/**
 * Companion orchestrator — brain ↔ body ↔ memory ↔ skills ↔ voice.
 *
 * Turn flow: input → processing (thinking face + waiting loop) → [research] → stream text (responding;
 * sentences spoken as they complete) → final validated metadata → side effects through their own
 * validated, consent-aware modules → plan → gestures/after-actions → completion → idle.
 * Every turn has a token: a cancelled or superseded turn can never overwrite a newer one (Asset 46).
 * Success reactions only follow verified results (Asset 36); failures get an explanation + retry (35, 47).
 */
import { validateRobotName } from '../../shared/identity';
import { BrainResponseSchema, type BrainResponse, type ExpressionPreset, type ServerCapabilities, type Pose } from '../../shared/schema';
import type { AnimationEngine } from '../animation/engine';
import type { ExpressionController } from '../expressions/expressionController';
import type { SkillRegistry } from '../skills/registry';
import type { LearningSystem, LearnOutcome } from '../skills/learning';
import type { MemoryStore, Settings } from '../memory/store';
import { ApiClient, ApiError } from '../ai/apiClient';
import { buildContext, msgId, SESSION_LIMIT, type UIMessage } from '../ai/context';
import { planFromResponse, type PlannedStep } from '../ai/planner';
import { browserCaps, computeCapabilities, type Capability } from '../ai/capabilities';
import { SkillRunner } from './skillRunner';
import { StateMachine, type CompanionState } from './stateMachine';
import { Notifications } from './notifications';
import type { CharacterRuntime } from './characterRuntime';
import { takeSentences, visemeFor } from '../voice/tts';
import type { SpeechIn, SpeechOut } from '../voice/serverVoice';
import { VoiceInputRouter, VoiceOutputRouter } from '../voice/router';
import { VOICE_STOP } from '../voice/recognition';
import { micPermission, type MicState } from '../voice/mic';
import { Diagnostics } from '../diagnostics/log';
import { sanitizeUserText } from '../security/validation';
import { SkillSandbox } from '../skills/sandbox';
import type { ChatStore } from './chats';
import { applyTheme } from '../theme';
import { describeDue, parseReminder, type Reminder, type ReminderStore } from './reminders';
import type { ResponseMeta } from '../../shared/schema';

export interface Snapshot {
  state: CompanionState; messages: UIMessage[]; caps: ServerCapabilities | null; capabilities: Capability[];
  listening: boolean; interim: string; draft: string | null; speaking: boolean; error: string | null; lastSkillId: string | null;
  /** what we actually know about the AI connection — from real requests and connection tests, never from saved config alone */
  connection: { state: 'untested' | 'ok' | 'demo' | 'failed'; at: number | null; detail: string };
  preview: { id: string; version: number; kind: string; name: string } | null; mic: MicState; busy: boolean;
}
export interface CompanionDeps {
  runtime: CharacterRuntime; registry: SkillRegistry; memory: MemoryStore; learning: LearningSystem; api: ApiClient;
  tts?: SpeechOut; stt?: SpeechIn; persistent: boolean; restAfterMs?: number; silentMsPerChar?: number;
  chats?: ChatStore; reminders?: ReminderStore;
}

/** Meta for replies produced on this device without any AI (reminders, greetings). */
export const ON_DEVICE_META: ResponseMeta = { provider: 'on-device', model: null, isLLM: false, latencyMs: 0, streamed: false, repaired: false, droppedFields: [], degraded: false, historySent: 0, promptVersion: 'local', research: { used: false, provider: null, count: 0 } };

