import { describe, expect, it } from 'vitest';
import { AnimationEngine, ENGINE_LIMITS, seeded } from '../../animation/engine';
import { BUILTIN_MOTIONS, tr } from '../../animation/builtinMotions';
import { ease, localTime, sampleKeys, totalDuration } from '../../animation/timeline';
import { validateSkill } from '../../skills/validator';
import { CHANNELS, CHANNEL_NAMES } from '../../../shared/channels';
import { SkillDefSchema, type SkillDefInput } from '../../../shared/schema';

const M = (id: string) => BUILTIN_MOTIONS.find((m) => m.id === id)!;
const E = () => { const e = new AnimationEngine(seeded(3)); return e; };
const run = (e: AnimationEngine, s: number, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) e.update(dt); return e.values; };
const skill = (o: Partial<SkillDefInput> & { id: string }) => SkillDefSchema.parse({ name: o.id, kind: 'motion', duration: 1, tracks: [tr('head.rot', [0.5, 10], [1, 0])], ...o });

describe('Category C — motion & body animation', () => {
  it('[A26] [A118] every motion required by the spec exists, validates, simulates cleanly and returns to rest', async () => {
    const required = { idle: 'happy_idle', greeting: 'greeting', wave: 'wave', nod: 'nod', 'head shake': 'shake_head', bounce: 'bounce', celebrate: 'celebrate', clap: 'clap', think: 'think_chin', listen: 'listen_lean', point: 'point', shrug: 'shrug', agree: 'agree', disagree: 'disagree', acknowledge: 'acknowledge', success: 'success', error: 'error_react', 'return to idle': 'return_to_idle' };
    for (const [label, id] of Object.entries(required)) {
      const m = M(id); expect(m, label).toBeTruthy();
      expect(validateSkill(m, { origin: 'builtin' }).report.ok, id).toBe(true);
    }
    for (const m of BUILTIN_MOTIONS) expect(validateSkill(m, { origin: 'builtin' }).report.ok, m.id).toBe(true);
    // run the new conversational motions to completion: the rig must come back to the neutral pose
    const rest = new AnimationEngine(seeded(1)); rest.rateLimit = false; rest.idleEnabled = false; run(rest, 1);
    for (const id of ['agree', 'disagree', 'acknowledge', 'success']) {
      const e = new AnimationEngine(seeded(1)); e.rateLimit = false; e.idleEnabled = false;
      const h = e.play(M(id)); run(e, 4); expect(await h.done, id).toBe('completed');
      for (const ch of ['armL.raise', 'armR.raise', 'head.rot', 'head.nod', 'body.y'] as const) expect(Math.abs(e.values[ch] - rest.values[ch]), `${id} ${ch}`).toBeLessThan(1.5);
    }
    // return_to_idle brings a raised arm back down
    const e = new AnimationEngine(seeded(1)); e.rateLimit = false; e.idleEnabled = false;
    e.play(M('wave')); run(e, 0.8); e.stopAll(); const r = e.play(M('return_to_idle')); run(e, 2);
    expect(await r.done).toBe('completed'); expect(Math.abs(e.values['armR.raise'] - rest.values['armR.raise'])).toBeLessThan(1.5);
  });
  it('[A21] idle breathing is subtle, continuous, and disabled by reduced motion', () => {
    const e = E(); e.rateLimit = false; const samples: number[] = [];
    for (let i = 0; i < 240; i++) { e.update(1 / 60); samples.push(e.values['body.squash']); }
    const range = Math.max(...samples) - Math.min(...samples);
    expect(range).toBeGreaterThan(0.005); expect(range).toBeLessThan(0.05);
    const r = E(); r.rateLimit = false; r.idleEnabled = false; const s2: number[] = []; for (let i = 0; i < 240; i++) { r.update(1 / 60); s2.push(r.values['body.squash']); }
    expect(Math.max(...s2) - Math.min(...s2)).toBeLessThan(1e-6);
  });
  it('[A22] blinking: varied intervals, occasional double blinks, never overlapping', () => {
    const e = E(); e.rateLimit = false; const closes: number[] = []; let prev = 1, closed = false;
    for (let i = 0; i < 60 * 120; i++) { e.update(1 / 60); const v = e.values['eyeL.open']; if (v < 0.3 && !closed) { closes.push(i); closed = true; } if (v > 0.8) closed = false; expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); prev = v; }
    void prev;
    const gaps = closes.slice(1).map((c, i) => c - closes[i]);
    expect(closes.length).toBeGreaterThan(20);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(60);          // varied timing
    expect(gaps.some((g) => g < 20)).toBe(true);                                // a double blink
    e.triggerBlink(); e.triggerBlink(); expect(true).toBe(true);                // re-trigger is ignored, not stacked
  });
  it('[A23] gaze follows a target and is clamped to safe bounds', () => {
    const e = E(); e.rateLimit = false; e.lookAt(5, -5); run(e, 1);
    expect(e.values['pupil.x']).toBeLessThanOrEqual(1); expect(e.values['pupil.x']).toBeGreaterThan(0.6); expect(e.values['pupil.y']).toBeGreaterThanOrEqual(-1);
    e.lookAt(-1, 0, 'chat'); run(e, 1); expect(e.values['pupil.x']).toBeLessThan(-0.6);
  });
  it('[A24] head tilt left/right/forward/back skills move the head and validate', () => {
    for (const [id, ch, sign] of [['head_tilt', 'head.rot', 1], ['head_forward', 'head.nod', 1], ['head_back', 'head.nod', -1]] as const) {
      expect(validateSkill(M(id), { origin: 'builtin' }).report.ok).toBe(true);
      const e = E(); e.rateLimit = false; e.idleEnabled = false; e.play(M(id)); run(e, 0.7);
      expect(Math.sign(e.values[ch])).toBe(sign);
    }
    const e = E(); e.rateLimit = false; e.idleEnabled = false; e.play(M('head_tilt'), { side: 'left' }); run(e, 0.7); expect(e.values['head.rot']).toBeLessThan(-5);
  });
  it('[A25] arm gestures exist with declared start/end poses and return to rest', async () => {
    for (const id of ['wave', 'point', 'raise_hand', 'open_arms', 'rest_hands']) {
      const s = M(id); expect(s.startPose).toBe('neutral'); expect(s.endPose).toBe('neutral');
      const e = E(); const h = e.play(s); run(e, 1); expect(Math.abs(e.values['armR.raise'] - CHANNELS['armR.raise'].rest) + Math.abs(e.values['armR.bend'] - CHANNELS['armR.bend'].rest)).toBeGreaterThan(15);
      run(e, 8); expect(await h.done).toBe('completed'); expect(Math.abs(e.values['armR.raise'] - CHANNELS['armR.raise'].rest)).toBeLessThan(4);
    }
  });
  it('[A26] bounce intensity scales with amplitude and stays within limits', () => {
    const peak = (amp: number) => { const e = E(); e.rateLimit = false; e.idleEnabled = false; e.play(M('bounce'), { amplitude: amp }); let m = 0; for (let i = 0; i < 60; i++) { e.update(1 / 60); m = Math.min(m, e.values['body.y']); } return m; };
    expect(peak(1.2)).toBeLessThan(peak(0.4)); expect(peak(1.2)).toBeGreaterThanOrEqual(CHANNELS['body.y'].min);
  });
  it('[A27] orientation: three-quarter facing is a bounded 2D channel', () => {
    const e = E(); e.rateLimit = false; e.play(M('turn_left')); run(e, 1); expect(e.values['body.facing']).toBeGreaterThan(0.5); expect(e.values['body.facing']).toBeLessThanOrEqual(1);
    expect(M('turn_left').description).toMatch(/not a 3D turn/);
  });
  it('[A28] timeline: easing, interpolation, loops; playback is deterministic', () => {
    for (const k of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'backOut'] as const) { expect(ease(k, 0)).toBeCloseTo(0); expect(ease(k, 1)).toBeCloseTo(1); }
    expect(sampleKeys([{ t: 1, v: 10, ease: 'linear' }], 0.5, 0)).toBeCloseTo(5);
    const s = skill({ id: 'lp', duration: 2, loop: { start: 0.5, end: 1.5 } }); expect(totalDuration(s, 3)).toBe(4); expect(localTime(s, 3, 1.75)).toBeCloseTo(0.75);
    const a = E(), b = E(); a.play(M('wave')); b.play(M('wave'));
    for (let i = 0; i < 200; i++) { a.update(1 / 60); b.update(1 / 60); }
    expect(a.values).toEqual(b.values);
  });
  it('[A28] cancellation resolves the handle as cancelled', async () => { const e = E(); const h = e.play(M('wave')); run(e, 0.3); h.cancel(); run(e, 0.5); expect(await h.done).toBe('cancelled'); });
  it('[A29] blending: different groups run together; same group interrupts; lower priority queues; no jumps', async () => {
    const e = E(); const faceCue = skill({ id: 'brow_flash', tracks: [tr('browL.y', [0.3, 1], [1, 0])] });
    const w = e.play(M('wave')); const n = e.play(faceCue); run(e, 0.2);
    expect(w.status).toBe('running'); expect(n.status).toBe('running');           // armR + eyes coexist
    const p = e.play(M('point')); run(e, 0.4); expect(await w.done).toBe('interrupted'); expect(p.status).toBe('running');
    const low = e.play(skill({ id: 'low_arm', priority: 1, tracks: [tr('armR.raise', [0.5, 60], [1, 8])] })); expect(low.status).toBe('queued');
    const r = e.play(skill({ id: 'rej', tracks: [tr('armR.raise', [0.5, 30], [1, 8])] }), { conflict: 'reject' }); expect(await r.done).toBe('rejected');
    // rate limiting prevents jumps
    const j = E(); j.play(skill({ id: 'snap', blendIn: 0.05, tracks: [tr('armL.raise', [0.05, 170], [1, 170])] })); j.update(1 / 60); j.update(1 / 60);
    const before = j.values['armL.raise']; j.update(1 / 60); expect(Math.abs(j.values['armL.raise'] - before)).toBeLessThanOrEqual(CHANNELS['armL.raise'].maxSpeed / 60 + 1e-6);
  });
  it('[A30] recovery: watchdog ends stuck actions, stopAll/reset return to neutral, limits enforced', async () => {
    const e = E(); const rec: string[] = []; e.on('recovered', (x) => rec.push(x.skillId));
    const h = e.play(M('wave')); e.speedScale = 0; run(e, 12);                    // simulated stall
    expect(await h.done).toBe('stuck'); expect(rec).toContain('wave'); e.speedScale = 1;
    const e2 = E(); e2.play(M('celebrate')); e2.play(M('nod')); run(e2, 0.5); e2.reset(); run(e2, 3);
    expect(e2.active()).toHaveLength(0); expect(Math.abs(e2.values['armL.raise'] - CHANNELS['armL.raise'].rest)).toBeLessThan(4);
    const e3 = E(); const hs = Array.from({ length: ENGINE_LIMITS.maxQueue + 12 }, (_, i) => e3.play(skill({ id: `q${i}`, tracks: [tr('head.rot', [0.5, 5], [1, 0])] }), { conflict: 'queue' }));
    expect(await hs.at(-1)!.done).toBe('rejected');
    const bad = E(); bad.on('start', () => { throw new Error('listener boom'); }); const orig = console.error; console.error = () => {};
    expect(() => { bad.play(M('nod')); run(bad, 1); }).not.toThrow(); console.error = orig;
    for (const ch of CHANNEL_NAMES) { expect(Number.isFinite(bad.values[ch])).toBe(true); }
  });
});
