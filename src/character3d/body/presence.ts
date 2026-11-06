/**
 * NEXUS presence — the unified motion director that makes the 3D robot feel physically present.
 *
 * It runs every frame next to the clip controller (controller.ts) and owns what clips cannot do:
 *   - BREATHING: an asymmetric breath cycle (shoulders, chest, a counter-nod), its rate drifting, an inhale in speech pauses
 *   - IDLE LIFE: weight shifts over one foot (the hips move, the feet stay — foot lock), shoulder settles, head
 *     repositioning, hand adjustments, all as smooth drift + occasional intentional events chosen without repeating
 *   - ATTENTION: eyes lead, the head follows, the torso joins for wide angles and the feet step round for wider ones;
 *     targets are the user, the visual NEXUS is presenting (IVES), the HOLOBUILD model/part — real screen positions
 *   - GESTURES: meaning-driven conversational gestures (gestures.ts) with preparation, a stroke timed to the voice's
 *     accents, hold, co-articulation into the next gesture or a relaxed retraction; pointing at real target positions
 *   - CONVERSATIONAL STATES: listening (attentive, nods on the user's pauses), thinking (gaze aversion), speaking and
 *     explaining (gestures, gaze shifts at sentence boundaries), waiting, and short REACTIONS (acknowledge, curious,
 *     surprise, discovery, correction, uncertain, interrupted)
 *   - LOCOMOTION (locomotion.ts): walking, stopping and turning on planted feet
 * Outputs are additive joint deltas, an absolute arm layer for gestures, the stage root transform and the foot
 * targets; apply.ts composes them with the channels and clip layers, and solves the legs last (footlock.ts).
 * Priorities: explicit clip actions (wave, clap, flips) > presence gestures > state clip loops > idle life; every hand-
 * over is weighted and spring-smoothed. Pure TypeScript and deterministic (seeded), so tests replay it exactly.
 */
import { add, clamp, D2R, QI, qeulerDeg, sub, type Q, type V3 } from './math';
import { twoBoneIK } from './ik';
import { shrugOffset, SKELETON, sgn, type Side } from './skeleton';
import { FORMS, planSentence, POINT, type GestureIntent } from './gestures';
import { Locomotion, type FootState } from './locomotion';
import { Cascade, Cascade3, SmoothNoise, Spring, Spring3 } from './noise';
import { pick, range, seeded, type Rng } from './rng';
import type { BodyState } from './clips';
import { clearMem, type ClearMem } from './frame';

export type ReactionKind = 'acknowledge' | 'curious' | 'surprise' | 'discovery' | 'correction' | 'uncertain' | 'interrupted';
export type TargetId = 'user' | 'visual' | 'holo';
export interface PresenceInput {
  state: BodyState;
  /** voice playing; smoothed loudness 0…1; accent strength this frame (fast − slow envelope) */
  speaking: boolean; speech: number; onset: number;
  reduced: boolean;
  /** weights (0…1) of clip layers that currently own those joints — presence yields to them */
  clipArms: number; clipHead: number; clipLegs: number; clipRoot: number;
  /** the 2D-style animation channels are moving an arm (a gesture without a 3D clip) */
  channelGesture: boolean;
}
export interface PresenceOut {
  root: { pos: V3; yaw: number };
  feet: Record<Side, FootState>;
  /** 0…1: how much the legs are solved by the foot lock (1 − clip legs) */
  lock: number;
  /** additive Euler deltas (radians) — already weighted against the clip layers */
  add: { body: V3; head: V3; arm: Record<Side, V3>; fore: Record<Side, V3>; hand: Record<Side, V3>; shrug: number };
  /** absolute arm layer (gestures, pointing): local rotations for Arm, Forearm, Hand and the weight per side */
  arms: Record<Side, { q: [Q, Q, Q]; w: number }>; protract: number;
  /** thumb opening per hand 0…1 */
  thumb: Record<Side, number>;
  /** eye direction in channel units and how much presence owns the eyes (0 = the engine's own gaze) */
  gaze: { x: number; y: number; own: number };
  /** brow lift (channel units, added) */
  brow: number;
  /** walking: the 2D walk channels (body slide, leg lifts) are replaced by real steps */
  suppressWalkChannels: boolean;
  /** the frame composition's collision memory (eases arm clearing in; dt of this frame) */
  mem: ClearMem;
  info: { gesture: string | null; attention: TargetId | 'aside'; reaction: string | null; walking: boolean; steps: number; breath: number; weight: number; /** how far (rad) the eyes are off the attention target */ aim: number };
}

const deg = (d: number) => d * D2R;
const HEAD: V3 = [0, SKELETON.hipHeight + SKELETON.head[1] + 0.5, 0];   // between the eyes (stage, at the origin)
// where a relaxed hand waits when the arm layer hands over (Body space): a little in front of the hip with the elbow
// softly bent — the IK is well-conditioned here (a fully hanging arm is at full reach, where the elbow flicks)
const rest = (s: Side): V3 => [sgn(s) * 0.7, 0.14, 0.14];
const VIA = (s: Side): V3 => [sgn(s) * 0.86, 0.34, 0.36];                // out and round the torso's front corner
const mirror = (v: V3, s: Side): V3 => (s === 'R' ? v : [-v[0], v[1], v[2]]);
const mirrorHand = (h: V3, s: Side): V3 => (s === 'R' ? h : [h[0], -h[1], -h[2]]);

