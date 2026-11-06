/**
 * NEXUS locomotion: walking, stopping and turning with planted feet — no sliding, no floating.
 *
 * The pelvis (root) follows a path with a real velocity profile (accelerate, cruise, decelerate to an exact stop) and
 * turns at a limited rate. The feet are NOT animated on a timer: each foot stays planted where it landed until it is
 * too far from where it should be under the moving body (behind the hips while walking, rotated away while turning);
 * then — only if the other foot is on the ground — it lifts, swings along a smooth arc (toe-off, heel strike) and
 * lands where the body will be. Alternating steps, turning steps, the final "feet together" step and the
 * stride-shortening on a slow start all fall out of that one rule, the way a capture-point controller works.
 * The upper body couples to the gait: weight shifts over the supporting foot, the hips bob and counter-rotate, the
 * arms swing opposite to the legs.
 * Pure TypeScript; world = the stage (Body_Root's parent), robot facing +z, its left = +x, yaw turns +z toward +x.
 */
import { clamp, D2R } from './math';

export interface FootState { x: number; z: number; yaw: number; lift: number; toe: number; swinging: boolean }
export interface LocoOutput {
  /** pelvis on the ground plane (path position + gait sway), yaw */
  root: { x: number; y: number; z: number; yaw: number };
  feet: { L: FootState; R: FootState };
  moving: boolean; speed: number;
  /** gait coupling for the upper body (radians): arm swing per side (+ = forward), hip counter-rotation */
  armSwing: { L: number; R: number }; hipYaw: number;
}
const STANCE = 0.3;                 // foot centre-line offset from the pelvis (the hips sit at ±0.3)
const V_MAX = 0.62, ACC = 1.0;      // m/s, m/s² — a calm robot walk
const TURN_RATE = 2.1;              // rad/s
const MIN_FEET = 0.42;              // closest the two foot centres may get
const sgn = (s: 'L' | 'R') => (s === 'L' ? 1 : -1);
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const mj = (u: number) => { const c = clamp(u, 0, 1); return c * c * c * (c * (c * 6 - 15) + 10); };   // minimum-jerk 0…1

interface Swing { fx: number; fz: number; fyaw: number; tx: number; tz: number; tyaw: number; t: number; T: number; len: number }

export class Locomotion {
  x = 0; z = 0; yaw = 0; v = 0;
  private goal: { x: number; z: number } | null = null;
  private face = 0;
  private feet: Record<'L' | 'R', { x: number; z: number; yaw: number; swing: Swing | null; rest: number }>;
  private lastStep: 'L' | 'R' = 'R';
  private sway = 0; private bob = 0;
  /** total distance each foot slid while planted (tests: must stay 0) */
  slip = 0;
  steps = 0;
  constructor() { this.feet = { L: { x: STANCE, z: 0, yaw: 0, swing: null, rest: 1 }, R: { x: -STANCE, z: 0, yaw: 0, swing: null, rest: 1 } }; }

  /** walk to a point on the stage, then face `yaw` (radians; default: keep the walking direction) */
  walkTo(x: number, z: number, faceYaw?: number) { this.goal = { x, z }; if (faceYaw !== undefined) this.face = faceYaw; else this.face = NaN; }
  /** turn on the spot to face `yaw` */
  turnTo(yaw: number) { this.face = wrap(yaw); if (this.goal && Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 0.02) this.goal = null; }
  stop() { this.goal = null; this.face = this.yaw; }
  /** something is still happening (walking, turning, a foot in the air) */
  busy() { return !!this.goal || Math.abs(this.v) > 0.01 || Math.abs(wrap(this.face - this.yaw)) > 0.02 || !!this.feet.L.swing || !!this.feet.R.swing || this.stanceError('L') > 0.06 || this.stanceError('R') > 0.06; }
  arrived() { return !this.busy(); }

