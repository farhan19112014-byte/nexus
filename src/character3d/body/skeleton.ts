/**
 * The NEXUS skeleton as the full-body system sees it: the existing pivot nodes of public/models/nexus.glb (no new
 * bones, no change to the model) with their rest offsets, bone lengths and the body volumes used for collision checks.
 * A unit test compares every number here with the GLB, so the IK always matches the model the browser loads.
 *
 * Frames: Body_Root sits on the ground (y = 0, facing +z, character's left = +x). Body is the hip pivot.
 * Everything a clip describes for arms and the head is in Body space (it follows the hips); feet targets are on the ground.
 */
import { add, qmul, rot, type Q, type V3 } from './math';

export const JOINTS = ['Body', 'Head', 'Antenna', 'Arm_L', 'Forearm_L', 'Hand_L', 'Arm_R', 'Forearm_R', 'Hand_R', 'Leg_L', 'Shin_L', 'Foot_L', 'Leg_R', 'Shin_R', 'Foot_R'] as const;
export type Joint = (typeof JOINTS)[number];
export type Side = 'L' | 'R';
export const sgn = (s: Side) => (s === 'L' ? 1 : -1);

export const SKELETON = {
  hipHeight: 1.34,                         // Body pivot above the ground
  head: [0, 1.04, 0] as V3,                // neck pivot (Body space)
  shoulder: (s: Side): V3 => [sgn(s) * 0.58, 0.78, 0],
  upperArm: 0.38,                          // shoulder → elbow pivot
  forearm: 0.36,                           // elbow → wrist pivot
  palm: { offset: 0.03, r: 0.15 },         // palm sphere centre below the wrist pivot
  hip: (s: Side): V3 => [sgn(s) * 0.3, 0, 0],
  thigh: 0.57, shin: 0.57,
  ankleHeight: 0.2,                        // foot pivot above the sole
  boot: { center: [0.03, -0.09, 0.07] as V3, half: [0.23, 0.11, 0.32] as V3 },
  // the shells are superellipsoids (build-model.mjs): e1 vertical, e2 horizontal squareness
  torso: { center: [0, 0.46, 0] as V3, half: [0.59, 0.5, 0.43] as V3, e1: 0.55, e2: 0.5 },
  helmet: { center: [0, 1.8, 0] as V3, half: [0.98, 0.8, 0.72] as V3, e1: 0.5, e2: 0.44 },   // Body space (neck 1.04 + 0.76)
  limbR: { upper: 0.115, fore: 0.105, thigh: 0.17, shin: 0.155 },
  /** the character's centre of mass (Body_Root space) — flips and rolls rotate about it */
  com: [0, 1.75, 0] as V3,
} as const;

/** A resolved full-body pose: root transform (Body_Root, about the ground origin) and a local rotation per joint. */
export interface BodyPose {
  rootPos: V3; rootRot: Q; joints: Record<Joint, Q>;
  /** shoulder lift (shrugs: the rig has no separate clavicle, so the shoulder pivots rise a little; the head drops) */
  shrug: number;
  /** shoulder protraction: + slides the shoulders forward along the torso when the hands reach in front (as a
   *  shoulder blade would) so the upper arms clear the torso's corners; − draws them back (hands behind the back) */
  protract: number;
}
export const shrugOffset = (k: number, pr = 0) => ({ arm: [0, 0.07 * k, 0.16 * pr] as V3, head: [0, -0.04 * k, 0] as V3 });