/** per-state amplitude of the idle life and the eye behaviour */
const LIFE: Record<string, { breath: number; drift: number; events: [number, number] | null }> = {
  IDLE: { breath: 1, drift: 1, events: [4, 9] }, LISTENING: { breath: 0.85, drift: 0.45, events: [7, 13] }, THINKING: { breath: 0.8, drift: 0.6, events: [3, 6] },
  SPEAKING: { breath: 0.45, drift: 0.35, events: null }, EXPLAINING: { breath: 0.45, drift: 0.35, events: null },
};
const lifeOf = (s: BodyState) => LIFE[s] ?? { breath: 0.7, drift: 0.4, events: null };

interface Reaction { kind: ReactionKind; t: number; attack: number; hold: number; release: number; body: V3; head: V3; shrug: number; brow: number }
const REACTIONS: Record<ReactionKind, Omit<Reaction, 't' | 'kind'>> = {
  acknowledge: { attack: 0.18, hold: 0.08, release: 0.35, body: [0, 0, 0], head: [deg(7), 0, 0], shrug: 0, brow: 0.12 },
  curious: { attack: 0.45, hold: 1.1, release: 0.7, body: [deg(2.5), 0, 0], head: [deg(-2), 0, deg(8)], shrug: 0, brow: 0.3 },
  surprise: { attack: 0.12, hold: 0.45, release: 0.7, body: [deg(-2.5), 0, 0], head: [deg(-7), 0, 0], shrug: 0.45, brow: 0.6 },
  discovery: { attack: 0.3, hold: 0.7, release: 0.6, body: [deg(3), 0, 0], head: [deg(-4), 0, deg(3)], shrug: 0.1, brow: 0.45 },
  correction: { attack: 0.25, hold: 0.5, release: 0.5, body: [deg(-1), 0, 0], head: [deg(5), 0, deg(-5)], shrug: 0, brow: 0.2 },
  uncertain: { attack: 0.35, hold: 0.6, release: 0.6, body: [0, 0, 0], head: [deg(1), 0, deg(-7)], shrug: 0.35, brow: -0.1 },
  interrupted: { attack: 0.15, hold: 0.25, release: 0.5, body: [deg(-1.5), 0, 0], head: [deg(-3), 0, 0], shrug: 0.15, brow: 0.3 },
};
const env = (r: Reaction) => { const l = r.t; if (l < r.attack) { const x = l / r.attack; return x * x * (3 - 2 * x); } if (l < r.attack + r.hold) return 1; const x = Math.min(1, (l - r.attack - r.hold) / r.release); return 1 - x * x * (3 - 2 * x); };

type Phase = 'prep' | 'stroke' | 'hold' | 'retract' | 'rest';
interface ArmCtl {
  palm: Cascade3; hand: Cascade3; w: Cascade; thumb: Spring;
  phase: Phase; t: number; form: string | null; intensity: number; jitter: V3; strokeDue: number; point: boolean;
}

export class Presence {
  enabled = true;
  private rng: Rng;
  private t = 0;
  private loco = new Locomotion();
  /* breath */
  private breathPh = 0; private breathRate = 0.22; private breathAmp = new SmoothNoise(seeded(3), 0.03); private inhaleKick = 0; private quietFor = 0;
  /* idle drift */
  private noise: Record<string, SmoothNoise>;
  private hipX = new Cascade(0, 1.7); private hipTarget = 0;
  private headBias = new Cascade3([0, 0, 0], 2.2); private headBiasT: V3 = [0, 0, 0];
  private handBias: Record<Side, Cascade3> = { L: new Cascade3([0, 0, 0], 2.5), R: new Cascade3([0, 0, 0], 2.5) }; private handBiasT: Record<Side, V3> = { L: [0, 0, 0], R: [0, 0, 0] };
  private shoulderSettle = 0;
  private kickC = new Cascade(0, 5); private lifeB = new Cascade(1, 2.5); private lifeD = new Cascade(1, 2.5); private chanK = new Cascade(0, 6);
  private nextEvent = 3; private lastEvents: string[] = [];
  /* attention */
  private targets: Partial<Record<TargetId, V3>> = { user: [0, 2.3, 10] };
  private focus: TargetId | 'aside' = 'user'; private focusUntil = 0; private aside: V3 = [0, 2.6, 6];
  private eye = new Spring3([0, 0, 0], 22); private head = new Cascade3([0, 0, 0], 6); private torso = new Cascade(0, 3); private saccade: [number, number] = [0, 0]; private nextSaccade = 1;
  private lastTurnReq = 0;
  /* gestures */
  private arm: Record<Side, ArmCtl>;
  private plan: (GestureIntent & { time: number; used?: boolean })[] = []; private sentenceStart = 0; private sentenceDur = 0; private lastHand: 'L' | 'R' = 'R'; private recent: string[] = [];
  private lastStroke = -10; private noSentenceSince = 0; private fastRetract = false;
  private visualFresh = false;
  /* reactions, brow, listening */
  private reactions: Reaction[] = []; private brow = new Spring(0, 8); private browPulse = 0;
  private userActiveAt = -10; private lastNod = -10; private userPending = false; /** after an interruption NEXUS keeps its eyes on the user */ private userHold = -10; private presentPending: TargetId | null = null; private presentAt = -10;
  private prevState: BodyState = 'IDLE';
  /* walking */
  private route: { x: number; z: number; face?: number; pause?: number }[] = []; private routePause = 0; private walkSkill = false; private home = { x: 0, z: 0 }; private idleSince = 0;
  log: string[] = [];
  private mem = clearMem();

