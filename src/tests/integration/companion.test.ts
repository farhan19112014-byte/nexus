/**
 * [A97] Integration: the companion orchestrator with the real engine, expressions, registry, memory and
 * learning modules; only the network client and the browser speech engines are faked.
 */
import { describe, expect, it } from 'vitest';
import { AnimationEngine, seeded } from '../../animation/engine';
import { ExpressionController } from '../../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { CharacterRuntime } from '../../core/characterRuntime';
import { MemoryKV } from '../../storage/db';
import { ChatStore } from '../../core/chats';
import { ReminderStore } from '../../core/reminders';
import { SkillRegistry } from '../../skills/registry';
import { LearningSystem } from '../../skills/learning';
import { MemoryStore } from '../../memory/store';
import { Companion } from '../../core/companion';
import { ApiError, type ApiClient, type ChatHandlers, type ChatResult } from '../../ai/apiClient';
import { demoBrain } from '../../../shared/demoBrain';
import { BrainResponseSchema, ChatRequestSchema, type BrainResponse, type ChatRequestInput, type ResponseMeta } from '../../../shared/schema';
import type { CompanionState } from '../../core/stateMachine';

const META: ResponseMeta = { provider: 'fake', model: null, isLLM: true, latencyMs: 1, streamed: true, repaired: false, droppedFields: [], degraded: false, historySent: 1, promptVersion: 't', research: { used: false, provider: null, count: 0 } };
type Script = (req: ReturnType<typeof ChatRequestSchema.parse>, signal: AbortSignal, h: ChatHandlers) => Promise<ChatResult>;
const demo: Script = async (req, _s, h) => { const r = demoBrain(req); h.onHead?.(r); h.onDelta?.(r.reply); return { response: r, meta: { ...META, isLLM: false }, offline: false }; };
const streamed = (r: Partial<BrainResponse> & { reply: string }, delayMs = 20): Script => async (_req, signal, h) => {
  const resp = BrainResponseSchema.parse(r); h.onHead?.(resp);
  for (const w of resp.reply.split(' ')) { await new Promise((ok, no) => { const t = setTimeout(ok, delayMs); signal.addEventListener('abort', () => { clearTimeout(t); no(new ApiError('Cancelled', 'cancelled')); }); }); h.onDelta?.(`${w} `); }
  return { response: resp, meta: META, offline: false };
};

function rig(script: Script = demo, o: { greeted?: boolean; restAfterMs?: number; kv?: MemoryKV; stores?: boolean; clock?: () => number } = {}) {
  const kv = o.kv ?? new MemoryKV();
  const chats = o.stores ? new ChatStore(kv) : undefined; const reminders = o.stores ? new ReminderStore(kv, o.clock) : undefined;
  const engine = new AnimationEngine(seeded(2)); const expressions = new ExpressionController(BUILTIN_EXPRESSIONS);
  const runtime = new CharacterRuntime(engine, expressions);
  const registry = new SkillRegistry(kv); const memory = new MemoryStore(kv); const learning = new LearningSystem(registry, kv);
  let calls = 0; const requests: ReturnType<typeof ChatRequestSchema.parse>[] = [];
  const api = { offline: false, status: async () => ({ provider: 'fake', label: 'fake', model: 'm', isLLM: true, configured: true, streaming: true, promptVersion: 't', runtimeConfig: false, research: { provider: 'none', configured: false } }),
    chat: async (input: ChatRequestInput, s: AbortSignal, h: ChatHandlers) => { calls++; const req = ChatRequestSchema.parse(input); requests.push(req); return script(req, s, h); }, summarize: async () => 'summary' } as unknown as ApiClient;
  const c = new Companion({ runtime, registry, memory, learning, api, persistent: false, silentMsPerChar: 0, restAfterMs: o.restAfterMs ?? 60_000, chats, reminders });
  const states: CompanionState[] = []; c.sm.on((s) => states.push(s));
  const started: string[] = []; engine.on('start', (e) => started.push(e.skillId));
  const timer = setInterval(() => runtime.step(0.1), 2);
  return { c, engine, expressions, registry, memory, learning, chats, reminders, kv, states, started, requests, calls: () => calls, stop: () => { clearInterval(timer); reminders?.stop(); },
    async ready() { await memory.ready; if (o.greeted !== false) await memory.updateSettings({ greeted: true }); await c.init(); } };
}
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const idle = (c: Companion) => until(() => c.sm.state === 'idle' && !c.getSnapshot().busy);

