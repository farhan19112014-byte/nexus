/**
 * Applies the full-body layers to the GLB's nodes AFTER the channel mapping (rig3d.applyChannels) and the 3D motion
 * engine (motion3d.applyMotion) have set them: each layer is slerped in over the current joint rotation by its weight,
 * so the face, lip-sync and idle life underneath stay intact and every hand-over is smooth.
 */
import type { Rest, Rig } from '../rig3d';
import { QI, eulerOf, qeuler, qnorm, slerp, type Q, type V3 } from './math';
import { JOINTS, shrugOffset, type Joint } from './skeleton';
import type { BodyOutput } from './controller';

export function applyBody(rig: Rig, rest: Rest, out: BodyOutput | null) {
  let rootPos: V3 = [rig.Body_Root.position.x, rig.Body_Root.position.y, rig.Body_Root.position.z];
  let rootRot: Q = QI(); let shrug = 0, protract = 0;
  const q = {} as Record<Joint, Q>; const touched = new Set<Joint>();
  if (out?.active) {
    for (const j of JOINTS) { const r = rig[j].rotation; q[j] = qeuler(r.x, r.y, r.z); }
    for (const l of out.layers) {
      for (const j of JOINTS) if (l.w[j] > 0) { q[j] = qnorm(slerp(q[j], l.pose.joints[j], l.w[j])); touched.add(j); }
      const w = l.w.root; if (w > 0) { rootRot = slerp(rootRot, l.pose.rootRot, w); rootPos = rootPos.map((v, i) => v + (l.pose.rootPos[i] - v) * w) as V3; }
      const k = Math.max(l.w.Arm_L, l.w.Arm_R); shrug += (l.pose.shrug - shrug) * k; protract += (l.pose.protract - protract) * k;
    }
    for (const j of touched) rig[j].rotation.set(...eulerOf(q[j]));
  }
  // root transform and shoulder offsets are written every frame (reset to rest when no layer is active)
  rig.Body_Root.position.set(...rootPos);
  rig.Body_Root.rotation.set(...eulerOf(rootRot));
  const off = shrugOffset(shrug, protract);
  for (const s of ['L', 'R'] as const) { const R = rest[`Arm_${s}`]; if (R) rig[`Arm_${s}`].position.set(R.x + off.arm[0], R.y + off.arm[1], R.z + off.arm[2]); }
  // speech accent: a small additive nod on stressed syllables (on top of gaze, expression and the layers)
  if (out?.accent) rig.Head.rotation.x += out.accent;
  rig.Head.position.set(rig.Head.position.x + off.head[0], rig.Head.position.y + off.head[1], rig.Head.position.z + off.head[2]);
}
