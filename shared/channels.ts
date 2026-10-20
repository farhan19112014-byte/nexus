/**
 * The NEXUS 2D rig: every animatable property is a named scalar CHANNEL with a range,
 * rest value, speed limit and an exclusive-control GROUP. Motions and expressions are
 * keyframes on these channels — nothing else can be animated.
 *
 * Conventions (front view; character's LEFT = viewer's RIGHT):
 *  arm*.raise   0 = hanging down, 90 = horizontal outward, 180 = straight up, <0 = across the body
 *  arm*.bend    elbow; + folds the forearm further in the raise direction (outward/up), − toward the body
 *  hand*.spin   wrist rotation (waving)
 *  leg*.spread  outward leg angle; leg*.lift 0..1 knee raise (foot rises, shin foreshortens)
 *  head.rot     + tilts toward the character's left; head.nod + = forward (face moves down)
 *  body.facing  −1..1 three-quarter facing (2D feature shift, not a 3D turn)
 */

export type ChannelGroup = 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'eyes' | 'brows' | 'mouth' | 'fx';

export interface ChannelDef {
  min: number; max: number; rest: number;
  /** max |dv/dt| in units per second, enforced at runtime and by the validator */
  maxSpeed: number;
  group: ChannelGroup;
  unit: 'deg' | 'px' | 'norm' | 'ratio';
  face?: boolean;
  doc: string;
}

const c = (min: number, max: number, rest: number, maxSpeed: number, group: ChannelGroup, unit: ChannelDef['unit'], doc: string, face = false): ChannelDef =>
  ({ min, max, rest, maxSpeed, group, unit, doc, face });

export const CHANNELS = {
  'body.x': c(-70, 70, 0, 260, 'body', 'px', 'horizontal stage offset'),
  'body.y': c(-40, 30, 0, 320, 'body', 'px', 'vertical offset (− = up)'),
  'body.rot': c(-14, 14, 0, 110, 'body', 'deg', 'lean'),
  'body.squash': c(-0.12, 0.12, 0, 2.5, 'body', 'ratio', 'squash (+) / stretch (−)'),
  'body.facing': c(-1, 1, 0, 9, 'body', 'norm', 'three-quarter facing'),
  'head.rot': c(-26, 26, 0, 190, 'head', 'deg', 'head tilt left/right'),
  'head.nod': c(-1, 1, 0, 12, 'head', 'norm', 'head tilt forward(+)/back(−)'),
  'head.x': c(-10, 10, 0, 140, 'head', 'px', 'head shift x'),
  'head.y': c(-10, 8, 0, 140, 'head', 'px', 'head shift y'),
  'armL.raise': c(-40, 180, 8, 1100, 'armL', 'deg', 'left arm raise'),
  'armL.bend': c(-150, 150, 6, 1200, 'armL', 'deg', 'left elbow bend'),
  'handL.spin': c(-45, 45, 0, 520, 'armL', 'deg', 'left wrist'),
  'armR.raise': c(-40, 180, 8, 1100, 'armR', 'deg', 'right arm raise'),
  'armR.bend': c(-150, 150, 6, 1200, 'armR', 'deg', 'right elbow bend'),
  'handR.spin': c(-45, 45, 0, 520, 'armR', 'deg', 'right wrist'),
  'legL.spread': c(-10, 40, 3, 240, 'legL', 'deg', 'left leg outward angle'),
  'legL.lift': c(0, 1, 0, 9, 'legL', 'norm', 'left knee raise'),
  'legR.spread': c(-10, 40, 3, 240, 'legR', 'deg', 'right leg outward angle'),
  'legR.lift': c(0, 1, 0, 9, 'legR', 'norm', 'right knee raise'),
  'eyeL.open': c(0, 1, 1, 30, 'eyes', 'norm', 'left eyelid open', true),
  'eyeR.open': c(0, 1, 1, 30, 'eyes', 'norm', 'right eyelid open', true),
  'eyes.happy': c(0, 1, 0, 12, 'eyes', 'norm', 'crescent "smiling" eyes', true),
  'eyes.size': c(0.8, 1.3, 1, 4, 'eyes', 'ratio', 'eye scale', true),
  'pupil.x': c(-1, 1, 0, 14, 'eyes', 'norm', 'gaze x', true),
  'pupil.y': c(-1, 1, 0, 14, 'eyes', 'norm', 'gaze y', true),
  'browL.y': c(-1, 1, 0, 8, 'brows', 'norm', 'left brow raise', true),
  'browR.y': c(-1, 1, 0, 8, 'brows', 'norm', 'right brow raise', true),
  'browL.tilt': c(-1, 1, 0, 8, 'brows', 'norm', 'left brow tilt (+ = angry/inner down)', true),
  'browR.tilt': c(-1, 1, 0, 8, 'brows', 'norm', 'right brow tilt', true),
  'mouth.curve': c(-1, 1, 0.2, 8, 'mouth', 'norm', 'frown(−) / smile(+)', true),
  'mouth.open': c(0, 1, 0, 20, 'mouth', 'norm', 'mouth open', true),
  'mouth.width': c(0.5, 1.4, 1, 6, 'mouth', 'ratio', 'mouth width', true),
  'mouth.round': c(0, 1, 0, 10, 'mouth', 'norm', 'round "o" mouth', true),
  'mouth.skew': c(-1, 1, 0, 6, 'mouth', 'norm', 'lopsided mouth', true),
  'cheeks': c(0, 1, 0, 10, 'mouth', 'norm', 'cheek lights', true),
  'face.glow': c(0.3, 1, 0.9, 4, 'fx', 'norm', 'screen brightness', true),
  'antenna.rot': c(-30, 30, 0, 400, 'fx', 'deg', 'antenna sway'),
  'antenna.glow': c(0, 1, 0.6, 14, 'fx', 'norm', 'antenna light'),
  'chest.glow': c(0, 1, 0.7, 6, 'fx', 'norm', 'chest light'),
} as const satisfies Record<string, ChannelDef>;