describe('[A97] companion integration', () => {
  it('[A31] greeting plays on the first session only', async () => {
    const t = rig(demo, { greeted: false }); await t.ready();
    expect(t.started).toContain('greeting'); expect(t.memory.settings.greeted).toBe(true);
    const t2 = rig(); await t2.ready(); expect(t2.started).not.toContain('greeting'); t.stop(); t2.stop();
  });
  it('[A14] [A37] thinking face + waiting loop only while pending; both stop on first text', async () => {
    const t = rig(streamed({ reply: 'One two three four.', expression: 'happy' }, 60)); await t.ready();
    const p = t.c.send('hello there');
    await until(() => t.expressions.current() === 'thinking');
    await until(() => t.engine.active().some((a) => a.skillId === 'waiting'));
    await until(() => t.c.sm.state === 'responding');
    await until(() => !t.engine.active().some((a) => a.skillId === 'waiting' && a.phase !== 'out'));
    expect(t.expressions.current()).not.toBe('thinking');
    await p; await idle(t.c); expect(t.states).toEqual(expect.arrayContaining(['processing', 'responding', 'idle'])); t.stop();
  });
  it('[A43] streamed text appears incrementally in the message before completion', async () => {
    const t = rig(streamed({ reply: 'alpha beta gamma delta epsilon' }, 30)); await t.ready();
    const p = t.c.send('stream please');
    await until(() => (t.c.getSnapshot().messages.at(-1)?.text ?? '').includes('beta'));
    const mid = t.c.getSnapshot().messages.at(-1)!; expect(mid.status).toBe('streaming'); expect(mid.text).not.toContain('epsilon');
    await p; expect(t.c.getSnapshot().messages.at(-1)!.status).toBe('complete'); t.stop();
  });
  it('[A46] cancellation: request aborted, message marked cancelled (never complete), newer turn wins', async () => {
    const t = rig(streamed({ reply: 'this is a long slow answer that will be cancelled', expression: 'happy' }, 40)); await t.ready();
    const p1 = t.c.send('first question');
    await until(() => t.c.getSnapshot().messages.at(-1)!.status === 'streaming');
    t.c.cancel(); await p1;
    const m = t.c.getSnapshot().messages.find((x) => x.role === 'assistant')!; expect(m.status).toBe('cancelled');
    expect(t.c.getSnapshot().busy).toBe(false);
    const p2 = t.c.send('second question'); const p3 = t.c.send('third question'); await Promise.all([p2, p3]); await idle(t.c);
    const asst = t.c.getSnapshot().messages.filter((x) => x.role === 'assistant');
    expect(asst.at(-1)!.status).toBe('complete'); expect(asst.at(-2)!.status).toBe('cancelled'); t.stop();
  });
  it('[A35] [A47] provider failure: error face + reaction + actionable message; retry succeeds', async () => {
    let fail = true;
    const t = rig(async (req, s, h) => { if (fail) throw new ApiError('The AI provider did not respond in time.', 'timeout', true); return demo(req, s, h); }); await t.ready();
    await t.c.send('hello');
    const m = t.c.getSnapshot().messages.at(-1)!;
    expect(t.c.sm.state).toBe('error'); expect(t.expressions.current()).toBe('error'); expect(m.status).toBe('failed'); expect(m.error).toMatchObject({ code: 'timeout', retryable: true });
    expect(t.c.getSnapshot().speaking).toBe(false); await until(() => t.started.includes('error_react'));
    fail = false; await t.c.retry(m.id); await idle(t.c);
    const msgs = t.c.getSnapshot().messages; expect(msgs.filter((x) => x.role === 'user')).toHaveLength(1); expect(msgs.at(-1)!.status).toBe('complete'); t.stop();
  });
  it('[A33] speaking: TTS word boundaries open the mouth; speaking state ends when speech ends', async () => {
    const t = rig(streamed({ reply: 'Hello friend. How are you today?' }, 5)); await t.ready();
    const fakeTts = t.c.tts as unknown as { supported: boolean; enqueue: (x: string) => void; speaking: boolean };
    let q: string[] = [];
    Object.defineProperty(t.c.tts, 'supported', { value: true });
    Object.defineProperty(t.c.tts, 'speaking', { get: () => q.length > 0 });
    (t.c.tts as unknown as { stop: () => void }).stop = () => { if (q.length) { q = []; t.c.tts.hooks.onIdle?.(); } };
    fakeTts.enqueue = (x: string) => { q.push(x); if (q.length === 1) { t.c.tts.hooks.onStart?.(); setTimeout(() => { t.c.tts.hooks.onWord?.('hello'); }, 10); setTimeout(() => { q = []; t.c.tts.hooks.onIdle?.(); }, 250); } };
    await t.memory.updateSettings({ voiceOutput: true });
    const p = t.c.send('talk to me');
    await until(() => t.states.includes('speaking')).catch((e) => { console.log('STATES', t.states, t.c.getSnapshot().messages.at(-1)); throw e; });
    await until(() => t.engine.values['mouth.open'] > 0.3);
    await p; await idle(t.c); expect(t.engine.isSpeaking()).toBe(false); expect(t.c.getSnapshot().speaking).toBe(false); t.stop();
  });
  it('[A119] PAUSED: pausing holds the reply with the mouth closed; resume continues; a new message while paused cancels the old reply', async () => {
    const t = rig(streamed({ reply: 'A long answer that keeps talking for a while.' }, 2)); await t.ready();
    let q: string[] = []; const ev: string[] = [];
    Object.defineProperty(t.c.tts, 'supported', { value: true });
    Object.defineProperty(t.c.tts, 'speaking', { get: () => q.length > 0 });
    const tts = t.c.tts as unknown as { stop: () => void; enqueue: (x: string) => void; pause: () => void; resume: () => void };
    tts.stop = () => { ev.push('stop'); if (q.length) { q = []; t.c.tts.hooks.onIdle?.(); } };
    tts.pause = () => ev.push('pause'); tts.resume = () => ev.push('resume');
    tts.enqueue = (x: string) => { q.push(x); if (q.length === 1) t.c.tts.hooks.onStart?.(); };   // keeps "playing" until stopped
    await t.memory.updateSettings({ voiceOutput: true });
    void t.c.send('talk to me');
    await until(() => t.c.sm.state === 'speaking');
    expect(t.c.pauseSpeech()).toBe(true); expect(t.c.sm.state).toBe('paused'); expect(t.engine.isSpeaking()).toBe(false);
    expect(t.c.resumeSpeech()).toBe(true); expect(t.c.sm.state).toBe('speaking'); expect(t.engine.isSpeaking()).toBe(true);
    t.c.pauseSpeech();
    const stopsBefore = ev.filter((x) => x === 'stop').length;
    const p2 = t.c.send('something else'); await until(() => ev.filter((x) => x === 'stop').length > stopsBefore);   // the newer request stops the paused reply
    await until(() => t.c.sm.state === 'speaking');                                   // now speaking the NEW reply
    expect(t.c.getSnapshot().messages.filter((m) => m.role === 'assistant').at(-1)?.replyTo).toBe(t.c.getSnapshot().messages.filter((m) => m.role === 'user').at(-1)?.id);
    expect(ev.filter((x) => x !== 'stop')).toEqual(['pause', 'resume', 'pause']);
    t.c.stopSpeaking(); await p2; await idle(t.c); t.stop();
  }, 15000);
  it('[A119] ERROR → RECOVERING (reassuring face, limbs settle) → IDLE, and the robot never stays stuck', async () => {
    const t = rig(async () => { throw new ApiError('Provider is down', 'provider', true); }); await t.ready();
    await t.c.send('hello');
    await until(() => t.c.sm.state === 'recovering', 6000);
    expect(t.expressions.current()).toBe('reassuring');
    await until(() => t.c.sm.state === 'idle', 3000);
    const i = t.states.indexOf('error'); expect(t.states.slice(i, i + 3)).toEqual(['error', 'recovering', 'idle']);
    t.stop();
  }, 15000);
  it('[A53] [A79] [A80] memory: explicit request saved & verified; inferred → consent; changes disclosed', async () => {
    const t = rig(streamed({ reply: 'Noted!', memoryCandidates: [{ text: 'User enjoys chess', category: 'preference', explicit: false, reason: '' }] }, 1)); await t.ready();
    await t.c.send('I played chess today'); await idle(t.c);
    expect(t.memory.active()).toHaveLength(0); expect(t.memory.suggestions.map((s) => s.text)).toEqual(['User enjoys chess']);
    const m = t.c.getSnapshot().messages.at(-1)!; expect(m.changes!.map((x) => x.scope)).toEqual(expect.arrayContaining(['conversation', 'memory']));
    await t.c.acceptSuggestion(t.memory.suggestions[0].id); expect(t.memory.active()).toHaveLength(1);
    const t2 = rig(); await t2.ready(); await t2.c.send('remember that my favourite colour is teal'); await idle(t2.c);
    expect(t2.memory.active()[0]).toMatchObject({ text: 'my favourite colour is teal', source: 'explicit_request', key: 'favourite_colour' });
    t.stop(); t2.stop();
  });
  it('[A36] success reaction only after verified results (approval), never on submission', async () => {
    const t = rig(); await t.ready();
    await t.c.send('invent a new greeting'); await idle(t.c);
    const l = t.c.getSnapshot().messages.at(-1)!.learn!; expect(l.status).toBe('proposed');
    expect(t.started).not.toContain('celebrate');
    expect(await t.c.approve(l.skillId!, l.version!)).toBe(true);
    await until(() => t.started.includes('celebrate'));
    expect(t.registry.get(l.skillId!)).toBeDefined(); t.stop();
  });
  it('[A39] [A20] user playback: approved skills play; unknown/unapproved report unavailable; approved expressions register', async () => {
    const t = rig(); await t.ready();
    expect(await t.c.playSkill('nod')).toBe('played'); expect(await t.c.playSkill('moonwalk')).toBe('unavailable');
    await t.c.send('invent a new expression'); await idle(t.c);
    const l = t.c.getSnapshot().messages.at(-1)!.learn!; expect(l.kind).toBe('expression');
    expect(await t.c.playSkill(l.skillId!)).toBe('unavailable');
    await t.c.approve(l.skillId!, l.version!); expect(t.expressions.has(l.skillId!)).toBe(true); expect(await t.c.playSkill(l.skillId!)).toBe('played'); t.stop();
  });
  it('[A70] feedback in conversation refines the last motion (proposal awaiting approval by default)', async () => {
    const t = rig(); await t.ready();
    await t.c.send('wave'); await idle(t.c); await t.c.send('that was too fast'); await idle(t.c);
    const l = t.c.getSnapshot().messages.at(-1)!.learn!; expect(l).toMatchObject({ status: 'proposed', skillId: 'wave' });
    expect(t.registry.get('wave')!.params.speed.default).toBe(1); await t.c.approve('wave', l.version!); expect(t.registry.get('wave')!.params.speed.default).toBeCloseTo(0.7); t.stop();
  });
  it('[A34] [A89] completion reaction respects its setting and quiet mode; essential errors still show', async () => {
    const t = rig(); await t.ready();
    await t.c.send('hello'); await idle(t.c); await until(() => t.started.includes('complete_nod'));
    t.started.length = 0; await t.memory.updateSettings({ quietMode: true }); t.c.applySettings();
    await t.c.send('thanks'); await idle(t.c); await new Promise((r) => setTimeout(r, 50));
    expect(t.started).not.toContain('complete_nod');
    t.c.notifications.push('skill', 'proposal ready', { react: true, sound: true });
    expect(t.started).not.toContain('notify'); expect(t.c.notifications.suppressed.reactions).toBeGreaterThan(0); expect(t.c.notifications.suppressed.sounds).toBeGreaterThan(0);
    t.c.notifications.push('error', 'disk full', { essential: true }); expect(t.c.notifications.notices.at(-1)!.text).toBe('disk full'); t.stop();
  });
  it('[A38] notification reactions play when enabled', async () => {
    const t = rig(); await t.ready(); t.c.notifications.push('skill', 'proposal ready', { react: true });
    await until(() => t.started.includes('notify')); t.stop();
  });
  it('[A32] [A84] listening state, interim text, voice "stop" command cancels instead of sending', async () => {
    const t = rig(streamed({ reply: 'a slow streaming reply that keeps going on' }, 40)); await t.ready();
    let cb: Parameters<typeof t.c.stt.start>[0] | null = null;
    Object.defineProperty(t.c.stt, 'supported', { value: true });
    t.c.stt.start = (c) => { cb = c; c.onState(true); };
    const p = t.c.send('tell me a story'); await until(() => t.c.sm.state === 'responding');
    t.c.startListening();
    expect(t.c.sm.state).toBe('listening'); expect(t.expressions.current()).toBe('listening'); await until(() => t.started.includes('listen_lean'));
    cb!.onInterim('st'); expect(t.c.getSnapshot().interim).toBe('st');
    cb!.onFinal('stop'); cb!.onState(false); await p;
    expect(t.calls()).toBe(1); expect(t.c.getSnapshot().messages.filter((m) => m.role === 'user')).toHaveLength(1);
    t.stop();
  });
  it('[A82] voice transcript is offered for review before sending (configurable)', async () => {
    const t = rig(); await t.ready(); Object.defineProperty(t.c.stt, 'supported', { value: true });
    let cb: Parameters<typeof t.c.stt.start>[0] | null = null; t.c.stt.start = (c) => { cb = c; c.onState(true); };
    t.c.startListening(); cb!.onFinal('wave then nod'); expect(t.c.getSnapshot().draft).toBe('wave then nod'); expect(t.calls()).toBe(0);
    await t.memory.updateSettings({ reviewTranscript: false }); t.c.startListening(); cb!.onFinal('wave'); await until(() => t.calls() === 1); t.stop();
  });
  it('[A57] [A88] preferences change real behaviour: prompt profile, animation intensity, reduced motion', async () => {
    const t = rig(); await t.ready();
    await t.memory.updateSettings({ responseStyle: 'concise', language: 'Hindi', animationIntensity: 0.5, reducedMotion: true }); t.c.applySettings();
    await t.c.send('hello'); await idle(t.c);
    expect(t.requests.at(-1)!.profile).toEqual({ responseStyle: 'concise', language: 'Hindi', robotName: 'NEXUS' });
    expect(t.engine.intensity).toBe(0.5); expect(t.engine.reducedMotion).toBe(true); expect(t.engine.idleEnabled).toBe(false);
    const full = new AnimationEngine(seeded(1)); full.rateLimit = false; const small = new AnimationEngine(seeded(1)); small.rateLimit = false; small.intensity = 0.5; small.reducedMotion = true;
    const wave = t.registry.get('wave')!; full.play(wave); small.play(wave);
    for (let i = 0; i < 40; i++) { full.update(1 / 60); small.update(1 / 60); }
    expect(small.values['armR.raise']).toBeLessThan(full.values['armR.raise'] * 0.5); t.stop();
  });
  it('[A19] resting after inactivity; any interaction wakes NEXUS', async () => {
    const t = rig(demo, { restAfterMs: 60 }); await t.ready();
    await until(() => t.c.sm.state === 'resting'); expect(t.expressions.current()).toBe('resting'); expect(t.engine.getPose()).toBe('resting');
    await t.c.playSkill('nod'); expect(t.c.sm.state).not.toBe('resting'); t.stop();
  });
  it('[A40] [A30] reset recovers from any state', async () => {
    const t = rig(streamed({ reply: 'long long long reply here' }, 40)); await t.ready();
    void t.c.send('go'); await until(() => t.c.sm.state === 'responding');
    t.c.resetCharacter(); expect(t.c.sm.state).toBe('idle'); expect(t.c.getSnapshot().busy).toBe(false);
    await until(() => t.engine.active().length === 0); t.stop();
  });
  it('[A103] rename: saved, sent to the model, used in the intro — conversation, skills and memories untouched', async () => {
    const t = rig(); await t.ready();
    await t.c.send('remember that my favourite colour is teal'); await idle(t.c);
    await t.c.send('invent a new greeting'); await idle(t.c);
    const msgsBefore = t.c.getSnapshot().messages.length; const skillsBefore = t.registry.list().map((r) => `${r.id}@${r.activeVersion}`).join();
    const memBefore = t.memory.active().length;
    expect(await t.c.renameRobot('   ')).toMatchObject({ ok: false });
    expect(t.c.robotName).toBe('NEXUS');
    const [a, b] = await Promise.all([t.c.renameRobot('Nova'), t.c.renameRobot('Nova')]);
    expect(a).toMatchObject({ ok: true, name: 'Nova', changed: true }); expect(b).toMatchObject({ ok: false, error: expect.stringMatching(/already being saved/) });
    expect(t.c.robotName).toBe('Nova'); expect(t.memory.settings.robotName).toBe('Nova');
    expect(t.c.getSnapshot().messages.length).toBe(msgsBefore);
    expect(t.registry.list().map((r) => `${r.id}@${r.activeVersion}`).join()).toBe(skillsBefore);
    expect(t.memory.active().length).toBe(memBefore);
    await t.c.send('hello'); await idle(t.c);
    expect(t.requests.at(-1)!.profile.robotName).toBe('Nova');
    expect(t.c.getSnapshot().messages.at(-1)!.text).toMatch(/I'm Nova/);
    expect(await t.c.renameRobot('Nova')).toMatchObject({ ok: true, changed: false });
    t.stop();
  });
  it('[A103] a storage failure during rename is reported and the old name stays', async () => {
    const t = rig(); await t.ready();
    (t.memory as unknown as { kv: MemoryKV }).kv.failWrites = true;
    const r = await t.c.renameRobot('Pixel');
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatch(/keeps its previous name/);
    expect(t.c.robotName).toBe('NEXUS'); t.stop();
  });
  it('[A104] greeting style and "greet every session" choose the real greeting motion; init runs once', async () => {
    const t = rig(demo, { greeted: false }); await t.memory.ready; await t.memory.updateSettings({ greetingStyle: 'bounce' });
    await Promise.all([t.c.init(), t.c.init()]);
    expect(t.started.filter((x) => x === 'bounce')).toHaveLength(1); expect(t.started).not.toContain('greeting');
    const t2 = rig(demo, { greeted: false }); await t2.memory.ready; await t2.memory.updateSettings({ greetingStyle: 'none' }); await t2.c.init();
    expect(t2.started).toHaveLength(0);
    const t3 = rig(); await t3.memory.ready; await t3.memory.updateSettings({ greeted: true, greetEverySession: true, greetingStyle: 'nod' }); await t3.c.init();
    expect(t3.started).toContain('nod');
    t.stop(); t2.stop(); t3.stop();
  });
  it('[A109] reminder requests are handled on this device — the AI is not called — and fire into the chat', async () => {
    let t = Date.now(); const tt = rig(demo, { stores: true, clock: () => t }); await tt.ready();
    const before = tt.calls();
    await tt.c.send('remind me in 10 minutes to stretch'); await idle(tt.c);
    expect(tt.calls()).toBe(before);
    const reply = tt.c.getSnapshot().messages.at(-1)!;
    expect(reply.meta?.provider).toBe('on-device'); expect(reply.text).toMatch(/remind you to \*\*stretch\*\*/);
    expect(tt.reminders!.pending()).toHaveLength(1);
    t += 11 * 60_000; await tt.reminders!.tick();
    expect(tt.c.getSnapshot().messages.at(-1)!.text).toMatch(/⏰ Reminder: stretch/);
    expect(tt.c.notifications.notices.some((n) => n.kind === 'reminder')).toBe(true);
    await tt.c.send('remind me what my favourite colour is'); await idle(tt.c);
    expect(tt.calls()).toBe(before + 1); // not a reminder → goes to the brain as usual
    tt.stop();
  });
  it('[A107] [A108] the conversation survives a reload; new chat keeps the old one; regenerate and edit replace the right messages', async () => {
    const kv = new MemoryKV();
    const a = rig(demo, { stores: true, kv }); await a.ready();
    await a.c.send('hello'); await idle(a.c); await a.c.send('wave'); await idle(a.c);
    await a.c.persistNow(); a.stop();
    const b = rig(demo, { stores: true, kv }); await b.ready();
    const texts = b.c.getSnapshot().messages.filter((m) => m.role !== 'system').map((m) => m.text);
    expect(texts[0]).toBe('hello'); expect(texts).toContain('wave');
    const callsBefore = b.calls();
    expect(await b.c.regenerate()).toBe(true); await idle(b.c);
    expect(b.calls()).toBe(callsBefore + 1);
    expect(b.c.getSnapshot().messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['hello', 'wave']);
    await b.c.editLast('nod'); await idle(b.c);
    expect(b.c.getSnapshot().messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['hello', 'nod']);
    expect(b.requests.at(-1)!.messages.at(-1)!.content).toBe('nod');
    await b.c.newChat();
    expect(b.c.getSnapshot().messages.filter((m) => m.role === 'user')).toHaveLength(0);
    expect(b.chats!.chats).toHaveLength(1);
    expect(await b.c.openChat(b.chats!.chats[0].id)).toBe(true);
    expect(b.c.getSnapshot().messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['hello', 'nod']);
    await b.memory.updateSettings({ saveChats: false });
    await b.c.send('clap'); await idle(b.c); await b.c.persistNow();
    expect(b.chats!.chats[0].messages.some((m) => m.text === 'clap')).toBe(false); // saving off → nothing new stored
    b.stop();
  });
  it('[A110] liveliness: typing makes the robot attentive; ambient behaviours respect quiet mode; daily greeting once per day', async () => {
    const t = rig(demo, { stores: true }); await t.ready();
    t.c.noteTyping(true); expect(t.expressions.current()).toBe('listening');
    t.c.noteTyping(false); t.expressions.update(1); expect(t.expressions.current()).not.toBe('listening');
    await t.memory.updateSettings({ quietMode: true }); expect(await t.c.ambient()).toBeNull();
    await t.memory.updateSettings({ quietMode: false }); t.c.applySettings();
    await until(() => t.engine.active().length === 0);
    const pick = await t.c.ambient(); expect(['look_around', 'stretch', 'antenna_wiggle', 'head_tilt']).toContain(pick); expect(t.started).toContain(pick);
    // daily greeting: already shown today by init → not again; a new day → once
    const n = t.c.getSnapshot().messages.filter((m) => m.role === 'system').length;
    expect(await t.c.dailyGreeting()).toBe(false);
    const tomorrow = new Date(Date.now() + 86_400_000); tomorrow.setHours(8);
    expect(await t.c.dailyGreeting(tomorrow)).toBe(true);
    expect(t.c.getSnapshot().messages.filter((m) => m.role === 'system').length).toBe(n + 1);
    expect(t.c.getSnapshot().messages.at(-1)!.text).toMatch(/^Good morning! NEXUS is here\./);
    t.stop();
  });
  it('[A109] [A107] review fixes: a reminder mid-reply keeps the reply; editing a reminder replaces it; New chat mid-reply saves the turn; deleted chats stay deleted', async () => {
    const t = rig(streamed({ reply: 'Once upon a time there was a robot who liked tea.' }, 25), { stores: true }); await t.ready();
    const p = t.c.send('tell me a story');
    await until(() => t.c.sm.state === 'responding');
    await t.c.send('remind me in 10 minutes to stretch');
    await p; await idle(t.c);
    const story = t.c.getSnapshot().messages.find((m) => m.role === 'assistant' && m.text.startsWith('Once'));
    expect(story?.status).toBe('complete'); expect(t.c.sm.state).toBe('idle');
    expect(t.reminders!.pending()).toHaveLength(1);
    await t.c.editLast('remind me in 20 minutes to stretch'); await idle(t.c);
    expect(t.reminders!.pending().map((r) => Math.round((r.dueAt - Date.now()) / 60_000))).toEqual([20]);
    // New chat while a reply streams: the turn is saved (as cancelled), not lost
    const p2 = t.c.send('second question'); await until(() => t.c.sm.state === 'responding');
    await t.c.newChat(); await p2.catch(() => {});
    const saved = t.chats!.chats[0];
    expect(saved.messages.filter((m) => m.role === 'user').map((m) => m.text)).toContain('second question');
    // delete the open chat right after a change: the pending save must not bring it back
    await t.c.send('remind me in 5 minutes to drink water'); await idle(t.c); await t.c.persistNow();
    const id = t.chats!.currentId; await t.c.send('remind me in 6 minutes to walk'); await t.c.deleteChat(id);
    await new Promise((r) => setTimeout(r, 700));
    expect(t.chats!.chats.some((c) => c.id === id)).toBe(false);
    expect(await t.kv.get('chats', id)).toBeUndefined();
    t.stop();
  });
  it('[A47] [A49] no silent demo substitution: an unreachable server is an error; the offline demo runs only when chosen; connection state is truthful', async () => {
    const down: Script = async () => { throw new ApiError('Can’t reach the NEXUS server', 'offline', true); };
    const t = rig(down); await t.ready();
    expect(t.c.getSnapshot().connection.state).toBe('untested');
    await t.c.send('hello'); await idle(t.c);
    const failed = t.c.getSnapshot().messages.at(-1)!;
    expect(failed.status).toBe('failed'); expect(failed.error?.code).toBe('offline'); expect(failed.text).toBe('');
    expect(t.c.getSnapshot().connection.state).toBe('failed');
    (t.c as unknown as { d: { api: { offlineDemo: Script } } }).d.api.offlineDemo = async (req, _s, h) => { const r = demoBrain(req); h.onDelta?.(r.reply); return { response: r, meta: { ...META, provider: 'local-demo', isLLM: false }, offline: true }; };
    await t.c.answerWithOfflineDemo(failed.id); await idle(t.c);
    const demoReply = t.c.getSnapshot().messages.at(-1)!;
    expect(demoReply.status).toBe('complete'); expect(demoReply.notes?.join(' ')).toMatch(/You chose the offline demo/);
    t.stop();
    const dm = rig(); await dm.ready(); await dm.c.send('hello'); await idle(dm.c);
    expect(dm.c.getSnapshot().connection).toMatchObject({ state: 'demo' }); // demo brain answered — not "connected to an AI"
    dm.stop();
    const ok = rig(streamed({ reply: 'Hi there.' }, 5)); await ok.ready(); await ok.c.send('hello'); await idle(ok.c);
    expect(ok.c.getSnapshot().connection).toMatchObject({ state: 'ok' }); // a real (fake-LLM) answer
    ok.stop();
  }, 15000);
  it('[A33] [A49] the core light shows real states: "responding" while text streams, never "speaking" without audio; success only after a verified save', async () => {
    const t = rig(streamed({ reply: 'One two three four five six.' }, 40)); await t.ready();
    const seen: string[] = []; const rt = (t.c as unknown as { d: { runtime: { setIndicator(i: string): void } } }).d.runtime; const orig = rt.setIndicator.bind(rt); rt.setIndicator = (i: string) => { seen.push(i); orig(i); };
    await t.c.send('tell me something'); await idle(t.c);
    expect(seen).toContain('processing'); expect(seen).toContain('responding'); expect(seen).not.toContain('speaking'); expect(seen).not.toContain('success');
    t.stop();
    const m = rig(); await m.ready();
    const seen2: string[] = []; const rt2 = (m.c as unknown as { d: { runtime: { setIndicator(i: string): void } } }).d.runtime; const o2 = rt2.setIndicator.bind(rt2); rt2.setIndicator = (i: string) => { seen2.push(i); o2(i); };
    await m.c.send('remember that my favourite colour is teal'); await idle(m.c);
    await until(() => seen2.includes('success'));
    expect(m.expressions.current()).toBe('success');
    m.stop();
  }, 15000);
});
