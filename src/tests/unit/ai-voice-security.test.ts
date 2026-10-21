import { describe, expect, it, vi } from 'vitest';
import { StreamParser } from '../../../shared/streamParser';
import { StateMachine, TRANSITIONS, PRECEDENCE } from '../../core/stateMachine';
import { computeCapabilities, type BrowserCaps } from '../../ai/capabilities';
import { planFromResponse } from '../../ai/planner';
import { buildContext } from '../../ai/context';
import { TOOLS, toolAllowed } from '../../security/toolPermissions';
import { looksSensitive, redact, sanitizeUserText } from '../../security/validation';
import { Diagnostics } from '../../diagnostics/log';
import { takeSentences, visemeFor, SpeechOutput } from '../../voice/tts';
import { SpeechInput, VOICE_STOP } from '../../voice/recognition';
import { micPermission } from '../../voice/mic';
import { SkillRegistry } from '../../skills/registry';
import { MemoryKV } from '../../storage/db';
import { BrainResponseSchema, ChatRequestSchema, LIMITS, type ServerCapabilities } from '../../../shared/schema';

const caps = (o: Partial<ServerCapabilities> = {}): ServerCapabilities => ({ provider: 'openai', label: 'x', model: 'm', isLLM: true, configured: true, streaming: true, promptVersion: 'v', runtimeConfig: true, research: { provider: 'none', configured: false }, ...o });
const B: BrowserCaps = { tts: true, stt: false, indexedDB: true, notifications: false, mic: 'unsupported', reducedMotionPref: false };

