import { describe, expect, it } from 'vitest';
import { activeStages, systemStatus } from '../../space/systemStatus';
import { LevelBus, micLevel } from '../../voice/levels';
import { UiSounds, UI_SOUNDS } from '../../core/uiSounds';
import type { ServerCapabilities } from '../../../shared/schema';

const caps = (o: Partial<ServerCapabilities> = {}): ServerCapabilities => ({ provider: 'gemini', label: 'Gemini', model: 'gemini-x', isLLM: true, configured: true, streaming: true, promptVersion: 'v', runtimeConfig: false, research: { provider: 'none', configured: false }, speech: { tts: { configured: true, note: 'ElevenLabs · eleven_multilingual_v2 · voice v1' }, stt: { configured: false, note: '' } }, ...o });
const base = { caps: caps(), connection: { state: 'untested' as const, at: null, detail: '' }, busy: false, state: 'idle' as const, speaking: false, listening: false, voiceIssue: null, voiceOkAt: null, error: null };
const opt = { voiceEngine: 'server', deviceVoice: true, voiceOn: true };
const by = (rows: ReturnType<typeof systemStatus>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe('Truthful system status', () => {
  it('[A142] nothing is ONLINE before it has really been reached: STANDBY when only configured, ONLINE after a real success, ERROR after a real failure', () => {
    let r = by(systemStatus({ ...base, caps: null }, opt)); expect(r.backend.status).toBe('CONNECTING'); expect(r.ai.status).toBe('CONNECTING');
    r = by(systemStatus(base, opt));
    expect(r.backend.status).toBe('ONLINE'); expect(r.ai).toMatchObject({ label: 'Gemini', status: 'STANDBY' }); expect(r.voice).toMatchObject({ label: 'ElevenLabs voice', status: 'STANDBY' });
    r = by(systemStatus({ ...base, connection: { state: 'ok', at: 1, detail: 'gemini-x answered' }, voiceOkAt: 5 }, opt)); expect(r.ai.status).toBe('ONLINE'); expect(r.voice.status).toBe('ONLINE');
    r = by(systemStatus({ ...base, connection: { state: 'failed', at: 1, detail: 'The AI provider returned 429' } }, opt)); expect(r.ai).toMatchObject({ status: 'ERROR', detail: 'The AI provider returned 429' });
    r = by(systemStatus({ ...base, voiceIssue: { message: 'ElevenLabs quota used up', at: 1 } }, opt)); expect(r.voice).toMatchObject({ status: 'ERROR', detail: 'ElevenLabs quota used up' });
    r = by(systemStatus({ ...base, busy: true, state: 'processing' }, opt)); expect(r.ai.status).toBe('PROCESSING'); expect(r.interaction.status).toBe('PROCESSING');
    r = by(systemStatus({ ...base, speaking: true, state: 'speaking' }, opt)); expect(r.voice.status).toBe('SPEAKING');
    r = by(systemStatus({ ...base, listening: true, state: 'listening' }, opt)); expect(r.interaction.status).toBe('LISTENING');
  });
  it('[A142] demo, offline and muted are reported as such', () => {
    let r = by(systemStatus({ ...base, caps: caps({ provider: 'demo', isLLM: false, speech: { tts: { configured: false, note: '' }, stt: { configured: false, note: '' } } }) }, opt));
    expect(r.ai).toMatchObject({ status: 'OFFLINE', detail: expect.stringMatching(/demo brain/) }); expect(r.voice).toMatchObject({ label: 'Device voice', status: 'ONLINE' });
    r = by(systemStatus({ ...base, caps: caps({ provider: 'local-demo', isLLM: false }) }, opt)); expect(r.backend.status).toBe('OFFLINE');
    r = by(systemStatus({ ...base, caps: caps({ provider: 'web-demo', isLLM: false }) }, opt)); expect(r.backend.detail).toMatch(/no server/);
    r = by(systemStatus(base, { ...opt, voiceOn: false })); expect(r.voice.status).toBe('OFFLINE');
    expect(systemStatus(base, opt).map((r) => r.label + ' ' + r.detail).join(' ')).not.toMatch(/api[_ -]?key|secret|sk-/i);
  });
  it('[A142] the NEXUS chain lights only the stages that are really active', () => {
    expect(activeStages({ state: 'processing', speaking: false }, { expression: 'neutral', moving: false })).toEqual(['intelligence']);
    expect(activeStages({ state: 'responding', speaking: false }, { expression: 'happy', moving: true })).toEqual(['conversation', 'expression', 'movement']);
    expect(activeStages({ state: 'speaking', speaking: true }, { expression: 'speaking', moving: false })).toEqual(['voice', 'expression']);
    expect(activeStages({ state: 'idle', speaking: false }, { expression: 'neutral', moving: false })).toEqual([]);
  });
});

describe('Audio levels and interface sounds', () => {
  it('[A142] levels are measured values with a short history; "live" only while they keep arriving', () => {
    let t = 0; const bus = new LevelBus(() => t);
    expect(bus.live('voice')).toBe(false);
    for (let i = 0; i < 60; i++) { t += 16; bus.emit('voice', i % 2 ? 0.8 : 0.1); }
    expect(bus.history('voice')).toHaveLength(40); expect(bus.live('voice')).toBe(true);
    t += 1000; expect(bus.live('voice')).toBe(false);
    bus.emit('mic', 7); bus.emit('mic', Number.NaN); expect(bus.history('mic')).toEqual([1, 0]);
    bus.reset('mic'); expect(bus.history('mic')).toEqual([]);
    expect(micLevel(0)).toBe(0); expect(micLevel(0.2)).toBeGreaterThan(0.5); expect(micLevel(1)).toBeLessThanOrEqual(1);
  });
  it('[A142] interface sounds: off by default, silenced by quiet mode, short and quiet when on', () => {
    const started: number[] = [];
    class FakeCtx { currentTime = 0; destination = {}; resume() {} createOscillator() { return { type: '', frequency: { value: 0 }, connect: (x: unknown) => x, start: (t: number) => started.push(t), stop() {} }; } createGain() { const g = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x }; return g; } }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    const prefs = { sounds: false, quietMode: false }; const ui = new UiSounds(() => prefs);
    expect(ui.play('startup')).toBe(false);
    prefs.sounds = true; expect(ui.play('listen')).toBe(true); expect(started).toHaveLength(2);
    prefs.quietMode = true; expect(ui.play('listenEnd')).toBe(false);
    for (const notes of Object.values(UI_SOUNDS)) for (const [f, , len, gain] of notes) { expect(f).toBeGreaterThan(200); expect(len).toBeLessThanOrEqual(0.7); expect(gain).toBeLessThanOrEqual(0.04); }
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });
});
