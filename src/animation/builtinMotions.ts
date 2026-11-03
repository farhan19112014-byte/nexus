/**
 * Built-in motion skills — plain declarative data in the same format the learning system
 * uses, validated by the same validator (Assets 24, 25, 26, 27, 31, 32, 34–39).
 * Authored for the RIGHT side; mirrorable skills can be played with side:'left'.
 */
import { SkillDefSchema, type Easing, type SkillDef, type SkillDefInput, type Track } from '../../shared/schema';
import type { Channel } from '../../shared/channels';

type K = [t: number, v: number, ease?: Easing];
export const tr = (channel: Channel, ...keys: K[]): Track => ({ channel, keys: keys.map(([t, v, e]) => ({ t, v, ...(e ? { ease: e } : {}) })) });
const S = (s: Omit<SkillDefInput, 'kind'>): SkillDef => SkillDefSchema.parse({ createdBy: 'builtin', kind: 'motion', ...s, tags: [...(s.tags ?? []), 'builtin'] });
const reps = (min: number, max: number, def: number, mirrorable = true) => ({ speed: { min: 0.5, max: 1.8, default: 1 }, amplitude: { min: 0.3, max: 1.3, default: 1 }, repetitions: { min, max, default: def }, mirrorable });

export const BUILTIN_MOTIONS: SkillDef[] = [
  /* ---- idle & life ---- */
  S({ id: 'happy_idle', name: 'Happy idle bounce', description: 'Gentle positive bob used while the happy expression is held.', priority: 1, duration: 1.6, loop: { start: 0, end: 1.6 }, params: reps(1, 4, 2, false),
    tracks: [tr('body.y', [0.4, -3], [0.8, 0], [1.2, -3], [1.6, 0]), tr('antenna.rot', [0.4, 6], [1.2, -6], [1.6, 0])], tags: ['idle', 'happy'] }),
  S({ id: 'waiting', name: 'Waiting', description: 'Calm, low-intensity loop while a request is pending (stops immediately when it ends).', priority: 1, duration: 4, params: { speed: { min: 1, max: 1, default: 1 }, amplitude: { min: 0.3, max: 1, default: 1 }, repetitions: { min: 1, max: 1, default: 1 }, mirrorable: false },
    tracks: [tr('antenna.glow', [1, 1], [2, 0.4], [3, 1], [4, 0.6]), tr('head.rot', [1.2, -4], [2.8, 4], [4, 0]), tr('body.squash', [2, 0.02], [4, 0])], tags: ['system', 'waiting'] }),
  /* ---- ambient mini-behaviours (played now and then while idle; can be turned off) ---- */
  S({ id: 'look_around', name: 'Look around', description: 'Curious glance left and right, as if checking out the room.', priority: 1, duration: 3.2, params: reps(1, 1, 1, false),
    tracks: [tr('pupil.x', [0.4, -0.85, 'easeOut'], [1.2, -0.85], [1.6, 0.85, 'easeInOut'], [2.5, 0.85], [3.0, 0]), tr('head.rot', [0.5, -7], [1.2, -7], [1.7, 7], [2.5, 7], [3.2, 0]), tr('pupil.y', [0.4, -0.2], [2.8, -0.2], [3.2, 0])], tags: ['idle', 'ambient'] }),
  S({ id: 'stretch', name: 'Little stretch', description: 'Arms up, a tall stretch and a happy settle.', priority: 1, duration: 2.6, params: reps(1, 1, 1, false),
    tracks: [tr('armL.raise', [0.6, 128, 'easeOut'], [1.6, 128], [2.4, 8]), tr('armR.raise', [0.6, 128, 'easeOut'], [1.6, 128], [2.4, 8]), tr('armL.bend', [0.6, 10], [1.6, 10], [2.4, 6]), tr('armR.bend', [0.6, 10], [1.6, 10], [2.4, 6]),
      tr('body.squash', [0.7, -0.08, 'easeOut'], [1.6, -0.08], [2.1, 0.03], [2.6, 0]), tr('body.y', [0.7, -6], [1.6, -6], [2.2, 0]), tr('eyeL.open', [0.6, 0.15], [1.6, 0.15], [2.0, 1]), tr('eyeR.open', [0.6, 0.15], [1.6, 0.15], [2.0, 1]), tr('mouth.round', [0.6, 0.7], [1.5, 0.7], [1.9, 0]), tr('mouth.open', [0.6, 0.45], [1.5, 0.45], [1.9, 0])], tags: ['idle', 'ambient'] }),
  S({ id: 'antenna_wiggle', name: 'Antenna wiggle', description: 'Looks up at its own antenna as it wiggles and glows.', priority: 1, duration: 2.2, params: reps(1, 1, 1, false),
    tracks: [tr('pupil.y', [0.3, -0.9, 'easeOut'], [1.8, -0.9], [2.2, 0]), tr('antenna.rot', [0.5, 16], [0.75, -16], [1.0, 14], [1.25, -12], [1.5, 8], [1.8, 0]), tr('antenna.glow', [0.5, 1], [0.8, 0.4], [1.1, 1], [1.6, 0.6]), tr('head.nod', [0.3, -0.35], [1.8, -0.35], [2.2, 0]), tr('mouth.curve', [0.9, 0.8], [1.8, 0.8], [2.2, 0.2])], tags: ['idle', 'ambient'] }),
  /* ---- head (Asset 24) ---- */
  S({ id: 'nod', name: 'Nod', description: 'Agreeing head nod.', duration: 0.9, loop: { start: 0.05, end: 0.55 }, params: reps(1, 4, 2, false),
    tracks: [tr('head.nod', [0.05, 0], [0.3, 0.7], [0.55, 0], [0.9, 0])], tags: ['agreement'] }),
  S({ id: 'shake_head', name: 'Shake head', description: 'Gentle "no".', duration: 1, loop: { start: 0.05, end: 0.65 }, params: reps(1, 4, 2, false),
    tracks: [tr('head.x', [0.2, 6], [0.5, -6], [0.65, 0], [1, 0]), tr('head.rot', [0.2, 6], [0.5, -6], [0.65, 0], [1, 0])], tags: ['disagreement'] }),
  S({ id: 'head_tilt', name: 'Head tilt', description: 'Curious sideways tilt (mirror for the other side).', duration: 1.6,
    tracks: [tr('head.rot', [0.35, 16, 'easeOut'], [1.2, 16], [1.6, 0])], tags: ['curious'] }),
  S({ id: 'head_forward', name: 'Lean head forward', description: 'Tilts the head forward attentively.', duration: 1.4, params: reps(1, 2, 1, false),
    tracks: [tr('head.nod', [0.35, 0.8, 'easeOut'], [1, 0.8], [1.4, 0])] }),
  S({ id: 'head_back', name: 'Lean head back', description: 'Tilts the head back.', duration: 1.4, params: reps(1, 2, 1, false),
    tracks: [tr('head.nod', [0.35, -0.8, 'easeOut'], [1, -0.8], [1.4, 0])] }),
  /* ---- arms (Asset 25) ---- */
  S({ id: 'wave', name: 'Wave', description: 'Friendly wave with the right hand (mirrorable).', duration: 1.9, loop: { start: 0.45, end: 1.05 }, params: reps(1, 4, 2),
    tracks: [
      tr('armR.raise', [0.35, 116, 'easeOut'], [1.5, 116], [1.9, 8]),
      tr('armR.bend', [0.35, 34, 'easeOut'], [0.45, 34], [0.75, 58], [1.05, 34], [1.5, 34], [1.9, 6]),
      tr('handR.spin', [0.45, -15], [0.75, 18], [1.05, -15], [1.9, 0]),
      tr('head.rot', [0.4, -6], [1.5, -6], [1.9, 0]),
      tr('eyes.happy', [0.3, 0.7], [1.6, 0.7], [1.9, 0]), tr('mouth.curve', [0.3, 0.9], [1.6, 0.9], [1.9, 0.2]),
    ], startPose: 'neutral', endPose: 'neutral', tags: ['greeting', 'farewell'] }),
  S({ id: 'point', name: 'Point', description: 'Points outward with the right arm.', duration: 1.8,
    tracks: [tr('armR.raise', [0.35, 88, 'easeOut'], [1.4, 88], [1.8, 8]), tr('armR.bend', [0.35, 2], [1.4, 2], [1.8, 6]), tr('body.rot', [0.35, -4], [1.4, -4], [1.8, 0]), tr('pupil.x', [0.3, -0.9], [1.4, -0.9], [1.8, 0])], tags: ['indicate'] }),
  S({ id: 'raise_hand', name: 'Raise hand', description: 'Raises the right hand high.', duration: 1.6,
    tracks: [tr('armR.raise', [0.4, 150, 'easeOut'], [1.2, 150], [1.6, 8]), tr('armR.bend', [0.35, 18], [1.6, 6]), tr('browR.y', [0.3, 0.6], [1.2, 0.6], [1.6, 0])] }),
  S({ id: 'open_arms', name: 'Open arms', description: 'Welcoming open arms.', duration: 1.8, params: reps(1, 2, 1, false),
    tracks: [tr('armL.raise', [0.4, 72, 'easeOut'], [1.3, 72], [1.8, 8]), tr('armR.raise', [0.4, 72, 'easeOut'], [1.3, 72], [1.8, 8]), tr('armL.bend', [0.4, 22], [1.3, 22], [1.8, 6]), tr('armR.bend', [0.4, 22], [1.3, 22], [1.8, 6]), tr('head.nod', [0.4, -0.25], [1.3, -0.25], [1.8, 0])], tags: ['greeting'] }),
  S({ id: 'rest_hands', name: 'Rest hands', description: 'Hands clasped in front — a calm resting gesture.', duration: 2.4, params: reps(1, 2, 1, false),
    tracks: [tr('armL.raise', [0.5, -22, 'easeOut'], [1.9, -22], [2.4, 8]), tr('armR.raise', [0.5, -22, 'easeOut'], [1.9, -22], [2.4, 8]), tr('armL.bend', [0.5, -55], [1.9, -55], [2.4, 6]), tr('armR.bend', [0.5, -55], [1.9, -55], [2.4, 6])], tags: ['calm'] }),
  S({ id: 'think_chin', name: 'Hand to chin', description: 'Thoughtful hand-to-chin gesture.', duration: 2.4,
    tracks: [tr('armR.raise', [0.5, 30, 'easeOut'], [1.9, 30], [2.4, 8]), tr('armR.bend', [0.5, -128, 'easeOut'], [1.9, -128], [2.4, 6]), tr('head.rot', [0.5, -8], [1.9, -8], [2.4, 0]), tr('pupil.y', [0.5, -0.6], [1.9, -0.6], [2.4, 0])], tags: ['thinking'] }),
  S({ id: 'shrug', name: 'Shrug', description: '"Not sure" shrug.', duration: 1.5, params: reps(1, 2, 1, false),
    tracks: [tr('armL.raise', [0.35, 38, 'easeOut'], [0.95, 38], [1.5, 8]), tr('armR.raise', [0.35, 38, 'easeOut'], [0.95, 38], [1.5, 8]), tr('armL.bend', [0.35, 70], [0.95, 70], [1.5, 6]), tr('armR.bend', [0.35, 70], [0.95, 70], [1.5, 6]), tr('head.rot', [0.35, 10], [0.95, 10], [1.5, 0]), tr('body.y', [0.35, -4], [0.95, -4], [1.5, 0]), tr('mouth.skew', [0.3, 0.6], [1, 0.6], [1.5, 0])], tags: ['uncertain'] }),
  S({ id: 'clap', name: 'Clap', description: 'Little claps in front of the chest.', duration: 1.8, loop: { start: 0.4, end: 0.8 }, params: reps(1, 4, 3, false),
    tracks: [tr('armL.raise', [0.3, 20], [1.5, 20], [1.8, 8]), tr('armR.raise', [0.3, 20], [1.5, 20], [1.8, 8]), tr('armL.bend', [0.4, -60], [0.6, -95], [0.8, -60], [1.5, -60], [1.8, 6]), tr('armR.bend', [0.4, -60], [0.6, -95], [0.8, -60], [1.5, -60], [1.8, 6]), tr('eyes.happy', [0.3, 0.8], [1.5, 0.8], [1.8, 0])], tags: ['celebration'] }),
  /* ---- body (Assets 26, 27) ---- */
  S({ id: 'bounce', name: 'Bounce', description: 'Restrained bounce.', duration: 1, loop: { start: 0, end: 0.5 }, params: reps(1, 4, 2, false),
    tracks: [tr('body.y', [0.15, 6], [0.3, -10, 'easeOut'], [0.5, 0, 'easeIn'], [1, 0]), tr('body.squash', [0.15, 0.08], [0.3, -0.05], [0.5, 0], [1, 0])], tags: ['happy'] }),
  S({ id: 'turn_left', name: 'Turn to its left', description: 'Three-quarter turn toward the viewer\'s right (2D feature shift, not a 3D turn).', duration: 2.2, params: reps(1, 1, 1, false),
    tracks: [tr('body.facing', [0.4, 0.85, 'easeOut'], [1.8, 0.85], [2.2, 0]), tr('pupil.x', [0.3, 0.8], [1.8, 0.8], [2.2, 0])], tags: ['orientation'] }),
  S({ id: 'turn_right', name: 'Turn to its right', description: 'Three-quarter turn toward the viewer\'s left (2D feature shift, not a 3D turn).', duration: 2.2, params: reps(1, 1, 1, false),
    tracks: [tr('body.facing', [0.4, -0.85, 'easeOut'], [1.8, -0.85], [2.2, 0]), tr('pupil.x', [0.3, -0.8], [1.8, -0.8], [2.2, 0])], tags: ['orientation'] }),
  S({ id: 'walk_across', name: 'Walk across', description: 'Toddles to one side and back with alternating steps.', duration: 3.6, params: reps(1, 1, 1, true),
    tracks: [
      tr('body.x', [1.6, -55, 'easeInOut'], [2, -55], [3.6, 0, 'easeInOut']),
      tr('body.facing', [0.3, -0.6], [1.6, -0.6], [2, 0.6], [3.3, 0.6], [3.6, 0]),
      tr('legL.lift', ...Array.from({ length: 9 }, (_, i): K => [0.2 + i * 0.4, i % 2 ? 0 : 0.6]), [3.6, 0]),
      tr('legR.lift', ...Array.from({ length: 9 }, (_, i): K => [0.2 + i * 0.4, i % 2 ? 0.6 : 0]), [3.6, 0]),
      tr('body.y', ...Array.from({ length: 9 }, (_, i): K => [0.2 + i * 0.4, i % 2 ? 0 : -4]), [3.6, 0]),
      tr('armL.raise', [0.6, 22], [1.4, 4], [2.2, 22], [3, 4], [3.6, 8]), tr('armR.raise', [0.6, 4], [1.4, 22], [2.2, 4], [3, 22], [3.6, 8]),
    ], tags: ['locomotion'] }),
  /* ---- reactions (Assets 31, 34–38) ---- */
  S({ id: 'greeting', name: 'Greeting', description: 'Welcoming hop and wave for the start of a session or an explicit greeting.', priority: 3, duration: 2.4, params: reps(1, 1, 1),
    tracks: [
      tr('body.y', [0.2, 5], [0.4, -14, 'easeOut'], [0.65, 0, 'easeIn'], [2.4, 0]), tr('body.squash', [0.2, 0.08], [0.4, -0.06], [0.65, 0]),
      tr('armR.raise', [0.5, 116, 'easeOut'], [2, 116], [2.4, 8]), tr('armR.bend', [0.5, 34], [0.8, 58], [1.1, 34], [1.4, 58], [1.7, 34], [2.4, 6]),
      tr('eyes.happy', [0.3, 0.9], [2.1, 0.9], [2.4, 0]), tr('mouth.curve', [0.3, 1], [2.1, 1], [2.4, 0.2]), tr('mouth.open', [0.3, 0.35], [2.1, 0.35], [2.4, 0]), tr('cheeks', [0.3, 0.9], [2.1, 0.9], [2.4, 0]),
      tr('antenna.glow', [0.3, 1], [2.1, 1], [2.4, 0.6]),
    ], tags: ['greeting', 'reaction'] }),
  S({ id: 'complete_nod', name: 'Response complete', description: 'Brief, optional "done" nod with an antenna blink.', priority: 1, duration: 0.9, params: reps(1, 1, 1, false),
    tracks: [tr('head.nod', [0.25, 0.35], [0.55, 0], [0.9, 0]), tr('antenna.glow', [0.2, 1], [0.6, 0.6])], tags: ['reaction', 'optional'] }),
  S({ id: 'error_react', name: 'Error reaction', description: 'Restrained concern when a real operation fails.', priority: 3, duration: 1.4, params: reps(1, 1, 1, false),
    tracks: [tr('head.nod', [0.3, 0.4], [1, 0.4], [1.4, 0]), tr('body.squash', [0.3, 0.05], [1, 0.05], [1.4, 0]), tr('antenna.rot', [0.3, -14], [1, -14], [1.4, 0]), tr('armL.raise', [0.4, 4], [1.4, 8]), tr('armR.raise', [0.4, 4], [1.4, 8])], tags: ['reaction', 'error'] }),
  S({ id: 'celebrate', name: 'Celebrate', description: 'Small celebration — used only after a verified success.', priority: 3, duration: 1.8, params: reps(1, 1, 1, false),
    tracks: [
      tr('armL.raise', [0.4, 150, 'easeOut'], [1.3, 150], [1.8, 8]), tr('armR.raise', [0.4, 150, 'easeOut'], [1.3, 150], [1.8, 8]),
      tr('armL.bend', [0.4, 15], [1.3, 15], [1.8, 6]), tr('armR.bend', [0.4, 15], [1.3, 15], [1.8, 6]),
      tr('body.y', [0.25, 5], [0.5, -16, 'easeOut'], [0.8, 0, 'easeIn'], [1.8, 0]), tr('body.squash', [0.25, 0.08], [0.5, -0.06], [0.8, 0]),
      tr('eyes.happy', [0.3, 1], [1.5, 1], [1.8, 0]), tr('mouth.curve', [0.3, 1], [1.5, 1], [1.8, 0.2]), tr('mouth.open', [0.3, 0.5], [1.5, 0.5], [1.8, 0]),
    ], tags: ['reaction', 'success', 'optional'] }),
  /* ---- speaking & explanation gestures ---- */
  S({ id: 'explain', name: 'Open-hand explanation', description: 'Palm turns outward at chest height while explaining, then settles.', duration: 1.8, params: reps(1, 2, 1),
    tracks: [tr('armR.raise', [0.4, 48, 'easeOut'], [1.3, 52], [1.8, 8]), tr('armR.bend', [0.4, 64], [0.9, 72], [1.3, 64], [1.8, 6]), tr('handR.spin', [0.4, -30], [1.3, -30], [1.8, 0]), tr('head.rot', [0.4, 4], [1.4, 4], [1.8, 0])], tags: ['speech', 'explanation'] }),
  S({ id: 'speak_beat', name: 'Speaking beat', description: 'Small, restrained hand beat that accompanies a longer spoken reply.', priority: 1, duration: 1.4, params: reps(1, 2, 1),
    tracks: [tr('armR.raise', [0.35, 26, 'easeOut'], [0.7, 32], [1.0, 26], [1.4, 8]), tr('armR.bend', [0.35, 40], [0.7, 50], [1.0, 40], [1.4, 6]), tr('body.rot', [0.4, 1.5], [1.4, 0])], tags: ['speech', 'optional'] }),
  S({ id: 'reassure', name: 'Reassure', description: 'Both hands lower gently, palms down — a calm "it is okay" gesture.', duration: 1.9, params: reps(1, 1, 1, false),
    tracks: [tr('armL.raise', [0.4, 38, 'easeOut'], [1.2, 30], [1.9, 8]), tr('armR.raise', [0.4, 38, 'easeOut'], [1.2, 30], [1.9, 8]), tr('armL.bend', [0.4, 30], [1.2, 30], [1.9, 6]), tr('armR.bend', [0.4, 30], [1.2, 30], [1.9, 6]),
      tr('head.nod', [0.5, 0.3], [1.2, 0.3], [1.9, 0]), tr('body.y', [0.6, 2], [1.4, 2], [1.9, 0])], tags: ['reaction', 'calm'] }),
  /* ---- conversational acknowledgements (spec §7.2) ---- */
  S({ id: 'agree', name: 'Agree', description: 'Warm "yes": two nods with a smile.', duration: 1.3, params: reps(1, 2, 1, false),
    tracks: [tr('head.nod', [0.2, 0.6], [0.45, 0], [0.7, 0.6], [0.95, 0]), tr('mouth.curve', [0.4, 0.9], [1.0, 0.9], [1.3, 0.2]), tr('eyes.happy', [0.2, 0.5], [1.0, 0.5], [1.3, 0])], tags: ['agreement', 'conversation'] }),
  S({ id: 'disagree', name: 'Disagree', description: 'Polite "no": a small head shake with a level mouth and one raised hand.', duration: 1.5, params: reps(1, 2, 1, false),
    tracks: [tr('head.rot', [0.25, 7], [0.55, -7], [0.85, 5], [1.1, 0]), tr('head.x', [0.25, 5], [0.55, -5], [0.85, 3], [1.1, 0]), tr('mouth.curve', [0.2, -0.2], [1.2, -0.2], [1.5, 0.2]),
      tr('armR.raise', [0.35, 52, 'easeOut'], [1.1, 52], [1.5, 8]), tr('armR.bend', [0.35, 70], [1.1, 70], [1.5, 6])], tags: ['disagreement', 'conversation'] }),
  S({ id: 'acknowledge', name: 'Acknowledge', description: 'A single small nod with a blink of the antenna — "got it".', duration: 0.8, params: reps(1, 1, 1, false),
    tracks: [tr('head.nod', [0.2, 0.4], [0.45, 0], [0.8, 0]), tr('antenna.glow', [0.15, 1], [0.6, 0.6]), tr('eyeL.open', [0.2, 0.5], [0.35, 1]), tr('eyeR.open', [0.2, 0.5], [0.35, 1])], tags: ['conversation'] }),
  S({ id: 'success', name: 'Success', description: 'Brief thumbs-up style arm pump — used only after a verified successful action.', priority: 3, duration: 1.3, params: reps(1, 1, 1, false),
    tracks: [tr('armR.raise', [0.3, 95, 'easeOut'], [0.9, 95], [1.3, 8]), tr('armR.bend', [0.3, 110], [0.55, 90], [0.75, 110], [1.3, 6]), tr('body.y', [0.3, -6, 'easeOut'], [0.6, 0]),
      tr('eyes.happy', [0.2, 0.8], [1.0, 0.8], [1.3, 0]), tr('mouth.curve', [0.4, 1], [1.0, 1], [1.3, 0.2]), tr('antenna.glow', [0.2, 1], [1.1, 1], [1.3, 0.6])], tags: ['reaction', 'success'] }),
  S({ id: 'return_to_idle', name: 'Return to idle', description: 'Settles every joint back into the neutral resting pose.', priority: 2, duration: 0.6, params: { speed: { min: 0.5, max: 1.8, default: 1 }, amplitude: { min: 1, max: 1, default: 1 }, repetitions: { min: 1, max: 1, default: 1 }, mirrorable: false },
    tracks: [tr('armL.raise', [0.6, 8, 'easeOut']), tr('armR.raise', [0.6, 8, 'easeOut']), tr('armL.bend', [0.6, 6, 'easeOut']), tr('armR.bend', [0.6, 6, 'easeOut']),
      tr('head.rot', [0.6, 0, 'easeOut']), tr('head.nod', [0.6, 0, 'easeOut']), tr('body.rot', [0.6, 0, 'easeOut']), tr('body.y', [0.6, 0, 'easeOut'])], tags: ['system'] }),
  S({ id: 'notify', name: 'Notification', description: 'Antenna flash and a little perk-up for in-app notifications.', priority: 2, duration: 1.2, params: reps(1, 1, 1, false),
    tracks: [tr('antenna.glow', [0.1, 1], [0.3, 0.3], [0.5, 1], [0.7, 0.3], [1.2, 0.6]), tr('antenna.rot', [0.2, 12], [0.5, -12], [0.8, 0]), tr('body.y', [0.15, -6, 'easeOut'], [0.45, 0]), tr('eyes.size', [0.15, 1.15], [0.8, 1.15], [1.2, 1])], tags: ['reaction', 'optional'] }),
  S({ id: 'listen_lean', name: 'Listening lean', description: 'Attentive lean while the microphone is capturing.', priority: 1, duration: 3, loop: { start: 0.5, end: 2.5 }, params: { speed: { min: 1, max: 1, default: 1 }, amplitude: { min: 0.3, max: 1, default: 1 }, repetitions: { min: 1, max: 6, default: 6 }, mirrorable: false },
    tracks: [tr('body.rot', [0.5, 4], [1.5, 5], [2.5, 4], [3, 0]), tr('head.rot', [0.5, 8], [1.5, 10], [2.5, 8], [3, 0])], tags: ['listening', 'system'] }),
];