export type Channel = keyof typeof CHANNELS;
export const CHANNEL_NAMES = Object.keys(CHANNELS) as Channel[];
export const FACE_CHANNELS = CHANNEL_NAMES.filter((k) => (CHANNELS[k] as ChannelDef).face) as Channel[];
export const isChannel = (s: string): s is Channel => Object.prototype.hasOwnProperty.call(CHANNELS, s);
export const GROUPS: ChannelGroup[] = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'eyes', 'brows', 'mouth', 'fx'];

export function clampChannel(ch: Channel, v: number): number {
  const d = CHANNELS[ch]; return v < d.min ? d.min : v > d.max ? d.max : v;
}
export const restOf = (ch: Channel) => CHANNELS[ch].rest;
export const groupOf = (ch: Channel) => CHANNELS[ch].group as ChannelGroup;

/** Mirror a channel name left↔right (arms, hands, legs, eyes, brows). */
export function mirrorChannel(ch: Channel): Channel {
  const m = ch.replace(/^(arm|hand|leg|eye|brow)([LR])/, (_, a, s) => a + (s === 'L' ? 'R' : 'L'));
  return (isChannel(m) ? m : ch) as Channel;
}
/** Channels whose value flips sign under mirroring (left/right asymmetric quantities). */
export const MIRROR_NEGATE = new Set<Channel>(['body.x', 'body.rot', 'body.facing', 'head.rot', 'head.x', 'pupil.x', 'mouth.skew', 'antenna.rot']);

export type ChannelValues = Partial<Record<Channel, number>>;
export function restPose(): Record<Channel, number> {
  return Object.fromEntries(CHANNEL_NAMES.map((k) => [k, CHANNELS[k].rest])) as Record<Channel, number>;
}