/** World (Body_Root-parent) positions of the points the checks need, by forward kinematics. */
export function fk(p: BodyPose) {
  const R = p.rootRot, T = p.rootPos;
  const toW = (q: Q, o: V3, v: V3): V3 => add(o, rot(q, v));
  const bodyQ = qmul(R, p.joints.Body); const bodyO = toW(R, T, [0, SKELETON.hipHeight, 0]);
  const B = (v: V3) => toW(bodyQ, bodyO, v);
  const sh = shrugOffset(p.shrug ?? 0, p.protract ?? 0);
  const headQ = qmul(bodyQ, p.joints.Head); const headO = B(add(SKELETON.head, sh.head));
  const out = {
    body: { q: bodyQ, o: bodyO }, head: { q: headQ, o: headO },
    helmetCenter: toW(headQ, headO, [0, 0.76, 0]),
    torsoCenter: B(SKELETON.torso.center),
    arm: {} as Record<Side, { shoulder: V3; elbow: V3; wrist: V3; palm: V3; handQ: Q }>,
    leg: {} as Record<Side, { hip: V3; knee: V3; ankle: V3; footQ: Q; soleCorners: V3[] }>,
  };
  for (const s of ['L', 'R'] as const) {
    const a1 = qmul(bodyQ, p.joints[`Arm_${s}`]); const shp = B(add(SKELETON.shoulder(s), sh.arm));
    const a2 = qmul(a1, p.joints[`Forearm_${s}`]); const el = toW(a1, shp, [0, -SKELETON.upperArm, 0]);
    const a3 = qmul(a2, p.joints[`Hand_${s}`]); const wr = toW(a2, el, [0, -SKELETON.forearm, 0]);
    out.arm[s] = { shoulder: shp, elbow: el, wrist: wr, palm: toW(a3, wr, [0, -SKELETON.palm.offset, 0]), handQ: a3 };
    const l1 = qmul(bodyQ, p.joints[`Leg_${s}`]); const hp = B(SKELETON.hip(s));
    const l2 = qmul(l1, p.joints[`Shin_${s}`]); const kn = toW(l1, hp, [0, -SKELETON.thigh, 0]);
    const l3 = qmul(l2, p.joints[`Foot_${s}`]); const an = toW(l2, kn, [0, -SKELETON.shin, 0]);
    const c = SKELETON.boot.center, h = SKELETON.boot.half; const cx = sgn(s) * c[0];
    const corners: V3[] = [];
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const dy of [-1, 1]) corners.push(toW(l3, an, [cx + dx * h[0], c[1] + dy * h[1], c[2] + dz * h[2]]));
    out.leg[s] = { hip: hp, knee: kn, ankle: an, footQ: l3, soleCorners: corners };
  }
  return out;
}

/**
 * Is point p inside a superellipsoid shell (centre, half-sizes, squareness e1/e2, orientation q), grown by `margin`?
 * Same implicit surface the model builder uses: (|x/a|^(2/e2) + |z/c|^(2/e2))^(e2/e1) + |y/b|^(2/e1) < 1.
 */
export function insideShell(p: V3, center: V3, half: V3, e1: number, e2: number, q: Q, margin = 0) {
  const d = rot([-q[0], -q[1], -q[2], q[3]], [p[0] - center[0], p[1] - center[1], p[2] - center[2]]);
  const x = Math.abs(d[0] / (half[0] + margin)), y = Math.abs(d[1] / (half[1] + margin)), z = Math.abs(d[2] / (half[2] + margin));
  return (x ** (2 / e2) + z ** (2 / e2)) ** (e2 / e1) + y ** (2 / e1) < 1;
}

/** points on a shell's surface (a cube of directions projected onto the superellipsoid) */
function shellPoints(half: V3, e1: number, e2: number): V3[] {
  const out: V3[] = [];
  for (const x of [-1, -0.5, 0, 0.5, 1]) for (const y of [-1, -0.5, 0, 0.5, 1]) for (const z of [-1, -0.5, 0, 0.5, 1]) {
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) < 1) continue;
    // scale the direction so it lies on the surface F = 1
    const f = (k: number) => { const X = Math.abs(x * k), Y = Math.abs(y * k), Z = Math.abs(z * k); return (X ** (2 / e2) + Z ** (2 / e2)) ** (e2 / e1) + Y ** (2 / e1); };
    let lo = 0, hi = 2; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (f(m) < 1) lo = m; else hi = m; }
    out.push([x * lo * half[0], y * lo * half[1], z * lo * half[2]]);
  }
  return out;
}
const TORSO_PTS = shellPoints(SKELETON.torso.half, SKELETON.torso.e1, SKELETON.torso.e2);
const HELMET_PTS = shellPoints(SKELETON.helmet.half, SKELETON.helmet.e1, SKELETON.helmet.e2);

/** the lowest point of the robot (soles, knees, palms, elbows, torso and helmet shells) — y relative to the floor */
export function lowestPoint(p: BodyPose) {
  const f = fk(p); let y = Infinity; let what = '';
  const take = (v: number, w: string) => { if (v < y) { y = v; what = w; } };
  for (const s of ['L', 'R'] as const) {
    for (const c of f.leg[s].soleCorners) take(c[1], `sole ${s}`);
    take(f.leg[s].knee[1] - SKELETON.limbR.shin, `knee ${s}`);
    take(f.arm[s].palm[1] - SKELETON.palm.r, `palm ${s}`);
    take(f.arm[s].elbow[1] - 0.1, `elbow ${s}`);
  }
  for (const v of TORSO_PTS) take(f.torsoCenter[1] + rot(f.body.q, v)[1], 'torso');
  for (const v of HELMET_PTS) take(f.helmetCenter[1] + rot(f.head.q, v)[1], 'helmet');
  return { y, what };
}
