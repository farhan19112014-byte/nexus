/**
 * [A127] 3D Motion Engine: bounded procedural motion, state priorities, interruption, reduced motion, no accumulation.
 */
import { describe, expect, it } from 'vitest';
import { applyMotion, gesturingFrom, JOINT_LIMITS, Motion3D, MOTION_LIMITS, seededRng, STATE_POSES, type MotionState } from '../../character3d/motion3d';
import { CHANNELS } from '../../../shared/channels';

const KEYS = Object.keys(MOTION_LIMITS) as (keyof typeof MOTION_LIMITS)[];
const run = (m: Motion3D, seconds: number, dt = 1 / 60, gest = false) => { let o = m.update(0); for (let t = 0; t < seconds; t += dt) o = m.update(dt, gest); return o; };
const node = () => ({ rotation: { x: 0, y: 0, z: 0 } });
const fakeRig = () => Object.fromEntries(['Body', 'Head', 'Antenna', 'Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Leg_L', 'Leg_R'].map((n) => [n, node()]));

describe('[A127] 3D motion engine', () => {
  it('[A127] every state stays inside the joint limits for minutes of simulated time (fuzzed seeds, uneven frames)', () => {
    const states: MotionState[] = ['idle', 'greeting', 'listening', 'thinking', 'speaking', 'curious', 'excited', 'confused', 'concerned', 'resting', 'error', 'interrupted', 'acting'];
    for (let seed = 1; seed <= 6; seed++) {
      const rng = seededRng(seed * 97); const m = new Motion3D(seededRng(seed));
      for (let i = 0; i < 2400; i++) {
        if (i % 300 === 0) m.setState(states[Math.floor(rng() * states.length)]);
        const o = m.update(rng() < 0.05 ? 0.2 : 1 / 60, rng() < 0.1);
        for (const k of KEYS) { expect(o[k]).toBeGreaterThanOrEqual(MOTION_LIMITS[k][0] - 1e-9); expect(o[k]).toBeLessThanOrEqual(MOTION_LIMITS[k][1] + 1e-9); }
        expect(Math.abs(o.antenna)).toBeLessThan(0.25);
      }
    }
  }, 30000);
  it('[A127] each state settles into its own base pose (thinking looks up and tilts, listening leans in, resting droops)', () => {
    for (const s of ['thinking', 'listening', 'resting', 'curious', 'confused'] as const) {
      const m = new Motion3D(seededRng(3)); m.setState(s); const o = run(m, 1.2);
      const base = STATE_POSES[s];
      for (const k of Object.keys(base) as (keyof typeof base)[]) expect(Math.abs(o[k] - base[k]!)).toBeLessThan(Math.abs(base[k]!) * 0.9 + 0.12);
    }
    const t = new Motion3D(); t.setState('thinking'); const o = run(t, 1.2);
    expect(o.gazeY).toBeLessThan(0); expect(o.headNod).toBeLessThan(0);           // looks up
  });
  it('[A127] procedural variation: sequences vary, never repeat back-to-back, and are reproducible with the same seed', () => {
    const a = new Motion3D(seededRng(5)), b = new Motion3D(seededRng(5));
    run(a, 120); run(b, 120);
    expect(a.log.length).toBeGreaterThan(10);
    expect(a.log).toEqual(b.log);
    for (let i = 1; i < a.log.length; i++) expect(a.log[i]).not.toBe(a.log[i - 1]);
    expect(new Set(a.log).size).toBeGreaterThan(2);
  });
  it('[A127] a state change cancels the running sequence (no stale gestures); interruption settles to neutral within ~0.4 s', () => {
    const m = new Motion3D(seededRng(2)); m.setState('speaking');
    for (let i = 0; i < 600 && !m.active(); i++) m.update(1 / 60);
    expect(m.active()).not.toBeNull();
    m.setState('interrupted'); expect(m.active()).toBeNull();
    const o = run(m, 0.4);
    for (const k of KEYS) expect(Math.abs(o[k])).toBeLessThan(0.02);
    run(m, 5); expect(m.active()).toBeNull();                                   // nothing new starts while interrupted
  });
  it('[A127] reduced motion: no procedural movement at all', () => {
    const m = new Motion3D(); m.amplitude = 0; m.setState('curious');
    const o = run(m, 20);
    for (const k of KEYS) expect(o[k]).toBe(0);
    expect(m.log).toEqual([]);
  });
  it('[A127] while the animation engine gestures, this engine leaves the arms alone (no conflicting transforms)', () => {
    const m = new Motion3D(seededRng(9)); m.setState('speaking');
    let max = 0; let o = m.update(0);
    for (let t = 0; t < 30; t += 1 / 60) { o = m.update(1 / 60, true); if (t > 0.5) max = Math.max(max, Math.abs(o.armLFwd), Math.abs(o.armRFwd), Math.abs(o.foreLFwd), Math.abs(o.foreRFwd)); }
    expect(max).toBeLessThan(0.01);
    const rest = Object.fromEntries(Object.entries(CHANNELS).map(([k, c]) => [k, c.rest]));
    expect(gesturingFrom(rest)).toBe(false);
    expect(gesturingFrom({ ...rest, 'armR.raise': 120 })).toBe(true);
  });
  it('[A127] applying motion never accumulates across frames; legs counter-rotate so the feet stay planted; total head angle is clamped', () => {
    const rig = fakeRig(); const m = { ...new Motion3D().update(0), lean: 0.06, sway: 0.03, headTilt: 0.2, armLFwd: -0.3, antenna: 0.1 };
    for (let i = 0; i < 3; i++) { for (const n of Object.values(rig)) n.rotation = { x: 0, y: 0, z: 0 }; rig.Head.rotation.z = -0.2; applyMotion(rig, m); }
    expect(rig.Body.rotation.x).toBeCloseTo(0.06); expect(rig.Leg_L.rotation.x).toBeCloseTo(-0.06); expect(rig.Leg_R.rotation.z).toBeCloseTo(-0.03);
    expect(rig.Arm_L.rotation.x).toBeCloseTo(-0.3);
    applyMotion(rig, m); expect(rig.Arm_L.rotation.x).toBeCloseTo(-0.3);       // assigned, not added
    expect(rig.Head.rotation.z).toBeGreaterThanOrEqual(JOINT_LIMITS.headTilt[0]);
  });
  it('[A127] motion is smooth: no frame-to-frame jump larger than a small step (springs, eased envelopes)', () => {
    const m = new Motion3D(seededRng(4)); let prev = m.update(0); let worst = 0;
    const order: MotionState[] = ['idle', 'thinking', 'speaking', 'curious', 'listening', 'idle'];
    for (let i = 0; i < 3600; i++) { if (i % 600 === 0) m.setState(order[i / 600]); const o = m.update(1 / 60); for (const k of KEYS) if (!k.startsWith('gaze')) worst = Math.max(worst, Math.abs(o[k] - prev[k])); prev = o; }
    expect(worst).toBeLessThan(0.02);                                            // < ~1.1° per frame at 60 fps
  });
});
