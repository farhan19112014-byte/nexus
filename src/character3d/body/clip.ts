/**
 * Full-body clip format + sampler.
 *
 * A clip is a list of keys. Each key describes INTENT, not raw bone angles where a target is more natural:
 *   root  – translation (lift, travel) and rotation (pitch for flips/rolls, yaw for turns) about the centre of mass
 *   body  – hip lean/turn/side tilt (deg), head – nod/turn/tilt (deg)
 *   arms  – a palm target in Body space solved with two-bone IK (+ elbow pole, hand roll/flex) or explicit angles
 *   legs  – "plant": the foot stays on the ground (IK, so squats and landings keep the feet still) — with optional
 *           step offsets / lift — or explicit thigh/knee/ankle angles for airborne moves (tuck, kick).
 * Between keys every number is interpolated with a cubic Hermite curve (Catmull–Rom tangents, zero velocity at
 * "hold" keys and at the ends), and the IK is solved again on every frame from the interpolated targets — so contact
 * points (palms in a clap, feet on the floor) stay exact between keys, and nothing snaps.
 */
import { D2R, QI, add, eulerOf, qconj, qeuler, qeulerDeg, qmul, rot, slerp, smooth, sub, type Q, type V3 } from './math';
import { twoBoneIK } from './ik';
import { JOINTS, lowestPoint, shrugOffset, SKELETON, sgn, type BodyPose, type Joint, type Side } from './skeleton';

export interface ArmIK { at: V3; pole?: V3; hand?: V3 }
export interface ArmAng { sh: V3; el: V3; hand?: V3 }
export interface LegPlant { plant: true; dx?: number; dz?: number; lift?: number; toe?: number; /** knee direction (Body space), default forward */ knee?: V3 }
export interface LegAng { th: V3; kn: number; an?: number }
export type ArmSpec = ArmIK | ArmAng;
export type LegSpec = LegPlant | LegAng;
export interface RootSpec { x?: number; y?: number; z?: number; pitch?: number; yaw?: number; roll?: number }
export interface Key {
  t: number; hold?: boolean;
  root?: RootSpec; body?: V3; head?: V3; antenna?: number; shrug?: number; protract?: number;
  armL?: ArmSpec; armR?: ArmSpec; legL?: LegSpec; legR?: LegSpec;
}
/** which joints a clip takes over (the rest stays with the channel/expression layer, e.g. the face, the head) */
export type Mask = 'full' | 'noHead' | 'arms' | 'armsHead' | 'head';
export interface Clip {
  id: string; name: string; duration: number; keys: Key[]; mask: Mask;
  /** [start, end] seconds looped while the action is held (e.g. claps, dancing); the rest plays once */
  loop?: [number, number];
  /** rotation pivot for root pitch/roll (default: the centre of mass) */
  pivot?: V3;
  /** [start, end] seconds of rolling ground contact: the body is kept touching the floor at its lowest point */
  contact?: [number, number];
  /** category for the preview lab and documentation */
  kind: 'basic' | 'expressive' | 'advanced' | 'state';
  doc: string;
}

const KNEE_FWD: V3 = [0, -0.2, 1];
export const NEUTRAL_ARM = (s: Side): ArmAng => ({ sh: [0, 0, sgn(s) * 8], el: [0, 0, sgn(s) * 6] });
export const PLANT: LegPlant = { plant: true };
export const isIK = (a: ArmSpec): a is ArmIK => (a as ArmIK).at !== undefined;
export const isPlant = (l: LegSpec): l is LegPlant => (l as LegPlant).plant === true;
/** mirror a right-arm spec to the left (or back) */
export function mirrorArm(a: ArmSpec): ArmSpec {
  if (isIK(a)) return { at: [-a.at[0], a.at[1], a.at[2]], pole: a.pole && [-a.pole[0], a.pole[1], a.pole[2]], hand: a.hand && [a.hand[0], -a.hand[1], -a.hand[2]] };
  return { sh: [a.sh[0], -a.sh[1], -a.sh[2]], el: [a.el[0], -a.el[1], -a.el[2]], hand: a.hand && [a.hand[0], -a.hand[1], -a.hand[2]] };
}
export function mirrorLeg(l: LegSpec): LegSpec {
  if (isPlant(l)) return { ...l, dx: l.dx === undefined ? undefined : -l.dx, knee: l.knee && [-l.knee[0], l.knee[1], l.knee[2]] };
  return { th: [l.th[0], -l.th[1], -l.th[2]], kn: l.kn, an: l.an };
}

