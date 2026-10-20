/**
 * Asset 05 — Body Pose Library. Poses are channel maps over the shared rig (Asset 03);
 * they form the engine's base layer and are blended smoothly when changed.
 * Sitting/crouching use leg foreshortening (front view); a seat appears for "sitting".
 */
import type { Pose } from '../../shared/schema';
import type { ChannelValues } from '../../shared/channels';

export const POSE_LIBRARY: Record<Pose, ChannelValues> = {
  neutral: {},
  standing: { 'body.squash': -0.02, 'armL.raise': 4, 'armR.raise': 4 },
  resting: { 'body.y': 4, 'body.squash': 0.03, 'head.nod': 0.35, 'head.rot': -6, 'armL.raise': 2, 'armR.raise': 2, 'armL.bend': 2, 'armR.bend': 2 },
  sitting: { 'body.y': 24, 'legL.lift': 0.9, 'legR.lift': 0.9, 'legL.spread': 12, 'legR.spread': 12, 'armL.raise': 18, 'armR.raise': 18, 'armL.bend': -30, 'armR.bend': -30 },
  leaning: { 'body.rot': 8, 'body.x': 6, 'head.rot': 6, 'armL.raise': 14, 'armR.raise': 2, 'legL.spread': 8 },
  crouching: { 'body.y': 18, 'body.squash': 0.07, 'legL.lift': 0.6, 'legR.lift': 0.6, 'legL.spread': 20, 'legR.spread': 20, 'armL.raise': 30, 'armR.raise': 30, 'armL.bend': -40, 'armR.bend': -40, 'head.nod': 0.2 },
  waving: { 'armR.raise': 120, 'armR.bend': 40, 'head.rot': -6 },
  reaching: { 'armR.raise': 95, 'armR.bend': 5, 'body.rot': -5, 'head.rot': -4, 'body.squash': -0.04 },
};

/** Map conversational posture hints from the brain onto poses. */
export const POSE_IDS = Object.keys(POSE_LIBRARY) as Pose[];
