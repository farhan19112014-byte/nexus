/**
 * [A119] voice + robot lifecycle: audio-driven lip-sync, server voice queue/cancel/fallback, server transcription
 * (permission denied, no speech), PAUSED / RECOVERING states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationEngine, seeded } from '../../animation/engine';
import { ServerSpeechInput, ServerSpeechOutput, levelToMouth, rmsOf, splitForTts } from '../../voice/serverVoice';
import { VoiceInputRouter, VoiceOutputRouter } from '../../voice/router';
import { StateMachine, TRANSITIONS } from '../../core/stateMachine';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { BUILTIN_MOTIONS } from '../../animation/builtinMotions';
import { validateSkill } from '../../skills/validator';

class FakeAudio {
  static all: FakeAudio[] = [];
  paused = true; playbackRate = 1; src: string;
  onended: (() => void) | null = null; onerror: (() => void) | null = null; onplaying: (() => void) | null = null; onpause: (() => void) | null = null;
  constructor(src: string) { this.src = src; FakeAudio.all.push(this); }
  play() { this.paused = false; queueMicrotask(() => this.onplaying?.()); return Promise.resolve(); }
  pause() { this.paused = true; this.onpause?.(); }
  removeAttribute() { this.src = ''; }
  end() { this.paused = true; this.onended?.(); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

beforeEach(() => {
  FakeAudio.all = [];
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h));
  URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); });

const okFetch = (log: string[]) => (async (_u: string, init?: RequestInit) => { log.push(JSON.parse(String(init?.body)).text); return new Response(new Uint8Array(500), { status: 200, headers: { 'content-type': 'audio/mpeg' } }); }) as unknown as typeof fetch;

describe('[A119] lip-sync follows the actual audio', () => {
  it('[A119] loudness maps to mouth openness with a noise floor; silence closes the mouth', () => {
    expect(levelToMouth(0)).toBe(0); expect(levelToMouth(0.01)).toBe(0);
    expect(levelToMouth(0.08)).toBeGreaterThan(0.25); expect(levelToMouth(0.5)).toBeLessThanOrEqual(1);
    const silent = new Uint8Array(512).fill(128); expect(rmsOf(silent)).toBe(0);
    const loud = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 200 : 56)); expect(rmsOf(loud)).toBeGreaterThan(0.5);
  });
  it('[A119] the engine mouth follows the measured level smoothly, and resets when speech ends', () => {
    const e = new AnimationEngine(seeded(2)); e.rateLimit = false; e.idleEnabled = false;
    e.setSpeaking(true); e.speechLevel(0.9); for (let i = 0; i < 30; i++) e.update(1 / 60);
    const open = e.values['mouth.open']; expect(open).toBeGreaterThan(0.6);
    e.speechLevel(0); for (let i = 0; i < 30; i++) e.update(1 / 60);
    expect(e.values['mouth.open']).toBeLessThan(0.2);                   // a pause in the audio closes the mouth (no fake oscillation)
    e.speechLevel(0.9); e.update(1 / 60); expect(e.values['mouth.open']).toBeLessThan(open); // interpolated, not snapped
    e.setSpeaking(false); for (let i = 0; i < 40; i++) e.update(1 / 60);
    expect(e.values['mouth.open']).toBeLessThan(0.1);
  });
});

describe('[A119] server voice output', () => {
  it('[A119] plays sentences in order, one at a time, then reports idle exactly once', async () => {
    const said: string[] = []; const o = new ServerSpeechOutput('', okFetch(said));
    const ev: string[] = []; o.hooks = { onStart: () => ev.push('start'), onIdle: () => ev.push('idle') };
    o.enqueue('First sentence.'); o.enqueue('Second sentence.');
    await flush(); expect(FakeAudio.all.length).toBe(1); expect(o.speaking).toBe(true);
    FakeAudio.all[0].end(); await flush(); expect(FakeAudio.all.length).toBe(2);
    FakeAudio.all[1].end(); await flush();
    expect(said).toEqual(['First sentence.', 'Second sentence.']); expect(ev).toEqual(['start', 'idle']); expect(o.speaking).toBe(false);
  });
  it('[A119] stop() cancels playback and pending audio at once; nothing plays afterwards', async () => {
    const said: string[] = []; const o = new ServerSpeechOutput('', okFetch(said)); const ev: string[] = []; o.hooks = { onIdle: () => ev.push('idle'), onLevel: (l) => ev.push(`lvl${l}`) };
    o.enqueue('One.'); o.enqueue('Two.'); await flush();
    const a = FakeAudio.all[0]; o.stop();
    expect(a.paused).toBe(true); expect(o.speaking).toBe(false); expect(ev).toContain('idle'); expect(ev).toContain('lvl0');
    await flush(); expect(FakeAudio.all.length).toBe(1);                 // "Two." never starts
  });
  it('[A119] pause and resume hold the same audio', async () => {
    const o = new ServerSpeechOutput('', okFetch([])); o.enqueue('Hello.'); await flush();
    o.pause(); expect(FakeAudio.all[0].paused).toBe(true); o.resume(); expect(FakeAudio.all[0].paused).toBe(false);
  });
  it('[A119] when the user allows the fallback, a failed sentence is spoken by the browser voice, with one notice; the queue continues', async () => {
    let n = 0;
    const flaky = (async () => { n++; return n === 1 ? new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }) : new Response(new Uint8Array(500), { status: 200 }); }) as unknown as typeof fetch;
    const browserSaid: string[] = [];
    const browser = { supported: true, speaking: false, hooks: {}, rate: 1, voiceURI: null, boundaryEvents: false, enqueue: (t: string) => browserSaid.push(t), stop: () => {}, voices: () => [] };
    const r = new VoiceOutputRouter(browser, new ServerSpeechOutput('', flaky)); const notes: string[] = []; r.onNotice = (m) => notes.push(m); r.allowFallback = true;
    r.configure(true, 'auto'); expect(r.engineName).toBe('server');
    r.enqueue('Broken one.', 'warm'); r.enqueue('Good one.', 'warm'); await flush();
    expect(browserSaid).toEqual(['Broken one.']); expect(notes.length).toBe(1); expect(notes[0]).toMatch(/rate limited/);
    expect(FakeAudio.all.length).toBe(1);
    r.configure(false, 'auto'); expect(r.engineName).toBe('browser');      // not configured → this computer's voice
    r.configure(true, 'browser'); expect(r.engineName).toBe('browser');    // user preference wins
  });
  it('[A121] by default a failed voice is never replaced: one honest notice, nothing else plays, mouth closed, idle', async () => {
    const failing = (async () => new Response(JSON.stringify({ error: 'ElevenLabs does not know this voice id', code: 'voice_not_found' }), { status: 502 })) as unknown as typeof fetch;
    const browserSaid: string[] = [];
    const browser = { supported: true, speaking: false, hooks: {}, rate: 1, voiceURI: null, boundaryEvents: false, enqueue: (t: string) => browserSaid.push(t), stop: () => {}, voices: () => [] };
    const r = new VoiceOutputRouter(browser, new ServerSpeechOutput('', failing)); const notes: string[] = []; r.onNotice = (m) => notes.push(m);
    const ev: string[] = []; r.hooks = { onLevel: (l) => ev.push(`lvl${l}`), onIdle: () => ev.push('idle') };
    r.configure(true, 'auto'); expect(r.allowFallback).toBe(false);
    r.enqueue('First.', 'warm'); r.enqueue('Second.', 'warm'); await flush();
    expect(browserSaid).toEqual([]); expect(FakeAudio.all.length).toBe(0);
    expect(notes).toHaveLength(1); expect(notes[0]).toMatch(/does not know this voice id/); expect(notes[0]).toMatch(/did not switch/);
    expect(r.speaking).toBe(false);
    r.enqueue('Next reply.', 'warm'); await flush(); expect(notes).toHaveLength(2);   // a new reply that fails is reported again
  });
  it('[A119] long replies are split for the speech service without losing text', () => {
    const t = 'word '.repeat(400).trim(); const parts = splitForTts(t);
    expect(parts.every((p) => p.length <= 600)).toBe(true); expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(t);
  });
});

describe('[A119] server voice input', () => {
  it('[A119] permission denied is reported once with guidance; no request is sent', async () => {
    const md = { getUserMedia: vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }) };
    vi.stubGlobal('navigator', { mediaDevices: md, userAgent: 'test' }); vi.stubGlobal('MediaRecorder', class {});
    const fetchSpy = vi.fn(); const i = new ServerSpeechInput('', fetchSpy as unknown as typeof fetch);
    expect(i.supported).toBe(true);
    const errs: string[] = []; i.start({ onInterim: () => {}, onFinal: () => {}, onState: () => {}, onError: (m, c) => errs.push(`${c}:${m}`) });
    await flush(); expect(errs).toHaveLength(1); expect(errs[0]).toMatch(/^not-allowed:.*denied/); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('[A119] the input router prefers configured server transcription (works in the desktop app) and honours "browser only"', () => {
    const browser = { supported: false, listening: false, start: vi.fn(), stop: vi.fn(), abort: vi.fn() };
    const server = { supported: true, listening: false, kind: 'server', start: vi.fn(), stop: vi.fn(), abort: vi.fn() } as unknown as ServerSpeechInput;
    const r = new VoiceInputRouter(browser, server, true);
    expect(r.supported).toBe(false); r.configure(true, 'auto'); expect(r.supported).toBe(true); expect(r.kind).toBe('server');
    r.configure(true, 'browser'); expect(r.kind).toBe('none');
  });
});

describe('[A119] state machine and character additions', () => {
  it('[A119] PAUSED and RECOVERING are explicit states with legal transitions', () => {
    const m = new StateMachine();
    expect(m.go('processing')).toBe(true); expect(m.go('speaking')).toBe(true); expect(m.go('paused')).toBe(true); expect(m.go('speaking')).toBe(true);
    expect(m.go('error')).toBe(true); expect(m.go('recovering')).toBe(true); expect(m.go('idle')).toBe(true);
    expect(m.go('paused')).toBe(false);                                    // cannot pause when nothing is speaking
    for (const [from, tos] of Object.entries(TRANSITIONS)) for (const to of tos) expect(TRANSITIONS[to as keyof typeof TRANSITIONS], `${from}->${to}`).toBeTruthy();
  });
  it('[A119] all 18 semantic expressions exist and are valid; new gestures validate', () => {
    const ids = new Set(BUILTIN_EXPRESSIONS.map((e) => e.id));
    for (const id of ['neutral', 'happy', 'excited', 'curious', 'interested', 'surprised', 'confused', 'thinking', 'listening', 'speaking', 'concerned', 'sympathetic', 'determined', 'playful', 'sleepy', 'reassuring', 'success', 'error']) expect(ids.has(id), id).toBe(true);
    for (const id of ['explain', 'speak_beat', 'reassure', 'head_tilt', 'open_arms']) { const m = BUILTIN_MOTIONS.find((x) => x.id === id); expect(m, id).toBeTruthy(); expect(validateSkill(m, { origin: 'builtin' }).report.ok, id).toBe(true); }
  });
});

describe('[A120] cute voice preset (this computer\'s voices)', () => {
  it('[A120] "youthful" lifts the pitch a little (capped well below squeaky); "natural" leaves the style untouched', async () => {
    const { voiceParams } = await import('../../voice/tts');
    const nat = voiceParams('warm', 'natural'); const cute = voiceParams('warm', 'cute');
    expect(nat).toEqual({ rate: 1, pitch: 1.15 }); expect(cute.pitch).toBeCloseTo(1.288); expect(cute.rate).toBe(1);   // brighter, natural pace
    expect(voiceParams('playful', 'cute', 1.5).pitch).toBeLessThanOrEqual(1.5); expect(voiceParams('calm', 'cute', 0.8).rate).toBeCloseTo(0.95 * 0.8);  // never squeaky
  });
  it('[A120] "Automatic" picks a young-adult voice in the user\'s language when one exists, else none (never a random one)', async () => {
    const { pickCuteVoice } = await import('../../voice/tts');
    const v = (name: string, lang: string) => ({ name, lang, voiceURI: name }) as SpeechSynthesisVoice;
    const list = [v('Microsoft Guy Online', 'en-US'), v('Microsoft Jenny Online (Natural)', 'en-US'), v('Microsoft Ana Online (Natural)', 'en-US'), v('Google Deutsch', 'de-DE')];
    expect(pickCuteVoice(list, 'en-US')?.name).toMatch(/Jenny/);             // a young-adult voice, not the child voice "Ana"
    expect(pickCuteVoice(list, 'de-DE')?.name).toMatch(/Jenny/);             // no youthful German voice → falls back to English
    expect(pickCuteVoice([v('Microsoft Guy Online', 'en-US')], 'en-US')).toBeUndefined();
  });
});
