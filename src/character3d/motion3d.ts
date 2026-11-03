/**
 * NEXUS 3D Motion Engine — the 3D robot's own body language, layered on top of the shared animation channels.
 *
 * What it controls (and only this — the GLB has rigid parts on pivoted nodes, no skeleton):
 *   Body (lean forward/back, side sway, turn — legs are counter-rotated so the feet stay planted),
 *   Head (nod, turn, tilt about the neck), Arm_L/Arm_R (forward swing, out), Forearm_L/R (forward bend at the elbow),
 *   Antenna (follow-through only), and a gaze offset (pupils).
 * The face (eyes, blinks, mouth, brows) stays with the expression system and speech audio — it is not touched here.
 *
 * How it works:
 *   - a per-state BASE POSE (thinking: head tilted, looking up; listening: leaning in slightly; …)
 *   - plus PRIMITIVES (head tilt, head turn, gaze shift, posture shift, small arm gesture, nod, return-to-neutral) with
 *     eased attack/hold/release envelopes, combined into short SEQUENCES chosen per state with a seeded RNG
 *     (varied but reproducible; never the same sequence twice in a row)
 *   - every joint is driven through a critically-damped spring toward its target (no snapping), the antenna through a
 *     lightly under-damped one that lags the head (follow-through), and the final angles are clamped to MOTION_LIMITS.
 * Priority: interrupt/stop > speech > intentional gestures from the animation engine (it owns the arms then — this
 * engine fades its own arm offsets out) > thinking/listening > idle/resting. One sequence at a time; a state change
 * cancels the running sequence. No network, no AI calls: Gemini never drives blinking, idle or timing.
 */

export type MotionState = 'idle' | 'greeting' | 'listening' | 'thinking' | 'speaking' | 'explaining' | 'waiting' | 'curious' | 'excited' | 'confused' | 'concerned' | 'resting' | 'interrupted' | 'error' | 'acting';

/** Joint offsets this engine adds (radians; gaze in channel units). */
export interface Pose {
  headNod: number; headTurn: number; headTilt: number;   // + nod = face down, + turn = toward character's left, + tilt = toward its right shoulder
  lean: number; sway: number; turn: number;                // body: + lean = forward
  armLFwd: number; armRFwd: number; armLOut: number; armROut: number; foreLFwd: number; foreRFwd: number;
  gazeX: number; gazeY: number;
}
const KEYS = ['headNod', 'headTurn', 'headTilt', 'lean', 'sway', 'turn', 'armLFwd', 'armRFwd', 'armLOut', 'armROut', 'foreLFwd', 'foreRFwd', 'gazeX', 'gazeY'] as const;
type Key = (typeof KEYS)[number];
const ZERO = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as Pose;
const deg = (d: number) => (d * Math.PI) / 180;

/* ------------------------------------------------------------------ configuration (all tuning lives here) */

/** Hard limits for the offsets this engine adds (applied to the sum of base pose + primitives). */
export const MOTION_LIMITS: Record<Key, [number, number]> = {
  headNod: [deg(-14), deg(12)], headTurn: [deg(-22), deg(22)], headTilt: [deg(-14), deg(14)],
  lean: [deg(-3), deg(5)], sway: [deg(-3), deg(3)], turn: [deg(-10), deg(10)],
  armLFwd: [deg(-38), deg(4)], armRFwd: [deg(-38), deg(4)], armLOut: [deg(-2), deg(12)], armROut: [deg(-2), deg(12)],
  foreLFwd: [deg(-55), 0], foreRFwd: [deg(-55), 0],
  gazeX: [-0.5, 0.5], gazeY: [-0.5, 0.4],
};
/** Limits for the TOTAL joint angle (expression/gesture channels + this engine), so stacked layers never over-rotate. */
export const JOINT_LIMITS = { headNod: [deg(-20), deg(18)], headTurn: [deg(-28), deg(28)], headTilt: [deg(-17), deg(17)], bodyLean: [deg(-6), deg(8)] } as const;
const lim = (v: number, r: readonly [number, number]) => Math.max(r[0], Math.min(r[1], v));
/** Spring response per joint (rad/s natural frequency): heavier parts move slower. */
export const MOTION_SPRINGS: Record<Key, number> = {
  headNod: 7, headTurn: 6, headTilt: 6, lean: 3.2, sway: 3, turn: 3.5,
  armLFwd: 5, armRFwd: 5, armLOut: 5, armROut: 5, foreLFwd: 6, foreRFwd: 6, gazeX: 14, gazeY: 14,
};
/** Antenna follow-through: lag behind head/body rotation, softly under-damped. */
export const ANTENNA = { gain: 0.35, freq: 9, damping: 0.35, limit: deg(14) };
/** Fast settle used on interrupt (everything returns to neutral in ~0.3 s). */
export const INTERRUPT_FREQ = 14;