/* ---- full-body moves (A144): the 3D robot plays a full-body clip with the same id (src/character3d/body/clips.ts);
   these tracks are the 2D robot's version and the face that goes with the move (eyes, mouth, glow) ---- */
const FULL = (s: Omit<SkillDefInput, 'kind'>): SkillDef => S({ ...s, tags: [...(s.tags ?? []), 'fullbody'] });
BUILTIN_MOTIONS.push(
  FULL({ id: 'thumbs_up', name: 'Thumbs up', description: 'Right forearm up in front, thumb pointing up — "nice!".', duration: 2.0, params: reps(1, 1, 1, false),
    tracks: [tr('armR.raise', [0.45, 40], [1.4, 40], [2.0, 8]), tr('armR.bend', [0.45, 95], [1.4, 95], [2.0, 6]), tr('head.rot', [0.45, 8], [1.4, 8], [2.0, 0]), tr('eyes.happy', [0.4, 0.8], [1.5, 0.8], [2.0, 0]), tr('mouth.curve', [0.4, 1], [1.5, 1], [2.0, 0.2])], tags: ['success', 'approval'] }),
  FULL({ id: 'excited', name: 'Excited', description: 'Arms up in a V, pumping, knees bouncing.', duration: 2.4, loop: { start: 0.5, end: 1.3 }, params: reps(1, 3, 1, false),
    tracks: [tr('armL.raise', [0.5, 140], [0.7, 120], [0.9, 140], [1.1, 120], [1.3, 140], [2.4, 8]), tr('armR.raise', [0.5, 140], [0.7, 120], [0.9, 140], [1.1, 120], [1.3, 140], [2.4, 8]), tr('body.y', [0.5, 0], [0.7, 6], [0.9, 0], [1.1, 6], [1.3, 0], [2.4, 0]), tr('eyes.happy', [0.4, 1], [1.8, 1], [2.4, 0]), tr('mouth.curve', [0.4, 1], [1.8, 1], [2.4, 0.2]), tr('mouth.open', [0.4, 0.5], [1.8, 0.5], [2.4, 0])], tags: ['happy', 'reaction'] }),
  FULL({ id: 'confused', name: 'Confused', description: 'Head tilt, one palm up, a puzzled pause.', duration: 2.6, loop: { start: 0.7, end: 1.9 }, params: reps(1, 2, 1, false),
    tracks: [tr('head.rot', [0.5, 16], [1.9, 16], [2.6, 0]), tr('armR.raise', [0.5, 50], [1.9, 50], [2.6, 8]), tr('armR.bend', [0.5, 70], [1.9, 70], [2.6, 6]), tr('browL.y', [0.5, 0.6], [1.9, 0.6], [2.6, 0]), tr('browR.y', [0.5, -0.2], [1.9, -0.2], [2.6, 0]), tr('mouth.skew', [0.5, 0.5], [1.9, 0.5], [2.6, 0])], tags: ['uncertain', 'reaction'] }),
  FULL({ id: 'curious', name: 'Curious lean', description: 'Leans forward, hands behind the back, head tilted.', duration: 2.8, loop: { start: 0.7, end: 2.0 }, params: reps(1, 2, 1, false),
    tracks: [tr('body.rot', [0.6, 4], [2.0, 4], [2.8, 0]), tr('head.rot', [0.6, -12], [2.0, -12], [2.8, 0]), tr('head.nod', [0.6, 0.3], [2.0, 0.3], [2.8, 0]), tr('eyes.size', [0.6, 1.15], [2.0, 1.15], [2.8, 1]), tr('browL.y', [0.6, 0.5], [2.0, 0.5], [2.8, 0]), tr('browR.y', [0.6, 0.5], [2.0, 0.5], [2.8, 0])], tags: ['curious'] }),
  FULL({ id: 'disappointed', name: 'Disappointed', description: 'Head and shoulders drop, a small slump — then recovers.', duration: 2.8, params: reps(1, 1, 1, false),
    tracks: [tr('head.nod', [0.7, 0.8], [1.8, 0.8], [2.8, 0]), tr('body.y', [0.7, 5], [1.8, 5], [2.8, 0]), tr('mouth.curve', [0.6, -0.7], [1.9, -0.7], [2.8, 0.2]), tr('browL.tilt', [0.6, -0.5], [1.9, -0.5], [2.8, 0]), tr('browR.tilt', [0.6, -0.5], [1.9, -0.5], [2.8, 0]), tr('eyeL.open', [0.6, 0.7], [1.9, 0.7], [2.8, 1]), tr('eyeR.open', [0.6, 0.7], [1.9, 0.7], [2.8, 1])], tags: ['sad', 'reaction'] }),
  FULL({ id: 'laugh', name: 'Laugh', description: 'Hands on the belly, head back, bobbing with each "ha".', duration: 2.4, loop: { start: 0.5, end: 1.3 }, params: reps(1, 3, 2, false),
    tracks: [tr('head.nod', [0.5, -0.5], [0.7, -0.2], [0.9, -0.5], [1.1, -0.2], [1.3, -0.5], [2.4, 0]), tr('body.y', [0.5, 0], [0.7, 4], [0.9, 0], [1.1, 4], [1.3, 0], [2.4, 0]), tr('eyes.happy', [0.3, 1], [1.8, 1], [2.4, 0]), tr('mouth.curve', [0.3, 1], [1.8, 1], [2.4, 0.2]), tr('mouth.open', [0.5, 0.7], [0.7, 0.3], [0.9, 0.7], [1.1, 0.3], [1.3, 0.7], [2.4, 0])], tags: ['joke', 'happy', 'laughter'] }),
  FULL({ id: 'surprised', name: 'Surprised', description: 'Quick hop back, hands up, a held "oh!" — then steps back.', duration: 2.4, params: reps(1, 1, 1, false), priority: 3,
    tracks: [tr('body.y', [0.26, -6], [0.38, 2], [1.2, 0], [2.4, 0]), tr('eyes.size', [0.2, 1.3], [1.4, 1.3], [2.4, 1]), tr('mouth.round', [0.25, 0.8], [1.3, 0.8], [2.0, 0]), tr('browL.y', [0.42, 1], [1.4, 1], [2.4, 0]), tr('browR.y', [0.42, 1], [1.4, 1], [2.4, 0]), tr('armL.raise', [0.38, 60], [1.2, 60], [2.4, 8]), tr('armR.raise', [0.38, 60], [1.2, 60], [2.4, 8])], tags: ['surprise', 'reaction'] }),
  FULL({ id: 'backflip', name: 'Backflip', description: 'A full backward somersault: crouch, take-off, tucked 360° rotation, landing and recovery.', duration: 2.9, params: { ...reps(1, 1, 1, false), speed: { min: 0.8, max: 1.2, default: 1 } }, priority: 2,
    tracks: [tr('body.y', [0.35, 10], [0.8, -36], [1.0, -36], [1.5, 8], [1.7, 10], [2.4, 0]), tr('body.squash', [0.35, 0.1], [0.55, -0.08], [1.44, 0.08], [1.8, 0]), tr('armL.raise', [0.3, -10], [0.75, 140], [1.0, 70], [1.44, 60], [2.4, 8]), tr('armR.raise', [0.3, -10], [0.75, 140], [1.0, 70], [1.44, 60], [2.4, 8]), tr('legL.lift', [0.75, 0.7], [1.15, 0.7], [1.5, 0]), tr('legR.lift', [0.75, 0.7], [1.15, 0.7], [1.5, 0]), tr('eyes.happy', [1.5, 1], [2.4, 1], [2.9, 0]), tr('mouth.round', [0.6, 0.6], [1.3, 0.6], [1.5, 0]), tr('mouth.curve', [1.5, 1], [2.5, 1], [2.9, 0.2])], tags: ['acrobatic', 'celebration'] }),
  FULL({ id: 'forward_roll', name: 'Forward roll', description: 'Squats, rolls forward in a ball, comes up and hops back to its spot.', duration: 3.9, params: { ...reps(1, 1, 1, false), speed: { min: 0.8, max: 1.2, default: 1 } }, priority: 2,
    tracks: [tr('body.y', [0.6, 25], [1.5, 25], [2.0, 0], [3.9, 0]), tr('head.nod', [0.6, 0.9], [1.5, 0.9], [2.0, 0]), tr('legL.lift', [0.8, 0.9], [1.4, 0.9], [1.8, 0]), tr('legR.lift', [0.8, 0.9], [1.4, 0.9], [1.8, 0]), tr('eyes.happy', [2.0, 1], [3.4, 1], [3.9, 0])], tags: ['acrobatic'] }),
  FULL({ id: 'dance_sway', name: 'Side-to-side dance', description: 'Hips sway on the beat, arms swing in opposition, knees dip.', duration: 2.5, loop: { start: 0.5, end: 2.1 }, params: reps(1, 6, 3, false),
    tracks: [tr('body.x', [0.5, 12], [0.9, 0], [1.3, -12], [1.7, 0], [2.1, 12], [2.5, 0]), tr('body.rot', [0.5, -6], [1.3, 6], [2.1, -6], [2.5, 0]), tr('armR.raise', [0.5, 60], [1.3, 20], [2.1, 60], [2.5, 8]), tr('armL.raise', [0.5, 20], [1.3, 60], [2.1, 20], [2.5, 8]), tr('eyes.happy', [0.4, 1], [2.2, 1], [2.5, 0]), tr('mouth.curve', [0.4, 1], [2.2, 1], [2.5, 0.2])], tags: ['dance', 'happy'] }),
  FULL({ id: 'dance', name: 'Dance routine', description: 'An 8-beat routine: step-touch, disco point, a stepping spin.', duration: 4.6, loop: { start: 0.4, end: 4.0 }, params: reps(1, 3, 1, false),
    tracks: [tr('body.x', [0.85, -12], [1.3, 0], [1.75, 12], [2.2, 0], [4.6, 0]), tr('armR.raise', [0.85, 120], [1.3, 8], [2.45, 150], [2.85, 30], [3.0, 30], [4.0, 8]), tr('armL.raise', [0.85, 30], [1.75, 120], [2.2, 8], [4.6, 8]), tr('body.facing', [2.95, 1], [3.25, 0], [3.55, -1], [4.0, 0]), tr('eyes.happy', [0.4, 1], [4.2, 1], [4.6, 0]), tr('mouth.curve', [0.4, 1], [4.2, 1], [4.6, 0.2])], tags: ['dance', 'happy'] }),
  FULL({ id: 'jump', name: 'Jump', description: 'Crouch, spring up with the arms, land softly.', duration: 2.0, params: reps(1, 2, 1, false),
    tracks: [tr('body.y', [0.32, 10], [0.74, -34], [0.8, -34], [1.24, 8], [1.6, 0]), tr('body.squash', [0.32, 0.08], [0.56, -0.06], [1.07, 0.06], [1.5, 0]), tr('armL.raise', [0.3, -10], [0.68, 120], [1.07, 40], [1.6, 8]), tr('armR.raise', [0.3, -10], [0.68, 120], [1.07, 40], [1.6, 8]), tr('legL.lift', [0.62, 0.5], [0.93, 0.5], [1.07, 0]), tr('legR.lift', [0.62, 0.5], [0.93, 0.5], [1.07, 0]), tr('eyes.happy', [0.6, 1], [1.4, 1], [2.0, 0])], tags: ['happy'] }),
  FULL({ id: 'squat', name: 'Squat', description: 'A deep squat with the arms forward, held, then up.', duration: 2.6, params: reps(1, 3, 1, false),
    tracks: [tr('body.y', [0.8, 28], [1.6, 28], [2.3, 0]), tr('body.squash', [0.8, 0.1], [1.6, 0.1], [2.3, 0]), tr('armL.raise', [0.8, 70], [1.6, 70], [2.3, 8]), tr('armR.raise', [0.8, 70], [1.6, 70], [2.3, 8])], tags: ['exercise'] }),
  FULL({ id: 'balance', name: 'Balance on one leg', description: 'Weight over the left foot, right knee up, arms out, little wobbles.', duration: 3.8, loop: { start: 1.0, end: 2.6 }, params: reps(1, 3, 1, false),
    tracks: [tr('body.x', [0.6, 20], [3.1, 18], [3.8, 0]), tr('legR.lift', [1.0, 0.8], [2.6, 0.8], [3.1, 0]), tr('armL.raise', [0.6, 80], [3.1, 60], [3.8, 8]), tr('armR.raise', [0.6, 80], [3.1, 60], [3.8, 8]), tr('body.rot', [1.4, -3], [1.9, 4], [2.6, -2], [3.8, 0]), tr('mouth.skew', [1.0, 0.4], [2.6, 0.4], [3.1, 0])], tags: ['balance'] }),
  FULL({ id: 'turn_around', name: 'Turn around', description: 'A full stepping turn in four quarter steps.', duration: 3.0, params: reps(1, 2, 1, false),
    tracks: [tr('body.facing', [0.6, 1], [1.1, 0], [1.6, -1], [2.1, 0], [3.0, 0]), tr('legR.lift', [0.6, 0.3], [0.85, 0], [1.6, 0.3], [1.85, 0]), tr('legL.lift', [1.1, 0.3], [1.35, 0], [2.1, 0.3], [2.35, 0])], tags: ['movement'] }),
  FULL({ id: 'sit', name: 'Sit on the floor', description: 'Lowers itself to sit on the floor, legs out in front; stands back up after.', duration: 4.8, loop: { start: 2.1, end: 2.7 }, params: reps(1, 6, 2, false),
    tracks: [tr('body.y', [0.7, 22], [1.8, 30], [2.7, 30], [3.9, 22], [4.6, 0]), tr('body.squash', [0.7, 0.1], [1.8, 0.12], [2.7, 0.12], [3.9, 0.1], [4.6, 0]), tr('legL.lift', [1.3, 0.6], [3.3, 0.6], [4.0, 0]), tr('legR.lift', [1.3, 0.6], [3.3, 0.6], [4.0, 0])], tags: ['rest'] }),
);

export const BUILTIN_MOTION_IDS = new Set(BUILTIN_MOTIONS.map((m) => m.id));
