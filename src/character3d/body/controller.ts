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
import { QI, qnorm, slerp, smooth } from './math';

export type LayerWeights = Record<Joint | 'root', number>;
export interface BodyLayer { pose: BodyPose; w: LayerWeights }
export interface BodyOutput { layers: BodyLayer[]; active: boolean; action: string | null; state: BodyState; /** additive head nod (radians, +x = down) on speech accents */ accent: number; /** smoothed speech energy 0…1 */ speech: number }

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
  private rawSpeech = 0; private envFast = 0; private envSlow = 0; private accentV = 0;
  /** current speech energy 0…1 (mouth openness from the playing voice; 0 when silent) */
  setSpeech(level: number) { this.rawSpeech = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)); }
  on(f: (e: { type: 'start' | 'end'; clip: string }) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  current() { const a = this.actions[0]; return a && !a.released && a.fadeRate <= 0 ? a.clip.id : null; }
  busy() { return this.actions.length > 0 || this.states.some((s) => s.fade > 0.001); }
  clipTime() { return this.actions[0]?.t ?? 0; }

  setState(s: BodyState) {
    if (s === this.state) return;
    this.state = s;
    for (const t of this.states) t.fadeRate = 1 / STATE_FADE;                  // fade out whatever is held
    const id = STATE_CLIP[s];
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
    for (const s of [...this.states].reverse()) if (s.fade > 0.001) { const g = SPEECH_STATES.has(this.stateOf(s)) ? speechGain : 1; layers.push({ pose: s.s.sample(s.t), w: maskW(s.clip.mask, smooth(s.fade) * g) }); }
    for (const a of [...this.actions].reverse()) if (a.fade > 0.001) layers.push({ pose: a.s.sample(a.t), w: maskW(a.clip.mask, smooth(a.fade)) });
    const accent = this.accentV > 1e-4 ? this.accentV : 0;
    return { layers, active: layers.length > 0 || accent > 0, action: this.current(), state: this.state, accent, speech: this.envSlow };
  }
}

/** compose layers onto a base pose in pure math (tests, and the preview's checks): same order the renderer uses */
export function compose(base: BodyPose, layers: BodyLayer[]): BodyPose {
  const out: BodyPose = { rootPos: [...base.rootPos], rootRot: [...base.rootRot], joints: { ...base.joints }, shrug: base.shrug, protract: base.protract };
  for (const l of layers) {
    for (const j of JOINTS) if (l.w[j] > 0) out.joints[j] = qnorm(slerp(out.joints[j], l.pose.joints[j], l.w[j]));
    const r = l.w.root; if (r > 0) { out.rootRot = slerp(out.rootRot, l.pose.rootRot, r); out.rootPos = out.rootPos.map((v, i) => v + (l.pose.rootPos[i] - v) * r) as BodyPose['rootPos']; }
    const k = Math.max(l.w.Arm_L, l.w.Arm_R); out.shrug += (l.pose.shrug - out.shrug) * k; out.protract += (l.pose.protract - out.protract) * k;
  }
  return out;
}
export const restBodyPose = (): BodyPose => ({ rootPos: [0, 0, 0], rootRot: QI(), joints: Object.fromEntries(JOINTS.map((j) => [j, QI()])) as Record<Joint, BodyPose['rootRot']>, shrug: 0, protract: 0 });