/** Per-state base pose (offsets held while in that state). */
export const STATE_POSES: Record<MotionState, Partial<Pose>> = {
  idle: {},
  listening: { lean: deg(2.5), headNod: deg(2), headTilt: deg(3) },
  thinking: { headTilt: deg(-3), headNod: deg(-5), headTurn: deg(-5), gazeX: -0.2, gazeY: -0.25 },
  speaking: { headNod: deg(-1) },
  /** a longer explanation: upright, open posture, more hand gestures */
  explaining: { headNod: deg(-2), lean: deg(1.5), armLOut: deg(2), armROut: deg(2) },
  /** asked the user something and waits for the answer: attentive, still */
  waiting: { headTilt: deg(4), lean: deg(1.5), headNod: deg(1) },
  curious: { headTilt: deg(3), lean: deg(3), headNod: deg(-2) },
  confused: { headTilt: deg(-4), headTurn: deg(5), sway: deg(-1.5) },
  resting: { headNod: deg(8), lean: deg(-1.5), armLOut: deg(-1), armROut: deg(-1) },
  interrupted: {},
  error: { headNod: deg(6), lean: deg(-1) },
  acting: {},
  greeting: { headTilt: deg(4), headNod: deg(-3), lean: deg(1.5) },
  excited: { headNod: deg(-6), lean: deg(1), armLOut: deg(4), armROut: deg(4) },
  concerned: { headNod: deg(7), headTilt: deg(-3), lean: deg(-1) },
};
/** How often a new sequence starts in each state [min, max] seconds (null = none). */
export const STATE_RHYTHM: Record<MotionState, [number, number] | null> = {
  idle: [3.5, 7.5], listening: [3, 6], thinking: [2.2, 4], speaking: [1.6, 3.2], explaining: [1.1, 2.2], waiting: [4, 7], curious: [2.5, 4.5], confused: [3, 5],
  resting: [9, 16], interrupted: null, error: null, acting: null, greeting: [1.2, 2], excited: [0.9, 1.6], concerned: [3.5, 6],
};

/* ------------------------------------------------------------------ primitives and sequences */

/** One primitive: offsets that ease in, hold, ease out (smoothstep envelope). */
export interface Primitive { name: string; at: number; attack: number; hold: number; release: number; pose: Partial<Pose> }
const P = (name: string, pose: Partial<Pose>, at = 0, attack = 0.5, hold = 0.6, release = 0.6): Primitive => ({ name, at, attack, hold, release, pose });
type Rng = () => number;
const rr = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
const side = (rng: Rng) => (rng() < 0.5 ? -1 : 1);

/** The reusable movement primitives (bounded parameters). */
export const PRIMITIVES = {
  headTilt: (rng: Rng, amp = 1, at = 0) => P('headTilt', { headTilt: side(rng) * deg(rr(rng, 3, 7)) * amp }, at, 0.6, rr(rng, 0.5, 1.2), 0.7),
  headTurn: (rng: Rng, amp = 1, at = 0) => P('headTurn', { headTurn: side(rng) * deg(rr(rng, 5, 12)) * amp, gazeX: 0 }, at, 0.7, rr(rng, 0.6, 1.4), 0.8),
  gazeShift: (rng: Rng, amp = 1, at = 0) => { const s = side(rng); return P('gazeShift', { gazeX: s * rr(rng, 0.2, 0.4) * amp, gazeY: rr(rng, -0.2, 0.15) * amp, headTurn: s * deg(3) * amp }, at, 0.25, rr(rng, 0.6, 1.4), 0.35); },
  posture: (rng: Rng, amp = 1, at = 0) => P('posture', { sway: side(rng) * deg(rr(rng, 0.8, 2)) * amp, lean: deg(rr(rng, -0.8, 1.5)) * amp }, at, 1.1, rr(rng, 1, 2), 1.2),
  nod: (rng: Rng, amp = 1, at = 0) => P('nod', { headNod: deg(rr(rng, 3, 6)) * amp }, at, 0.22, 0.08, 0.3),
  armGesture: (rng: Rng, amp = 1, at = 0) => { const L = rng() < 0.5; const f = -deg(rr(rng, 14, 26)) * amp, e = -deg(rr(rng, 24, 40)) * amp, o = deg(rr(rng, 3, 7)) * amp;
    return P('armGesture', L ? { armLFwd: f, foreLFwd: e, armLOut: o } : { armRFwd: f, foreRFwd: e, armROut: o }, at, 0.45, rr(rng, 0.5, 0.9), 0.6); },
  neutral: (_rng: Rng, _amp = 1, at = 0) => P('neutral', {}, at, 0.3, 0.1, 0.3),
};