describe('AI client-side modules', () => {
  it('[A43] stream parser: HEAD, incremental text, META marker never leaks even across chunks', () => {
    const p = new StreamParser(); const out: string[] = [];
    const chunks = ['HEAD {"expression":"happy","gesture":"wave"}\nHel', 'lo there! <<<', 'MET', 'A>>>\n{"actions":[]}'];
    let head = false;
    for (const c of chunks) { const r = p.feed(c); out.push(r.delta); head ||= r.headParsed; }
    const end = p.end();
    expect(head).toBe(true); expect(out.join('')).toBe('Hello there! '); expect(end.text).toBe('Hello there!');
    expect(end.metaRaw).toBe('{"actions":[]}'); expect(out.join('')).not.toContain('<<<');
    const plain = new StreamParser(); plain.feed('Just text, no contract.'); expect(plain.end()).toMatchObject({ head: null, text: 'Just text, no contract.', metaRaw: null });
  });
  it('[A40] state machine: legal transitions only; precedence defined for every state', () => {
    const sm = new StateMachine(); expect(sm.go('speaking')).toBe(false); expect(sm.rejected).toBe(1);
    expect(sm.go('processing')).toBe(true); expect(sm.go('responding')).toBe(true); expect(sm.go('speaking')).toBe(true); expect(sm.go('interrupted')).toBe(true); expect(sm.go('listening')).toBe(true);
    for (const s of Object.keys(TRANSITIONS)) expect(PRECEDENCE[s as keyof typeof PRECEDENCE]).toBeTypeOf('number');
    expect(PRECEDENCE.error).toBeGreaterThan(PRECEDENCE.listening); expect(PRECEDENCE.listening).toBeGreaterThan(PRECEDENCE.processing);
    sm.reset(); expect(sm.state).toBe('idle');
  });
  it('[A44] context window respects count and character budgets', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: 'x'.repeat(1000), at: i, status: 'complete' as const }));
    expect(buildContext(msgs, 6).length).toBeLessThanOrEqual(6); expect(buildContext(msgs, 30, 5000).reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(5000);
  });
  it('[A49] capability registry reflects real configuration (never hard-coded yes)', () => {
    // configured but never confirmed → partial; a successful request → operational; a failure → unavailable
    expect(computeCapabilities(caps(), B, true).find((c) => c.id === 'llm')!.state).toBe('partial');
    expect(computeCapabilities(caps(), B, true, { state: 'failed', detail: 'timeout' }).find((c) => c.id === 'llm')!.state).toBe('unavailable');
    const c1 = computeCapabilities(caps(), B, true, { state: 'ok', detail: 'answered' }); expect(c1.find((c) => c.id === 'llm')!.state).toBe('operational');
    expect(c1.find((c) => c.id === 'stt')!.state).toBe('unavailable'); expect(c1.find((c) => c.id === 'training')!.state).toBe('unavailable');
    const c2 = computeCapabilities(caps({ isLLM: false, provider: 'demo', streaming: false }), B, false);
    expect(c2.find((c) => c.id === 'llm')!.state).toBe('needs_config'); expect(c2.find((c) => c.id === 'memory')!.state).toBe('partial');
    expect(computeCapabilities(caps({ configured: false, note: 'Set a key' }), B, true).find((c) => c.id === 'llm')!.detail).toBe('Set a key');
  });
  it('[A76] follow-up context keeps earlier turns of the same thread', () => {
    const msgs = [{ id: '1', role: 'user' as const, text: 'Tell me about Mars', at: 1, status: 'complete' as const }, { id: '2', role: 'assistant' as const, text: 'Mars is the fourth planet.', at: 2, status: 'complete' as const }, { id: '3', role: 'user' as const, text: 'How far is it?', at: 3, status: 'complete' as const }];
    expect(buildContext(msgs, 16).map((m) => m.content)).toEqual(['Tell me about Mars', 'Mars is the fourth planet.', 'How far is it?']);
  });
  it('[A77] uncertainty & clarification are first-class validated fields', () => {
    const r = BrainResponseSchema.parse({ reply: 'Not sure.', uncertainty: 'high', clarification: 'Which planet?' });
    expect(r).toMatchObject({ uncertainty: 'high', clarification: 'Which planet?' });
    expect(BrainResponseSchema.safeParse({ reply: 'x', uncertainty: 'total' }).success).toBe(false);
  });
  it('[A78] tool permission registry: minimum permissions, enforcement points, consent', () => {
    expect(TOOLS.map((t) => t.id)).toEqual(expect.arrayContaining(['web_research', 'memory_write', 'skill_propose', 'skill_play', 'speech_in', 'speech_out', 'desktop_notify']));
    for (const t of TOOLS) { expect(t.enforcedBy).toMatch(/\.ts/); expect(t.permissions.join()).not.toMatch(/file|exec|secret/); }
    expect(toolAllowed('web_research', { researchEnabled: true, researchConfigured: false })).toBe(false);
    expect(toolAllowed('desktop_notify', { desktopNotifications: true, quietMode: true, notificationPermission: true })).toBe(false);
    expect(toolAllowed('unknown_tool', {})).toBe(false);
  });
  it('[A93] input validation: sanitize, sensitive detection, redaction, request limits', () => {
    expect(sanitizeUserText('  hi\u0000there\u0007 ')).toBe('hithere');
    expect(looksSensitive('my api key is sk-abcdefghijklmnop')).toBe(true); expect(looksSensitive('I like tea')).toBe(false);
    expect(redact('password is hunter2, card 4111 1111 1111 1111')).not.toContain('4111');
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.messageChars + 3000) }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'assistant', content: 'x' }] }).success).toBe(false);
  });
  it('[A95] diagnostics record codes/timings; content only when opted in, always redacted; bounded', () => {
    const d = new Diagnostics(5);
    d.log({ type: 'request', code: 'ok', ms: 12 }, 'secret question'); expect(d.events[0].detail).toBeUndefined();
    d.includeContent = true; d.log({ type: 'request', code: 'ok' }, 'my password is x'); expect(d.events[1].detail).toContain('[redacted]');
    for (let i = 0; i < 10; i++) d.log({ type: 'state', code: 'x' }); expect(d.events).toHaveLength(5);
    expect(JSON.parse(d.export()).format).toBe('nexus-diagnostics');
  });
  it('[A71] planner only plays approved skills from model intentions', () => {
    const reg = new SkillRegistry(new MemoryKV());
    const p = planFromResponse(BrainResponseSchema.parse({ reply: 'hi', gesture: 'greeting', actions: [{ type: 'skill', skillId: 'moonwalk' }, { type: 'skill', skillId: 'waiting' }, { type: 'unsupported', request: 'backflip', reason: 'no physics' }] }), reg, { greeting: 'open_arms' });
    expect(p.during.map((s) => s.skillId)).toEqual(['open_arms']); expect(p.notes.join()).toMatch(/moonwalk/); expect(p.notes.join()).toMatch(/system animation/); expect(p.unsupported[0].request).toBe('backflip');
  });
});