  private desired(s: 'L' | 'R', lead: number): { x: number; z: number; yaw: number } {
    const y = this.yaw; const fx = Math.sin(y), fz = Math.cos(y);     // forward
    const rx = Math.cos(y), rz = -Math.sin(y);                         // the robot's left (+x at yaw 0)
    return { x: this.x + rx * sgn(s) * STANCE + fx * lead, z: this.z + rz * sgn(s) * STANCE + fz * lead, yaw: y };
  }
  private stanceError(s: 'L' | 'R', lead = 0) { const f = this.feet[s]; const d = this.desired(s, lead); return Math.hypot(f.x - d.x, f.z - d.z) + Math.abs(wrap(f.yaw - d.yaw)) * 0.35; }

  update(dt: number): LocoOutput {
    const d = clamp(dt, 0, 0.1);
    // ---------- path & velocity
    let heading = this.yaw; let targetV = 0;
    if (this.goal) {
      const dx = this.goal.x - this.x, dz = this.goal.z - this.z; const dist = Math.hypot(dx, dz);
      if (dist < 0.015 && Math.abs(this.v) < 0.05) { this.goal = null; if (Number.isNaN(this.face)) this.face = this.yaw; }   // the last cm/s bleed off on their own (no stop jolt)
      else {
        heading = Math.atan2(dx, dz);
        const off = Math.abs(wrap(heading - this.yaw));
        // facing well away from the path: turn first (on the spot), walk once roughly aligned
        targetV = off > 50 * D2R ? 0 : Math.min(V_MAX, Math.sqrt(2 * ACC * 0.8 * Math.max(0, dist - 0.01))) * (1 - off / (Math.PI / 2));
      }
    }
    const faceYaw = this.goal ? heading : Number.isNaN(this.face) ? this.yaw : this.face;
    // the body cannot outrun its feet: with a foot in the air the pelvis may not get far ahead of the planted one
    const sw = this.feet.L.swing ? 'L' : this.feet.R.swing ? 'R' : null;
    if (sw) { const p = this.feet[sw === 'L' ? 'R' : 'L']; const ahead = (this.x - p.x) * Math.sin(this.yaw) + (this.z - p.z) * Math.cos(this.yaw); if (ahead > 0.3) targetV = Math.min(targetV, this.v * 0.6); }
    const dv = clamp(targetV - this.v, -ACC * 1.4 * d, ACC * d); this.v = Math.max(0, this.v + dv);
    // heading: rate-limited, eased near the target (no instant rotation)
    const yerr = wrap(faceYaw - this.yaw); let rate = Math.min(TURN_RATE, Math.abs(yerr) * 3.2 + 0.05);
    // the hips may not twist far ahead of the feet: past ~28° the turn waits for the next step to catch up
    const feetYaw = this.feet.L.yaw + wrap(this.feet.R.yaw - this.feet.L.yaw) / 2; const twist = wrap(this.yaw - feetYaw);
    if (Math.abs(twist) > 28 * D2R && Math.sign(twist) === Math.sign(yerr)) rate *= clamp(1 - (Math.abs(twist) - 28 * D2R) / (10 * D2R), 0.08, 1);
    this.yaw = wrap(this.yaw + Math.sign(yerr) * Math.min(Math.abs(yerr), rate * d));
    this.x += Math.sin(this.yaw) * this.v * d; this.z += Math.cos(this.yaw) * this.v * d;

    // ---------- feet: swing the one in the air; start a step when a planted foot is out of place
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s]; const g = f.swing; if (!g) continue;
      g.t += d; const u = Math.min(1, g.t / g.T); const k = mj(u);
      f.x = g.fx + (g.tx - g.fx) * k; f.z = g.fz + (g.tz - g.fz) * k; f.yaw = g.fyaw + wrap(g.tyaw - g.fyaw) * k;
      if (u >= 1) { f.swing = null; f.rest = 0; this.steps++; }
    }
    for (const s of ['L', 'R'] as const) this.feet[s].rest += d;
    const T = clamp(0.47 - this.v * 0.12, 0.38, 0.48);
    const lead = this.v * T * 0.9;                       // land ahead of the hips by about half a stride
    if (!this.feet.L.swing && !this.feet.R.swing) {
      const moving = this.v > 0.02 || Math.abs(yerr) > 0.05 || !!this.goal;
      const thr = moving ? 0.1 : 0.055;                   // standing still: only a clearly misplaced foot is re-placed
      const eL = this.stanceError('L', lead), eR = this.stanceError('R', lead);
      // alternate when both are out of place; never step twice with the same foot while the other is far off
      let s: 'L' | 'R' | null = null;
      if (eL > thr || eR > thr) s = eL > eR + 0.03 ? 'L' : eR > eL + 0.03 ? 'R' : this.lastStep === 'L' ? 'R' : 'L';
      if (s && this.feet[s === 'L' ? 'R' : 'L'].rest > (moving ? 0.04 : 0.25)) {
        const f = this.feet[s]; const pv = this.v * T;    // where the body will be when the foot lands
        const px = this.x, pz = this.z; this.x += Math.sin(this.yaw) * pv; this.z += Math.cos(this.yaw) * pv;
        const tgt = this.desired(s, this.v > 0.02 ? this.v * T * 0.5 : 0); this.x = px; this.z = pz;
        // keep the feet apart (turning steps, crossing)
        const o = this.feet[s === 'L' ? 'R' : 'L']; const sep = Math.hypot(tgt.x - o.x, tgt.z - o.z);
        if (sep < MIN_FEET) { const k = MIN_FEET / Math.max(1e-6, sep); tgt.x = o.x + (tgt.x - o.x) * k; tgt.z = o.z + (tgt.z - o.z) * k; }
        const len = Math.hypot(tgt.x - f.x, tgt.z - f.z);
        f.swing = { fx: f.x, fz: f.z, fyaw: f.yaw, tx: tgt.x, tz: tgt.z, tyaw: tgt.yaw, t: 0, T: len < 0.12 ? Math.max(0.3, T * 0.85) : T, len };
        this.lastStep = s;
      }
    }

    // ---------- gait coupling: weight over the supporting foot, bob, hip twist, arm swing
    const out = {} as LocoOutput['feet']; let swingU = 0, swingSide: 'L' | 'R' | null = null;
    for (const s of ['L', 'R'] as const) {
      const f = this.feet[s]; const g = f.swing; let lift = 0, toe = 0;
      if (g) {
        const u = Math.min(1, g.t / g.T); swingU = u; swingSide = s;
        const h = clamp(0.035 + g.len * 0.14, 0.035, 0.085);
        // lift and toe angle start and end with zero velocity (the boot peels off and settles down, no flick)
        lift = h * (1 - Math.cos(2 * Math.PI * u)) / 2;
        const k = clamp(g.len / 0.25, 0.3, 1);
        // + = toes down (+x rotation): push-off peels the heel up first; − = toes up before the heel strikes
        toe = u < 0.55 ? 11 * Math.sin((Math.PI * u) / 0.55) ** 2 * k : u > 0.6 ? -8 * Math.sin((Math.PI * (u - 0.6)) / 0.4) ** 2 * k : 0;
      }
      out[s] = { x: f.x, z: f.z, yaw: f.yaw, lift, toe, swinging: !!g };
    }
    const swayT = swingSide ? -sgn(swingSide) * 0.035 * Math.sin(Math.PI * swingU) : 0;   // hips over the planted foot
    this.sway += (swayT - this.sway) * (1 - Math.exp(-d * 9));
    const bobT = (swingSide ? 0.006 * Math.sin(Math.PI * swingU) ** 2 : 0) - 0.03 * clamp(this.v / V_MAX + Math.min(1, Math.abs(yerr)), 0, 1);   // walking / turning: knees softer
    this.bob += (bobT - this.bob) * (1 - Math.exp(-d * 12));
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fwd = (s: 'L' | 'R') => (out[s].x - this.x) * Math.sin(this.yaw) + (out[s].z - this.z) * Math.cos(this.yaw);
    const stride = clamp((fwd('L') - fwd('R')) / 0.35, -1, 1);       // + = left foot ahead
    const armK = clamp(this.v / V_MAX, 0, 1);
    return {
      root: { x: this.x + rx * this.sway, y: this.bob, z: this.z + rz * this.sway, yaw: this.yaw },
      feet: out, moving: this.busy(), speed: this.v,
      armSwing: { L: -stride * 0.22 * armK, R: stride * 0.22 * armK }, hipYaw: stride * 0.05 * armK,
    };
  }
}