  constructor(seed = 7) {
    this.rng = seeded(seed);
    const r = this.rng;
    this.noise = { hy: new SmoothNoise(r, 0.09), hp: new SmoothNoise(r, 0.11), hr: new SmoothNoise(r, 0.07), by: new SmoothNoise(r, 0.05), bp: new SmoothNoise(r, 0.06), br: new SmoothNoise(r, 0.045),
      aL: new SmoothNoise(r, 0.08), aR: new SmoothNoise(r, 0.075), fL: new SmoothNoise(r, 0.1), fR: new SmoothNoise(r, 0.095), wL: new SmoothNoise(r, 0.13), wR: new SmoothNoise(r, 0.12) };
    const mk = (s: Side): ArmCtl => ({ palm: new Cascade3(rest(s), 7), hand: new Cascade3([0, 0, 0], 7), w: new Cascade(0, 8), thumb: new Spring(0.2, 6), phase: 'rest', t: 0, form: null, intensity: 1, jitter: [0, 0, 0], strokeDue: 0, point: false });
    this.arm = { L: mk('L'), R: mk('R') };
  }

  /* ------------------------------------------------------------ events from the app */
  /** a stage position (Body_Root parent space, metres) for a target, or null when it is gone */
  setTarget(id: TargetId, p: V3 | null) {
    if (p) { const had = !!this.targets[id]; this.targets[id] = p; if (!had && id !== 'user') { this.visualFresh = true; this.log.push(`target:${id}`); } }
    else if (id !== 'user') { delete this.targets[id]; if (this.focus === id) this.focus = 'user'; }
  }
  hasTarget(id: TargetId) { return !!this.targets[id]; }
  /** present this target with the next sentence once it is on screen (a visual still loading) */
  presentWhenSeen(id: TargetId) { this.presentPending = id; this.presentAt = this.t; }
  /** what NEXUS is looking at now */
  attending(): TargetId | 'aside' { return this.focus; }
  /** look at (and, while speaking, present) a target now — e.g. a new visual or a selected HOLOBUILD part */
  attend(id: TargetId, seconds = 2.2, present = false) {
    if (!this.targets[id]) return false;
    this.focus = id; this.focusUntil = this.t + seconds;
    if (id !== 'user') { if (present) { this.startGesture(this.sideOf(id), 'present', 1, true); this.presentPending = null; } else { this.presentPending = id; this.presentAt = this.t; } }
    return true;
  }
  /** a sentence starts playing: plan its gestures (meaning) and where NEXUS looks */
  sentence(text: string, durationSec?: number) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    this.sentenceStart = this.t; this.sentenceDur = durationSec && durationSec > 0.3 ? durationSec : Math.max(0.8, words * 0.36);
    const vis = this.visibleTarget();
    const state = this.prevState === 'EXPLAINING' ? 'explaining' : 'speaking';
    const intents = planSentence(text, { state, visual: !!vis, lastHand: this.lastHand, recent: this.recent, visualSide: vis ? this.sideOf(vis) : null }, this.rng);
    this.plan = intents.map((g) => ({ ...g, time: this.sentenceStart + 0.25 + g.at * this.sentenceDur * 0.85 }));
    this.noSentenceSince = this.t;
    // gaze at sentence starts: a short look aside while formulating (people avert gaze when they begin), then the
    // listener; with a visual on screen the first sentence (and any that refer to it) look at it
    // a visual that appeared before the voice started (the reply is still being prepared): present it with the first sentence
    const pend = this.t - this.presentAt < 10 ? this.presentPending : null; this.presentPending = null;
    if (pend && this.targets[pend] && !intents.some((g) => g.point)) { this.focus = pend; this.focusUntil = this.t + Math.min(2.6, this.sentenceDur * 0.7); this.visualFresh = false; const side = this.sideOf(pend); this.startGesture(side, 'present', 1, true); this.plan = this.plan.filter((g) => g.hand !== side && g.hand !== 'both'); }
    else if (vis && (this.visualFresh || intents.some((g) => g.point))) { this.focus = vis; this.focusUntil = this.t + Math.min(2.6, this.sentenceDur * 0.7); this.visualFresh = false; }
    else if (vis && this.rng() < 0.35) { this.focus = vis; this.focusUntil = this.t + Math.min(1.8, this.sentenceDur * 0.5); }
    else if (words > 6 && this.rng() < 0.3) { this.lookAside(range(this.rng, 0.5, 0.9)); }
    else this.focus = 'user';
    this.log.push(`sentence:${intents.map((g) => g.form).join(',') || '-'}`); if (this.log.length > 80) this.log.splice(0, 20);
  }
  /** look at a point on the screen (normalized −1…1, like the engine's gaze — e.g. the chat box while the user types) */
  lookScreen(x: number, y: number, seconds = 0.6) { if (this.t < this.userHold) return; this.aside = [clamp(x, -1, 1) * 2.4, 2.4 - clamp(y, -1, 1) * 1.4, 5]; this.focus = 'aside'; this.focusUntil = this.t + seconds; }
  /** the user is talking (interim transcript grew): NEXUS nods on the user's pauses */
  userActivity() { this.userActiveAt = this.t; this.userPending = true; }
  react(kind: ReactionKind) {
    if (!this.enabled) return;
    if (kind === 'interrupted') this.interrupt();
    this.reactions = this.reactions.filter((r) => r.kind !== kind).slice(-2);
    this.reactions.push({ kind, t: 0, ...REACTIONS[kind] }); this.browPulse = REACTIONS[kind].brow;
    this.log.push(`react:${kind}`);
  }
  /** stop gesturing now and attend the user (speech cut off, emergency stop) */
  interrupt() {
    this.plan = []; this.fastRetract = true;
    for (const s of ['L', 'R'] as const) { const a = this.arm[s]; if (a.phase !== 'rest') { a.phase = 'retract'; a.t = 0; } }
    this.focus = 'user'; this.focusUntil = 0; this.userHold = this.t + 1.8;
  }
  /* walking */
  walkTo(x: number, z: number, face?: number) { this.route = [{ x, z, face }]; this.routePause = 0; }
  walkRoute(r: { x: number; z: number; face?: number; pause?: number }[]) { this.route = [...r]; this.routePause = 0; }
  turnTo(yaw: number) { this.loco.turnTo(yaw); }
  /** the engine's 2D "walk across" became a real walk: over to the side and back */
  startWalkSkill() { this.walkSkill = true; this.walkRoute([{ x: -0.75, z: 0.15, pause: 0.3 }, { x: 0, z: 0, face: 0 }]); }
  endWalkSkill(completed: boolean) { this.walkSkill = false; if (!completed) { this.route = []; this.loco.stop(); } }
  busy() { return this.loco.busy() || this.route.length > 0 || this.reactions.length > 0 || (['L', 'R'] as const).some((s) => this.arm[s].phase !== 'rest' || this.arm[s].w.x > 0.01); }
  stageRoot() { return { x: this.loco.x, z: this.loco.z, yaw: this.loco.yaw }; }

  private visibleTarget(): TargetId | null { return this.targets.visual ? 'visual' : this.targets.holo ? 'holo' : null; }
  /** which arm reaches a target: the one on its side (the target's x in the robot's frame) */
  private sideOf(id: TargetId): Side { const p = this.targets[id]; if (!p) return 'L'; const y = this.loco.yaw; const lx = (p[0] - this.loco.x) * Math.cos(y) - (p[2] - this.loco.z) * Math.sin(y); return lx >= 0 ? 'L' : 'R'; }
  private lookAside(seconds: number, up = false) { if (this.t < this.userHold) return; const s = this.rng() < 0.5 ? -1 : 1; this.aside = [s * range(this.rng, 1.2, 2.4), up ? range(this.rng, 3.8, 4.8) : range(this.rng, 2.5, 3.4), 5]; this.focus = 'aside'; this.focusUntil = this.t + seconds; }

  /* ------------------------------------------------------------ gestures */
  private startGesture(s: Side | 'both', form: string, intensity: number, point = false, strokeIn = 0.42) {
    if (this.t < this.userHold - 0.6) return;            // just interrupted: the hands stay down for a moment
    this.fastRetract = false;
    this.log.push(`gesture:${form}${point ? ':aimed' : ''}`);
    const sides: Side[] = s === 'both' ? ['L', 'R'] : [s];
    for (const side of sides) {
      const a = this.arm[side];
      a.form = form; a.intensity = intensity; a.point = point; a.phase = 'prep'; a.t = 0; a.strokeDue = strokeIn;
      a.jitter = [range(this.rng, -0.025, 0.025), range(this.rng, -0.03, 0.03), range(this.rng, -0.02, 0.02)];
    }
    if (s !== 'both') this.lastHand = s;
    this.recent.push(form); if (this.recent.length > 6) this.recent.shift();
  }
  /** the palm target for a form or a pointing target (Body space; the body's own yaw is undone so it reaches the target) */
  private formTarget(a: ArmCtl, s: Side, bodyYaw: number): { at: V3; hand: V3; thumb: number; pole?: V3 } {
    if (a.point) {
      const id = this.visibleTarget(); const p = id ? this.targets[id] : null;
      if (p) {
        const y = this.loco.yaw + bodyYaw; const dx = p[0] - this.loco.x, dz = p[2] - this.loco.z;
        const lx = dx * Math.cos(y) - dz * Math.sin(y), lz = dx * Math.sin(y) + dz * Math.cos(y), ly = p[1] - SKELETON.hipHeight;
        const sh = SKELETON.shoulder(s); let d = sub([lx, ly, lz], sh); const L = Math.hypot(...d) || 1; d = [d[0] / L, d[1] / L, d[2] / L];
        // keep the arm out of the body: never across the chest, not below the waist, a little forward
        d = [s === 'L' ? Math.max(0.35, d[0]) : Math.min(-0.35, d[0]), clamp(d[1], -0.25, 0.55), Math.max(0.35, d[2])];
        const n = Math.hypot(...d); const at = add(sh, [d[0] / n * POINT.reach, d[1] / n * POINT.reach, d[2] / n * POINT.reach]);
        return { at, hand: POINT.hand, thumb: POINT.thumb };
      }
    }
    const f = FORMS[a.form ?? 'beat'] ?? FORMS.beat;
    return { at: add(mirror(f.at, s), a.jitter), hand: mirrorHand(f.hand, s), thumb: f.thumb, pole: f.pole ? mirror(f.pole, s) : undefined };
  }
  private stepArm(s: Side, dt: number, onset: number, free: number, bodyYaw: number): { q: [Q, Q, Q]; w: number; thumb: number } {
    const a = this.arm[s]; a.t += dt;
    const ft = this.formTarget(a, s, bodyYaw); const f = FORMS[a.form ?? 'beat'] ?? FORMS.beat;
    let target: V3 = rest(s); let handT: V3 = [0, 0, 0]; let w = 0; let freq = 6; let thumb = 0.2;
    switch (a.phase) {
      case 'prep': {
        target = ft.at; handT = ft.hand; w = 1; freq = 7.5; thumb = ft.thumb;
        // stroke on the next voice accent once the hand is nearly there — or on time if no accent comes
        const ready = a.t > 0.28; const accent = onset > 0.05 && a.t > a.strokeDue - 0.15;
        if (ready && (accent || a.t > a.strokeDue + 0.3)) { a.phase = 'stroke'; a.t = 0; this.lastStroke = this.t; this.browPulse = Math.max(this.browPulse, (f.brow ?? 0) * a.intensity); }
        break;
      }
      case 'stroke': {
        const k = a.point ? 0.4 : a.intensity;
        target = add(ft.at, [f.stroke[0] * (s === 'L' ? -1 : 1) * k, f.stroke[1] * k, f.stroke[2] * k]); handT = ft.hand; w = 1; freq = 15; thumb = ft.thumb;
        if (a.t > 0.2) { a.phase = 'hold'; a.t = 0; }
        break;
      }
      case 'hold': {
        target = add(ft.at, [f.stroke[0] * (s === 'L' ? -1 : 1) * 0.5, f.stroke[1] * 0.5, f.stroke[2] * 0.5]); handT = ft.hand; w = 1; freq = 6; thumb = ft.thumb;
        if (a.t > (a.point ? 1.2 : 0.35)) {
          // co-articulation: another gesture for this hand soon → stay up; otherwise retract and relax
          const next = this.plan.find((g) => !g.used && (g.hand === s || g.hand === 'both') && g.time - this.t < 1.1);
          if (!next) { a.phase = 'retract'; a.t = 0; }
        }
        break;
      }
      case 'retract': {
        const p = a.palm.x; const near = Math.hypot(p[0] - rest(s)[0], p[1] - rest(s)[1], p[2] - rest(s)[2]);
        // back the way it came: out round the torso corner, then down to the side
        target = p[2] > 0.3 && Math.abs(p[0]) < 0.8 ? VIA(s) : rest(s); freq = this.fastRetract ? 9 : 5.5; thumb = 0.2;
        w = clamp(near / (this.fastRetract ? 0.5 : 0.3), 0, 1);
        if (near < 0.04 || a.t > (this.fastRetract ? 1 : 2.2)) { a.phase = 'rest'; a.form = null; a.point = false; }
        break;
      }
      case 'rest': default: { target = rest(s); w = 0; freq = 6; thumb = 0.2; }
    }
    // from the side, go out round the torso's front corner first (never through it)
    const p = a.palm.x; if (a.phase === 'prep' && p[2] < 0.28 && target[2] > 0.3 && Math.abs(p[0]) < 0.9) target = VIA(s);
    const palm = a.palm.step(target, dt, freq); const hand = a.hand.step(handT, dt, freq);
    const weight = a.w.step(w * free, dt, a.phase === 'retract' ? (this.fastRetract ? 10 : 6) : 9);
    const th = a.thumb.step(thumb, dt, 7);
    const shoulder = add(SKELETON.shoulder(s), shrugOffset(0, 0).arm);
    const pole: V3 = ft.pole ?? [sgn(s) * 0.6, -1, -0.3];
    const ik = twoBoneIK(shoulder, palm, SKELETON.upperArm, SKELETON.forearm + SKELETON.palm.offset, pole, 'x', QI(), -1);
    return { q: [ik.upper, ik.lower, qeulerDeg(hand)], w: clamp(weight, 0, 1), thumb: th };
  }
  /** start planned strokes when their time comes (gesture preparation begins ~0.45 s before the stroke) */
  private schedule() {
    for (const g of this.plan) {
      if (g.used || this.t < g.time - 0.45) continue;
      g.used = true;
      const side: Side | 'both' = g.hand === 'both' ? 'both' : g.hand;
      this.startGesture(side, g.form, g.intensity, !!g.point, 0.45);
    }
  }

  /* ------------------------------------------------------------ idle events */
  private idleEvent(state: BodyState) {
    const opts = state === 'THINKING' ? ['aside', 'head', 'weight'] : state === 'LISTENING' ? ['head', 'weight', 'hand'] : ['weight', 'head', 'hand', 'shoulders', 'glance', 'weight'];
    let e = pick(this.rng, opts); if (this.lastEvents.slice(-2).includes(e)) e = pick(this.rng, opts.filter((x) => !this.lastEvents.slice(-2).includes(x))) ?? e;
    this.lastEvents.push(e); if (this.lastEvents.length > 6) this.lastEvents.shift();
    switch (e) {
      case 'weight': { const cur = Math.sign(this.hipTarget); const opts2 = [-1, 0, 1].filter((x) => x !== cur); this.hipTarget = pick(this.rng, opts2) * range(this.rng, 0.018, 0.032); break; }
      case 'head': this.headBiasT = [deg(range(this.rng, -3, 3)), deg(range(this.rng, -5, 5)), deg(range(this.rng, -4, 4))]; break;
      case 'hand': { const s: Side = this.rng() < 0.5 ? 'L' : 'R'; this.handBiasT[s] = [deg(range(this.rng, -6, 4)), deg(range(this.rng, -8, 8)), deg(range(this.rng, -6, 6))]; break; }
      case 'shoulders': this.shoulderSettle = 1; break;
      case 'glance': if (this.focus === 'user') this.lookAside(range(this.rng, 0.7, 1.4)); break;
      case 'aside': this.lookAside(range(this.rng, 1.4, 2.6), true); break;
    }
    this.log.push(`idle:${e}`); if (this.log.length > 80) this.log.splice(0, 20);
  }

  /* ------------------------------------------------------------ frame */
  /** a slow frame (a busy laptop, power saving) is split into ≤50 ms steps so time keeps real pace and the springs,
   *  gestures and steps stay stable; only the last step's output is rendered */
  update(dtIn: number, inp: PresenceInput): PresenceOut {
    let left = clamp(dtIn, 0, 0.25);
    while (left > 0.05 + 1e-9) { this.frame(0.05, inp); left -= 0.05; }
    return this.frame(left, inp);
  }
  private frame(dt: number, inp: PresenceInput): PresenceOut {
    this.t += dt;
    const st = inp.state; const amp = this.enabled && !inp.reduced ? 1 : 0;
    if (st !== this.prevState) this.onStateChange(this.prevState, st);
    this.prevState = st;
    // state-dependent amplitudes change gradually (a state switch never jolts the idle life)
    const L0 = lifeOf(st);
    const life = { breath: this.lifeB.step(L0.breath * (inp.speaking ? 0.6 : 1), dt), drift: this.lifeD.step(L0.drift, dt), events: L0.events };
    const chan = this.chanK.step(inp.channelGesture ? 1 : 0, dt);

    // ---------- locomotion: routes, homing after an interrupted walk
    if (!amp) this.route = [];
    if (this.route.length && !this.loco.busy()) {
      if (this.routePause > 0) this.routePause -= dt;
      else { const r = this.route.shift()!; this.loco.walkTo(r.x, r.z, r.face); this.routePause = r.pause ?? 0; }
    }
    const idleish = st === 'IDLE' || st === 'LISTENING';
    this.idleSince = idleish && !this.loco.busy() && !this.route.length ? this.idleSince + dt : 0;
    if (this.idleSince > 2 && Math.hypot(this.loco.x - this.home.x, this.loco.z - this.home.z) > 0.08) { this.walkTo(this.home.x, this.home.z, 0); this.idleSince = 0; }
    else if (this.idleSince > 2 && !this.loco.busy() && Math.abs(this.loco.yaw) > deg(8) && this.focus === 'user') { this.loco.turnTo(0); this.idleSince = 0; }
    const lo = amp ? this.loco.update(dt) : this.loco.update(0);

    // ---------- breathing: rate drifts, an inhale after speech pauses, smaller while talking
    const pauseNow = inp.speaking && inp.speech < 0.05; this.quietFor = pauseNow ? this.quietFor + dt : 0;
    if (inp.speaking && this.quietFor > 0.22 && this.quietFor - dt <= 0.22) this.inhaleKick = 1;      // a breath in each pause
    this.inhaleKick = Math.max(0, this.inhaleKick - dt * 1.6);
    const rateT = st === 'THINKING' ? 0.19 : st === 'LISTENING' ? 0.24 : inp.speaking ? 0.28 : 0.22;
    this.breathRate += (rateT * (1 + 0.1 * this.breathAmp.step(dt)) - this.breathRate) * (1 - Math.exp(-dt * 0.5));
    this.breathPh += dt * this.breathRate * Math.PI * 2;
    // asymmetric: a quicker inhale, a longer exhale (0 = empty, 1 = full)
    const ph = this.breathPh % (Math.PI * 2); const inh = ph < Math.PI * 0.8 ? Math.sin((ph / (Math.PI * 0.8)) * Math.PI / 2) : Math.cos(((ph - Math.PI * 0.8) / (Math.PI * 1.2)) * Math.PI / 2);
    const kick = this.kickC.step(this.inhaleKick, dt);
    const breath = clamp((inh * inh) * life.breath + kick * 0.5, 0, 1.2) * amp;

    // ---------- idle drift and events
    const dr = life.drift * amp; const N = (k: string) => this.noise[k].step(dt);
    const hy = N('hy') * deg(1.4) * dr, hp = N('hp') * deg(1.1) * dr, hr = N('hr') * deg(1.2) * dr;
    const by = N('by') * deg(0.8) * dr, bp = N('bp') * deg(0.35) * dr, br = N('br') * deg(0.3) * dr;
    const aw: Record<Side, V3> = { L: [N('aL') * deg(1.8) * dr, 0, N('aR') * deg(0.8) * dr], R: [N('aR') * deg(1.8) * dr, 0, -N('aL') * deg(0.8) * dr] };
    const fw: Record<Side, number> = { L: N('fL') * deg(2.5) * dr, R: N('fR') * deg(2.5) * dr };
    const ww: Record<Side, number> = { L: N('wL') * deg(4) * dr, R: N('wR') * deg(4) * dr };
    if (life.events && amp && !inp.speaking && !lo.moving) { this.nextEvent -= dt; if (this.nextEvent <= 0) { this.idleEvent(st); this.nextEvent = range(this.rng, life.events[0], life.events[1]); } }
    if (st === 'SPEAKING' || st === 'EXPLAINING' || lo.moving || inp.clipLegs > 0.1) this.hipTarget = 0;
    const hipX = this.hipX.step(this.hipTarget * amp, dt);
    const hb = this.headBias.step(st === 'IDLE' || st === 'THINKING' ? this.headBiasT : [0, 0, 0], dt);
    this.shoulderSettle = Math.max(0, this.shoulderSettle - dt * 0.9);
    const settle = Math.sin(Math.PI * (1 - this.shoulderSettle)) ** 2 * (this.shoulderSettle > 0 ? 1 : 0) * 0.35;

    // ---------- listening: nod on the user's pauses (not while they are mid-word)
    if (st === 'LISTENING' && this.userPending && this.t - this.userActiveAt > 0.55 && this.t - this.lastNod > 2.2) {
      this.userPending = false; if (this.rng() < 0.7 || this.t - this.lastNod > 6) { this.react('acknowledge'); this.lastNod = this.t; }
    }

    // ---------- attention: choose the target, then eyes → head → torso → feet
    const pointing = this.arm.L.point || this.arm.R.point;
    if (this.focus !== 'user' && this.t > this.focusUntil && !(pointing && this.focus !== 'aside')) this.focus = 'user';
    if (st === 'THINKING' && this.focus === 'user' && this.t > this.focusUntil + 0.6) this.lookAside(range(this.rng, 1.5, 2.8), true);
    let tp: V3 = this.focus === 'aside' ? this.aside : this.targets[this.focus] ?? this.targets.user!;
    if (this.focus !== 'aside' && !this.targets[this.focus]) { this.focus = 'user'; tp = this.targets.user!; }
    const hx = HEAD[0] + lo.root.x, hz = HEAD[2] + lo.root.z;
    const dx = tp[0] - hx, dy = tp[1] - HEAD[1], dz = tp[2] - hz;
    let yaw = Math.atan2(dx, dz) - lo.root.yaw; while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
    const pitch = Math.atan2(-dy, Math.hypot(dx, dz));
    // micro-saccades while looking at someone: attentive, not a fixed stare
    this.nextSaccade -= dt; if (this.nextSaccade <= 0) { this.nextSaccade = range(this.rng, 0.5, 1.6); this.saccade = [range(this.rng, -1, 1) * deg(1.6), range(this.rng, -1, 1) * deg(1.1)]; }
    const sac = this.focus === 'user' ? this.saccade : [0, 0];
    const headYawT = clamp(yaw * 0.78, deg(-34), deg(34)), headPitchT = clamp(pitch * 0.62, deg(-13), deg(19));
    const torsoT = clamp((yaw - headYawT) * 0.9 + (Math.abs(yaw) > deg(25) ? yaw * 0.12 : 0), deg(-24), deg(24));
    // a target further round than head + torso can follow: turn on the feet (step round)
    if (amp && Math.abs(yaw) > deg(58) && this.t - this.lastTurnReq > 1.5 && !this.route.length && !lo.moving) { this.loco.turnTo(lo.root.yaw + yaw * 0.7); this.lastTurnReq = this.t; }
    const e = this.eye.step([clamp(yaw - this.head.x[0] - this.torso.x, deg(-20), deg(20)) + sac[0], clamp(pitch - this.head.x[1], deg(-16), deg(16)) + sac[1], 0], dt);
    const head = this.head.step([headYawT, headPitchT, 0], dt, this.focus === 'aside' ? 4 : 6);
    const torso = this.torso.step(torsoT, dt);
    const att = amp;

    // ---------- gestures (speech-driven), pointing, retraction
    if (inp.speaking) this.schedule();
    else if (this.plan.length && !inp.speaking && this.t - this.noSentenceSince > 3) this.plan = [];
    // a voice without sentence information (e.g. a reaction line): an occasional beat on a strong accent
    if (inp.speaking && !this.plan.length && this.t - this.noSentenceSince > 4 && inp.onset > 0.12 && this.t - this.lastStroke > 2.5 && this.rng() < 0.25 && this.arm.L.phase === 'rest' && this.arm.R.phase === 'rest') {
      this.startGesture(this.lastHand === 'L' ? 'R' : 'L', 'beat', 0.8, false, 0.3);
    }
    if (!inp.speaking && !this.arm.L.point && !this.arm.R.point) for (const s of ['L', 'R'] as const) { const a = this.arm[s]; if (a.phase === 'hold' && a.t > 0.5) { a.phase = 'retract'; a.t = 0; } }
    const free = clamp(1 - inp.clipArms, 0, 1) * (1 - chan) * amp;
    const armL = this.stepArm('L', dt, inp.onset, free, torso), armR = this.stepArm('R', dt, inp.onset, free, torso);

    // ---------- reactions and brows
    let rb: V3 = [0, 0, 0], rh: V3 = [0, 0, 0], rs = 0;
    for (const r of this.reactions) { r.t += dt; const k = env(r) * amp; rb = add(rb, [r.body[0] * k, r.body[1] * k, r.body[2] * k]); rh = add(rh, [r.head[0] * k, r.head[1] * k, r.head[2] * k]); rs += r.shrug * k; }
    this.reactions = this.reactions.filter((r) => r.t < r.attack + r.hold + r.release);
    this.browPulse = Math.max(0, this.browPulse - dt * 0.8);
    const browQ = (st === 'LISTENING' ? 0.08 : 0) + this.browPulse;
    const brow = this.brow.step(browQ * amp, dt);

    // ---------- compose: idle life + attention + gait + reactions, weighted against the clip layers
    const headFree = 1 - inp.clipHead * (inp.clipRoot > 0.05 ? 1 : 0.6), bodyFree = 1 - inp.clipRoot, armFree = clamp(1 - inp.clipArms, 0, 1) * (1 - chan * 0.7);
    const weightRoll = hipX * 0.55;
    const addBody: V3 = [(bp - breath * deg(0.6) + rb[0]) * bodyFree, (by + torso * att + lo.hipYaw + hipX * 0.6) * bodyFree, (br + weightRoll + rb[2]) * bodyFree];
    const addHead: V3 = [(hp + hb[0] + breath * deg(0.45) + head[1] * att + rh[0] - addBody[0] * 0.5) * headFree, (hy + hb[1] + head[0] * att - lo.hipYaw * 0.8) * headFree, (hr + hb[2] - weightRoll * 0.8 + rh[2]) * headFree];
    const armAdd = (s: Side): V3 => { this.handBias[s].step(this.handBiasT[s], dt); return [(aw[s][0] - (s === 'L' ? lo.armSwing.L : lo.armSwing.R)) * armFree, 0, (aw[s][2] + sgn(s) * breath * deg(0.9) + sgn(s) * settle * deg(1.5)) * armFree]; };
    const handB = (s: Side): V3 => { const b = this.handBias[s].x; return [(b[0] + ww[s] * 0.5) * armFree, (b[1] + ww[s]) * armFree, b[2] * armFree]; };
    const out: PresenceOut = {
      root: { pos: [lo.root.x + Math.cos(lo.root.yaw) * hipX, lo.root.y, lo.root.z - Math.sin(lo.root.yaw) * hipX], yaw: lo.root.yaw },
      feet: lo.feet, lock: clamp(1 - inp.clipLegs, 0, 1),
      add: { body: addBody, head: addHead, arm: { L: armAdd('L'), R: armAdd('R') }, fore: { L: [-Math.abs(fw.L) * armFree, 0, 0], R: [-Math.abs(fw.R) * armFree, 0, 0] }, hand: { L: handB('L'), R: handB('R') }, shrug: (breath * 0.12 + settle + rs) * bodyFree },
      arms: { L: { q: armL.q, w: armL.w }, R: { q: armR.q, w: armR.w } }, protract: Math.max(armL.w, armR.w) * 0.25,
      thumb: { L: armL.w > 0.01 ? armL.thumb : 0.2, R: armR.w > 0.01 ? armR.thumb : 0.2 },
      gaze: { x: clamp(e[0] / deg(30), -0.75, 0.75), y: clamp(e[1] / deg(22), -0.6, 0.6), own: amp ? 1 : 0 },
      brow,
      suppressWalkChannels: this.walkSkill || lo.moving,
      mem: Object.assign(this.mem, { dt }),
      info: { gesture: this.arm.R.form ?? this.arm.L.form, attention: this.focus, reaction: this.reactions[this.reactions.length - 1]?.kind ?? null, walking: lo.moving, steps: this.loco.steps, breath, weight: hipX, aim: Math.hypot(yaw - head[0] - torso - e[0], pitch - head[1] - e[1]) },
    };
    return out;
  }

  private onStateChange(prev: BodyState, next: BodyState) {
    this.log.push(`state:${prev}>${next}`);
    if (next === 'THINKING') { this.lookAside(range(this.rng, 1.2, 2), true); }
    if (next === 'LISTENING' || next === 'SPEAKING' || next === 'EXPLAINING') { if (this.focus === 'aside') this.focus = 'user'; }
    if (prev === 'SPEAKING' || prev === 'EXPLAINING') { this.plan = []; }
    if (next === 'SURPRISED') this.react('surprise');
    if (next === 'CURIOUS') this.react('curious');
    if (next === 'CONFUSED') this.react('uncertain');
  }
}
