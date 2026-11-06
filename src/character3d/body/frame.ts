/**
 * One frame of the full-body composition, in pure math (shared by the renderer's applyBody and the unit tests):
 *   1. clip layers over the channel pose, in order: state loops → presence gestures → explicit actions (slerp by weight)
 *   2. presence additive life on top (breathing, weight shift, attention, gait coupling, reactions)
 *   3. the presence root (walking position, heading, the pelvis's weight-shift offset) under everything
 *   4. the foot lock: legs solved so the boots stay where they were planted
 */
import { add, eulerOf, qeuler, qmul, qnorm, rot, slerp, type Q, type V3 } from './math';
import { fk, insideShell, JOINTS, SKELETON, sgn, type BodyPose, type Joint, type Side } from './skeleton';
import type { BodyLayer } from './controller';
import type { PresenceOut } from './presence';
import { solveFeet } from './footlock';

export const SOFT_KNEES = 0.03;
const addQ = (q: Q, e: V3, k = 1): Q => (k === 0 || (e[0] === 0 && e[1] === 0 && e[2] === 0) ? q : qnorm(qmul(q, qeuler(e[0] * k, e[1] * k, e[2] * k))));

export interface FrameResult { pose: BodyPose; touched: Set<Joint>; drop: number; /** shoulder lift (rad) the collision pass needed */ cleared: Record<Side, number> }

/** is any part of this arm (palm sphere, elbow, mid-forearm) inside the torso shell? `extra` widens the shell only in
 *  front of the chest (where crossfades sweep the hands across) — hanging at the sides the arms brush the torso by design */
function armInTorso(p: BodyPose, s: Side, extra = 0) {
  const f = fk(p); const a = f.arm[s]; const T = SKELETON.torso; const q = f.body.q; const iq: Q = [-q[0], -q[1], -q[2], q[3]];
  const mid: V3 = [(a.elbow[0] + a.wrist[0]) / 2, (a.elbow[1] + a.wrist[1]) / 2, (a.elbow[2] + a.wrist[2]) / 2];
  const m = (pt: V3, base: number) => { const z = rot(iq, [pt[0] - f.torsoCenter[0], pt[1] - f.torsoCenter[1], pt[2] - f.torsoCenter[2]])[2]; return base + extra * Math.max(0, Math.min(1, (z - 0.1) / 0.2)); };
  return insideShell(a.palm, f.torsoCenter, T.half, T.e1, T.e2, q, m(a.palm, SKELETON.palm.r * 0.95)) || insideShell(a.elbow, f.torsoCenter, T.half, T.e1, T.e2, q, m(a.elbow, 0.035)) || insideShell(mid, f.torsoCenter, T.half, T.e1, T.e2, q, m(mid, 0.045));
}
/** smallest sideways shoulder lift (rad) that clears the torso with `extra` margin (bisection: smooth frame to frame) */
function clearAngle(p: BodyPose, s: Side, q0: Q, extra: number) {
  const lift = (a: number) => { p.joints[`Arm_${s}`] = qnorm(qmul(qeuler(0, 0, sgn(s) * a), q0)); };
  lift(0); if (!armInTorso(p, s, extra)) return 0;
  let lo = 0, hi = 1.2; lift(hi); if (armInTorso(p, s, extra)) { lift(0); return hi; }   // cannot clear: lift as far as it goes
  for (let i = 0; i < 15; i++) { const m = (lo + hi) / 2; lift(m); if (armInTorso(p, s, extra)) lo = m; else hi = m; }
  lift(0); return hi;
}
/** per-renderer memory for the collision pass (kept for API stability; the pass itself is stateless) */
export interface ClearMem { dt: number; init?: boolean }
export const clearMem = (): ClearMem => ({ dt: 0 });
/**
 * Collision pass: crossfades between two arm poses (a clip letting go, a state switch) blend joint rotations, and a
 * blend can sweep a hand through the torso even when both poses are clean. Where that would happen the shoulder lifts
 * the arm out sideways by the SMALLEST angle that clears the body (bisection: it changes continuously frame to frame)
 * — the hand glances off and slides around the body instead of passing through it, like real contact. Poses that are
 * clean (every clip, every presence gesture) are never touched.
 */
