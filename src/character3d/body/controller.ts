/**
 * NEXUS full-body animation controller — the one place that decides what the 3D body does.
 *
 * Two layers over the existing channel/expression pose (which keeps the face, lip-sync and idle life):
 *   STATE layer  – a held loop for NEXUS's interaction state (LISTENING, THINKING, SPEAKING, HAPPY, EXCITED, CONFUSED,
 *                  CURIOUS, SURPRISED, CELEBRATING, DANCING; IDLE = none). State changes crossfade (0.5 s); the previous
 *                  state keeps moving while it fades, so nothing freezes or snaps.
 *   ACTION layer – one explicit clip at a time (clap, wave, backflip…), started by the animation engine's own action
 *                  events — so the engine's priorities and queue decide what plays and nothing interrupts at random.
 *                  Looping clips repeat while their engine action is held and play their outro when it ends.
 *                  Airborne clips have a commit window: a stop request during a flip is honoured after the landing.
 * Each layer weights only the joints of its clip's mask; the face is never touched.
 * Pure TypeScript (no three.js): the same code runs in the renderer and in unit tests.
 */
import { CLIP_BY_ID, STATE_CLIP, type BodyState } from './clips';
import { ClipSampler, type Clip, type Mask } from './clip';
import { JOINTS, type BodyPose, type Joint } from './skeleton';
import { QI, smooth } from './math';
import type { Presence, PresenceOut } from './presence';
import { composeFrame } from './frame';

export type LayerWeights = Record<Joint | 'root', number>;
export interface BodyLayer { pose: BodyPose; w: LayerWeights }
export interface BodyOutput { layers: BodyLayer[]; active: boolean; action: string | null; state: BodyState; /** additive head nod (radians, +x = down) on speech accents */ accent: number; /** smoothed speech energy 0…1 */ speech: number; /** the presence layer (3D only): idle life, attention, gestures, locomotion */ presence: PresenceOut | null }

const MASKS: Record<Mask, (Joint | 'root')[]> = {
  full: [...JOINTS, 'root'],
  noHead: [...JOINTS.filter((j) => j !== 'Head' && j !== 'Antenna'), 'root'],
  arms: ['Arm_L', 'Forearm_L', 'Hand_L', 'Arm_R', 'Forearm_R', 'Hand_R'],
  armsHead: ['Arm_L', 'Forearm_L', 'Hand_L', 'Arm_R', 'Forearm_R', 'Hand_R', 'Head'],
  head: ['Head'],
};
const zeroW = (): LayerWeights => Object.fromEntries([...JOINTS, 'root'].map((j) => [j, 0])) as LayerWeights;
const maskW = (m: Mask, k: number): LayerWeights => { const w = zeroW(); for (const j of MASKS[m]) w[j] = k; return w; };

/** clips that leave the floor: a stop/cancel inside [a, b] waits until b (the robot cannot stop mid-air) */
export const COMMIT: Record<string, [number, number]> = {
  backflip: [0.35, 1.7], forward_roll: [0.55, 1.6], jump: [0.35, 1.15], celebrate: [0.3, 1.2], surprised: [0.05, 0.4],
};
/** the engine's motion skills that have a full-body clip (skill id → clip id) */
export const CLIP_FOR_SKILL: Record<string, string> = {
  clap: 'clap', wave: 'wave', greeting: 'wave', farewell: 'wave', nod: 'nod', agree: 'nod', shake_head: 'shake_head', disagree: 'shake_head',
  shrug: 'shrug', point: 'point', thumbs_up: 'thumbs_up', success: 'thumbs_up', speak_gestures: 'speak_gestures', look_around: 'look_around',
  excited: 'excited', celebrate: 'celebrate', confused: 'confused', curious: 'curious', disappointed: 'disappointed', think_chin: 'think', think: 'think',
  laugh: 'laugh', surprised: 'surprised', backflip: 'backflip', forward_roll: 'forward_roll', dance_sway: 'dance_sway', dance: 'dance',
  jump: 'jump', squat: 'squat', balance: 'balance', turn_around: 'turn_around', sit: 'sit',
  point_right: 'point_right', point_left: 'point_left', compare: 'compare', explain: 'explain',
};
/** states whose gestures follow the voice: arms rest in pauses, move with the words */
const SPEECH_STATES = new Set<BodyState>(['SPEAKING', 'EXPLAINING']);
/** with the presence layer attached, these states gesture from meaning (presence) instead of a looping clip */
const PRESENCE_STATES = new Set<BodyState>(['SPEAKING', 'EXPLAINING']);

interface Track { clip: Clip; s: ClipSampler; t: number; age: number; held: boolean; released: boolean; fade: number; fadeRate: number; speed: number; engineId?: number; cancelAt?: number }
const FADE_IN = 0.28, FADE_OUT = 0.35, STATE_FADE = 0.5;