describe('Voice modules (with fake browser engines)', () => {
  it('[A81] microphone permission is queried, never requested, and degrades gracefully', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {}, permissions: { query: async () => ({ state: 'denied', onchange: null }) } });
    expect(await micPermission()).toBe('denied');
    vi.stubGlobal('navigator', { mediaDevices: {}, permissions: { query: async () => { throw new Error('unsupported name'); } } });
    expect(await micPermission()).toBe('unknown');
    vi.stubGlobal('navigator', {}); expect(await micPermission()).toBe('unsupported');
    vi.unstubAllGlobals();
  });
  it('[A82] recognition: interim text, single de-duplicated final, readable errors, unsupported fallback', () => {
    class FakeRec { lang = ''; interimResults = false; continuous = false; maxAlternatives = 1; onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null; onstart: (() => void) | null = null; static last: FakeRec; constructor() { FakeRec.last = this; } start() { this.onstart?.(); } stop() { this.onend?.(); this.onend?.(); } abort() { this.onend?.(); } }
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRec });
    const si = new SpeechInput(); expect(si.supported).toBe(true);
    const ev: string[] = []; si.start({ onInterim: (t) => ev.push(`i:${t}`), onFinal: (t) => ev.push(`f:${t}`), onError: (m) => ev.push(`e:${m}`), onState: (s) => ev.push(`s:${s}`) }, 'en-US');
    FakeRec.last.onresult!({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'wave' } }] });
    FakeRec.last.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'wave then nod' } }] });
    FakeRec.last.onerror!({ error: 'not-allowed' });
    si.stop();
    expect(ev).toContain('i:wave'); expect(ev.filter((e) => e.startsWith('f:'))).toEqual(['f:wave then nod']); expect(ev.join()).toMatch(/permission was denied/);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/140 Electron/44.7.2 Safari/537.36' });
    const de: string[] = []; const si2 = new SpeechInput(); si2.start({ onInterim() {}, onFinal() {}, onError: (m) => de.push(m), onState() {} }); FakeRec.last.onerror!({ error: 'network' });
    expect(de[0]).toMatch(/not available in the NEXUS desktop app/); si2.stop();
    vi.stubGlobal('window', {}); const none = new SpeechInput(); const errs: string[] = []; none.start({ onInterim() {}, onFinal() {}, onError: (m) => errs.push(m), onState() {} }); expect(errs[0]).toMatch(/isn't supported/);
    vi.unstubAllGlobals();
  });
  it('[A83] TTS: sentence queue with voice/rate, word boundaries drive visemes, stop clears queue, text-only fallback', () => {
    expect(takeSentences('Hello there. How are')).toEqual([['Hello there.'], 'How are']);
    expect(visemeFor('hello').open).toBeLessThan(visemeFor('father').open); expect(visemeFor('you').round).toBeGreaterThan(0.5);
    const spoken: { text: string; rate: number }[] = []; let cancelled = 0;
    class U { onstart?: () => void; onend?: () => void; onboundary?: (e: { name: string; charIndex: number; charLength: number }) => void; onerror?: () => void; rate = 1; pitch = 1; voice: unknown = null; constructor(public text: string) {} }
    vi.stubGlobal('window', { speechSynthesis: { speak: (u: U) => { spoken.push({ text: u.text, rate: u.rate }); u.onstart?.(); u.onboundary?.({ name: 'word', charIndex: 0, charLength: 5 }); }, cancel: () => cancelled++, getVoices: () => [] }, SpeechSynthesisUtterance: U });
    vi.stubGlobal('SpeechSynthesisUtterance', U);
    const t = new SpeechOutput(); t.character = 'natural'; t.rate = 1.5; const words: string[] = []; let idle = 0; t.hooks = { onWord: (w) => words.push(w), onIdle: () => idle++ };
    t.enqueue('First sentence.', 'calm'); t.enqueue('Second.', 'calm');
    expect(spoken[0].text).toBe('First sentence.'); expect(spoken[0].rate).toBeCloseTo(0.95 * 1.5); expect(words[0]).toBe('First');
    expect(t.speaking).toBe(true); t.stop(); expect(cancelled).toBe(1); expect(t.speaking).toBe(false); expect(idle).toBe(1);
    vi.stubGlobal('window', {}); expect(new SpeechOutput().supported).toBe(false);
    vi.unstubAllGlobals();
  });
  it('[A84] spoken interruption commands are recognised', () => {
    for (const s of ['stop', 'Stop.', 'cancel', 'be quiet', 'never mind']) expect(VOICE_STOP.test(s)).toBe(true);
    for (const s of ['stop waving at me please', 'can you stop by later']) expect(VOICE_STOP.test(s)).toBe(false);
  });
});