/** Sequences per state: each returns a few compatible primitives with staggered start times. */
const SEQUENCES: Partial<Record<MotionState, { id: string; make: (rng: Rng) => Primitive[] }[]>> = {
  idle: [
    { id: 'glance', make: (r) => [PRIMITIVES.gazeShift(r), PRIMITIVES.headTurn(r, 0.5, 0.15)] },
    { id: 'shift', make: (r) => [PRIMITIVES.posture(r)] },
    { id: 'tilt', make: (r) => [PRIMITIVES.headTilt(r, 0.6)] },
    { id: 'look-around', make: (r) => [PRIMITIVES.headTurn(r, 0.9), PRIMITIVES.gazeShift(r, 0.8, 0.1), PRIMITIVES.posture(r, 0.5, 0.4)] },
  ],
  listening: [
    { id: 'attend-nod', make: (r) => [PRIMITIVES.nod(r, 0.6)] },
    { id: 'attend-tilt', make: (r) => [PRIMITIVES.headTilt(r, 0.5)] },
  ],
  thinking: [
    { id: 'ponder-turn', make: (r) => [PRIMITIVES.headTurn(r, 0.6), PRIMITIVES.gazeShift(r, 0.7, 0.2)] },
    { id: 'ponder-tilt', make: (r) => [PRIMITIVES.headTilt(r, 0.7), PRIMITIVES.posture(r, 0.5, 0.3)] },
    { id: 'ponder-chin', make: (r) => [{ ...PRIMITIVES.armGesture(r, 0.7), name: 'thinkArm' }, PRIMITIVES.gazeShift(r, 0.6, 0.3)] },
  ],
  speaking: [
    { id: 'beat-nod', make: (r) => [PRIMITIVES.nod(r, 0.8)] },
    { id: 'beat-tilt', make: (r) => [PRIMITIVES.headTilt(r, 0.5), PRIMITIVES.nod(r, 0.5, 0.35)] },
    { id: 'explain', make: (r) => [PRIMITIVES.armGesture(r, 0.8), PRIMITIVES.nod(r, 0.5, 0.25)] },
    { id: 'beat-turn', make: (r) => [PRIMITIVES.headTurn(r, 0.4), PRIMITIVES.posture(r, 0.4)] },
  ],
  explaining: [
    { id: 'explain-left', make: (r) => [PRIMITIVES.armGesture(r, 1), PRIMITIVES.nod(r, 0.5, 0.25)] },
    { id: 'explain-both', make: (r) => [PRIMITIVES.armGesture(r, 0.8), PRIMITIVES.armGesture(r, 0.7, 0.35), PRIMITIVES.headTilt(r, 0.4, 0.2)] },
    { id: 'explain-beat', make: (r) => [PRIMITIVES.nod(r, 0.7), PRIMITIVES.headTurn(r, 0.3, 0.2)] },
  ],
  waiting: [{ id: 'wait-tilt', make: (r) => [PRIMITIVES.headTilt(r, 0.4)] }, { id: 'wait-blink-look', make: (r) => [PRIMITIVES.gazeShift(r, 0.3)] }],
  greeting: [{ id: 'hello-nod', make: (r) => [PRIMITIVES.nod(r, 0.8), PRIMITIVES.headTilt(r, 0.6, 0.2)] }],
  excited: [
    { id: 'bounce-nod', make: (r) => [PRIMITIVES.nod(r, 1), PRIMITIVES.nod(r, 0.8, 0.45)] },
    { id: 'happy-arms', make: (r) => [PRIMITIVES.armGesture(r, 0.9), PRIMITIVES.headTilt(r, 0.6, 0.1)] },
  ],
  concerned: [{ id: 'worried-shift', make: (r) => [PRIMITIVES.posture(r, 0.4), PRIMITIVES.gazeShift(r, 0.4, 0.3)] }],
  curious: [
    { id: 'curious-look', make: (r) => [PRIMITIVES.gazeShift(r, 0.7), PRIMITIVES.headTilt(r, 0.6, 0.2)] },
    { id: 'curious-lean', make: (r) => [PRIMITIVES.posture(r, 0.6), PRIMITIVES.nod(r, 0.4, 0.5)] },
  ],
  confused: [
    { id: 'puzzle', make: (r) => [PRIMITIVES.headTurn(r, 0.4), PRIMITIVES.gazeShift(r, 0.6, 0.3)] },
    { id: 'puzzle-shift', make: (r) => [PRIMITIVES.posture(r, 0.6)] },
  ],
  resting: [{ id: 'settle', make: (r) => [PRIMITIVES.posture(r, 0.4)] }],
};