/* ---------------- interpolation ---------------- */
/** cubic Hermite on one scalar track (keys may omit the value → undefined: treated as the given default) */
function hermite(ts: number[], vs: number[], holds: boolean[], t: number) {
  const n = ts.length; if (n === 1 || t <= ts[0]) return vs[0]; if (t >= ts[n - 1]) return vs[n - 1];
  let i = 0; while (i < n - 2 && t > ts[i + 1]) i++;
  const t0 = ts[i], t1 = ts[i + 1], h = t1 - t0, u = (t - t0) / h;
  const tan = (k: number) => (holds[k] || k === 0 || k === n - 1 ? 0 : (vs[k + 1] - vs[k - 1]) / (ts[k + 1] - ts[k - 1]));
  // limit tangents (monotone-ish) so the curve cannot overshoot wildly between close keys
  const lim = (m: number, k: number) => { const s0 = k > 0 ? (vs[k] - vs[k - 1]) / (ts[k] - ts[k - 1]) : 0, s1 = k < n - 1 ? (vs[k + 1] - vs[k]) / (ts[k + 1] - ts[k]) : 0; if (s0 * s1 <= 0) return 0; const mx = 3 * Math.min(Math.abs(s0), Math.abs(s1)); return Math.sign(m) * Math.min(Math.abs(m), mx); };
  const m0 = lim(tan(i), i) * h, m1 = lim(tan(i + 1), i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * m1;
}

/** a sampler pre-built for one clip (tracks extracted once; sampling allocates only the result) */
export class ClipSampler {
  private ts: number[]; private holds: boolean[];
  private tracks = new Map<string, number[]>();
  constructor(readonly clip: Clip) {
    const k = [...clip.keys].sort((a, b) => a.t - b.t);
    this.ts = k.map((x) => x.t); this.holds = k.map((x) => !!x.hold);
    const put = (name: string, get: (x: Key) => number) => this.tracks.set(name, k.map(get));
    for (const c of ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const) put(`root.${c}`, (x) => x.root?.[c] ?? 0);
    for (const i of [0, 1, 2]) { put(`body.${i}`, (x) => x.body?.[i] ?? 0); put(`head.${i}`, (x) => x.head?.[i] ?? 0); }
    put('antenna', (x) => x.antenna ?? 0); put('shrug', (x) => x.shrug ?? 0); put('protract', (x) => x.protract ?? 0);
    this.keys = k;
  }
  private keys: Key[];
  private val(name: string, t: number) { return hermite(this.ts, this.tracks.get(name)!, this.holds, t); }

  /** limb spec at time t: same-kind neighbours are interpolated parameter-wise; otherwise null (caller slerps) */
  private limb<T>(get: (k: Key) => T, t: number): { a: T; b: T; u: number; same: boolean; i: number } {
    const n = this.keys.length; if (t <= this.ts[0] || n === 1) return { a: get(this.keys[0]), b: get(this.keys[0]), u: 0, same: true, i: 0 };
    if (t >= this.ts[n - 1]) return { a: get(this.keys[n - 1]), b: get(this.keys[n - 1]), u: 0, same: true, i: n - 1 };
    let i = 0; while (i < n - 2 && t > this.ts[i + 1]) i++;
    return { a: get(this.keys[i]), b: get(this.keys[i + 1]), u: (t - this.ts[i]) / (this.ts[i + 1] - this.ts[i]), same: true, i };
  }
  /** Hermite-interpolate a numeric field of a limb spec across all keys that use the same kind */
  private limbNum(get: (k: Key) => number | undefined, t: number, dflt: number) {
    const raw = this.keys.map(get);
    // a key next to a key of another kind (IK ↔ angles, planted ↔ airborne) starts/ends with zero velocity, matching
    // the eased blend on the other side — otherwise the tangent would leak a placeholder value across the boundary
    const holds = this.holds.map((h, i) => h || raw[i - 1] === undefined && i > 0 || raw[i + 1] === undefined && i < raw.length - 1);
    return hermite(this.ts, raw.map((v) => v ?? dflt), holds, t);
  }

  sample(tIn: number): BodyPose {
    const t = Math.max(0, Math.min(this.clip.duration, tIn));
    // ---------- legs (classified first: the hip-height easing depends on whether the feet are planted) ----------
    type PlantP = { dx: number; dz: number; lift: number; toe: number; knee: V3 };
    const legSeg = { L: this.limb((k) => k.legL ?? PLANT, t), R: this.limb((k) => k.legR ?? PLANT, t) };
    const plantP = {} as Record<Side, PlantP | null>;
    for (const s of ['L', 'R'] as const) {
      const seg = legSeg[s]; const getL = (k: Key): LegSpec => (s === 'L' ? k.legL : k.legR) ?? PLANT;
      if (isPlant(seg.a) && isPlant(seg.b)) {
        const num = (f: (x: LegPlant) => number | undefined) => this.limbNum((k) => { const x = getL(k); return isPlant(x) ? f(x) ?? 0 : undefined; }, t, 0);
        const ka = (seg.a as LegPlant).knee ?? KNEE_FWD, kb = (seg.b as LegPlant).knee ?? KNEE_FWD, ku = smooth(seg.u);
        plantP[s] = { dx: num((x) => x.dx), dz: num((x) => x.dz), lift: Math.max(0, num((x) => x.lift)), toe: num((x) => x.toe), knee: [ka[0] + (kb[0] - ka[0]) * ku, ka[1] + (kb[1] - ka[1]) * ku, ka[2] + (kb[2] - ka[2]) * ku] };
      } else plantP[s] = null;
    }
    // toes pointing down (push-off): the foot pivots on its toe tip — the heel rises, the toe never sinks into the floor
    const smax = (a: number, b: number, k = 0.03) => (a + b + Math.sqrt((a - b) ** 2 + k * k)) / 2 - k / 2;   // smooth max (no kink)
    const heel = (toe: number) => (toe < 0 ? 0.39 * Math.sin(-toe * D2R) + 0.11 * (1 - Math.cos(toe * D2R)) : 0);
    const r = (c: string) => this.val(`root.${c}`, t);
    const yaw = r('yaw') * D2R, pitch = r('pitch') * D2R, roll = r('roll') * D2R;
    const rootRot = qmul(qmul(qeuler(0, yaw, 0), qeuler(pitch, 0, 0)), qeuler(0, 0, roll));
    const C = this.clip.pivot ?? SKELETON.com;
    // knees: from fully straight legs the knee angle grows like √(hip drop), so a dip that starts at full speed makes
    // the knees jump. The first few cm of any dip below standing height follow a softer (C1) curve instead.
    // Only while both feet are planted: take-offs and landings are authored with bent knees instead.
    const y0 = r('y'), EPS = 0.04;
    const xe = -y0 / EPS;                                  // cubic ease: zero slope at standing height, identity below −EPS
    const yEase = y0 >= 0 || xe >= 1 ? y0 : -EPS * xe * xe * (2 - xe);
    const planted = 1 - smooth(Math.min(plantP.L ? plantP.L.lift : 1, plantP.R ? plantP.R.lift : 1) / 0.04);   // any foot on the floor
    // soft knees while a clip drives the legs: the hips settle a few cm lower (quintic ramp in and out, so the knees
    // leave and return to straight with zero speed). At rest the robot still stands exactly as modelled.
    const legsOn = this.clip.mask === 'full' || this.clip.mask === 'noHead';
    const S = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * c * (c * (c * 6 - 15) + 10); };
    const kappa = legsOn ? 0.05 * S(t / 0.4) * (this.clip.loop ? 1 : S((this.clip.duration - t) / 0.4)) : 0;
    const y = y0 + (yEase - y0) * planted - kappa;
    const rootPos = add(add([r('x'), y, r('z')], C), rot(rootRot, [-C[0], -C[1], -C[2]]));
    const stance = qeuler(0, yaw, 0); const stanceT: V3 = [0, 0, 0];   // feet stay where the clip puts them (dx/dz), not dragged by the hips
    const bodyE: V3 = [this.val('body.0', t), this.val('body.1', t), this.val('body.2', t)];
    const bodyL = qeulerDeg(bodyE);
    const joints = {} as Record<Joint, Q>;
    for (const j of JOINTS) joints[j] = QI();
    joints.Body = bodyL;
    joints.Head = qeulerDeg([this.val('head.0', t), this.val('head.1', t), this.val('head.2', t)]);
    joints.Antenna = qeuler(0, 0, this.val('antenna', t) * D2R);
    const bodyW = qmul(rootRot, bodyL);

    for (const s of ['L', 'R'] as const) {
      // ---------- arm ----------
      const getA = (k: Key): ArmSpec => (s === 'L' ? k.armL : k.armR) ?? NEUTRAL_ARM(s);
      const seg = this.limb(getA, t);
      const solveArm = (spec: ArmSpec): [Q, Q, Q] => {
        if (isIK(spec)) {
          const pole: V3 = spec.pole ?? [sgn(s) * 0.5, -1, -0.35];
          const ik = twoBoneIK(add(SKELETON.shoulder(s), shrugOffset(this.val('shrug', t), this.val('protract', t)).arm), spec.at, SKELETON.upperArm, SKELETON.forearm + SKELETON.palm.offset, pole, 'x', QI(), -1);
          return [ik.upper, ik.lower, qeulerDeg(spec.hand ?? [0, 0, 0])];
        }
        return [qeulerDeg(spec.sh), qeulerDeg(spec.el), qeulerDeg(spec.hand ?? [0, 0, 0])];
      };
      let arm: [Q, Q, Q];
      if (isIK(seg.a) && isIK(seg.b)) {
        // re-solve IK on Hermite-interpolated targets (exact contact between keys)
        const kind = (k: Key) => { const x = getA(k); return isIK(x) ? x : null; };
        const num = (f: (x: ArmIK) => number | undefined, d: number) => this.limbNum((k) => { const x = kind(k); return x ? f(x) : undefined; }, t, d);
        const at: V3 = [num((x) => x.at[0], seg.a.at[0]), num((x) => x.at[1], seg.a.at[1]), num((x) => x.at[2], seg.a.at[2])];
        const pa = seg.a.pole ?? [sgn(s) * 0.5, -1, -0.35], pb = seg.b.pole ?? [sgn(s) * 0.5, -1, -0.35];
        const u = smooth(seg.u);
        const pole: V3 = [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u];
        const ha = seg.a.hand ?? [0, 0, 0], hb = seg.b.hand ?? [0, 0, 0];
        arm = solveArm({ at, pole, hand: [ha[0] + (hb[0] - ha[0]) * u, ha[1] + (hb[1] - ha[1]) * u, ha[2] + (hb[2] - ha[2]) * u] });
      } else if (!isIK(seg.a) && !isIK(seg.b)) {
        const e = (f: (x: ArmAng) => number, d: number) => this.limbNum((k) => { const x = getA(k); return isIK(x) ? undefined : f(x); }, t, d);
        const A = seg.a as ArmAng;
        arm = [qeulerDeg([e((x) => x.sh[0], A.sh[0]), e((x) => x.sh[1], A.sh[1]), e((x) => x.sh[2], A.sh[2])]),
          qeulerDeg([e((x) => x.el[0], A.el[0]), e((x) => x.el[1], A.el[1]), e((x) => x.el[2], A.el[2])]),
          qeulerDeg([e((x) => x.hand?.[0] ?? 0, 0), e((x) => x.hand?.[1] ?? 0, 0), e((x) => x.hand?.[2] ?? 0, 0)])];
      } else {
        const a = solveArm(seg.a), b = solveArm(seg.b), u = smooth(seg.u);
        arm = [slerp(a[0], b[0], u), slerp(a[1], b[1], u), slerp(a[2], b[2], u)];
      }
      [joints[`Arm_${s}`], joints[`Forearm_${s}`], joints[`Hand_${s}`]] = arm;

    }

    const ankleTarget = (s: Side, p: PlantP): V3 => add(stanceT, rot(stance, [sgn(s) * 0.3 + p.dx, SKELETON.ankleHeight + smax(p.lift, heel(p.toe)), p.dz]));
    let bodyO = add(rootPos, rot(rootRot, [0, SKELETON.hipHeight, 0]));
    // pelvis drop: a planted foot the leg cannot reach (hips shifted or tilted) bends the knees a little instead of
    // lifting the foot off the floor — what a person does
    for (let it = 0; it < 3; it++) {
      let excess = 0;
      for (const s of ['L', 'R'] as const) {
        const p = plantP[s]; if (!p) continue;
        const w = 1 - smooth(p.lift / 0.15);                                  // a foot coming down engages gradually
        if (w <= 0) continue;
        const tb = rot(qconj(bodyW), sub(ankleTarget(s, p), bodyO)); const d = Math.hypot(tb[0] - sgn(s) * 0.3, tb[1], tb[2]);
        excess = Math.max(excess, w * (d - (SKELETON.thigh + SKELETON.shin)));
      }
      if (excess <= 1e-5) break;
      rootPos[1] -= excess * 1.02; bodyO = add(rootPos, rot(rootRot, [0, SKELETON.hipHeight, 0]));
    }
    for (const s of ['L', 'R'] as const) {
      // reachK < 1 while blending between airborne angles and a planted foot: knees never lock straight mid-transition
      const solvePlant = (p: PlantP, reachK = 1): [Q, Q, Q] => {
        const tb = rot(qconj(bodyW), sub(ankleTarget(s, p), bodyO));          // ankle target in Body space
        // knee pole: forward by default; poses with the foot in front of the hip (sitting) point the knees up instead,
        // so the pole is never parallel to the leg and the knee cannot flip
        const ik = twoBoneIK(SKELETON.hip(s), tb, SKELETON.thigh, SKELETON.shin, p.knee, 'x', QI(), 1, reachK, 0.08, true);
        const legW = qmul(bodyW, ik.upper), shinW = qmul(legW, ik.lower);
        const footW = qmul(stance, qeuler(p.toe * D2R, 0, 0));                // sole flat on the floor (or toe tilt)
        return [ik.upper, ik.lower, qmul(qconj(shinW), footW)];
      };
      // in a planted ↔ airborne blend the planted side keeps a little knee bend (reach 96%) — clips author those keys
      // with bent knees, where 96% and full reach give the same solution, so the hand-over is seamless
      const solveLeg = (spec: LegSpec): [Q, Q, Q] => isPlant(spec)
        ? solvePlant({ dx: spec.dx ?? 0, dz: spec.dz ?? 0, lift: Math.max(0, spec.lift ?? 0), toe: spec.toe ?? 0, knee: spec.knee ?? KNEE_FWD }, 0.96)
        : [qeulerDeg(spec.th), qeuler(spec.kn * D2R, 0, 0), qeuler((spec.an ?? 0) * D2R, 0, 0)];
      const seg = legSeg[s]; const getL = (k: Key): LegSpec => (s === 'L' ? k.legL : k.legR) ?? PLANT;
      let leg: [Q, Q, Q];
      if (plantP[s]) leg = solvePlant(plantP[s]!);
      else if (!isPlant(seg.a) && !isPlant(seg.b)) {
        const e = (f: (x: LegAng) => number) => this.limbNum((k) => { const x = getL(k); return isPlant(x) ? undefined : f(x); }, t, 0);
        leg = [qeulerDeg([e((x) => x.th[0]), e((x) => x.th[1]), e((x) => x.th[2])]), qeuler(e((x) => x.kn) * D2R, 0, 0), qeuler(e((x) => x.an ?? 0) * D2R, 0, 0)];
      } else {
        const a = solveLeg(seg.a), b = solveLeg(seg.b), u = smooth(seg.u);
        leg = [slerp(a[0], b[0], u), slerp(a[1], b[1], u), slerp(a[2], b[2], u)];
      }
      [joints[`Leg_${s}`], joints[`Shin_${s}`], joints[`Foot_${s}`]] = leg;
    }
    const pose: BodyPose = { rootPos, rootRot, joints, shrug: this.val('shrug', t), protract: this.val('protract', t) };
    // rolling contact: keep the lowest point of the body on the floor (eased in and out at the window's edges)
    const c = this.clip.contact;
    if (c && t > c[0] - 0.12 && t < c[1] + 0.12) {
      const w = smooth(Math.min((t - (c[0] - 0.12)) / 0.24, ((c[1] + 0.12) - t) / 0.24, 1));
      pose.rootPos[1] -= lowestPoint(pose).y * w;
    }
    return pose;

  }
}

/** Euler (deg) of a quaternion — for debugging and the preview readout */
export const degOf = (q: Q): V3 => eulerOf(q).map((v) => Math.round((v / D2R) * 10) / 10) as V3;