export class BodyController {
  state: BodyState = 'IDLE';
  /** reduced motion: no state loops (explicit actions still play, gently faded) */
  reduced = false;
  private states: Track[] = [];           // [current, …fading-out previous]
  private actions: Track[] = [];          // [current, …fading-out previous]
  private queue: { id: string; engineId?: number; speed: number }[] = [];
  private listeners = new Set<(e: { type: 'start' | 'end'; clip: string }) => void>();
  /* speech coordination: the voice's loudness (mouth openness) drives a fast and a slow envelope */
  private rawSpeech = 0; private envFast = 0; private envSlow = 0; private accentV = 0; private speaking = false;
  /** the presence layer (idle life, attention, meaningful gestures, walking) — attached while the 3D robot is shown */
  presence: Presence | null = null;
  /** the 2D-style channels are moving an arm themselves (a gesture without a 3D clip): presence gestures yield */
  channelGesture = false;
  /** current speech energy 0…1 (mouth openness from the playing voice; 0 when silent) */
  setSpeech(level: number, speaking = level > 0) { this.rawSpeech = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)); this.speaking = speaking; }
  on(f: (e: { type: 'start' | 'end'; clip: string }) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  current() { const a = this.actions[0]; return a && !a.released && a.fadeRate <= 0 ? a.clip.id : null; }
  busy() { return this.actions.length > 0 || this.states.some((s) => s.fade > 0.001) || !!this.presence?.busy(); }
  clipTime() { return this.actions[0]?.t ?? 0; }

  setState(s: BodyState) {
    if (s === this.state) return;
    this.state = s;
    for (const t of this.states) t.fadeRate = 1 / STATE_FADE;                  // fade out whatever is held
    const id = this.presence && PRESENCE_STATES.has(s) ? null : STATE_CLIP[s];
    if (id && !this.reduced) { const clip = CLIP_BY_ID[id]; this.states.unshift({ clip, s: new ClipSampler(clip), t: 0, age: 0, held: true, released: false, fade: 0, fadeRate: -1 / STATE_FADE, speed: 1 }); }
  }

  /**
   * Play a clip (explicit command or an engine action starting). If a committed clip is in the air the new one
   * waits; otherwise the previous action crossfades out while the new one fades in.
   */
  play(id: string, o: { engineId?: number; speed?: number; hold?: boolean } = {}): boolean {
    const clip = CLIP_BY_ID[id]; if (!clip) return false;
    const cur = this.actions[0];
    if (cur && this.committed(cur)) { if (this.queue.length < 2) this.queue.push({ id, engineId: o.engineId, speed: o.speed ?? 1 }); return true; }
    for (const a of this.actions) if (a.fadeRate <= 0) a.fadeRate = 1 / 0.3;
    this.actions.unshift({ clip, s: new ClipSampler(clip), t: 0, age: 0, held: o.hold ?? !!clip.loop, released: false, fade: 0, fadeRate: -1 / FADE_IN, speed: Math.max(0.5, Math.min(1.8, o.speed ?? 1)), engineId: o.engineId });
    this.listeners.forEach((f) => f({ type: 'start', clip: id }));
    return true;
  }
  /** the action's command ended normally: loops finish their cycle and play their outro */
  release(engineId?: number) {
    for (const a of this.actions) if (engineId === undefined || a.engineId === engineId) { a.held = false; a.released = true; }
    if (engineId !== undefined) this.queue = this.queue.filter((q) => q.engineId !== engineId);
  }
  /** stop now (user stop, cancellation): fades out quickly — after the landing for an airborne clip */
  stop(engineId?: number) {
    this.queue = engineId === undefined ? [] : this.queue.filter((q) => q.engineId !== engineId);
    for (const a of this.actions) if (engineId === undefined || a.engineId === engineId) {
      a.held = false; a.released = true;
      const c = COMMIT[a.clip.id];
      if (c && a.t >= c[0] && a.t < c[1]) a.cancelAt = c[1]; else a.fadeRate = 1 / 0.3;
    }
  }
  private stateOf(t: Track): BodyState { return (Object.keys(STATE_CLIP) as BodyState[]).find((k) => STATE_CLIP[k] === t.clip.id) ?? 'IDLE'; }
  private committed(a: Track) { const c = COMMIT[a.clip.id]; return !!c && a.t >= c[0] && a.t < c[1] && a.fadeRate <= 0; }

  update(dt: number): BodyOutput {
    const d = Math.min(0.1, Math.max(0, dt));
    // ---- actions
    for (const a of this.actions) {
      a.age += d; a.t += d * a.speed;
      const L = a.clip.loop;
      if (L && a.held && a.t >= L[1]) a.t = L[0] + ((a.t - L[0]) % (L[1] - L[0]));   // loop while held
      if (a.cancelAt !== undefined && a.t >= a.cancelAt) { a.fadeRate = 1 / 0.35; a.cancelAt = undefined; }
      if (a.t >= a.clip.duration && a.fadeRate <= 0) a.fadeRate = 1 / FADE_OUT;        // finished: settle out
      a.fade = Math.max(0, Math.min(1, a.fade - a.fadeRate * d));
    }
    const ended = this.actions.filter((a) => a.fadeRate > 0 && a.fade <= 0);
    this.actions = this.actions.filter((a) => !(a.fadeRate > 0 && a.fade <= 0));
    for (const e of ended) this.listeners.forEach((f) => f({ type: 'end', clip: e.clip.id }));
    if (this.queue.length && !(this.actions[0] && this.committed(this.actions[0]))) { const q = this.queue.shift()!; this.play(q.id, { engineId: q.engineId, speed: q.speed }); }
    // ---- states
    for (const s of this.states) {
      s.t += d; const L = s.clip.loop; if (L && s.t >= L[1]) s.t = L[0] + ((s.t - L[0]) % (L[1] - L[0]));
      s.fade = Math.max(0, Math.min(1, s.fade - s.fadeRate * d));
    }
    this.states = this.states.filter((s) => !(s.fadeRate > 0 && s.fade <= 0));
    if (this.reduced) for (const s of this.states) s.fadeRate = Math.max(s.fadeRate, 1 / STATE_FADE);

    // ---- speech envelope: attack fast, release slower; pauses relax the speaking gestures, accents nod the head
    const up = this.rawSpeech > this.envFast;
    this.envFast += (this.rawSpeech - this.envFast) * (1 - Math.exp(-d * (up ? 18 : 6)));
    this.envSlow += (this.rawSpeech - this.envSlow) * (1 - Math.exp(-d * 2.2));
    const onset = Math.max(0, this.envFast - this.envSlow - 0.06);
    const accentTarget = this.reduced ? 0 : Math.min(0.07, onset * 0.22);
    this.accentV += (accentTarget - this.accentV) * (1 - Math.exp(-d * 10));
    const speechGain = 0.4 + 0.6 * Math.min(1, this.envSlow * 2.2);
    // ---- layers: older first (the renderer slerps them in order over the channel pose)
    const layers: BodyLayer[] = [];
    // state crossfades: the arms of the incoming state wait until the outgoing state's arms have mostly let go — a
    // direct blend between two arm poses on opposite sides of the body can pass through the torso
    const ARMS = ['Arm_L', 'Forearm_L', 'Hand_L', 'Arm_R', 'Forearm_R', 'Hand_R'] as const;
    const live = [...this.states].reverse();
    for (let i = 0; i < live.length; i++) {
      const s = live[i]; if (s.fade <= 0.001) continue;
      const g = SPEECH_STATES.has(this.stateOf(s)) ? speechGain : 1; const w = maskW(s.clip.mask, smooth(s.fade) * g);
      const older = Math.max(0, ...live.slice(0, i).filter((o) => MASKS[o.clip.mask].includes('Arm_L')).map((o) => o.fade));
      if (older > 0) { const k = 1 - smooth(Math.min(1, older / 0.6)); for (const j of ARMS) w[j] *= k; }
      layers.push({ pose: s.s.sample(s.t), w });
    }
    const actionLayers: BodyLayer[] = [];
    for (const a of [...this.actions].reverse()) if (a.fade > 0.001) actionLayers.push({ pose: a.s.sample(a.t), w: maskW(a.clip.mask, smooth(a.fade)) });
    // ---- presence: yields to whatever the explicit actions own; its gesture arms sit between the states and the actions
    let presence: PresenceOut | null = null;
    if (this.presence) {
      const mx = (j: Joint | 'root') => actionLayers.reduce((m, l) => Math.max(m, l.w[j]), 0);
      presence = this.presence.update(Math.min(0.25, Math.max(0, dt)), { state: this.state, speaking: this.speaking, speech: this.envSlow, onset, reduced: this.reduced,
        clipArms: Math.max(mx('Arm_L'), mx('Arm_R')), clipHead: mx('Head'), clipLegs: Math.max(mx('Leg_L'), mx('Leg_R')), clipRoot: mx('root'), channelGesture: this.channelGesture });
      const armPose = restBodyPose(); const w = zeroW();
      for (const s of ['L', 'R'] as const) {
        const a = presence.arms[s]; [armPose.joints[`Arm_${s}`], armPose.joints[`Forearm_${s}`], armPose.joints[`Hand_${s}`]] = a.q;
        w[`Arm_${s}`] = w[`Forearm_${s}`] = w[`Hand_${s}`] = a.w;
      }
      armPose.protract = presence.protract;
      if (presence.arms.L.w > 0.001 || presence.arms.R.w > 0.001) layers.push({ pose: armPose, w });
    }
    layers.push(...actionLayers);
    const accent = this.accentV > 1e-4 ? this.accentV : 0;
    return { layers, active: layers.length > 0 || accent > 0 || !!presence, action: this.current(), state: this.state, accent, speech: this.envSlow, presence };
  }
}

/** compose layers onto a base pose in pure math (tests, and the preview's checks): same order the renderer uses */
export function compose(base: BodyPose, layers: BodyLayer[], presence: PresenceOut | null = null): BodyPose {
  return composeFrame(base, layers, presence).pose;
}
export const restBodyPose = (): BodyPose => ({ rootPos: [0, 0, 0], rootRot: QI(), joints: Object.fromEntries(JOINTS.map((j) => [j, QI()])) as Record<Joint, BodyPose['rootRot']>, shrug: 0, protract: 0 });
