/**
 * Assets 51–60 — memory & personalization.
 *  · Session memory (51) lives in the conversation; this store holds PERSISTENT, user-approved items (52).
 *  · Model-suggested memories are held as pending suggestions until the user accepts (53).
 *    An explicit "remember …" request from the user counts as consent.
 *  · Retrieval is relevance-ranked (54); every item records why/when it was saved (55).
 *  · Edit/delete remove the stored records (56). Conflicts resolve by key + timestamp + source priority (59).
 *  · Import/export are validated, never executed (60). Settings/profile persist here too (57).
 */
import { z } from 'zod';
import { DEFAULT_ROBOT_NAME, effectiveRobotName } from '../../shared/identity';
import { MEMORY_CATEGORIES, type MemoryCandidate } from '../../shared/schema';
import { StorageError, type KV } from '../storage/db';
import { jaccard, rankMemories } from './retrieval';
import { looksSensitive } from '../security/validation';

export type MemorySource = 'explicit_request' | 'accepted_suggestion' | 'manual' | 'import';
export const SOURCE_PRIORITY: Record<MemorySource, number> = { explicit_request: 3, manual: 3, accepted_suggestion: 2, import: 1 };

export const MemoryItemSchema = z.object({
  id: z.string().max(40), text: z.string().min(2).max(200), category: z.enum(MEMORY_CATEGORIES), key: z.string().max(40).regex(/^[a-z0-9_]*$/).optional(),
  reason: z.string().max(160).default(''), source: z.enum(['explicit_request', 'accepted_suggestion', 'manual', 'import']),
  createdAt: z.number(), updatedAt: z.number(), lastUsedAt: z.number().nullable().default(null),
  status: z.enum(['active', 'superseded']).default('active'), supersededBy: z.string().max(40).nullable().default(null),
}).strict();
export type MemoryItem = z.infer<typeof MemoryItemSchema>;
export interface Suggestion extends MemoryCandidate { id: string; at: number }
export interface Summary { id: string; text: string; createdAt: number; messages: number }