const REMEMBER_RE = /\b(remember|note|keep in mind|don'?t forget|save (this|that))\b/i;

export class Companion {
  readonly sm = new StateMachine();
  readonly diagnostics = new Diagnostics();
  readonly notifications: Notifications;
  readonly runner: SkillRunner;
  readonly sandbox = new SkillSandbox();
  readonly tts: SpeechOut; readonly stt: SpeechIn;
  /** set when the app chose engines itself (not injected by a test) */
  readonly voiceOut: VoiceOutputRouter | null = null; readonly voiceIn: VoiceInputRouter | null = null;
  readonly engine: AnimationEngine; readonly expressions: ExpressionController;
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private token = 0;
  private reqAbort: AbortController | null = null;
  private seqAbort: AbortController | null = null;
  private lastSent = { text: '', at: 0 };
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private speechDone: (() => void) | null = null;
  private sessionPrefs: Record<string, string> = {};

  constructor(private d: CompanionDeps) {
    this.engine = d.runtime.engine; this.expressions = d.runtime.expressions;
    if (d.tts) this.tts = d.tts; else { const r = new VoiceOutputRouter(); r.onNotice = (m) => this.notifications.push('error', m, { react: false }); this.voiceOut = r; this.tts = r; }
    if (d.stt) this.stt = d.stt; else { const r = new VoiceInputRouter(); this.voiceIn = r; this.stt = r; }
    this.runner = new SkillRunner(this.engine, d.registry);
    this.notifications = new Notifications(() => this.settings, (kind) => { if (kind !== 'error') void this.react('notify'); });
    this.snap = { state: 'idle', messages: [], caps: null, capabilities: [], listening: false, interim: '', draft: null, speaking: false, error: null, lastSkillId: null, preview: null, mic: 'unknown', busy: false, connection: { state: 'untested', at: null, detail: 'No request yet' } };
    this.sm.on((s, prev) => this.onState(s, prev));
    this.tts.hooks = {
      onStart: () => { this.engine.setSpeaking(true); if (this.sm.state === 'responding' || this.sm.state === 'processing') this.sm.go('speaking'); this.set({ speaking: true }); },
      onWord: (w) => { const v = visemeFor(w); this.engine.speechPulse(v.open, v.round); },
      onLevel: (l) => { if (this.engine.isSpeaking()) this.engine.speechLevel(l); },
      onIdle: () => { this.engine.setSpeaking(false); this.set({ speaking: false }); const f = this.speechDone; this.speechDone = null; f?.(); },
    };
    this.engine.on('recovered', (e) => this.diagnostics.log({ type: 'skill', code: 'watchdog_recovery', detail: `${e.skillId}: ${e.reason}` }));
  }

  get settings(): Settings { return this.d.memory.settings; }
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.snap;
  private set(p: Partial<Snapshot>) { this.snap = { ...this.snap, ...p, state: this.sm.state }; this.listeners.forEach((f) => f()); if (p.messages) this.schedulePersist(); }

  /* ---------------- saved chats ---------------- */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private restoring = false;
  private schedulePersist() {
    const chats = this.d.chats; if (!chats || this.restoring) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => { void this.persistNow(); }, 400);
  }
  /** Saves the conversation (only settled messages count; in-flight ones are stored as cancelled). */
  async persistNow(): Promise<boolean> {
    const chats = this.d.chats; if (!chats || !this.settings.saveChats) return false;
    if (this.snap.messages.some((m) => m.status === 'sending' || m.status === 'streaming')) { this.schedulePersist(); return false; }
    try { return await chats.saveCurrent(this.snap.messages); } catch (e) { this.diagnostics.log({ type: 'storage', code: 'chat_save_failed', detail: (e as Error).message }); return false; }
  }
  /** Starts a new chat; the current one stays in Chats (if saving is on). */
  async newChat() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.interrupt('new chat'); // marks a streaming reply as cancelled so it is saved, not dropped
    await this.persistNow();
    await this.resetConversation();
    await this.d.chats?.startNew();
  }
  async openChat(id: string): Promise<boolean> {
    const chats = this.d.chats; if (!chats) return false;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.interrupt('open chat');
    await this.persistNow();
    const c = await chats.open(id); if (!c) return false;
    this.interrupt('open chat'); this.sm.reset();
    this.restoring = true; this.set({ messages: c.messages.map((m) => ({ ...m })) as UIMessage[] }); this.restoring = false;
    return true;
  }
  async deleteChat(id: string) {
    const chats = this.d.chats; if (!chats) return;
    const wasCurrent = id === chats.currentId;
    if (wasCurrent && this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    await chats.remove(id);
    if (wasCurrent) { this.interrupt('chat deleted'); this.restoring = true; this.set({ messages: [] }); this.restoring = false; this.sm.reset(); this.set({}); }
  }
  /** Asks the model again for the last reply. */
  async regenerate() {
    const last = [...this.snap.messages].reverse().find((m) => m.role === 'assistant' && m.replyTo);
    if (!last || this.snap.busy) return false;
    await this.retry(last.id); return true;
  }
  /** Replaces your last message (and everything after it) with an edited version and sends it. */
  async editLast(text: string, expectedId?: string) {
    const msgs = this.snap.messages; const i = msgs.map((m) => m.role).lastIndexOf('user');
    if (i < 0 || !sanitizeUserText(text)) return false;
    if (expectedId && msgs[i].id !== expectedId) return false; // the chat changed since editing started
    this.interrupt('edit');
    for (const m of msgs.slice(i)) if (m.reminderId) await this.d.reminders?.cancel(m.reminderId).catch(() => {}); // an edited reminder replaces the old one
    this.set({ messages: msgs.slice(0, i) });
    this.lastSent = { text: '', at: 0 };
    await this.send(text); return true;
  }

  /* ---------------- reminders ---------------- */
  private onReminder(r: Reminder) {
    const label = r.kind === 'timer' ? (r.text === 'Timer' ? 'Timer finished' : `Timer finished: ${r.text}`) : `Reminder: ${r.text}`;
    const due = new Date(r.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // "late" = it came due while NEXUS was closed; a short delay (sleep, background-tab throttling) just shows the due time
    const late = r.late ? ` (due ${due} — ${this.robotName} wasn't open then)` : (r.firedAt ?? Date.now()) - r.dueAt > 90_000 ? ` (due ${due})` : '';
    this.push({ role: 'system', text: `⏰ ${label}${late}`, status: 'complete' });
    this.notifications.push('reminder', `⏰ ${label}${late}`, { essential: true, react: !this.settings.quietMode, sound: true, desktop: true });
    if (!this.settings.quietMode) this.expressions.set('reaction', 'surprised', 0.8, 1.2);
    if (this.settings.voiceOutput && this.tts.supported && !this.tts.speaking) this.tts.enqueue(label, 'warm');
  }

  private push(m: Omit<UIMessage, 'id' | 'at'>): UIMessage {
    const msg: UIMessage = { ...m, id: msgId(), at: Date.now() };
    const msgs = [...this.snap.messages, msg]; if (msgs.length > SESSION_LIMIT) msgs.splice(0, msgs.length - SESSION_LIMIT);
    this.set({ messages: msgs }); return msg;
  }
  private patch(id: string, p: Partial<UIMessage>) { this.set({ messages: this.snap.messages.map((m) => (m.id === id ? { ...m, ...p } : m)) }); }
  private msg(id: string) { return this.snap.messages.find((m) => m.id === id); }

  /* ---------------- identity (Section 6) ---------------- */
  /** The robot's current display name — the one source of truth is the saved settings. */
  get robotName(): string { return this.settings.robotName; }
  private renaming = false;
  /**
   * Renames the robot. Validates, saves, reads the setting back, and only then reports success.
   * Touches nothing else: conversation, memories, skills, provider config and the engine are left as they are.
   */
  async renameRobot(raw: string): Promise<{ ok: true; name: string; changed: boolean } | { ok: false; error: string }> {
    const v = validateRobotName(raw);
    if (!v.ok) return v;
    if (this.renaming) return { ok: false, error: 'A rename is already being saved.' };
    if (v.name === this.robotName) return { ok: true, name: v.name, changed: false };
    this.renaming = true;
    try {
      await this.d.memory.updateSettings({ robotName: v.name });
      if (this.robotName !== v.name) return { ok: false, error: 'The new name could not be confirmed after saving. Please try again.' };
      this.diagnostics.log({ type: 'state', code: 'robot_renamed' });
      this.notifications.push('success', `Saved — your robot is now called ${v.name}.`, { react: false });
      return { ok: true, name: v.name, changed: true };
    } catch (e) {
      return { ok: false, error: `${(e as Error).message || 'The name could not be saved.'} Your robot keeps its previous name.` };
    } finally { this.renaming = false; }
  }

  /** Once per calendar day: a local (non-AI) hello with today's reminders. */
  async dailyGreeting(now = new Date()) {
    if (!this.settings.dailyGreeting) return false;
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (this.settings.lastGreetDay === day) return false;
    try { await this.d.memory.updateSettings({ lastGreetDay: day }); } catch { return false; }
    const h = now.getHours();
    const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const today = (this.d.reminders?.pending() ?? []).filter((r) => r.dueAt <= endOfDay.getTime());
    const list = today.length ? ` You have ${today.length} reminder${today.length > 1 ? 's' : ''} today: ${today.slice(0, 3).map((r) => `${r.text} (${new Date(r.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`).join(', ')}${today.length > 3 ? '…' : ''}.` : '';
    this.push({ role: 'system', text: `${part}! ${this.robotName} is here.${list}`, status: 'complete' });
    // low priority (0): never overrides the face the AI chose for a reply that is already on screen
    if (!this.settings.quietMode && !this.settings.reducedMotion && this.settings.greeted && !this.snap.busy) this.expressions.set('reaction', 'happy', 0.7, 2, 0);
    return true;
  }

  /* ---------------- lifecycle ---------------- */
  private initP: Promise<void> | null = null;
  /** Safe to call more than once (StrictMode, navigating home and back): the work runs once. */
  init() { return (this.initP ??= this.doInit()); }
  private async doInit() {
    await Promise.all([this.d.registry.ready, this.d.memory.ready, this.d.chats?.ready, this.d.reminders?.ready]);
    const cur = this.d.chats?.current;
    if (cur && this.settings.saveChats && !this.snap.messages.length) { this.restoring = true; this.set({ messages: cur.messages.map((m) => ({ ...m })) as UIMessage[] }); this.restoring = false; }
    if (this.d.reminders) { this.d.reminders.onFire = (r) => this.onReminder(r); void this.d.reminders.tick(); }
    for (const e of this.d.registry.usableExpressions()) this.expressions.register(e);
    this.applySettings();
    await this.refreshStatus();
    const mic = await micPermission((s) => { this.set({ mic: s }); this.refreshCaps(); });
    this.set({ mic: this.stt.supported ? mic : 'unsupported' });
    this.refreshCaps();
    for (const e of [...this.d.memory.loadErrors, ...(this.d.registry.lastError ? [this.d.registry.lastError] : [])]) this.notifications.push('error', e, { essential: true, react: false });
    if (this.d.registry.quarantined.length) this.notifications.push('info', `${this.d.registry.quarantined.length} saved skill version(s) failed re-validation and were quarantined.`, { react: false });
    const style = this.settings.greetingStyle;
    if (style !== 'none' && (!this.settings.greeted || this.settings.greetEverySession)) { // Asset 31: greet on the first session (or every session if chosen)
      this.sm.go('greeting'); await this.runner.run({ skillId: style }, { tag: 'greeting' });
      if (!this.settings.greeted) { try { await this.d.memory.updateSettings({ greeted: true }); } catch { /* ignore */ } }
      if (this.sm.state === 'greeting') this.sm.go('idle');
    }
    await this.dailyGreeting();
    this.armRest(); this.armAmbient();
  }
  applySettings() {
    const s = this.settings;
    this.engine.intensity = s.animationIntensity;
    this.engine.reducedMotion = s.reducedMotion;
    this.engine.idleEnabled = !s.reducedMotion && s.idleLevel !== 'off';
    this.engine.idleScale = { off: 0, calm: 0.5, normal: 1, lively: 1.6 }[s.idleLevel];
    this.engine.speechMouth = s.speakingMouth;
    this.expressions.setBaseline(s.defaultExpression);
    applyTheme(s.theme);
    this.expressions.allowPlayful = s.playfulReactions && !s.quietMode;
    this.tts.rate = s.speechRate; this.tts.voiceURI = s.voiceURI; this.tts.character = s.voiceCharacter; if (this.voiceOut) this.voiceOut.allowFallback = s.voiceFallback; this.voiceOut?.configure(!!this.snap.caps?.speech?.tts.configured, s.voiceEngine); this.voiceIn?.configure(!!this.snap.caps?.speech?.stt.configured, s.voiceEngine);
    this.diagnostics.includeContent = s.diagnosticsIncludeContent;
  }
  async refreshStatus() { const caps = await this.d.api.status(); this.set({ caps }); this.configureVoice(); this.refreshCaps(); return caps; }
  /** choose voice engines from the server's real speech status and the user's preference */
  configureVoice() {
    const c = this.snap.caps; const pref = this.settings.voiceEngine;
    this.voiceOut?.configure(!!c?.speech?.tts.configured, pref); this.voiceIn?.configure(!!c?.speech?.stt.configured, pref);
    this.set({ mic: this.stt.supported ? (this.snap.mic === 'unsupported' ? 'unknown' : this.snap.mic) : 'unsupported' });
  }
  refreshCaps() { this.set({ capabilities: computeCapabilities(this.snap.caps, browserCaps(this.snap.mic), this.d.persistent, this.snap.connection) }); }

  /* ---------------- state → face/indicator ---------------- */
  private onState(s: CompanionState, prev: CompanionState) {
    const X = this.expressions;
    this.d.runtime.resting = s === 'resting';
    if (prev === 'resting') this.d.runtime.kick();
    if (s === 'listening') X.set('system', 'listening', 1, null, 4);
    else if (s === 'processing') X.set('system', 'thinking', 1, null, 3);
    else if (s === 'error') X.set('system', 'error', 1, null, 5);
    else if (s === 'recovering') { X.set('system', 'reassuring', 1, null, 4); void this.runner.run({ skillId: 'return_to_idle' }, { tag: 'recover' }); }
    else if (s === 'paused') X.set('system', 'interested', 0.8, null, 1);
    else if (s === 'resting') X.set('system', 'resting', 1, null, 0);
    else if (s === 'speaking') X.set('system', 'speaking', 0.9, null, 1); // only while speech audio actually plays
    else X.release('system');
    // the chest core / forehead light mirror the real state: "speaking" only while audio plays, "responding" while text streams
    if (!this.successFlash) this.d.runtime.setIndicator(this.indicatorFor(s));
    if (s === 'listening') { this.engine.lookAt(0, 0, 'user'); void this.runner.run({ skillId: 'listen_lean' }, { tag: 'listening' }); }
    if (prev === 'listening') this.engine.cancelTag('listening');
    if (prev === 'resting') this.engine.setPose('neutral');
    if (s === 'resting') this.engine.setPose('resting');
    if (s === 'responding') this.engine.lookAt(0.6, 0.1, 'chat');
    if (s === 'idle') this.engine.lookAt(null);
    this.diagnostics.log({ type: 'state', code: `${prev}->${s}` });
    this.set({});
  }
  private armRest() {
    if (this.restTimer) clearTimeout(this.restTimer);
    this.restTimer = setTimeout(() => { if (this.sm.state === 'idle' && !this.engine.active().length) this.sm.go('resting'); }, this.d.restAfterMs ?? 120000);
  }
  private wake() { this.armRest(); this.armAmbient(); if (this.sm.state === 'resting') this.sm.go('idle'); }

  /* ---------------- liveliness ---------------- */
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private typingSince = 0;
  /** While you type, the robot looks at the chat with an attentive face (and leans in once per message). */
  noteTyping(active: boolean) {
    if (this.typingTimer) clearTimeout(this.typingTimer);
    const idleish = this.sm.state === 'idle' || this.sm.state === 'resting';
    if (!active || !idleish) { this.expressions.release('attention'); if (!active) this.typingSince = 0; if (this.gazeOnChat) { this.engine.lookAt(null); this.gazeOnChat = false; } return; }
    if (this.sm.state === 'resting') this.wake(); else this.armAmbient();
    this.engine.lookAt(0.85, 0.2, 'chat'); this.gazeOnChat = true;
    this.expressions.set('attention', 'listening', 0.55, null, 1);
    if (!this.typingSince) {
      this.typingSince = Date.now();
      const s = this.settings;
      if (!s.reducedMotion && !s.quietMode && !this.engine.active().length) void this.runner.run({ skillId: 'head_forward', amplitude: 0.4 }, { tag: 'attention' }).catch(() => {});
    }
    this.typingTimer = setTimeout(() => { this.expressions.release('attention'); this.engine.lookAt(null); this.gazeOnChat = false; this.typingSince = 0; }, 2500);
  }
  private gazeOnChat = false;
  private ambientTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAmbient: string | null = null;
  /** Now and then, while idle, the robot does a small thing (looks around, stretches, wiggles its antenna). */
  armAmbient(delayMs = 25_000 + Math.random() * 25_000) {
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    this.ambientTimer = setTimeout(() => { void this.ambient(); }, delayMs);
  }
  async ambient(force = false): Promise<string | null> {
    const s = this.settings;
    const allowed = s.ambientBehaviours && !s.quietMode && !s.reducedMotion && s.idleLevel !== 'off';
    const quiet = this.sm.state !== 'idle' || this.snap.busy || this.snap.listening || this.tts.speaking || this.engine.active().some((a) => a.phase !== 'out') || (typeof document !== 'undefined' && document.hidden);
    if (!force && (!allowed || quiet)) { this.armAmbient(); return null; }
    const pool = ['look_around', 'stretch', 'antenna_wiggle', 'head_tilt'].filter((x) => x !== this.lastAmbient && this.d.registry.get(x));
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? null;
    if (pick) { this.lastAmbient = pick; await this.runner.run({ skillId: pick, amplitude: s.idleLevel === 'calm' ? 0.6 : 1 }, { tag: 'ambient' }).catch(() => {}); }
    this.armAmbient();
    return pick;
  }

  /* ---------------- reactions ---------------- */
  private async react(id: 'notify' | 'complete_nod' | 'celebrate' | 'error_react') {
    const s = this.settings;
    const optional = id !== 'error_react';
    if (optional && s.quietMode) return;
    if (id === 'complete_nod' && !s.completionReaction) return;
    if (id === 'notify' && !s.notificationReactions) return;
    if (id === 'celebrate' && !s.playfulReactions) return;
    await this.runner.run({ skillId: id }, { tag: 'reaction' });
  }
  /** Asset 36 — only after a verified result. */
  private successFlash: ReturnType<typeof setTimeout> | null = null;
  private indicatorFor(s: CompanionState) {
    return s === 'listening' ? 'listening' : s === 'processing' ? 'processing' : s === 'responding' ? 'responding' : s === 'speaking' ? 'speaking' : s === 'acting' || s === 'greeting' ? 'acting' : s === 'error' ? 'error' : this.snap.caps?.provider === 'local-demo' ? 'offline' : 'idle';
  }
  /** Called only after a save was read back and confirmed: success face + green core for a moment, then back to the real state. */
  private async verifiedSuccess(text: string) {
    this.notifications.push('success', text, { react: false, sound: true });
    this.expressions.set('reaction', 'success', 1, 1.6, 2);
    if (this.successFlash) clearTimeout(this.successFlash);
    this.d.runtime.setIndicator('success');
    this.successFlash = setTimeout(() => { this.successFlash = null; this.d.runtime.setIndicator(this.indicatorFor(this.sm.state)); }, 1600);
    await this.react('celebrate');
  }

  /* ---------------- interruption ---------------- */
  interrupt(reason: string) {
    this.token++;
    if (this.reqAbort) { this.reqAbort.abort(reason); this.reqAbort = null; }
    if (this.seqAbort) { this.seqAbort.abort(reason); this.seqAbort = null; }
    this.tts.stop();
    this.engine.cancelTag('speech'); this.engine.cancelTag('waiting'); this.engine.setSpeaking(false);
    const live = this.snap.messages.filter((m) => m.status === 'streaming' || m.status === 'sending');
    for (const m of live) this.patch(m.id, { status: 'cancelled', stage: undefined });
    if (['processing', 'responding', 'speaking', 'acting', 'greeting'].includes(this.sm.state)) { this.sm.go('interrupted'); }
    this.set({ speaking: false, error: null, busy: false });
  }

  /** Reminder/timer requests are handled on this device (no AI involved) and say so. */
  private async handleReminder(text: string, r: NonNullable<ReturnType<typeof parseReminder>>) {
    const user = this.push({ role: 'user', text, status: 'complete' });
    let reply: string; let reminderId: string | undefined;
    if ('error' in r) reply = r.error;
    else {
      try {
        const saved = await this.d.reminders!.add(r);
        reminderId = saved.id;
        reply = saved.kind === 'timer' ? `⏱ Timer set — I'll let you know ${describeDue(saved.dueAt)}.` : `⏰ Got it — I'll remind you to **${saved.text}** ${describeDue(saved.dueAt)}.`;
        reply += ' Keep NEXUS open for the alert; you can see or cancel it under Reminders.';
        if (!this.settings.quietMode) void this.runner.run({ skillId: 'nod' }, { tag: 'reaction' });
      } catch (e) { reply = `I couldn't save that reminder: ${(e as Error).message}`; }
    }
    this.push({ role: 'assistant', text: reply, status: 'complete', replyTo: user.id, meta: ON_DEVICE_META, reminderId });
    if (!this.snap.busy && (this.sm.state === 'interrupted' || this.sm.state === 'error' || this.sm.state === 'recovering' || this.sm.state === 'paused')) this.go('idle');
  }

  /* ---------------- conversation ---------------- */
  recordConnection(state: Snapshot['connection']['state'], detail: string) { this.set({ connection: { state, at: Date.now(), detail: detail.slice(0, 160) } }); this.refreshCaps(); }
  /** The user explicitly asked for the scripted offline demo after the server could not be reached. */
  async answerWithOfflineDemo(assistantMsgId: string) {
    const a = this.msg(assistantMsgId); const u = a?.replyTo ? this.msg(a.replyTo) : undefined; if (!u) return;
    this.set({ messages: this.snap.messages.filter((m) => m.id !== a!.id && m.id !== u.id) });
    await this.send(u.text, { retryOf: a!.id, offlineDemo: true });
  }

  async send(raw: string, o: { voice?: boolean; retryOf?: string; offlineDemo?: boolean } = {}): Promise<void> {
    const text = sanitizeUserText(raw);
    if (!text) return;
    const now = Date.now();
    if (text === this.lastSent.text && now - this.lastSent.at < 1200 && !o.retryOf) return; // duplicate guard
    this.lastSent = { text, at: now };
    this.noteTyping(false);
    this.wake();
    // reminders are handled on device and must not cancel a reply that is still streaming
    if (this.d.reminders && !o.retryOf) {
      const r = parseReminder(text);
      if (r) { await this.handleReminder(text, r); return; }
    }
    this.interrupt('new input');
    if (this.stt.listening) this.stt.abort();
    const token = this.token;
    const user = this.push({ role: 'user', text, status: 'complete' });
    this.go('processing');
    this.set({ listening: false, interim: '', draft: null, busy: true, error: null });
    void this.waitingLoop(token);

    const asst = this.push({ role: 'assistant', text: '', status: 'sending', replyTo: user.id, stage: 'thinking' });
    const ctl = new AbortController(); this.reqAbort = ctl;
    const s = this.settings;
    const research = s.research && !!this.snap.caps?.research.configured;
    const t0 = performance.now();
    let streamed = '', ttsBuf = '', firstDelta = true, headApplied = false;
    let mouthTimer: ReturnType<typeof setInterval> | null = null;
    const voiceOn = s.voiceOutput && this.tts.supported;
    try {
      const call = o.offlineDemo ? this.d.api.offlineDemo.bind(this.d.api) : this.d.api.chat.bind(this.d.api);
      const result = await call({
        messages: buildContext(this.snap.messages.filter((m) => m.id !== asst.id), s.historyLimit),
        skills: this.d.registry.catalog(), expressions: this.expressions.ids().filter((x) => x !== '__preview'),
        memory: this.d.memory.contextLines(text), preferences: this.prefs(),
        profile: { responseStyle: s.responseStyle, language: s.language, robotName: s.robotName }, lastSkillId: this.runner.lastSkillId,
        research, stream: s.streaming,
      }, ctl.signal, {
        onStatus: (st) => { if (token === this.token) this.patch(asst.id, { stage: st }); },
        onSources: (src) => { if (token === this.token) this.patch(asst.id, { sources: src }); },
        onHead: (h) => {
          if (token !== this.token || headApplied) return; headApplied = true;
          this.applyExpression(h.expression, h.emotionIntensity);
        },
        onDelta: (t) => {
          if (token !== this.token) return;
          if (firstDelta) {
            firstDelta = false; this.engine.cancelTag('waiting'); this.expressions.release('system'); this.go('responding');
            if (!voiceOn) { this.engine.setSpeaking(true); mouthTimer = setInterval(() => this.engine.speechPulse(0.6), 180); } // approximate mouth while text streams
          }
          streamed += t;
          this.patch(asst.id, { text: streamed, status: 'streaming', stage: 'streaming' });
          if (voiceOn) { ttsBuf += t; const [sent, rest] = takeSentences(ttsBuf); ttsBuf = rest; for (const x of sent) this.tts.enqueue(x, 'warm'); }
        },
      });
      if (token !== this.token) return;
      this.reqAbort = null;
      if (mouthTimer) { clearInterval(mouthTimer); mouthTimer = null; this.engine.setSpeaking(false); }
      const resp = BrainResponseSchema.parse(result.response);   // client-side re-validation (Asset 93)
      if (voiceOn && ttsBuf.trim()) this.tts.enqueue(ttsBuf, resp.speakingStyle);
      if (voiceOn && !streamed) this.tts.enqueue(resp.reply, resp.speakingStyle);
      this.diagnostics.log({ type: 'request', code: result.meta.isLLM ? 'llm_ok' : 'demo_ok', ms: Math.round(performance.now() - t0), detail: `${result.meta.provider}${result.meta.streamed ? ' streamed' : ''}${result.meta.droppedFields.length ? ` dropped:${result.meta.droppedFields.join(',')}` : ''}` }, text);
      const notes: string[] = [];
      if (result.offline) notes.push('You chose the offline demo: this answer is scripted (not an AI) because the NEXUS server was unreachable.');
      if (!result.offline) this.recordConnection(result.meta.isLLM ? 'ok' : 'demo', result.meta.isLLM ? `${result.meta.model ?? result.meta.provider} answered` : 'Demo brain answered (not an LLM)');
      if (result.meta.degraded) notes.push('The model output did not follow the format; showing text only and running no actions.');
      if (result.meta.droppedFields.length) notes.push(`Ignored invalid fields from the model: ${[...new Set(result.meta.droppedFields)].join(', ')}.`);
      if (research && result.meta.research.error) notes.push(result.meta.research.error);
      if (s.research && !this.snap.caps?.research.configured) notes.push('Research is on, but no research provider is configured — answered without live sources.');
      this.patch(asst.id, { text: resp.reply, status: 'complete', stage: undefined, meta: result.meta, response: resp, notes, changes: [{ scope: 'conversation', text: 'This reply is part of the conversation only.' }] });
      if (!headApplied) this.applyExpression(resp.expression, resp.emotionIntensity);
      if (resp.pose !== 'neutral' || this.engine.getPose() !== 'neutral') this.engine.setPose(resp.pose as Pose);
      if (typeof document !== 'undefined' && document.hidden) this.notifications.push('response', `${this.robotName} replied.`, { react: false, desktop: true });
      await this.sideEffects(resp, text, asst.id, token);
      if (token !== this.token) return;
      await this.performPlan(resp, token, asst.id, voiceOn);
    } catch (e) {
      if (mouthTimer) { clearInterval(mouthTimer); this.engine.setSpeaking(false); }
      if (token !== this.token) return;
      const err = e instanceof ApiError ? e : new ApiError((e as Error).message, 'internal', false);
      if (err.code === 'cancelled') { this.patch(asst.id, { status: 'cancelled', stage: undefined }); return; }
      this.fail(asst.id, err, streamed);
    }
  }

  private applyExpression(id: string, intensity: number) {
    const ok = this.expressions.set('response', this.expressions.has(id) ? id : 'neutral', Math.max(0.4, intensity));
    const idle = this.expressions.idleMotion();
    if (ok && idle && !this.settings.reducedMotion) void this.runner.run({ skillId: idle, repetitions: 2 }, { tag: 'speech' });
  }
  private prefs() { return { ...this.d.memory.prefs, ...this.sessionPrefs }; }

  private async waitingLoop(token: number) { // Asset 37 — calm loop only while genuinely waiting
    while (token === this.token && this.sm.state === 'processing') {
      const r = await this.runner.run({ skillId: 'waiting' }, { tag: 'waiting' });
      if (r !== 'completed') break;
    }
  }

  private fail(asstId: string, err: ApiError, partial: string) {
    this.engine.cancelTag('waiting'); this.engine.cancelTag('speech'); this.engine.setSpeaking(false); this.tts.stop();
    const hint = err.code === 'unconfigured' ? ' Open Settings → Model to configure a provider.' : err.code === 'rate_limited' ? ' Wait a moment, then retry.' : err.retryable ? ' You can retry.' : '';
    this.patch(asstId, { status: 'failed', stage: undefined, text: partial, error: { message: err.message + hint, code: err.code, retryable: err.retryable || err.code === 'timeout' || err.code === 'network' || err.code === 'offline' } });
    if (['offline', 'network', 'timeout', 'provider', 'unconfigured', 'rate_limited', 'malformed'].includes(err.code)) this.recordConnection('failed', err.message);
    this.go('error');
    this.set({ error: err.message, busy: false, speaking: false });
    this.diagnostics.log({ type: 'error', code: err.code, detail: err.message });
    this.notifications.push('error', err.message, { essential: true, react: false, sound: true });
    void this.react('error_react');
    const token = this.token;
    // ERROR → RECOVERING (calm, reassuring face, limbs settle) → IDLE; a newer request cancels this path (token check)
    setTimeout(() => { if (token === this.token && this.sm.state === 'error') { this.go('recovering'); setTimeout(() => { if (token === this.token && this.sm.state === 'recovering') this.go('idle'); }, 900); } }, 3200);
  }

  async retry(assistantMsgId: string) {
    const a = this.msg(assistantMsgId); if (!a?.replyTo) return;
    const u = this.msg(a.replyTo); if (!u) return;
    this.set({ messages: this.snap.messages.filter((m) => m.id !== a.id && m.id !== u.id) });
    await this.send(u.text, { retryOf: a.id });
  }
  cancel() {
    if (!this.snap.busy && !this.tts.speaking) return;
    this.interrupt('user cancelled');
    this.diagnostics.log({ type: 'request', code: 'cancelled' });
    if (this.sm.state === 'interrupted') this.go('idle');
  }

  /* ---------------- side effects (validated, consent-aware) ---------------- */
  private async sideEffects(resp: BrainResponse, userText: string, msgIdV: string, token: number) {
    const M = this.d.memory; const changes = [...(this.msg(msgIdV)?.changes ?? [])]; const notes = [...(this.msg(msgIdV)?.notes ?? [])];
    const explicitAsk = REMEMBER_RE.test(userText);
    for (const c of resp.memoryCandidates) {
      if (!M.settings.memoryEnabled) { notes.push('Memory is off — nothing was saved.'); break; }
      if (c.explicit && explicitAsk) {
        const r = await M.remember(c, 'explicit_request');
        this.diagnostics.log({ type: 'memory', code: r.status });
        changes.push({ scope: 'memory', text: r.status === 'saved' ? `Saved memory: "${r.item!.text}"${r.superseded?.length ? ` (replaced "${r.superseded[0].text}")` : ''}` : r.message });
        if (r.status === 'saved') void this.verifiedSuccess('Memory saved and verified.');
      } else {
        const sug = M.suggest(c);
        if (sug) { changes.push({ scope: 'memory', text: `Suggested memory awaiting your OK: "${sug.text}" (nothing saved yet)` }); this.notifications.push('memory', 'NEXUS suggested something to remember — review it below the reply.', { react: true }); }
      }
    }
    if (resp.preferenceUpdate) {
      const sid = resp.preferenceUpdate.skillId === 'last' ? this.runner.lastSkillId : resp.preferenceUpdate.skillId;
      if (sid && this.d.registry.get(sid)) {
        if (M.settings.memoryEnabled) { try { await M.setPreference(resp.preferenceUpdate.context, sid); changes.push({ scope: 'preference', text: `Saved preference: ${resp.preferenceUpdate.context} → ${sid}` }); } catch (e) { notes.push(`Preference not saved: ${(e as Error).message}`); } }
        else { this.sessionPrefs[resp.preferenceUpdate.context] = sid; changes.push({ scope: 'preference', text: `Preference applied for this session only (memory is off): ${resp.preferenceUpdate.context} → ${sid}` }); }
      } else notes.push('Preference not saved — that skill is not approved.');
    }
    if (resp.feedback) {
      const sid = resp.feedback.skillId === 'last' ? this.runner.lastSkillId : resp.feedback.skillId;
      if (sid && await this.d.learning.rate(sid, resp.feedback.rating === 'up', resp.feedback.note)) changes.push({ scope: 'skill_registry', text: `Recorded ${resp.feedback.rating === 'up' ? 'positive' : 'negative'} feedback for "${sid}"` });
    }
    let learn: LearnOutcome | undefined;
    if (resp.skillRefinement) learn = await this.d.learning.refine(resp.skillRefinement, this.runner.lastSkillId);
    if (resp.skillProposal) learn = await this.d.learning.propose(resp.skillProposal);
    if (learn) {
      changes.push({ scope: 'skill_registry', text: learn.message });
      this.diagnostics.log({ type: 'skill', code: `proposal_${learn.status}`, detail: learn.skillId });
      if (learn.status === 'proposed') this.notifications.push('skill', `"${learn.skillId}" is ready to preview and approve.`, { react: true, sound: true });
      if (learn.status === 'saved' && learn.skillId) void this.verifiedSuccess(`Refinement of "${learn.skillId}" saved.`);
    }
    if (token === this.token) this.patch(msgIdV, { changes, notes, learn });
  }

  private async performPlan(resp: BrainResponse, token: number, msgIdV: string, voiceOn: boolean) {
    const plan = planFromResponse(resp, this.d.registry, this.prefs());
    const m = this.msg(msgIdV);
    if (m) this.patch(msgIdV, { notes: [...(m.notes ?? []), ...plan.notes, ...plan.unsupported.map((u) => `Unsupported: ${u.request} — ${u.reason}`)] });
    const seq = new AbortController(); this.seqAbort = seq;
    const run = async (steps: PlannedStep[], tag?: string) => { for (const s of steps) { if (seq.signal.aborted || token !== this.token) return; const r = await this.runner.run(s, { tag, signal: seq.signal }); this.set({ lastSkillId: this.runner.lastSkillId }); if (r === 'missing') this.notifications.push('info', `"${s.skillId}" is unavailable.`, { react: false }); } };
    if (plan.before.length) { this.go('acting'); await run(plan.before); }
    const during = run(plan.during, 'speech');
    // a longer spoken reply with no chosen gesture gets one restrained speaking beat (never in quiet or reduced-motion mode)
    if (voiceOn && this.tts.speaking && !plan.during.length && !plan.before.length && resp.reply.length > 140 && !this.settings.quietMode && !this.settings.reducedMotion) void this.runner.run({ skillId: 'speak_beat' }, { tag: 'speech', signal: seq.signal });
    if (voiceOn && this.tts.speaking) {
      if (this.sm.state !== 'speaking') this.go('speaking');
      await new Promise<void>((res) => { this.speechDone = res; if (!this.tts.speaking) res(); });
    } else if (!voiceOn && this.d.silentMsPerChar !== 0) await this.silentSpeech(resp.reply, token);
    if (token !== this.token) return;
    await during;
    if (plan.after.length) { this.go('acting'); await run(plan.after); }
    if (token !== this.token) return;
    this.seqAbort = null;
    this.set({ busy: false });
    if (resp.uncertainty !== 'high' && !resp.clarification) void this.react('complete_nod');
    this.go('idle');
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { if (token === this.token && this.sm.state === 'idle') { this.expressions.release('response'); this.engine.setPose('neutral'); } }, 7000);
    this.armRest();
  }
  /** Text-only mode: brief approximate mouth movement (not lip-sync). */
  private silentSpeech(text: string, token: number) {
    const ms = Math.min(2500, Math.max(500, text.length * (this.d.silentMsPerChar ?? 18)));
    this.engine.setSpeaking(true);
    return new Promise<void>((res) => { const iv = setInterval(() => { if (token !== this.token) { clearInterval(iv); this.engine.setSpeaking(false); res(); } else this.engine.speechPulse(0.5); }, 160); setTimeout(() => { clearInterval(iv); this.engine.setSpeaking(false); res(); }, ms); });
  }

  private go(s: CompanionState) {
    if (!this.sm.go(s)) {
      // legal fallback paths, e.g. interrupted → processing
      if (this.sm.state === 'interrupted' || this.sm.state === 'error' || this.sm.state === 'recovering' || this.sm.state === 'paused' || this.sm.state === 'resting') { this.sm.go('idle'); this.sm.go(s); }
    }
    this.set({});
  }

  /* ---------------- voice ---------------- */
  startListening() {
    if (!this.stt.supported) { this.notifications.push('info', this.voiceIn?.isDesktop ? 'Voice input needs a transcription service in the desktop app (Settings → Voice), or type instead.' : 'Voice input is not supported in this browser — please type instead.', { react: false }); return; }
    this.wake();
    this.interrupt('listening');
    this.go('listening');
    this.set({ listening: true, interim: '', draft: null });
    this.stt.start({
      onInterim: (t) => this.set({ interim: t }),
      onTranscribing: () => { this.set({ listening: false }); if (this.sm.state === 'listening') this.go('processing'); },
      onFinal: (t) => {
        this.diagnostics.log({ type: 'voice', code: 'final' });
        if (VOICE_STOP.test(t.trim())) { this.cancel(); this.notifications.push('info', 'Stopped (voice command).', { react: false }); return; } // Asset 84
        if (this.settings.reviewTranscript) { this.set({ draft: t, interim: '' }); if (this.sm.state === 'listening' || this.sm.state === 'processing') this.go('idle'); }
        else void this.send(t, { voice: true });
      },
      onError: (m, code) => { this.diagnostics.log({ type: 'voice', code }); this.set({ listening: false, interim: '' }); if (this.sm.state === 'listening' || (this.sm.state === 'processing' && !this.snap.busy)) this.go('idle'); this.notifications.push(code === 'no-speech' ? 'info' : 'error', m, { react: false, essential: code === 'not-allowed' }); if (code === 'not-allowed') this.set({ mic: 'denied' }); },
      onState: (on) => { this.set({ listening: on }); if (on) this.set({ mic: 'granted' }); if (!on && this.sm.state === 'listening') this.go('idle'); },
    });
  }
  stopListening() { this.stt.stop(); }
  cancelListening() { this.stt.abort(); this.set({ listening: false, interim: '' }); if (this.sm.state === 'listening') this.go('idle'); }
  clearDraft() { this.set({ draft: null }); }
  /** PAUSED state (spec §7): holds the reply mid-sentence; the mouth closes while paused. */
  pauseSpeech(): boolean {
    if (this.sm.state !== 'speaking' || !this.tts.pause) return false;
    this.tts.pause(); this.engine.setSpeaking(false); this.go('paused'); return true;
  }
  resumeSpeech(): boolean {
    if (this.sm.state !== 'paused' || !this.tts.resume) return false;
    this.tts.resume(); this.engine.setSpeaking(true); this.go('speaking'); return true;
  }
  stopSpeaking() { this.tts.stop(); this.engine.cancelTag('speech'); this.engine.setSpeaking(false); }
  /** Reads one reply aloud on request (spec §13.2 play control). Uses the system's speech voices; reports when unavailable. */
  readAloud(text: string): boolean {
    if (!this.tts.supported) { this.notifications.push('error', 'Spoken replies are not available here — this system has no speech voices.', { react: false }); return false; }
    const plain = text.replace(/```[\s\S]*?```/g, ' (code) ').replace(/[*_`#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    if (!plain) return false;
    this.stopSpeaking(); this.tts.enqueue(plain.slice(0, 4000), 'warm'); return true;
  }

  /* ---------------- body controls ---------------- */
  stopAction() { this.seqAbort?.abort('stop'); this.seqAbort = null; this.engine.stopAll(); if (this.sm.state === 'acting') this.go('idle'); }
  resetCharacter() {
    this.interrupt('reset'); this.engine.reset(); this.expressions.release('response'); this.expressions.release('user'); this.expressions.release('system');
    this.engine.setPose('neutral'); this.sm.reset(); this.set({ busy: false, error: null });
  }
  /** Asset 39 — user-requested playback with an explicit unavailable state. */
  async playSkill(id: string, version?: number): Promise<'played' | 'unavailable' | 'blocked'> {
    this.wake();
    const v = this.d.registry.getVersion(id, version);
    if (!v) return 'unavailable';
    if (v.kind === 'expression') { if (!this.d.registry.getExpression(id) && !version) return 'unavailable'; this.expressions.set('user', id, 1, 3); return 'played'; }
    if (!this.d.registry.get(id)) return 'unavailable';
    if (this.sm.state === 'idle' || this.sm.state === 'error') this.go('acting');
    const r = await this.runner.run({ skillId: id });
    this.set({ lastSkillId: this.runner.lastSkillId });
    if (this.sm.state === 'acting') this.go('idle');
    if (r === 'rejected' || r === 'stuck') { this.notifications.push('info', `Couldn't play "${id}" right now — ${r === 'stuck' ? 'it did not finish and was reset' : 'too many movements are waiting'}.`, { react: false }); return 'blocked'; }
    return r === 'missing' ? 'unavailable' : 'played';
  }
  setPose(p: Pose) { this.wake(); this.engine.setPose(p); }
  showExpression(id: string) { this.wake(); return this.expressions.set('user', id, 1, 4); }

  /* ---------------- skills (preview → approve/reject) ---------------- */
  previewSkill(id: string, version?: number) {
    const v = this.d.registry.getVersion(id, version); if (!v) return false;
    this.set({ preview: { id, version: v.version, kind: v.kind, name: (v.def as { name: string }).name } });
    if (v.kind === 'expression') this.sandbox.preview({ kind: 'expression', def: v.def as ExpressionPreset });
    else this.sandbox.preview({ kind: v.kind, def: v.def as never, lookup: (x) => this.d.registry.get(x) });
    return true;
  }
  closePreview() { this.sandbox.stop(); this.set({ preview: null }); }
  async approve(id: string, version: number) {
    try { await this.d.learning.approve(id, version); }
    catch (e) { this.notifications.push('error', (e as Error).message, { essential: true }); return false; }
    // verify (Asset 79) before celebrating (Asset 36)
    const v = this.d.registry.getVersion(id, version);
    const ok = !!v && v.status === 'approved' && (v.kind === 'expression' ? !!this.d.registry.getExpression(id) : !!this.d.registry.get(id));
    if (ok && v!.kind === 'expression') this.expressions.register(v!.def as ExpressionPreset);
    this.diagnostics.log({ type: 'skill', code: ok ? 'approved' : 'approve_unverified', detail: id });
    if (ok) void this.verifiedSuccess(`"${id}" approved — it can now be reused.`);
    else this.notifications.push('error', `Approval of "${id}" could not be verified.`, { essential: true });
    if (this.snap.preview?.id === id) this.closePreview();
    return ok;
  }
  async reject(id: string, version: number) { await this.d.learning.reject(id, version); if (this.snap.preview?.id === id) this.closePreview(); this.diagnostics.log({ type: 'skill', code: 'rejected', detail: id }); }

  /* ---------------- memory consent ---------------- */
  async acceptSuggestion(id: string) {
    const r = await this.d.memory.acceptSuggestion(id);
    if (r?.status === 'saved') void this.verifiedSuccess('Memory saved and verified.');
    else if (r) this.notifications.push(r.status === 'error' ? 'error' : 'info', r.message, { react: false });
    return r;
  }

  async resetConversation() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const msgs = buildContext(this.snap.messages, 40);
    this.interrupt('reset conversation');
    this.set({ messages: [] }); this.sm.reset(); this.set({});
    if (this.settings.memoryEnabled && msgs.length >= 4) {
      const s = await this.d.api.summarize(msgs);
      if (s && await this.d.memory.addSummary(s, msgs.length).catch(() => false)) { this.notifications.push('memory', 'Conversation cleared; a short summary was saved (see Memory).', { react: false }); return; }
    }
    this.notifications.push('info', 'Conversation cleared.', { react: false });
  }
}
