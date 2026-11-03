/**
 * The NEXUS full-body clip library. Authored against the real proportions (skeleton.ts): short arms (0.77 reach),
 * a helmet wider than the shoulders (so "arms up" goes out in a V, never through the head), a palm sphere of r = 0.15.
 * Every clip is checked frame by frame (checks.ts): floor, planted feet, no limb through the body, no snapping.
 * Coordinates: Body space (hips = origin, +x = the character's left, +z = toward the viewer), metres; angles in degrees.
 */
import { qeulerDeg, qmul, rot, type V3 } from './math';
import { twoBoneIK } from './ik';
import { SKELETON } from './skeleton';
import { mirrorArm, mirrorLeg, NEUTRAL_ARM, PLANT, type ArmSpec, type Clip, type Key, type LegSpec } from './clip';

const N = (): Partial<Key> => ({ armL: NEUTRAL_ARM('L'), armR: NEUTRAL_ARM('R'), legL: PLANT, legR: PLANT });
/** the same arm spec on both sides (authored for the right arm, mirrored to the left) */
const both = (r: ArmSpec): Partial<Key> => ({ armR: r, armL: mirrorArm(r) });
const legs = (r: LegSpec): Partial<Key> => ({ legR: r, legL: mirrorLeg(r) });
const k = (t: number, ...parts: Partial<Key>[]): Key => Object.assign({ t }, ...parts);
const hold = (t: number, ...parts: Partial<Key>[]): Key => Object.assign({ t, hold: true }, ...parts);
const ik = (at: V3, pole?: V3, hand?: V3): ArmSpec => ({ at, pole, hand });

/**
 * Thumbs-up: the wrist roll that turns the thumb straight up for a given palm target, found once by search
 * (the thumb is part of the existing hand mesh: local (±0.1, 0.06, 0.05), tilted 0.6 rad outward).
 */
function thumbUpRoll(at: V3, pole: V3): V3 {
  const ikr = twoBoneIK(SKELETON.shoulder('R'), at, SKELETON.upperArm, SKELETON.forearm + SKELETON.palm.offset, pole, 'x', [0, 0, 0, 1], -1);
  const fore = qmul(ikr.upper, ikr.lower);
  const thumbDir: V3 = [Math.sin(0.6), Math.cos(0.6), 0];   // right hand (s = −1): tilted outward/up in hand space
  let best: V3 = [0, 0, 0], score = -2;
  for (let roll = -180; roll < 180; roll += 5) for (let flex = -40; flex <= 40; flex += 10) {
    const d = rot(qmul(fore, qeulerDeg([flex, roll, 0])), thumbDir);
    if (d[1] > score) { score = d[1]; best = [flex, roll, 0]; }
  }
  return best;
}
const THUMB_AT: V3 = [-0.42, 0.8, 0.58], THUMB_POLE: V3 = [-0.6, -1, -0.2];
const THUMB_HAND = thumbUpRoll(THUMB_AT, THUMB_POLE);

/* poses reused by several clips */
/* clap in front of the upper chest, below the helmet; the shoulders slide forward (protract) so the upper arms clear
   the torso's front corners — the shoulder pivots sit right at the torso's edge on this model */
const CLAP_OPEN = ik([-0.46, 0.78, 0.62], [-0.6, -1, -0.4]);
const CLAP_SHUT = ik([-0.151, 0.8, 0.66], [-0.6, -1, -0.4]);
const REACH = { protract: 1 };
/* the helmet (half-width 0.98) is wider than the arms can clear above the shoulders, so raised arms go out to the
   sides beside it — a "Y", never through the head */
const V_HIGH = ik([-1.13, 1.28, 0.08], [-0.6, -0.3, -0.6]);
const V_LOW = ik([-1.18, 1.05, 0.2], [-0.6, -0.6, -0.4]);
const HIP_HAND_L = ik([0.78, 0.18, 0.2], [0.6, -0.2, -0.8], [0, 0, -20]);
const CHIN_HAND_R = ik([-0.25, 0.86, 0.6], [-0.6, -1, -0.2], [-20, 0, 0]);
const BEHIND_BACK = ik([-0.46, 0.3, -0.62], [-0.9, -0.5, -0.1]);
const BELLY = ik([-0.4, 0.4, 0.64], [-1, -0.5, 0], [-10, 0, 0]);
const CHEST_HANDS_UP = ik([-0.62, 0.84, 0.56], [-0.5, -1, -0.3], [-40, 0, 0]);
/* via-points: hands travel out and around the torso's corners instead of through them */
const CLEAR_FRONT = ik([-0.86, 0.42, 0.42], [-0.6, -1, -0.4]);
const CLEAR_BACK = ik([-0.8, 0.3, -0.5], [-0.9, -0.6, -0.1]);
const ARMS_BACK: ArmSpec = { sh: [45, 0, -12], el: [0, 0, -8] };
const ARMS_OUT: ArmSpec = { sh: [0, 0, -78], el: [0, 0, -10] };

