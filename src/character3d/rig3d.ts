/**
 * NEXUS 3D rig driver: turns the same animation channels that drive the 2D robot (shared/channels.ts) into
 * transforms on the named nodes of public/models/nexus.glb. Pure mapping — no WebGL — so it is unit tested.
 * Conventions match the 2D rig: character's LEFT = +x (viewer's right), raising an arm = rotating away from the body.
 */
import type { Channel } from '../../shared/channels';

export interface Xform { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; rotation: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; visible: boolean }
export interface MorphMesh extends Xform { morphTargetInfluences?: number[]; morphTargetDictionary?: Record<string, number> }

/** every node the driver moves — the GLB must contain these names (checked by tests and at load time) */
export const RIG_NODES = [
  'Body_Root', 'Body', 'Head', 'Antenna', 'Face', 'Mouth', 'Mouth_Line', 'Mouth_Open', 'Mouth_O',
  'Eye_L', 'Eye_R', 'Pupil_L', 'Pupil_R', 'EyeSpark_L', 'EyeSpark_R', 'EyeLid_L', 'EyeLid_R', 'Brow_L', 'Brow_R',
  'Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R', 'Leg_L', 'Leg_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R',
  'Cheek_L', 'Cheek_R',
] as const;
export type RigNode = (typeof RIG_NODES)[number];
export type Rig = Record<RigNode, MorphMesh>;
/** rest positions captured from the model (pivots never drift) */
export type Rest = Record<string, { x: number; y: number; z: number }>;

const rad = (d: number) => (d * Math.PI) / 180;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Glow levels the renderer applies to emissive materials (0..1, multiplied by each material's base intensity). */
export interface Glow { face: number; chest: number; antenna: number; cheeks: number }

export function applyChannels(rig: Rig, rest: Rest, v: Record<Channel, number>): Glow {
  const p = (n: RigNode) => rest[n] ?? { x: 0, y: 0, z: 0 };
  // body: stage offset, squash about the ground, lean about the hips, a real three-quarter turn
  const sq = v['body.squash'];
  rig.Body_Root.position.set(v['body.x'] / 100, -v['body.y'] / 100, 0);
  rig.Body_Root.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);
  // every axis of every body joint is ASSIGNED each frame (the model's rest rotations are all zero): the body layer
  // writes full rotations after this, so an axis left alone here would carry last frame's pose into the next one and
  // the presence layer's additive motion would accumulate (a slow random walk — the hands visibly shook)
  rig.Body.rotation.set(0, v['body.facing'] * 0.6, -rad(v['body.rot']));
  // head: tilt, nod (forward = face down), a little turn toward where the eyes look
  const H = p('Head');
  rig.Head.position.set(H.x + v['head.x'] / 100, H.y - v['head.y'] / 100, H.z);
  rig.Head.rotation.set(v['head.nod'] * 0.28, v['pupil.x'] * 0.14 + v['body.facing'] * 0.2, -rad(v['head.rot']));
  rig.Antenna.rotation.z = -rad(v['antenna.rot']);
  // arms: raise and bend in the body plane (+ = away from the body), wrist spin
  rig.Arm_L.rotation.set(0, 0, rad(v['armL.raise'])); rig.Arm_R.rotation.set(0, 0, -rad(v['armR.raise']));
  rig.Forearm_L.rotation.set(0, 0, rad(v['armL.bend'])); rig.Forearm_R.rotation.set(0, 0, -rad(v['armR.bend']));
  rig.Hand_L.rotation.set(0, 0, -rad(v['handL.spin'])); rig.Hand_R.rotation.set(0, 0, -rad(v['handR.spin']));
  // legs: spread sideways; lift is a real knee bend (thigh forward, shin back, foot level)
  for (const s of ['L', 'R'] as const) {
    const sign = s === 'L' ? 1 : -1; const lift = clamp01(v[`leg${s}.lift` as Channel]);
    rig[`Leg_${s}`].rotation.set(-lift * 1.05, 0, sign * rad(v[`leg${s}.spread` as Channel]));
    rig[`Shin_${s}`].rotation.set(lift * 1.7, 0, 0);
    rig[`Foot_${s}`].rotation.set(-lift * 0.65, 0, 0);
  }
  // eyes: blink, size, gaze, "happy" crescents (a screen-coloured lid rises over the lower half)
  const size = v['eyes.size'], happy = clamp01(v['eyes.happy']);
  for (const s of ['L', 'R'] as const) {
    const open = Math.max(0.06, v[`eye${s}.open` as Channel]);
    rig[`Eye_${s}`].scale.set(size, size * open, 1);
    const px = v['pupil.x'] * 0.07, py = -v['pupil.y'] * 0.06;
    const P = p(`Pupil_${s}`), S = p(`EyeSpark_${s}`);
    rig[`Pupil_${s}`].position.set(P.x + px, P.y + py, P.z); rig[`Pupil_${s}`].visible = happy <= 0.5 && open > 0.3;
    rig[`EyeSpark_${s}`].position.set(S.x + px, S.y + py, S.z); rig[`EyeSpark_${s}`].visible = happy <= 0.5 && open > 0.3;
    const L = p(`EyeLid_${s}`);
    const lid = rig[`EyeLid_${s}`]; lid.visible = happy > 0.02;
    lid.scale.set(happy > 0.02 ? 1 : 0.001, happy > 0.02 ? 1 : 0.001, 1);
    lid.position.set(L.x, L.y + happy * 0.26, L.z);   // the renderer clips it to the eye
    const sign = s === 'L' ? 1 : -1; const B = p(`Brow_${s}`);
    rig[`Brow_${s}`].position.set(B.x, B.y + v[`brow${s}.y` as Channel] * 0.08 * size + (size - 1) * 0.2, B.z);
    rig[`Brow_${s}`].rotation.z = sign * rad(v[`brow${s}.tilt` as Channel] * 18);
  }
  // mouth: smile/frown morphs, width, open (speech), round "o", skew
  const curve = v['mouth.curve'], open = clamp01(v['mouth.open']), round = clamp01(v['mouth.round']), width = v['mouth.width'], skew = v['mouth.skew'];
  const line = rig.Mouth_Line;
  if (line.morphTargetInfluences) { const d = line.morphTargetDictionary ?? { smile: 0, frown: 1 }; line.morphTargetInfluences[d.smile ?? 0] = Math.max(0, curve); line.morphTargetInfluences[d.frown ?? 1] = Math.max(0, -curve); }
  line.scale.set(width, 1 - round * 0.95, 1); line.visible = round < 0.95;
  rig.Mouth_Open.scale.set(width * (1 - round), Math.max(0.001, open * (1 - round)), 1); rig.Mouth_Open.visible = open > 0.06 && round < 0.95;
  const o = round > 0.02 ? round * (1 + open * 0.6) : 0.001; rig.Mouth_O.scale.set(o, o, 1); rig.Mouth_O.visible = round > 0.02;
  const Mo = p('Mouth');
  rig.Mouth.position.set(Mo.x + skew * 0.03, Mo.y - curve * 0.015, Mo.z); rig.Mouth.rotation.z = -skew * 0.15;
  // the face drifts a little with the turn, like the 2D parallax
  const F = p('Face'); rig.Face.position.set(F.x + v['body.facing'] * 0.04, F.y, F.z);
  return { face: v['face.glow'], chest: 0.35 + 0.65 * v['chest.glow'], antenna: 0.35 + 0.65 * v['antenna.glow'], cheeks: v.cheeks * 0.75 };
}
