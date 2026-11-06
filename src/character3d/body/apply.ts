/**
 * Applies the full-body frame to the GLB's nodes AFTER the channel mapping (rig3d.applyChannels) and the 3D motion
 * engine (motion3d.applyMotion) have set them. The composition itself (layers, presence life, root, foot lock) is pure
 * math in frame.ts — the same code the tests run — so the face, lip-sync and idle life underneath stay intact and every
 * hand-over is smooth.
 */
import type { Rest, Rig } from '../rig3d';
import { eulerOf, qeuler, qmul, rot, type Q, type V3 } from './math';
import { JOINTS, shrugOffset, type BodyPose, type Joint } from './skeleton';
import type { BodyOutput } from './controller';
import { composeFrame } from './frame';

export function applyBody(rig: Rig, rest: Rest, out: BodyOutput | null) {
  const rootPos: V3 = [rig.Body_Root.position.x, rig.Body_Root.position.y, rig.Body_Root.position.z];
  let pose: BodyPose = { rootPos, rootRot: [0, 0, 0, 1], joints: {} as Record<Joint, Q>, shrug: 0, protract: 0 };
  let touched = new Set<Joint>();
  if (out?.active) {
    for (const j of JOINTS) { const r = rig[j].rotation; pose.joints[j] = qeuler(r.x, r.y, r.z); }
    const f = composeFrame(pose, out.layers, out.presence); pose = f.pose; touched = f.touched;
    for (const j of touched) rig[j].rotation.set(...eulerOf(pose.joints[j]));
  }
  // root transform and shoulder offsets are written every frame (reset to rest when no layer is active)
  rig.Body_Root.position.set(...pose.rootPos);
  rig.Body_Root.rotation.set(...eulerOf(pose.rootRot));
  const off = shrugOffset(pose.shrug, pose.protract);
  for (const s of ['L', 'R'] as const) { const R = rest[`Arm_${s}`]; if (R) rig[`Arm_${s}`].position.set(R.x + off.arm[0], R.y + off.arm[1], R.z + off.arm[2]); }
  // speech accent: a small additive nod on stressed syllables (on top of gaze, expression and the layers)
  if (out?.accent) rig.Head.rotation.x += out.accent;
  rig.Head.position.set(rig.Head.position.x + off.head[0], rig.Head.position.y + off.head[1], rig.Head.position.z + off.head[2]);
}

/** a node the thumb articulation moves (three.js Object3D compatible) */
export interface ThumbNode { position: { set(x: number, y: number, z: number): unknown }; rotation: { set(x: number, y: number, z: number): unknown } }
export interface ThumbRest { pos: V3; rot: V3 }
/**
 * Thumb articulation: the hand is a ball with one thumb capsule (no finger bones). The thumb pivots about its BASE
 * (not its centre — the capsule is 0.14 long along its local y), opening outward and toward the palm's front.
 * open 0 = relaxed along the palm, 1 = spread wide; the model's rest pose sits at 0.5.
 */
export function applyThumb(node: ThumbNode, restT: ThumbRest, side: 'L' | 'R', open: number) {
  const s = side === 'L' ? 1 : -1; const k = Math.max(0, Math.min(1, open)) - 0.5;
  const q0 = qeuler(restT.rot[0], restT.rot[1], restT.rot[2]);
  const base: V3 = [restT.pos[0] - rot(q0, [0, 0.07, 0])[0], restT.pos[1] - rot(q0, [0, 0.07, 0])[1], restT.pos[2] - rot(q0, [0, 0.07, 0])[2]];
  const q = qmul(q0, qeuler(-k * 0.5, 0, s * k * 0.7));
  const tip = rot(q, [0, 0.07, 0]);
  node.position.set(base[0] + tip[0], base[1] + tip[1], base[2] + tip[2]);
  node.rotation.set(...eulerOf(q));
}