export const CLIPS: Clip[] = [
  /* ------------------------------------------------ basic */
  {
    id: 'clap', name: 'Clap', kind: 'basic', mask: 'armsHead', duration: 2.2, loop: [0.55, 0.97],
    doc: 'Both arms come together in front of the chest until the palms touch, then part again; repeats while held.',
    keys: [k(0, N()), k(0.2, both(CLEAR_FRONT), { protract: 0.5 }), k(0.38, both(CLAP_OPEN), REACH, { head: [-4, 0, 0] }), hold(0.55, both(CLAP_OPEN), REACH, { head: [-4, 0, 0] }),
      k(0.69, both(CLAP_SHUT), REACH, { head: [2, 0, 0] }), hold(0.73, both(CLAP_SHUT), REACH, { head: [2, 0, 0] }), hold(0.97, both(CLAP_OPEN), REACH, { head: [-4, 0, 0] }),
      k(1.35, both(ik([-0.8, 0.45, 0.4], [-0.6, -1, -0.4])), { protract: 0.3, head: [-2, 0, 0] }), hold(2.2, N())],
  },
  {
    id: 'wave', name: 'Wave', kind: 'basic', mask: 'armsHead', duration: 2.4, loop: [0.6, 1.4],
    doc: 'Right arm rises beside the head (shoulder, elbow out, hand up) and waves from the elbow and wrist.',
    keys: [k(0, N()), k(0.45, { armR: ik([-1.15, 1.2, 0.12], [-0.8, -1, 0.1]), armL: NEUTRAL_ARM('L'), head: [0, -8, -6] }),
      k(0.6, { armR: ik([-1.13, 1.27, 0.12], [-0.8, -1, 0.1], [0, 0, 18]), head: [0, -8, -6] }), k(0.8, { armR: ik([-1.27, 1.02, 0.14], [-0.8, -1, 0.1], [0, 0, -24]), head: [0, -8, -4] }),
      k(1.0, { armR: ik([-1.13, 1.27, 0.12], [-0.8, -1, 0.1], [0, 0, 18]), head: [0, -8, -6] }), k(1.2, { armR: ik([-1.27, 1.02, 0.14], [-0.8, -1, 0.1], [0, 0, -24]), head: [0, -8, -4] }),
      k(1.4, { armR: ik([-1.13, 1.27, 0.12], [-0.8, -1, 0.1], [0, 0, 18]), head: [0, -8, -6] }),
      k(1.85, { armR: ik([-0.95, 0.55, 0.25], [-0.6, -1, -0.3]), head: [0, -3, -2] }), hold(2.4, N())],
  },
  {
    id: 'nod', name: 'Nod', kind: 'basic', mask: 'head', duration: 1.4,
    doc: 'Two agreeing nods about the neck.',
    keys: [k(0, {}), k(0.3, { head: [14, 0, 0] }), k(0.55, { head: [-2, 0, 0] }), k(0.82, { head: [11, 0, 0] }), hold(1.15, { head: [0, 0, 0] }), hold(1.4, {})],
  },
  {
    id: 'shake_head', name: 'Shake head', kind: 'basic', mask: 'head', duration: 1.6,
    doc: 'A clear "no": the head turns left and right about the neck, slightly lowered.',
    keys: [k(0, {}), k(0.25, { head: [4, 18, 0] }), k(0.55, { head: [5, -18, 0] }), k(0.85, { head: [4, 15, 0] }), k(1.12, { head: [3, -9, 0] }), hold(1.4, { head: [1, 0, 0] }), hold(1.6, {})],
  },
  {
    id: 'shrug', name: 'Shrug', kind: 'basic', mask: 'full', duration: 1.8,
    doc: 'Shoulders rise, forearms turn out with palms up, head tilts — "I don\'t know" — then settles.',
    keys: [k(0, N()), k(0.35, both(ik([-0.88, 0.4, 0.36], [-0.3, -1, -0.6], [-30, 0, 0])), { shrug: 1, head: [0, 0, 10], body: [-3, 0, 0] }),
      hold(0.95, both(ik([-0.9, 0.42, 0.36], [-0.3, -1, -0.6], [-32, 0, 0])), { shrug: 1, head: [0, 0, 11], body: [-3, 0, 0] }),
      k(1.35, both(ik([-0.75, 0.25, 0.25], [-0.5, -1, -0.4])), { shrug: 0.2, head: [0, 0, 3] }), hold(1.8, N())],
  },
  {
    id: 'point', name: 'Point', kind: 'basic', mask: 'full', duration: 2.2,
    doc: 'Turns toward its right, extends the right arm straight out and holds the point, head following.',
    keys: [k(0, N()), k(0.45, { armR: ik([-0.72, 0.92, 0.72], [-0.5, -1, -0.3], [12, 0, 0]), body: [0, -12, 0], head: [-2, -16, 0] }),
      hold(1.5, { armR: ik([-0.72, 0.93, 0.72], [-0.5, -1, -0.3], [12, 0, 0]), body: [0, -12, 0], head: [-2, -16, 0] }), hold(2.2, N())],
  },
  {
    id: 'thumbs_up', name: 'Thumbs up', kind: 'basic', mask: 'armsHead', duration: 2.0,
    doc: 'Right forearm comes up in front with the wrist rolled so the thumb points straight up.',
    keys: [k(0, N()), k(0.45, { armR: ik(THUMB_AT, THUMB_POLE, THUMB_HAND), head: [0, -6, 8] }), hold(1.4, { armR: ik([-0.42, 0.82, 0.58], THUMB_POLE, THUMB_HAND), head: [0, -6, 9] }), hold(2.0, N())],
  },
  {
    id: 'speak_gestures', name: 'Speaking gestures', kind: 'basic', mask: 'arms', duration: 4.0, loop: [0.5, 3.5],
    doc: 'Open-palm beats while talking: one hand, the other, both — calm, under the face so lip-sync stays visible.',
    keys: [k(0, N()), hold(0.5, both(ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0]))),
      k(0.9, { armR: ik([-0.8, 0.52, 0.42], [-0.6, -1, -0.3], [-35, 0, 10]), armL: mirrorArm(ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0])) }),
      k(1.3, both(ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0]))),
      k(1.75, { armL: mirrorArm(ik([-0.8, 0.52, 0.42], [-0.6, -1, -0.3], [-35, 0, 10])), armR: ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0]) }),
      k(2.2, both(ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0]))),
      k(2.65, both(ik([-0.84, 0.5, 0.38], [-0.6, -1, -0.3], [-38, 0, 12]))), k(3.1, both(ik([-0.66, 0.44, 0.47], [-0.6, -1, -0.3], [-24, 0, 0]))),
      hold(3.5, both(ik([-0.62, 0.42, 0.48], [-0.6, -1, -0.3], [-20, 0, 0]))), hold(4.0, N())],
  },
  {
    id: 'look_around', name: 'Look around', kind: 'basic', mask: 'full', duration: 3.2,
    doc: 'Head and hips turn together (head leads, body follows) to one side, pause, to the other, back — feet stay planted.',
    keys: [k(0, N()), k(0.6, { head: [4, -38, 0], body: [0, -14, 0] }), hold(1.0, { head: [4, -40, 0], body: [0, -15, 0] }),
      k(1.6, { head: [4, 36, 0], body: [0, 13, 0] }), hold(2.1, { head: [3, 38, 0], body: [0, 14, 0] }), k(2.7, { head: [1, 0, 0], body: [0, 0, 0] }), hold(3.2, N())],
  },

  /* ------------------------------------------------ expressive */
  {
    id: 'excited', name: 'Excited', kind: 'expressive', mask: 'full', duration: 2.4, loop: [0.5, 1.3],
    doc: 'Both arms shoot up in a V and pump while the knees bounce.',
    keys: [k(0, N()), k(0.35, both(V_LOW), { root: { y: -0.08 }, head: [-6, 0, 0] }), hold(0.5, both(V_HIGH), { root: { y: -0.02 }, head: [-8, 0, 0], antenna: 6 }),
      k(0.7, both(V_LOW), { root: { y: -0.1 }, head: [-5, 0, 0], antenna: -6 }), k(0.9, both(V_HIGH), { root: { y: -0.02 }, head: [-8, 0, 0], antenna: 6 }),
      k(1.1, both(V_LOW), { root: { y: -0.1 }, head: [-5, 0, 0], antenna: -6 }), hold(1.3, both(V_HIGH), { root: { y: -0.02 }, head: [-8, 0, 0], antenna: 6 }),
      k(1.8, both(ik([-0.8, 0.5, 0.3], [-0.6, -1, -0.3])), { root: { y: -0.04 } }), hold(2.4, N())],
  },
  {
    id: 'celebrate', name: 'Celebrate', kind: 'expressive', mask: 'full', duration: 3.0, loop: [1.6, 2.1],
    doc: 'Crouch, arms swing back, then a jump with both arms thrown up, a soft landing and fist pumps.',
    keys: [k(0, N()), k(0.3, both(ARMS_BACK), { root: { y: -0.3 }, body: [16, 0, 0], head: [8, 0, 0] }),
      k(0.45, both(V_LOW), { root: { y: 0.08 }, body: [-4, 0, 0], head: [-6, 0, 0] }, legs({ plant: true, lift: 0.13, toe: -15 })),
      k(0.6, both(V_HIGH), { root: { y: 0.5 }, head: [-10, 0, 0] }, legs({ plant: true, lift: 0.62, toe: -10 })),
      k(0.75, both(V_HIGH), { root: { y: 0.72 }, head: [-10, 0, 0], antenna: 10 }, legs({ plant: true, lift: 0.9, toe: -5 })),
      k(0.92, both(V_HIGH), { root: { y: 0.38 }, head: [-6, 0, 0], antenna: -8 }, legs({ plant: true, lift: 0.46 })),
      k(0.99, both(V_HIGH), { root: { y: 0.16 }, head: [-3, 0, 0] }, legs({ plant: true, lift: 0.22 })), k(1.08, both(V_LOW), { root: { y: -0.17 }, head: [2, 0, 0] }), k(1.25, both(V_LOW), { root: { y: -0.3 }, body: [10, 0, 0], head: [6, 0, 0], antenna: -10 }),
      hold(1.6, both(V_HIGH), { root: { y: 0 }, head: [-8, 0, 0] }), k(1.85, both(V_LOW), { root: { y: -0.08 }, head: [-4, 0, 0] }), hold(2.1, both(V_HIGH), { root: { y: 0 }, head: [-8, 0, 0] }),
      k(2.5, both(ik([-0.8, 0.5, 0.3], [-0.6, -1, -0.3]))), hold(3.0, N())],
  },
  {
    id: 'confused', name: 'Confused', kind: 'expressive', mask: 'full', duration: 2.6, loop: [0.7, 1.9],
    doc: 'Head tilts, one palm comes up beside the shoulder, the other hand goes to the hip — a puzzled pause.',
    keys: [k(0, N()), k(0.5, { armR: ik([-0.95, 0.72, 0.38], [-0.4, -1, -0.4], [-35, 0, 0]), armL: HIP_HAND_L, head: [4, 10, 16], body: [0, 8, -4] }),
      hold(0.7, { armR: ik([-0.95, 0.72, 0.38], [-0.4, -1, -0.4], [-35, 0, 0]), armL: HIP_HAND_L, head: [4, 10, 16], body: [0, 8, -4] }),
      k(1.3, { armR: ik([-0.96, 0.74, 0.37], [-0.4, -1, -0.4], [-38, 0, 0]), armL: HIP_HAND_L, head: [6, 12, 18], body: [0, 8, -5] }),
      hold(1.9, { armR: ik([-0.95, 0.72, 0.38], [-0.4, -1, -0.4], [-35, 0, 0]), armL: HIP_HAND_L, head: [4, 10, 16], body: [0, 8, -4] }), hold(2.6, N())],
  },
  {
    id: 'curious', name: 'Curious', kind: 'expressive', mask: 'full', duration: 2.8, loop: [0.7, 2.0],
    doc: 'Leans forward from the hips with the hands behind the back and the head tilted, studying something.',
    keys: [k(0, N()), k(0.18, both(ik([-0.92, 0.3, -0.05], [-0.9, -0.6, -0.1])), { body: [3, 0, 0] }), k(0.38, both(CLEAR_BACK), { body: [6, 0, 0], protract: -0.5 }), k(0.62, both(BEHIND_BACK), { body: [12, 0, 0], head: [8, 0, -12], protract: -0.8 }), hold(0.7, both(BEHIND_BACK), { body: [12, 0, 0], head: [8, 0, -12], protract: -0.8 }),
      k(1.35, both(BEHIND_BACK), { body: [13, 3, 0], head: [10, 6, -15], protract: -0.8 }), hold(2.0, both(BEHIND_BACK), { body: [12, 0, 0], head: [8, 0, -12], protract: -0.8 }), k(2.32, both(CLEAR_BACK), { body: [5, 0, 0], protract: -0.5 }), k(2.55, both(ik([-0.92, 0.3, -0.05], [-0.9, -0.6, -0.1])), { body: [2, 0, 0] }), hold(2.8, N())],
  },
  {
    id: 'disappointed', name: 'Disappointed', kind: 'expressive', mask: 'full', duration: 2.8,
    doc: 'Head and shoulders drop, the body sinks a little and the arms hang — then it recovers.',
    keys: [k(0, N()), k(0.7, both({ sh: [-10, 0, -9], el: [0, 0, -4] }), { head: [22, 0, -6], body: [8, 0, 0], shrug: -0.6, root: { y: -0.06 } }),
      hold(1.8, both({ sh: [-11, 0, -9], el: [0, 0, -4] }), { head: [24, 0, -7], body: [9, 0, 0], shrug: -0.6, root: { y: -0.07 } }), hold(2.8, N())],
  },
  {
    id: 'think', name: 'Thinking', kind: 'expressive', mask: 'full', duration: 3.0, loop: [0.8, 2.4],
    doc: 'Right hand to the chin, left hand on the hip, head tilted up — with a slow, thoughtful sway.',
    keys: [k(0, N()), k(0.3, { armR: CLEAR_FRONT, protract: 0.4 }), k(0.6, { armR: CHIN_HAND_R, armL: HIP_HAND_L, head: [-8, -10, 10], body: [0, -6, 3], protract: 0.6, root: { y: -0.07 } }),
      hold(0.8, { armR: CHIN_HAND_R, armL: HIP_HAND_L, head: [-8, -10, 10], body: [0, -6, 3], protract: 0.6, root: { y: -0.07 } }),
      k(1.6, { armR: ik([-0.26, 0.87, 0.6], [-0.6, -1, -0.2], [-22, 0, 0]), armL: HIP_HAND_L, head: [-10, -6, 7], body: [0, -4, -1], protract: 0.6, root: { y: -0.08 } }),
      hold(2.4, { armR: CHIN_HAND_R, armL: HIP_HAND_L, head: [-8, -10, 10], body: [0, -6, 3], protract: 0.6, root: { y: -0.07 } }), k(2.7, { armR: CLEAR_FRONT, protract: 0.4 }), hold(3.0, N())],
  },
  {
    id: 'laugh', name: 'Laugh', kind: 'expressive', mask: 'full', duration: 2.4, loop: [0.5, 1.3],
    doc: 'Hands on the belly, head thrown back, shoulders and knees bob with each "ha".',
    keys: [k(0, N()), k(0.22, both(CLEAR_FRONT), { protract: 0.4 }), hold(0.5, both(BELLY), { protract: 0.8, head: [-14, 0, 0], body: [-5, 0, 0], root: { y: 0 } }),
      k(0.7, both(BELLY), { protract: 0.8, head: [-7, 0, 0], body: [1, 0, 0], root: { y: -0.05 }, shrug: 0.4 }), k(0.9, both(BELLY), { protract: 0.8, head: [-14, 0, 0], body: [-5, 0, 0], root: { y: 0 }, shrug: 0 }),
      k(1.1, both(BELLY), { protract: 0.8, head: [-7, 0, 0], body: [1, 0, 0], root: { y: -0.05 }, shrug: 0.4 }), hold(1.3, both(BELLY), { protract: 0.8, head: [-14, 0, 0], body: [-5, 0, 0], root: { y: 0 } }),
      k(1.75, both(CLEAR_FRONT), { protract: 0.3, head: [-4, 0, 0] }), hold(2.4, N())],
  },
  {
    id: 'surprised', name: 'Surprised', kind: 'expressive', mask: 'full', duration: 2.4,
    doc: 'A quick hop backward with the hands flying up and the body leaning back, a held reaction, then steps back into place.',
    keys: [k(0, N()), k(0.1, both(ik([-0.72, 0.4, 0.35], [-0.5, -1, -0.3])), { root: { y: -0.06 }, body: [4, 0, 0] }), k(0.26, both(ik([-0.8, 0.7, 0.42], [-0.5, -1, -0.3])), { root: { y: 0.07, z: -0.09 }, body: [-8, 0, 0], head: [-6, 0, 0] }, legs({ plant: true, lift: 0.1, dz: -0.09 })),
      k(0.38, both(CHEST_HANDS_UP), { protract: 0.5, root: { y: -0.06, z: -0.18 }, body: [-12, 0, 0], head: [-10, 0, 0], antenna: -12 }, legs({ plant: true, dz: -0.18 })),
      hold(1.2, both(CHEST_HANDS_UP), { protract: 0.5, root: { y: 0, z: -0.18 }, body: [-9, 0, 0], head: [-8, 0, 0] }, legs({ plant: true, dz: -0.18 })),
      k(1.5, both(ik([-0.75, 0.45, 0.35], [-0.6, -1, -0.3])), { root: { z: -0.13 }, body: [-3, 0, 0] }, { legR: { plant: true, dz: -0.09, lift: 0.09 }, legL: { plant: true, dz: -0.18 } }),
      k(1.7, { root: { z: -0.09 } }, N(), { legR: { plant: true, dz: 0 }, legL: { plant: true, dz: -0.18 } }),
      k(1.9, { root: { z: -0.04 } }, N(), { legR: { plant: true, dz: 0 }, legL: { plant: true, dz: -0.09, lift: 0.09 } }),
      hold(2.1, { root: { z: 0 } }, N()), hold(2.4, N())],
  },

  /* ------------------------------------------------ advanced */
  {
    id: 'backflip', name: 'Backflip', kind: 'advanced', mask: 'full', duration: 2.9,
    doc: 'Crouch and arm swing, take-off, a full 360° backward rotation in a tuck (knees to chest, hands on the knees), legs open before the landing, an absorbing crouch and recovery.',
    keys: [k(0, N()),
      k(0.35, both(ARMS_BACK), { root: { y: -0.36 }, body: [18, 0, 0], head: [10, 0, 0] }),
      k(0.52, both(V_HIGH), { root: { y: 0.1 }, body: [-8, 0, 0], head: [-14, 0, 0] }, legs({ plant: true, lift: 0.24, toe: -20 })),
      k(0.66, both(ik([-1.08, 0.98, 0.32], [-0.6, -0.5, -0.5])), { root: { y: 0.75, pitch: -55 }, body: [0, 0, 0], head: [-10, 0, 0] }, legs({ th: [-45, 0, -4], kn: 60, an: -10 })),
      k(0.82, both(ik([-0.82, 0.25, 0.42], [-0.7, -0.8, -0.3])), { root: { y: 1.2, pitch: -150 }, body: [6, 0, 0], head: [10, 0, 0] }, legs({ th: [-112, 0, -6], kn: 128, an: -20 })),
      k(1.04, both(ik([-0.82, 0.25, 0.42], [-0.7, -0.8, -0.3])), { root: { y: 1.25, pitch: -240 }, body: [6, 0, 0], head: [12, 0, 0] }, legs({ th: [-115, 0, -6], kn: 130, an: -20 })),
      k(1.24, both(ik([-0.7, 0.45, 0.45], [-0.7, -0.9, -0.3])), { root: { y: 0.62, pitch: -322 }, body: [2, 0, 0], head: [2, 0, 0] }, legs({ th: [-34, 0, -2], kn: 64, an: -30 })),
      k(1.44, both(ik([-0.95, 0.6, 0.4], [-0.6, -0.8, -0.3])), { root: { y: -0.17, pitch: -360 }, body: [8, 0, 0], head: [2, 0, 0] }),
      k(1.66, both(ik([-0.92, 0.45, 0.42], [-0.6, -1, -0.3])), { root: { y: -0.38, pitch: -360 }, body: [16, 0, 0], head: [8, 0, 0] }),
      k(2.15, both(ik([-0.85, 0.45, 0.35], [-0.6, -1, -0.3])), { root: { y: -0.04, pitch: -360 }, body: [3, 0, 0], head: [-3, 0, 0] }),
      hold(2.9, N(), { root: { pitch: -360 } })],
  },
  {
    id: 'forward_roll', name: 'Forward roll', kind: 'advanced', mask: 'full', duration: 3.9, contact: [0.62, 1.55],
    doc: 'Squats, reaches forward, tucks the head and rolls forward over its back in a ball (the body stays in contact with the floor), comes up on its feet, then hops back to its spot.',
    keys: [k(0, N()),
      k(0.4, both(CLEAR_FRONT), { protract: 0.5, root: { y: -0.35 }, body: [24, 0, 0], head: [16, 0, 0] }),
      k(0.62, both(ik([-0.72, 0.28, 0.52], [-0.8, -0.6, -0.2])), { protract: 0.5, root: { y: -0.62 }, body: [40, 0, 0], head: [24, 0, 0] }),
      k(0.8, both(ik([-0.78, 0.22, 0.42], [-0.8, -0.7, -0.2])), { root: { y: -0.6, z: 0.2, pitch: 55 }, body: [30, 0, 0], head: [26, 0, 0] }, legs({ th: [-100, 0, -5], kn: 118, an: -15 })),
      k(1.02, both(ik([-0.78, 0.22, 0.42], [-0.8, -0.7, -0.2])), { root: { y: -0.6, z: 0.42, pitch: 160 }, body: [22, 0, 0], head: [24, 0, 0] }, legs({ th: [-110, 0, -5], kn: 126, an: -15 })),
      k(1.26, both(ik([-0.78, 0.22, 0.42], [-0.8, -0.7, -0.2])), { root: { y: -0.6, z: 0.66, pitch: 268 }, body: [22, 0, 0], head: [20, 0, 0] }, legs({ th: [-108, 0, -5], kn: 124, an: -15 })),
      k(1.52, both(ik([-0.8, 0.3, 0.45], [-0.7, -0.8, -0.3])), { root: { y: -0.56, z: 0.88, pitch: 360 }, body: [30, 0, 0], head: [12, 0, 0] }, legs({ plant: true, dz: 0.88 })),
      k(2.0, both(ik([-0.85, 0.4, 0.35], [-0.6, -1, -0.3])), { root: { y: -0.08, z: 0.88, pitch: 360 }, body: [5, 0, 0], head: [0, 0, 0] }, legs({ plant: true, dz: 0.88 })),
      k(2.24, { root: { y: 0.14, z: 0.66, pitch: 360 } }, N(), legs({ plant: true, dz: 0.66, lift: 0.24 })),
      k(2.44, { root: { y: -0.12, z: 0.44, pitch: 360 } }, N(), legs({ plant: true, dz: 0.44 })),
      k(2.72, { root: { y: 0.14, z: 0.22, pitch: 360 } }, N(), legs({ plant: true, dz: 0.22, lift: 0.24 })),
      k(2.92, { root: { y: -0.12, z: 0, pitch: 360 } }, N(), legs({ plant: true, dz: 0 })),
      hold(3.9, N(), { root: { pitch: 360 } })],
  },
  {
    id: 'dance_sway', name: 'Side-to-side dance', kind: 'advanced', mask: 'full', duration: 2.5, loop: [0.5, 2.1],
    doc: 'Hips sway side to side on the beat with a knee dip, arms swing in opposition, head bobs — feet planted.',
    keys: [k(0, N()), k(0.25, { root: { y: -0.08 } }, N()),
      hold(0.5, { root: { x: 0.12, y: -0.07 }, body: [0, 4, -6], head: [0, 0, 11], armR: ik([-1.02, 0.92, 0.34], [-0.7, -1, -0.2], [-20, 0, 0]), armL: mirrorArm(ik([-0.84, 0.2, 0.3], [-0.6, -1, -0.4])) }),
      k(0.9, { root: { x: 0, y: -0.13 }, body: [3, 0, 0], head: [4, 0, 0], ...both(ik([-0.7, 0.45, 0.4], [-0.6, -1, -0.3])) }),
      hold(1.3, { root: { x: -0.12, y: -0.07 }, body: [0, -4, 6], head: [0, 0, -11], armL: mirrorArm(ik([-1.02, 0.92, 0.34], [-0.7, -1, -0.2], [-20, 0, 0])), armR: ik([-0.84, 0.2, 0.3], [-0.6, -1, -0.4]) }),
      k(1.7, { root: { x: 0, y: -0.13 }, body: [3, 0, 0], head: [4, 0, 0], ...both(ik([-0.7, 0.45, 0.4], [-0.6, -1, -0.3])) }),
      hold(2.1, { root: { x: 0.12, y: -0.07 }, body: [0, 4, -6], head: [0, 0, 11], armR: ik([-1.02, 0.92, 0.34], [-0.7, -1, -0.2], [-20, 0, 0]), armL: mirrorArm(ik([-0.84, 0.2, 0.3], [-0.6, -1, -0.4])) }),
      hold(2.5, N())],
  },
  {
    id: 'dance', name: 'Dance routine', kind: 'advanced', mask: 'full', duration: 4.6, loop: [0.4, 4.0],
    doc: 'An 8-beat routine: step-touch right and left with arm swings, disco point up and down, then a stepping spin.',
    keys: [k(0, N()), hold(0.4, N(), { root: { y: -0.08 } }),
      // 1–2 step right, touch
      k(0.6, { root: { x: -0.1, y: -0.11 }, body: [0, -8, 5], head: [0, -10, 0], ...both(ik([-0.75, 0.45, 0.35], [-0.7, -1, -0.2])) }, { legR: { plant: true, dx: -0.12, lift: 0.1 }, legL: PLANT }),
      k(0.85, { root: { x: -0.12, y: -0.07 }, body: [0, -6, 4], head: [0, -8, 0], armR: ik([-1.16, 1.04, 0.2], [-0.7, -0.6, -0.2]), armL: mirrorArm(ik([-0.78, 0.5, 0.45], [-0.6, -1, -0.3])) }, { legR: { plant: true, dx: -0.2 }, legL: PLANT }),
      k(1.1, { root: { x: -0.06, y: -0.11 } }, N(), { legR: { plant: true, dx: -0.2 }, legL: { plant: true, dx: -0.1, lift: 0.1 } }),
      k(1.3, { root: { x: 0, y: -0.07 } }, N(), { legR: { plant: true, dx: -0.1 }, legL: PLANT }),
      // 3–4 step left, touch
      k(1.5, { root: { x: 0.1, y: -0.11 }, body: [0, 8, -5], head: [0, 10, 0], ...both(ik([-0.75, 0.45, 0.35], [-0.7, -1, -0.2])) }, { legL: { plant: true, dx: 0.12, lift: 0.1 }, legR: { plant: true, dx: -0.1 } }),
      k(1.75, { root: { x: 0.12, y: -0.07 }, body: [0, 6, -4], head: [0, 8, 0], armL: mirrorArm(ik([-1.16, 1.04, 0.2], [-0.7, -0.6, -0.2])), armR: ik([-0.78, 0.5, 0.45], [-0.6, -1, -0.3]) }, { legL: { plant: true, dx: 0.2 }, legR: { plant: true, dx: -0.1 } }),
      k(2.0, { root: { x: 0.05, y: -0.11 } }, N(), { legL: { plant: true, dx: 0.2 }, legR: { plant: true, dx: 0, lift: 0.1 } }),
      k(2.2, { root: { x: 0, y: -0.07 } }, N(), { legL: PLANT, legR: PLANT }),
      // 5–6 disco: right hand points up across, then down
      k(2.45, { root: { y: -0.1 }, body: [0, 10, 4], head: [-10, -12, 0], armR: ik([-1.14, 1.27, 0.1], [-0.8, -0.6, 0], [0, 0, 0]), armL: HIP_HAND_L }),
      k(2.75, { root: { y: -0.1 }, body: [0, -10, -4], head: [8, -14, 0], armR: ik([-0.82, 0.3, 0.42], [-0.6, -1, -0.3]), armL: HIP_HAND_L }),
      // 7–8 stepping spin (four quarter steps), arms in
      k(2.95, { root: { yaw: 90, y: -0.1 }, body: [0, 0, 0], head: [0, 0, 0], ...both(ik([-0.8, 0.45, 0.38], [-0.6, -1, -0.3])) }, { legL: { plant: true, lift: 0.1 }, legR: PLANT }),
      k(3.25, { root: { yaw: 180, y: -0.07 } }, both(ik([-0.8, 0.45, 0.38], [-0.6, -1, -0.3])), { legR: { plant: true, lift: 0.1 }, legL: PLANT }),
      k(3.55, { root: { yaw: 270, y: -0.1 } }, both(ik([-0.8, 0.45, 0.38], [-0.6, -1, -0.3])), { legL: { plant: true, lift: 0.1 }, legR: PLANT }),
      hold(4.0, N(), { root: { yaw: 360, y: -0.08 } }),
      hold(4.6, N(), { root: { yaw: 360 } })],
  },
  {
    id: 'jump', name: 'Jump', kind: 'advanced', mask: 'full', duration: 2.0,
    doc: 'Crouch with arms back, spring up with arms swinging forward and knees tucking, land softly and recover.',
    keys: [k(0, N()), k(0.32, both(ARMS_BACK), { root: { y: -0.32 }, body: [16, 0, 0], head: [8, 0, 0] }),
      k(0.52, both(ik([-0.95, 0.85, 0.4], [-0.6, -1, -0.3])), { root: { y: 0.08 }, body: [-3, 0, 0], head: [-4, 0, 0] }, legs({ plant: true, lift: 0.14, toe: -18 })),
      k(0.62, both(ik([-1.08, 1.06, 0.32], [-0.6, -0.8, -0.3])), { root: { y: 0.55 }, head: [-6, 0, 0] }, legs({ plant: true, lift: 0.72, toe: -8 })),
      k(0.77, both(ik([-1.14, 1.15, 0.28], [-0.6, -0.8, -0.3])), { root: { y: 0.78 }, head: [-6, 0, 0], antenna: 8 }, legs({ plant: true, lift: 1.0 })),
      k(0.93, both(ik([-1.0, 0.75, 0.4], [-0.6, -1, -0.3])), { root: { y: 0.45 }, head: [-2, 0, 0], antenna: -8 }, legs({ plant: true, lift: 0.55 })),
      k(0.99, both(ik([-0.95, 0.6, 0.42], [-0.6, -1, -0.3])), { root: { y: 0.16 }, head: [0, 0, 0] }, legs({ plant: true, lift: 0.22 })), k(1.07, both(ik([-0.9, 0.5, 0.45], [-0.6, -1, -0.3])), { root: { y: -0.17 }, head: [2, 0, 0] }),
      k(1.22, both(ik([-0.88, 0.45, 0.45], [-0.6, -1, -0.3])), { root: { y: -0.32 }, body: [12, 0, 0], head: [6, 0, 0] }),
      k(1.6, both(ik([-0.8, 0.35, 0.3], [-0.6, -1, -0.3])), { root: { y: 0 }, body: [0, 0, 0] }), hold(2.0, N())],
  },
  {
    id: 'squat', name: 'Squat', kind: 'advanced', mask: 'full', duration: 2.6,
    doc: 'Sits back into a deep squat (knees forward, feet flat, torso leaning, arms forward for balance), holds, stands up.',
    keys: [k(0, N()), k(0.35, both(CLEAR_FRONT), { protract: 0.5, root: { y: -0.15 }, body: [8, 0, 0] }), k(0.8, both(ik([-0.4, 0.62, 0.72], [-0.6, -1, -0.3])), { protract: 1, root: { y: -0.55 }, body: [22, 0, 0], head: [-14, 0, 0] }),
      hold(1.6, both(ik([-0.4, 0.62, 0.72], [-0.6, -1, -0.3])), { protract: 1, root: { y: -0.56 }, body: [22, 0, 0], head: [-14, 0, 0] }),
      k(1.95, both(CLEAR_FRONT), { protract: 0.5, root: { y: -0.3 }, body: [12, 0, 0], head: [-6, 0, 0] }), k(2.3, both(ik([-0.85, 0.3, 0.3], [-0.6, -1, -0.3])), { root: { y: -0.03 }, body: [2, 0, 0], head: [0, 0, 0] }), hold(2.6, N())],
  },
  {
    id: 'balance', name: 'Balance on one leg', kind: 'advanced', mask: 'full', duration: 3.8, loop: [1.0, 2.6],
    doc: 'Shifts its weight over the left foot, raises the right knee, arms out like a tightrope walker, small corrective wobbles, then steps down.',
    keys: [k(0, N()), k(0.6, { root: { x: 0.2 }, body: [0, 0, 3], ...both(ARMS_OUT) }),
      k(1.0, { root: { x: 0.21 }, body: [0, 0, 4], ...both(ARMS_OUT) }, { legR: { plant: true, lift: 0.42, dz: 0.22, dx: 0.04, toe: -10 }, legL: PLANT }),
      k(1.4, { root: { x: 0.2 }, body: [0, 0, 1.5], head: [0, 0, -3], armR: { sh: [0, 0, -84], el: [0, 0, -8] }, armL: mirrorArm({ sh: [0, 0, -72], el: [0, 0, -12] }) }, { legR: { plant: true, lift: 0.44, dz: 0.23, dx: 0.04, toe: -10 }, legL: PLANT }),
      k(1.9, { root: { x: 0.21 }, body: [0, 0, 5.5], head: [0, 0, 3], armL: mirrorArm({ sh: [0, 0, -86], el: [0, 0, -8] }), armR: { sh: [0, 0, -72], el: [0, 0, -12] } }, { legR: { plant: true, lift: 0.41, dz: 0.21, dx: 0.04, toe: -10 }, legL: PLANT }),
      k(2.6, { root: { x: 0.21 }, body: [0, 0, 4], ...both(ARMS_OUT) }, { legR: { plant: true, lift: 0.42, dz: 0.22, dx: 0.04, toe: -10 }, legL: PLANT }),
      k(3.1, { root: { x: 0.18 }, body: [0, 0, 2], ...both(ik([-0.8, 0.4, 0.3], [-0.6, -1, -0.3])) }, { legR: PLANT, legL: PLANT }), hold(3.8, N())],
  },
  {
    id: 'turn_around', name: 'Turn around', kind: 'advanced', mask: 'full', duration: 3.0,
    doc: 'A full stepping turn: four quarter steps, alternating feet, arms swinging, back to face the viewer.',
    keys: [k(0, N()),
      k(0.6, { root: { yaw: 90, y: -0.03 } }, both(ik([-0.75, 0.35, 0.3], [-0.6, -1, -0.3])), { legR: { plant: true, lift: 0.12 }, legL: PLANT }),
      k(1.1, { root: { yaw: 180, y: 0 } }, both(ik([-0.75, 0.35, 0.3], [-0.6, -1, -0.3])), { legL: { plant: true, lift: 0.12 }, legR: PLANT }),
      k(1.6, { root: { yaw: 270, y: -0.03 } }, both(ik([-0.75, 0.35, 0.3], [-0.6, -1, -0.3])), { legR: { plant: true, lift: 0.12 }, legL: PLANT }),
      k(2.1, { root: { yaw: 360, y: 0 } }, both(ik([-0.75, 0.35, 0.3], [-0.6, -1, -0.3])), { legL: { plant: true, lift: 0.12 }, legR: PLANT }),
      hold(2.5, N(), { root: { yaw: 360 } }), hold(3.0, N(), { root: { yaw: 360 } })],
  },
  {
    id: 'sit', name: 'Sit down and stand up', kind: 'advanced', mask: 'full', duration: 4.8, loop: [2.1, 2.7],
    doc: 'Squats with arms forward for balance, lowers itself onto the floor while the feet slide out in front, sits with the hands resting on the thighs; stands back up the same way when released.',
    keys: [k(0, N()),
      k(0.7, both(ik([-0.4, 0.58, 0.7], [-0.6, -1, -0.3])), { protract: 1, root: { y: -0.6 }, body: [16, 0, 0], head: [-10, 0, 0] }, legs({ plant: true, knee: [-0.45, 0.2, 1] })),
      k(1.3, both(ik([-0.45, 0.45, 0.66], [-0.6, -1, -0.3])), { protract: 0.9, root: { y: -0.92, z: -0.12 }, body: [-2, 0, 0], head: [-6, 0, 0] }, legs({ plant: true, dz: 0.42, knee: [-0.45, 0.5, 1] })),
      k(1.8, both(ik([-0.44, 0.36, 0.58], [-0.8, -0.8, -0.2])), { protract: 0.6, root: { y: -1.06, z: -0.25 }, body: [-6, 0, 0], head: [0, 0, 0] }, legs({ plant: true, dz: 0.84, knee: [-0.4, 1, 0.4] })),
      hold(2.1, both(ik([-0.44, 0.36, 0.58], [-0.8, -0.8, -0.2])), { protract: 0.6, root: { y: -1.06, z: -0.25 }, body: [-6, 0, 0], head: [0, 0, 0] }, legs({ plant: true, dz: 0.84, knee: [-0.4, 1, 0.4] })),
      k(2.4, both(ik([-0.44, 0.37, 0.58], [-0.8, -0.8, -0.2])), { protract: 0.6, root: { y: -1.06, z: -0.25 }, body: [-7, 0, 0], head: [3, 6, 2] }, legs({ plant: true, dz: 0.84, knee: [-0.4, 1, 0.4] })),
      hold(2.7, both(ik([-0.44, 0.36, 0.58], [-0.8, -0.8, -0.2])), { protract: 0.6, root: { y: -1.06, z: -0.25 }, body: [-6, 0, 0], head: [0, 0, 0] }, legs({ plant: true, dz: 0.84, knee: [-0.4, 1, 0.4] })),
      k(3.3, both(ik([-0.45, 0.45, 0.66], [-0.6, -1, -0.3])), { protract: 0.9, root: { y: -0.92, z: -0.12 }, body: [0, 0, 0], head: [-6, 0, 0] }, legs({ plant: true, dz: 0.42, knee: [-0.45, 0.5, 1] })),
      k(3.9, both(ik([-0.4, 0.58, 0.7], [-0.6, -1, -0.3])), { protract: 1, root: { y: -0.6 }, body: [16, 0, 0], head: [-10, 0, 0] }, legs({ plant: true, knee: [-0.45, 0.2, 1] })),
      k(4.3, both(CLEAR_FRONT), { protract: 0.4, root: { y: -0.2 }, body: [8, 0, 0] }),
      hold(4.8, N())],
  },

  /* ------------------------------------------------ state loops (held while NEXUS is in that state) */
  {
    id: 'state_listening', name: 'Listening (state)', kind: 'state', mask: 'noHead', duration: 2.6, loop: [0.6, 2.6],
    doc: 'Attentive: leaning in a little, hands loosely together in front, a slow breath.',
    keys: [k(0, N()), k(0.3, both(CLEAR_FRONT), { protract: 0.5 }), hold(0.6, both(ik([-0.28, 0.52, 0.66], [-1, -0.5, 0])), { protract: 0.9, body: [4, 0, 0] }),
      k(1.6, both(ik([-0.28, 0.54, 0.66], [-1, -0.5, 0])), { protract: 0.9, body: [3, 0, 0], root: { y: -0.01 } }), hold(2.6, both(ik([-0.28, 0.52, 0.66], [-1, -0.5, 0])), { protract: 0.9, body: [4, 0, 0] })],
  },
  {
    id: 'state_happy', name: 'Happy (state)', kind: 'state', mask: 'noHead', duration: 1.8, loop: [0.6, 1.8],
    doc: 'A light knee bounce with relaxed, swinging arms.',
    keys: [k(0, N()), hold(0.6, { root: { y: -0.02 }, body: [0, 0, 2], armR: { sh: [-6, 0, -12], el: [0, 0, -8] }, armL: { sh: [6, 0, 14], el: [0, 0, 6] } }),
      k(0.9, { root: { y: -0.04 }, body: [0, 0, 0], ...both({ sh: [0, 0, -12], el: [0, 0, -8] }) }),
      k(1.2, { root: { y: -0.02 }, body: [0, 0, -2], armR: { sh: [6, 0, -14], el: [0, 0, -6] }, armL: { sh: [-6, 0, 12], el: [0, 0, 8] } }),
      k(1.5, { root: { y: -0.04 }, body: [0, 0, 0], ...both({ sh: [0, 0, -12], el: [0, 0, -8] }) }),
      hold(1.8, { root: { y: -0.02 }, body: [0, 0, 2], armR: { sh: [-6, 0, -12], el: [0, 0, -8] }, armL: { sh: [6, 0, 14], el: [0, 0, 6] } })],
  },
  {
    id: 'state_surprised', name: 'Surprised (state)', kind: 'state', mask: 'noHead', duration: 2.2, loop: [0.4, 2.2],
    doc: 'Hands up near the chest, leaning back a little — held while surprised.',
    keys: [k(0, N()), k(0.2, both(CLEAR_FRONT), { protract: 0.3 }), hold(0.45, both(CHEST_HANDS_UP), { protract: 0.5, body: [-7, 0, 0] }), k(1.3, both(ik([-0.63, 0.82, 0.57], [-0.5, -1, -0.3], [-42, 0, 0])), { protract: 0.5, body: [-6, 0, 0] }), hold(2.2, both(CHEST_HANDS_UP), { protract: 0.5, body: [-7, 0, 0] })],
  },
];

export const CLIP_BY_ID: Record<string, Clip> = Object.fromEntries(CLIPS.map((c) => [c.id, c]));

/** NEXUS's interaction states and the clip held in each (null = the existing idle body language only) */
export const BODY_STATES = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'HAPPY', 'EXCITED', 'CONFUSED', 'CURIOUS', 'SURPRISED', 'CELEBRATING', 'DANCING'] as const;
export type BodyState = (typeof BODY_STATES)[number];
export const STATE_CLIP: Record<BodyState, string | null> = {
  IDLE: null, LISTENING: 'state_listening', THINKING: 'think', SPEAKING: 'speak_gestures', HAPPY: 'state_happy', EXCITED: 'excited',
  CONFUSED: 'confused', CURIOUS: 'curious', SURPRISED: 'state_surprised', CELEBRATING: 'celebrate', DANCING: 'dance_sway',
};