export const SETTINGS_VERSION = 3;
export const SettingsSchema = z.object({
  memoryEnabled: z.boolean().default(true),
  responseStyle: z.enum(['concise', 'balanced', 'detailed']).default('balanced'),
  language: z.string().max(40).default('English'),
  animationIntensity: z.number().min(0.3).max(1.3).default(1),
  voiceOutput: z.boolean().default(true),
  voiceURI: z.string().max(200).nullable().default(null),
  speechRate: z.number().min(0.6).max(1.6).default(1),
  speechVolume: z.number().min(0).max(1).default(1),
  /** cute: raise the pitch of this computer's voices and prefer a youthful one when the voice is "Automatic" */
  voiceCharacter: z.enum(['cute', 'natural']).default('cute'),
  /** if the voice service (ElevenLabs…) fails, speak with this computer's voice instead — off: never substitute silently */
  voiceFallback: z.boolean().default(false),
  /** say hello and introduce itself (name + who made it) each time the robot is opened */
  introduceOnOpen: z.boolean().default(true),
  reviewTranscript: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  highContrast: z.boolean().default(false),
  largeText: z.boolean().default(false),
  quietMode: z.boolean().default(false),
  sounds: z.boolean().default(false),
  playfulReactions: z.boolean().default(true),
  completionReaction: z.boolean().default(true),
  notificationReactions: z.boolean().default(true),
  desktopNotifications: z.boolean().default(false),
  research: z.boolean().default(false),
  streaming: z.boolean().default(true),
  refinementPolicy: z.enum(['require', 'auto_low_risk']).default('require'),
  historyLimit: z.number().int().min(2).max(40).default(16),
  environment: z.enum(['lab', 'grid', 'transparent']).default('lab'),
  effects: z.boolean().default(true),
  accessories: z.object({ antenna: z.boolean(), sidePanels: z.boolean(), chestLight: z.boolean(), cheekLights: z.boolean(), foreheadIndicator: z.boolean() })
    .default({ antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true }),
  diagnosticsIncludeContent: z.boolean().default(false),
  greeted: z.boolean().default(false),
  // Personalization (Settings → Personalization). The robot's display name lives here: one source of truth.
  robotName: z.string().max(200).default(DEFAULT_ROBOT_NAME).catch(DEFAULT_ROBOT_NAME).transform((v) => effectiveRobotName(v)),
  defaultExpression: z.enum(['neutral', 'happy', 'curious', 'determined', 'sleepy']).default('neutral').catch('neutral'),
  greetingStyle: z.enum(['greeting', 'wave', 'bounce', 'nod', 'none']).default('greeting').catch('greeting'),
  greetEverySession: z.boolean().default(false).catch(false),
  idleLevel: z.enum(['off', 'calm', 'normal', 'lively']).default('normal').catch('normal'),
  speakingMouth: z.boolean().default(true).catch(true),
  // Companion features
  saveChats: z.boolean().default(true).catch(true),
  dailyGreeting: z.boolean().default(true).catch(true),
  lastGreetDay: z.string().max(10).default('').catch(''),
  theme: z.enum(['dark', 'light', 'system']).default('dark').catch('dark'),
  ambientBehaviours: z.boolean().default(true).catch(true),
  setupDone: z.boolean().default(false).catch(false),
  robotSize: z.enum(['small', 'medium', 'large']).default('medium').catch('medium'),
  /** robot: the robot fills the window and voice comes first (default); workspace: robot + chat + panels side by side */
  layout: z.enum(['robot', 'workspace']).default('robot').catch('robot'),
  /** auto: the server speech service when configured, else this computer's voices / browser recognition */
  voiceEngine: z.enum(['auto', 'server', 'browser']).default('auto').catch('auto'),
  /** settings schema version — bump when a field changes meaning; unknown/invalid fields fall back to defaults */
  settingsVersion: z.number().int().default(SETTINGS_VERSION).catch(SETTINGS_VERSION),
});
/** Settings that "Reset personalization" restores (everything else — memories, skills, model, privacy — is untouched). */
export const PERSONALIZATION_KEYS = ['robotName', 'defaultExpression', 'greetingStyle', 'greetEverySession', 'idleLevel', 'speakingMouth', 'animationIntensity', 'environment', 'effects', 'accessories', 'playfulReactions', 'completionReaction', 'theme', 'ambientBehaviours', 'robotSize', 'layout'] as const;
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export type RememberResult = { status: 'saved' | 'disabled' | 'sensitive' | 'duplicate' | 'conflict' | 'error'; item?: MemoryItem; superseded?: MemoryItem[]; message: string };

export class MemoryStore {
  items: MemoryItem[] = [];
  suggestions: Suggestion[] = [];
  summaries: Summary[] = [];
  prefs: Record<string, string> = {};
  settings: Settings = { ...DEFAULT_SETTINGS };
  conflicts: { newer: Suggestion | MemoryItem; older: MemoryItem }[] = [];
  ready: Promise<void>;
  version = 0;
  loadErrors: string[] = [];
  private listeners = new Set<() => void>();

  constructor(private kv: KV) { this.ready = this.load(); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }

  private async load() {
    try {
      for (const row of await this.kv.all<unknown>('memory')) {
        const p = MemoryItemSchema.safeParse(row);
        if (p.success) this.items.push(p.data); else this.loadErrors.push('A corrupted memory record was skipped.');
      }
      this.summaries = (await this.kv.all<Summary>('summaries')).filter((s) => typeof s?.text === 'string').sort((a, b) => a.createdAt - b.createdAt);
      const prefs = await this.kv.get<Record<string, string>>('kv', 'prefs');
      if (prefs && typeof prefs === 'object') this.prefs = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));
      const st = SettingsSchema.safeParse({ ...(await this.kv.get<object>('kv', 'settings')) });
      if (st.success) this.settings = st.data; else this.loadErrors.push('Saved settings were invalid and were reset to defaults.');
    } catch (e) { this.loadErrors.push(`Memory storage unavailable: ${(e as Error).message}`); }
    this.changed();
  }

  /** Validates, persists, then publishes. On a failed write the previous settings stay in effect (nothing pretends to be saved). */
  async updateSettings(patch: Partial<Settings>) {
    const prev = this.settings;
    const next = SettingsSchema.parse({ ...this.settings, ...patch });
    this.settings = next; this.changed();
    try { await this.kv.put('kv', next, 'settings'); }
    catch (e) { this.settings = prev; this.changed(); throw new StorageError(`Settings could not be saved: ${(e as Error).message}`); }
  }
  async resetPersonalization() {
    const patch: Record<string, unknown> = {};
    for (const k of PERSONALIZATION_KEYS) patch[k] = DEFAULT_SETTINGS[k];
    await this.updateSettings(patch as Partial<Settings>);
  }

  active() { return this.items.filter((i) => i.status === 'active'); }

  /** Store a memory (explicit request, accepted suggestion, manual entry or import). */
  async remember(c: MemoryCandidate, source: MemorySource): Promise<RememberResult> {
    const text = c.text.trim().slice(0, 200);
    if (!this.settings.memoryEnabled) return { status: 'disabled', message: 'Memory is turned off — nothing was saved.' };
    if (looksSensitive(text)) return { status: 'sensitive', message: 'That looks like sensitive data (a password, card or ID number), so it was not saved.' };
    const act = this.active();
    if (act.some((m) => m.text.toLowerCase() === text.toLowerCase() || jaccard(m.text, text) > 0.85)) return { status: 'duplicate', message: 'I already have that saved.' };
    const t = Date.now();
    const item: MemoryItem = MemoryItemSchema.parse({ id: uid(), text, category: c.category, key: c.key || undefined, reason: c.reason || (source === 'explicit_request' ? 'you asked me to remember this' : ''), source, createdAt: t, updatedAt: t });
    // conflict resolution (59): same key → newer wins unless the older one has higher source priority
    const superseded: MemoryItem[] = [];
    if (item.key) for (const old of act.filter((m) => m.key === item.key)) {
      if (SOURCE_PRIORITY[source] >= SOURCE_PRIORITY[old.source]) superseded.push(old);
      else { this.conflicts.push({ newer: { ...c, id: item.id, at: t }, older: old }); this.changed(); return { status: 'conflict', message: `This conflicts with "${old.text}", which you set explicitly. Resolve it in the Memory panel.` }; }
    }
    try {
      await this.kv.put('memory', item);
      for (const o of superseded) await this.kv.put('memory', { ...o, status: 'superseded', supersededBy: item.id, updatedAt: t });
      const back = await this.kv.get<MemoryItem>('memory', item.id);   // verify (Asset 79)
      if (!back || back.text !== item.text) throw new Error('read-back mismatch');
    } catch (e) { return { status: 'error', message: `Saving the memory failed: ${(e as Error).message}` }; }
    for (const o of superseded) { o.status = 'superseded'; o.supersededBy = item.id; o.updatedAt = t; }
    this.items.push(item);
    while (this.active().length > 60) { const oldest = this.active().sort((a, b) => a.updatedAt - b.updatedAt)[0]; await this.forget(oldest.id); }
    this.changed();
    return { status: 'saved', item, superseded, message: superseded.length ? `Saved, replacing ${superseded.length} older item(s): "${superseded[0].text}".` : 'Saved to memory.' };
  }

  suggest(c: MemoryCandidate) {
    if (!this.settings.memoryEnabled || looksSensitive(c.text)) return null;
    if (this.suggestions.some((s) => jaccard(s.text, c.text) > 0.85) || this.active().some((m) => jaccard(m.text, c.text) > 0.85)) return null;
    const s: Suggestion = { ...c, id: uid(), at: Date.now() };
    this.suggestions.push(s); this.changed();
    return s;
  }
  async acceptSuggestion(id: string) {
    const s = this.suggestions.find((x) => x.id === id); if (!s) return null;
    this.suggestions = this.suggestions.filter((x) => x.id !== id);
    const r = await this.remember(s, 'accepted_suggestion'); this.changed(); return r;
  }
  dismissSuggestion(id: string) { this.suggestions = this.suggestions.filter((x) => x.id !== id); this.changed(); }
  async resolveConflict(index: number, keep: 'newer' | 'older') {
    const c = this.conflicts[index]; if (!c) return;
    this.conflicts.splice(index, 1);
    if (keep === 'newer') { await this.forget(c.older.id); await this.remember({ ...(c.newer as MemoryCandidate), explicit: true }, 'manual'); }
    this.changed();
  }

  async edit(id: string, text: string) {
    const m = this.items.find((x) => x.id === id); if (!m) return false;
    if (looksSensitive(text) || text.trim().length < 2) return false;
    const next = { ...m, text: text.trim().slice(0, 200), updatedAt: Date.now(), source: 'manual' as const };
    try { await this.kv.put('memory', next); } catch (e) { throw new StorageError((e as Error).message); }
    Object.assign(m, next); this.changed(); return true;
  }
  /** Deletes the stored record (not a soft delete). */
  async forget(id: string) {
    try { await this.kv.del('memory', id); } catch (e) { throw new StorageError(`Delete failed: ${(e as Error).message}`); }
    this.items = this.items.filter((m) => m.id !== id); this.changed();
  }
  async setPreference(ctx: string, skillId: string | null) {
    const next = { ...this.prefs }; if (skillId) next[ctx] = skillId; else delete next[ctx];
    await this.kv.put('kv', next, 'prefs'); this.prefs = next; this.changed();
  }
  async addSummary(text: string, messages: number) {
    if (!this.settings.memoryEnabled || !text.trim() || looksSensitive(text)) return false;
    const s: Summary = { id: uid(), text: text.slice(0, 600), createdAt: Date.now(), messages };
    await this.kv.put('summaries', s); this.summaries.push(s);
    while (this.summaries.length > 10) { const o = this.summaries.shift()!; await this.kv.del('summaries', o.id); }
    this.changed(); return true;
  }
  async deleteSummary(id: string) { await this.kv.del('summaries', id); this.summaries = this.summaries.filter((s) => s.id !== id); this.changed(); }

  /** Asset 54: rules always apply; other items only when relevant to the query. Marks lastUsedAt. */
  retrieve(query: string, k = 5): MemoryItem[] {
    if (!this.settings.memoryEnabled) return [];
    const act = this.active();
    const rules = act.filter((m) => m.category === 'rule').slice(0, 3);
    const ranked = rankMemories(act.filter((m) => m.category !== 'rule'), query, k).map((x) => x.item);
    const out = [...rules, ...ranked];
    const t = Date.now(); for (const m of out) m.lastUsedAt = t;
    return out;
  }
  contextLines(query: string): string[] {
    if (!this.settings.memoryEnabled) return [];
    const lines = this.retrieve(query).map((m) => `${m.category === 'rule' ? 'Rule from user' : `User ${m.category}`} (saved ${new Date(m.updatedAt).toISOString().slice(0, 10)}): ${m.text}`);
    const s = this.summaries.at(-1);
    if (s && rankMemories([{ id: s.id, text: s.text, category: 'summary', updatedAt: s.createdAt }], query, 1).length) lines.push(`Earlier session summary: ${s.text}`);
    return lines.slice(0, 12).map((l) => l.slice(0, 300));
  }

  async wipeAll() {
    await this.kv.clear('memory'); await this.kv.clear('summaries'); await this.kv.put('kv', {}, 'prefs');
    this.items = []; this.summaries = []; this.prefs = {}; this.suggestions = []; this.conflicts = []; this.changed();
  }
  exportJSON() { return JSON.stringify({ format: 'nexus-memory', version: 2, exportedAt: new Date().toISOString(), items: this.items, summaries: this.summaries, preferences: this.prefs }, null, 2); }
  /** Asset 60: validated import; contents are data only. */
  async importJSON(text: string): Promise<{ imported: number; skipped: number }> {
    let d: unknown; try { d = JSON.parse(text); } catch { return { imported: 0, skipped: 1 }; }
    const items = (d as { items?: unknown[] })?.items;
    if (!Array.isArray(items)) return { imported: 0, skipped: 1 };
    let imported = 0, skipped = 0;
    for (const row of items.slice(0, 200)) {
      const p = MemoryItemSchema.safeParse(row);
      if (!p.success || p.data.status !== 'active') { skipped++; continue; }
      const r = await this.remember({ text: p.data.text, category: p.data.category, key: p.data.key, reason: `imported (${p.data.reason || 'no reason given'})`, explicit: false }, 'import');
      if (r.status === 'saved') imported++; else skipped++;
    }
    return { imported, skipped };
  }
}