function clearArms(p: BodyPose, _mem: ClearMem | null): Record<Side, number> {
  const out = { L: 0, R: 0 };
  for (const s of ['L', 'R'] as const) {
    const q0 = p.joints[`Arm_${s}`]; const a = clearAngle(p, s, q0, 0);
    if (a > 0) p.joints[`Arm_${s}`] = qnorm(qmul(qeuler(0, 0, sgn(s) * a), q0));
    out[s] = a;
  }
  return out;
}

export function composeFrame(base: BodyPose, layers: BodyLayer[], pres: PresenceOut | null, mem: ClearMem | null = pres?.mem ?? null): FrameResult {
  const out: BodyPose = { rootPos: [...base.rootPos], rootRot: [...base.rootRot], joints: { ...base.joints }, shrug: base.shrug, protract: base.protract };
  const touched = new Set<Joint>();
  for (const l of layers) {
    for (const j of JOINTS) if (l.w[j] > 0) { out.joints[j] = qnorm(slerp(out.joints[j], l.pose.joints[j], l.w[j])); touched.add(j); }
    const r = l.w.root; if (r > 0) { out.rootRot = slerp(out.rootRot, l.pose.rootRot, r); out.rootPos = out.rootPos.map((v, i) => v + (l.pose.rootPos[i] - v) * r) as V3; }
    const k = Math.max(l.w.Arm_L, l.w.Arm_R); out.shrug += (l.pose.shrug - out.shrug) * k; out.protract += (l.pose.protract - out.protract) * k;
  }
  let drop = 0;
  if (pres) {
    const a = pres.add;
    out.joints.Body = addQ(out.joints.Body, a.body); out.joints.Head = addQ(out.joints.Head, a.head);
    for (const s of ['L', 'R'] as const) {
      out.joints[`Arm_${s}`] = addQ(out.joints[`Arm_${s}`], a.arm[s]); out.joints[`Forearm_${s}`] = addQ(out.joints[`Forearm_${s}`], a.fore[s]); out.joints[`Hand_${s}`] = addQ(out.joints[`Hand_${s}`], a.hand[s]);
    }
    out.shrug += a.shrug;
    for (const j of ['Body', 'Head', 'Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R'] as const) touched.add(j);
    // presence root under everything: the layers' root motion happens where NEXUS is standing, facing where it faces
    const ry = qeuler(0, pres.root.yaw, 0);
    out.rootPos = add(pres.root.pos, rot(ry, out.rootPos)); out.rootRot = qmul(ry, out.rootRot);
    if (pres.lock > 0) {
      // soft knees: standing on the foot lock the hips sit 3 cm lower than the fully straight model — a relaxed stance,
      // and it keeps the knees away from full extension, where a tiny hip movement would make them flick
      out.rootPos[1] -= SOFT_KNEES * pres.lock;
      const f = solveFeet(out.rootPos, out.rootRot, out.joints.Body, pres.feet);
      drop = f.drop * pres.lock; out.rootPos[1] -= drop;
      for (const s of ['L', 'R'] as const) {
        const L = f.legs[s];
        out.joints[`Leg_${s}`] = slerp(out.joints[`Leg_${s}`], L.leg, pres.lock); out.joints[`Shin_${s}`] = slerp(out.joints[`Shin_${s}`], L.shin, pres.lock); out.joints[`Foot_${s}`] = slerp(out.joints[`Foot_${s}`], L.foot, pres.lock);
        touched.add(`Leg_${s}`); touched.add(`Shin_${s}`); touched.add(`Foot_${s}`);
      }
      // while a clip that moves the legs fades in or out, the blend of its legs and the locked legs is not exactly on
      // the floor: lift the body by whatever a sole would sink (never into the floor)
      if (pres.lock < 0.999) { const k = fk(out); const low = Math.min(...k.leg.L.soleCorners.map((c) => c[1]), ...k.leg.R.soleCorners.map((c) => c[1])); if (low < 0) out.rootPos[1] -= low; }
    }
  }
  const cleared = clearArms(out, mem); if (mem) mem.init = true; if (cleared.L) touched.add('Arm_L'); if (cleared.R) touched.add('Arm_R');
  return { pose: out, touched, drop, cleared };
}
export { eulerOf };