export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function envelope(p: Primitive, t: number) {
  const l = t - p.at; if (l <= 0) return 0;
  if (l < p.attack) return smooth(l / p.attack);
  if (l < p.attack + p.hold) return 1;
  return 1 - smooth((l - p.attack - p.hold) / p.release);
}
const endOf = (p: Primitive) => p.at + p.attack + p.hold + p.release;
const clamp = (k: Key, v: number) => Math.max(MOTION_LIMITS[k][0], Math.min(MOTION_LIMITS[k][1], v));
/** mulberry32 (same as the animation engine) */
export function seededRng(seed: number): Rng { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ------------------------------------------------------------------ engine */

export class Motion3D {
  state: MotionState = 'idle';
  /** 0 = no procedural motion (reduced motion); 1 = normal */
  amplitude = 1;
  private seq: { id: string; prims: Primitive[]; t: number; end: number } | null = null;
  private lastSeq: string | null = null;
  private wait = 1.5;
  private cur = ZERO(); private vel = ZERO();
  private ant = { x: 0, v: 0 }; private prevHead = { z: 0, y: 0 };
  private armsBusy = 0;          // 0..1 — fades this engine's arm offsets out while the animation engine gestures
  private settleFast = 0;        // seconds of fast settling left (after an interrupt)
  /** debug / tests: names of the primitives running now, and every sequence started (bounded) */
  log: string[] = [];
  constructor(private rng: Rng = seededRng(11)) {}

  setState(s: MotionState) {
    if (s === this.state) return;
    this.state = s;
    this.seq = null;                                   // a state change cancels the running sequence (no stale gestures)
    const r = STATE_RHYTHM[s]; this.wait = r ? rr(this.rng, 0.4, Math.min(1.5, r[0])) : Infinity;
    if (s === 'interrupted') this.interrupt();
  }
  /** Stop everything now and settle quickly to neutral (user interruption / emergency stop). */
  interrupt() { this.seq = null; this.settleFast = 0.45; this.wait = 1.2; }
  /** Running sequence id (null when only the base pose is held). */
  active() { return this.seq ? this.seq.id : null; }
  /** True while something still moves (so a power-saving loop should keep full frame rate). */
  busy() { return this.seq !== null || KEYS.some((k) => Math.abs(this.vel[k]) > 0.002) || Math.abs(this.ant.v) > 0.002; }

  private target(): Pose {
    const out = ZERO(); const a = this.amplitude;
    const base = STATE_POSES[this.state];
    for (const k of KEYS) out[k] = (base[k] ?? 0) * a;
    if (this.seq) for (const p of this.seq.prims) { const w = envelope(p, this.seq.t) * a; if (w) for (const k of KEYS) out[k] += (p.pose[k] ?? 0) * w; }
    const armK = 1 - this.armsBusy;
    for (const k of ['armLFwd', 'armRFwd', 'armLOut', 'armROut', 'foreLFwd', 'foreRFwd'] as const) out[k] *= armK;
    for (const k of KEYS) out[k] = clamp(k, out[k]);
    return out;
  }
  private pick() {
    const list = SEQUENCES[this.state]; if (!list?.length) return;
    const choices = list.length > 1 ? list.filter((s) => s.id !== this.lastSeq) : list;
    const s = choices[Math.floor(this.rng() * choices.length) % choices.length];
    const prims = s.make(this.rng);
    this.seq = { id: s.id, prims, t: 0, end: Math.max(...prims.map(endOf)) };
    this.lastSeq = s.id; this.log.push(`${this.state}:${s.id}`); if (this.log.length > 50) this.log.shift();
  }

  /**
   * Advance by dt seconds. `gesturing` = the animation engine is moving the arms itself (an AI-chosen or user gesture).
   * Returns the clamped offsets to add to the model (no allocation beyond the returned object).
   */
  update(dt: number, gesturing = false): Pose & { antenna: number } {
    dt = Math.min(0.1, Math.max(0, dt));
    this.armsBusy += ((gesturing ? 1 : 0) - this.armsBusy) * (1 - Math.exp(-dt * 10));
    // sequencing
    if (this.amplitude > 0) {
      if (this.seq) { this.seq.t += dt; if (this.seq.t >= this.seq.end) { this.seq = null; const r = STATE_RHYTHM[this.state]; this.wait = r ? rr(this.rng, r[0], r[1]) : Infinity; } }
      else if (Number.isFinite(this.wait)) { this.wait -= dt; if (this.wait <= 0) this.pick(); }
    } else this.seq = null;
    // springs (critically damped): x'' = w²(target - x) - 2w x'
    const tg = this.target(); const fast = this.settleFast > 0; this.settleFast -= dt;
    for (const k of KEYS) {
      const w = fast ? INTERRUPT_FREQ : MOTION_SPRINGS[k];
      const steps = dt > 0.034 ? 2 : 1; const h = dt / steps;            // sub-step long frames for stability
      for (let i = 0; i < steps; i++) { const acc = w * w * (tg[k] - this.cur[k]) - 2 * w * this.vel[k]; this.vel[k] += acc * h; this.cur[k] += this.vel[k] * h; }
      this.cur[k] = clamp(k, this.cur[k]);
    }
    // antenna follow-through: pushed opposite to the head/body's angular velocity, then wobbles back (under-damped)
    const hz = this.cur.headTilt + this.cur.sway, hy = this.cur.headTurn;
    const push = dt > 0 ? -((hz - this.prevHead.z) / dt) * ANTENNA.gain - ((hy - this.prevHead.y) / dt) * ANTENNA.gain * 0.3 : 0;
    this.prevHead = { z: hz, y: hy };
    const w = ANTENNA.freq; const acc = w * w * (0 - this.ant.x) - 2 * ANTENNA.damping * w * this.ant.v + push * w;
    this.ant.v += acc * dt; this.ant.x = Math.max(-ANTENNA.limit, Math.min(ANTENNA.limit, this.ant.x + this.ant.v * dt));
    return { ...this.cur, antenna: this.ant.x * this.amplitude };
  }
}

/** Minimal node shape (three.js Object3D compatible) so the mapping is unit-testable without WebGL. */
interface Node { rotation: { x: number; y: number; z: number } }
/** Neutral arm channel values (shared/channels.ts defaults): beyond this, the animation engine is gesturing. */
export const ARM_REST = { raise: 8, bend: 6, tolerance: 12 };
export const gesturingFrom = (v: Record<string, number>) => Math.abs(v['armL.raise'] - ARM_REST.raise) > ARM_REST.tolerance || Math.abs(v['armR.raise'] - ARM_REST.raise) > ARM_REST.tolerance
  || Math.abs(v['armL.bend'] - ARM_REST.bend) > ARM_REST.tolerance * 1.5 || Math.abs(v['armR.bend'] - ARM_REST.bend) > ARM_REST.tolerance * 1.5;

/**
 * Adds the motion offsets onto the nodes AFTER the channel mapping (rig3d.applyChannels) has set them.
 * Legs are counter-rotated against the body lean/sway so the boots stay on the floor.
 */
export function applyMotion(rig: Record<string, Node>, m: Pose & { antenna: number }) {
  // nodes whose axis the channel mapping does not set are assigned (not added), so nothing accumulates across frames
  const B = rig.Body.rotation; B.x = m.lean; B.z += m.sway; B.y += m.turn;
  for (const s of ['L', 'R']) { const L = rig[`Leg_${s}`].rotation; L.x -= m.lean; L.z -= m.sway; }
  const H = rig.Head.rotation; H.x = lim(H.x + m.headNod, JOINT_LIMITS.headNod); H.y = lim(H.y + m.headTurn, JOINT_LIMITS.headTurn); H.z = lim(H.z - m.headTilt, JOINT_LIMITS.headTilt);
  rig.Arm_L.rotation.x = m.armLFwd; rig.Arm_R.rotation.x = m.armRFwd;
  rig.Arm_L.rotation.z += m.armLOut; rig.Arm_R.rotation.z -= m.armROut;
  rig.Forearm_L.rotation.x = m.foreLFwd; rig.Forearm_R.rotation.x = m.foreRFwd;
  rig.Antenna.rotation.z += m.antenna;
}
