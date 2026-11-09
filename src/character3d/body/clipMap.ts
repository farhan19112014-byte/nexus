/**
 * Which engine motion skills have a full-body clip in the 3D robot (skill id → clip id). Kept apart from the body
 * controller so the always-loaded runtime can know this without downloading the 3D animation code.
 */
/** the engine's motion skills that have a full-body clip (skill id → clip id) */
export const CLIP_FOR_SKILL: Record<string, string> = {
  clap: 'clap', wave: 'wave', greeting: 'wave', farewell: 'wave', nod: 'nod', agree: 'nod', shake_head: 'shake_head', disagree: 'shake_head',
  shrug: 'shrug', point: 'point', thumbs_up: 'thumbs_up', success: 'thumbs_up', speak_gestures: 'speak_gestures', look_around: 'look_around',
  excited: 'excited', celebrate: 'celebrate', confused: 'confused', curious: 'curious', disappointed: 'disappointed', think_chin: 'think', think: 'think',
  laugh: 'laugh', surprised: 'surprised', backflip: 'backflip', forward_roll: 'forward_roll', dance_sway: 'dance_sway', dance: 'dance',
  jump: 'jump', squat: 'squat', balance: 'balance', turn_around: 'turn_around', sit: 'sit',
  point_right: 'point_right', point_left: 'point_left', compare: 'compare', explain: 'explain',
};
