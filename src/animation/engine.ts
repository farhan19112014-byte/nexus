/**
 * Assets 21–30 — the central animation engine. It is the ONLY writer of channel values.
 *
 * Per frame (deterministic for a given dt sequence):
 *   rest → pose base (Asset 05) → expression face targets (Asset 20) → idle breathing (21)
 *   → skill actions arbitrated by channel GROUP and priority (29) → gaze (23) → blink (22)
 *   → speech mouth (33) → clamp to range → per-channel speed limit → output
 *
 * Exclusive control: an action owns the groups its tracks touch. A new action overlapping a running
 * one interrupts it (if its priority ≥), queues behind it (lower priority), or is rejected — never a
 * silent overwrite. Different groups (e.g. face cue + arm wave + head nod) run simultaneously.
 *
 * Recovery (30): watchdog ends actions that outlive their scheduled time, queue/active limits,
 * stopAll() fades everything to the pose, reset() also returns the body home.
 */
import { CHANNELS, CHANNEL_NAMES, clampChannel, groupOf, restPose, type Channel, type ChannelGroup, type ChannelValues } from '../../shared/channels';
import type { Keyframe, Pose, SkillDef } from '../../shared/schema';
import { localTime, prepareTracks, sampleKeys, totalDuration } from './timeline';
import { POSE_LIBRARY } from '../character/poses';

export type ActionResult = 'completed' | 'interrupted' | 'cancelled' | 'rejected' | 'stuck';
export type ConflictPolicy = 'auto' | 'interrupt' | 'queue' | 'reject';

export interface PlayOptions {
  speed?: number; amplitude?: number; repetitions?: number; side?: 'left' | 'right';
  conflict?: ConflictPolicy; tag?: string; preview?: boolean;
}
export interface ActionHandle { id: number; skillId: string; readonly status: 'queued' | 'running' | 'fading' | 'done'; done: Promise<ActionResult>; cancel(): void }

export interface EngineEvents {
  start: { id: number; skillId: string; preview: boolean };
  end: { id: number; skillId: string; result: ActionResult; preview: boolean };
  queued: { id: number; skillId: string; blockedBy: string[] };
  recovered: { id: number; skillId: string; reason: string };
}

type Phase = 'queued' | 'in' | 'run' | 'hold' | 'out' | 'done';
export const ENGINE_LIMITS = { maxActive: 8, maxQueue: 12, watchdogGraceS: 3 };

class Action implements ActionHandle {
  phase: Phase = 'queued'; time = 0; weight = 0; outRate = 3; result: ActionResult = 'completed'; resolved = false;
  resolve!: (r: ActionResult) => void; done: Promise<ActionResult>;
  tracks: { channel: Channel; keys: Keyframe[] }[]; groups: Set<ChannelGroup>; total: number; wall = 0; budget = Infinity;
  constructor(public id: number, public skill: SkillDef, public speed: number, amplitude: number, public reps: number,
    public tag: string | undefined, public preview: boolean, mirrored: boolean, private onCancel: (a: Action) => void) {
    this.done = new Promise((r) => (this.resolve = r));
    this.tracks = prepareTracks(skill.tracks, amplitude, mirrored);
    this.groups = new Set(this.tracks.map((t) => groupOf(t.channel)));
    this.total = totalDuration(skill, reps);
  }
  get skillId() { return this.skill.id; }
  get priority() { return this.skill.priority; }
  get status() { return this.phase === 'queued' ? 'queued' as const : this.phase === 'out' ? 'fading' as const : this.phase === 'done' ? 'done' as const : 'running' as const; }
  cancel() { this.onCancel(this); }
}

export interface FaceSource { targets(): ChannelValues; headOffset(): { rot: number; nod: number; y: number } }
export interface Rng { (): number }

/** mulberry32 — seeded RNG so blinking/idle are reproducible in tests. */
export function seeded(seed: number): Rng {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class AnimationEngine {
  readonly values: Record<Channel, number> = restPose();
  private target: Record<Channel, number> = restPose();
  private poseCur: Record<Channel, number> = restPose();
  private pose: Pose = 'neutral';
  private actions: Action[] = [];
  private queue: Action[] = [];
  private nextId = 1;
  clock = 0;
  private listeners: { [K in keyof EngineEvents]?: Set<(e: EngineEvents[K]) => void> } = {};
  private face: FaceSource | null = null;
  // procedural sub-controllers
  private blink = { t: 0, next: 2.5, phase: 0, double: false };
  blinkRate = 1;
  private gaze = { x: 0, y: 0, tx: 0, ty: 0, mode: 'user' as 'user' | 'chat' | 'center' | 'idle', idleNext: 1.5 };
  private speech = { active: false, open: 0, round: 0, pulse: 0, levelMode: false, level: 0 };

  /** user preferences / accessibility */
  intensity = 1;           // Asset 57 animation intensity (0.3..1.3)
  reducedMotion = false;   // Asset 88
  idleEnabled = true;
  /** fastest normalized channel speed in the last frame (range units per second) */
  motion = 1;
  /**
   * True when nothing visible is happening except slow breathing: no actions, no speech, no blink due, gaze settled.
   * The render loop then drops to a low frame rate to save battery; it returns to full rate the moment this turns false.
   */
  isCalm(): boolean {
    return this.motion < 0.3 && !this.speech.active && this.queue.length === 0 && this.active().length === 0 && this.blink.phase === 0 && this.blink.next > 0.3;
  }
  /** Idle 'life' amount: 0.5 calm, 1 normal, 1.6 lively (Settings → Personalization). */
  idleScale = 1;
  /** Animate the mouth while speech plays (Settings → Voice). */
  speechMouth = true;
  speedScale = 1;
  rateLimit = true;

  constructor(private rng: Rng = Math.random) { this.setPose('neutral', true); }

  /* ---------- events ---------- */
  on<K extends keyof EngineEvents>(k: K, fn: (e: EngineEvents[K]) => void) {
    const s = (this.listeners[k] ??= new Set() as never) as Set<(e: EngineEvents[K]) => void>;
    s.add(fn); return () => { s.delete(fn); };
  }
  private emit<K extends keyof EngineEvents>(k: K, e: EngineEvents[K]) {
    (this.listeners[k] as Set<(e: EngineEvents[K]) => void> | undefined)?.forEach((f) => { try { f(e); } catch (err) { console.error('[engine listener]', err); } });
  }

  /* ---------- inputs ---------- */
  setFaceSource(f: FaceSource) { this.face = f; }
  setPose(p: Pose, immediate = false) {
    this.pose = p;
    if (immediate) for (const ch of CHANNEL_NAMES) this.poseCur[ch] = POSE_LIBRARY[p][ch] ?? CHANNELS[ch].rest;
  }
  getPose() { return this.pose; }
  /** Asset 23: gaze target in normalized [-1,1] screen space, or null for idle wandering. */
  lookAt(x: number | null, y = 0, mode: 'user' | 'chat' | 'center' = 'user') {
    if (x === null) { this.gaze.mode = 'idle'; return; }
    this.gaze.mode = mode; this.gaze.tx = Math.max(-1, Math.min(1, x)); this.gaze.ty = Math.max(-1, Math.min(1, y));
  }
  getGaze() { return { x: this.gaze.x, y: this.gaze.y, mode: this.gaze.mode }; }
  /** Asset 33: speech activity; viseme is an approximate mouth shape from the current word. */
  setSpeaking(on: boolean) { this.speech.active = on; if (!on) { this.speech.pulse = 0; this.speech.levelMode = false; this.speech.level = 0; } }
  /** Mouth from the measured loudness of the audio that is playing right now (0…1). Replaces the timed oscillation. */
  speechLevel(level: number) { this.speech.levelMode = true; this.speech.level = Math.max(0, Math.min(1, level)); }
  speechPulse(open = 0.8, round = 0) { this.speech.pulse = Math.min(1, Math.max(this.speech.pulse, open)); this.speech.round = round; }
  isSpeaking() { return this.speech.active; }
  /** Force a blink now (e.g. on state change). Never overlaps an ongoing blink (Asset 22). */
  triggerBlink() { if (this.blink.phase === 0) { this.blink.phase = 1e-6; this.blink.double = false; } }

  /* ---------- queries ---------- */
  active() {
    return this.actions.filter((a) => a.phase !== 'done').map((a) => ({
      id: a.id, skillId: a.skill.id, name: a.skill.name, phase: a.phase, priority: a.priority, preview: a.preview, tag: a.tag,
      progress: a.total ? Math.min(1, a.time / a.total) : 1, groups: [...a.groups],
    }));
  }
  queued() { return this.queue.map((a) => ({ id: a.id, skillId: a.skill.id })); }
  isHolding(id: string) { return this.actions.some((a) => a.skill.id === id && a.phase === 'hold'); }
  hasTag(tag: string) { return this.actions.some((a) => a.phase !== 'done' && a.skill.tags.includes(tag)); }

  /* ---------- playback ---------- */
  play(skill: SkillDef, o: PlayOptions = {}): ActionHandle {
    const p = skill.params;
    const cl = (v: number | undefined, r: { min: number; max: number; default: number }) => Math.min(r.max, Math.max(r.min, v ?? r.default));
    const speed = cl(o.speed !== undefined ? o.speed * p.speed.default : undefined, p.speed);
    let amp = cl(o.amplitude !== undefined ? o.amplitude * p.amplitude.default : undefined, p.amplitude) * this.intensity;
    if (this.reducedMotion) amp *= 0.45;
    const reps = Math.round(cl(o.repetitions, p.repetitions));
    const a = new Action(this.nextId++, skill, speed, amp, reps, o.tag, !!o.preview, o.side === 'left' && p.mirrorable, (x) => this.cancelAction(x, 'cancelled'));
    if (skill.kind !== 'motion') { a.phase = 'done'; a.resolve('rejected'); return a; }
    if (this.actions.filter((x) => x.phase !== 'done').length >= ENGINE_LIMITS.maxActive && this.queue.length >= ENGINE_LIMITS.maxQueue) {
      a.phase = 'done'; a.resolve('rejected'); return a;
    }
    const conflicts = this.conflicts(a);
    const policy = o.conflict ?? 'auto';
    if (!conflicts.length && this.activeCount() < ENGINE_LIMITS.maxActive) { this.start(a); return a; }
    const higher = conflicts.filter((c) => c.priority > a.priority && c.phase !== 'hold');
    if (policy === 'reject' || (policy === 'interrupt' && higher.length)) { a.phase = 'done'; a.resolve('rejected'); return a; }
    if (policy === 'queue' || (policy === 'auto' && higher.length) || this.activeCount() >= ENGINE_LIMITS.maxActive) {
      if (this.queue.length >= ENGINE_LIMITS.maxQueue) { a.phase = 'done'; a.resolve('rejected'); return a; }
      this.queue.push(a);
      this.emit('queued', { id: a.id, skillId: skill.id, blockedBy: conflicts.map((c) => c.skill.id) });
      return a;
    }
    for (const c of conflicts) this.fadeOut(c, 'interrupted', 1 / 0.2);
    this.start(a);
    return a;
  }

  private activeCount() { return this.actions.filter((x) => x.phase !== 'done' && x.phase !== 'out').length; }
  private conflicts(a: Action) {
    return this.actions.filter((b) => (b.phase === 'in' || b.phase === 'run' || b.phase === 'hold') && [...a.groups].some((g) => b.groups.has(g)));
  }
  private start(a: Action) {
    a.phase = 'in';
    // watchdog budget fixed at start: scheduled length at the requested speed + blends + grace
    a.budget = a.total / Math.max(0.05, a.speed * Math.max(0.5, this.speedScale)) + a.skill.blendIn + a.skill.blendOut + ENGINE_LIMITS.watchdogGraceS;
    this.actions.push(a);
    this.actions.sort((x, y) => x.priority - y.priority || x.id - y.id);
    this.emit('start', { id: a.id, skillId: a.skill.id, preview: a.preview });
  }
  private fadeOut(a: Action, result: ActionResult, rate?: number) {
    if (a.phase === 'done' || a.phase === 'out') return;
    a.result = result; a.phase = 'out'; a.outRate = rate ?? 1 / a.skill.blendOut;
  }
  private cancelAction(a: Action, result: ActionResult) {
    const qi = this.queue.indexOf(a);
    if (qi >= 0) { this.queue.splice(qi, 1); a.phase = 'done'; this.finish(a, result); return; }
    this.fadeOut(a, result, 1 / 0.15);
  }
  private finish(a: Action, r: ActionResult) {
    if (a.resolved) return; a.resolved = true; a.resolve(r);
    this.emit('end', { id: a.id, skillId: a.skill.id, result: r, preview: a.preview });
  }
  cancelTag(tag: string) {
    for (const a of [...this.queue]) if (a.tag === tag) this.cancelAction(a, 'cancelled');
    for (const a of this.actions) if (a.tag === tag) this.cancelAction(a, 'cancelled');
  }
  stopAll() {
    for (const a of [...this.queue]) this.cancelAction(a, 'cancelled');
    for (const a of this.actions) this.fadeOut(a, 'cancelled', 1 / 0.15);
  }
  reset() { this.stopAll(); this.setPose('neutral'); this.lookAt(null); }

  /* ---------- frame ---------- */
  update(dtRaw: number): Record<Channel, number> {
    const dt = Math.min(Math.max(dtRaw, 0), 0.1);
    this.clock += dt;
    const t = this.clock;
    const motionScale = (this.reducedMotion ? 0.35 : 1) * this.intensity;
    const T = this.target;

    // 1–2: pose base (smoothed)
    const pk = 1 - Math.exp(-dt * 6);
    const pose = POSE_LIBRARY[this.pose];
    for (const ch of CHANNEL_NAMES) {
      const goal = pose[ch] ?? CHANNELS[ch].rest;
      this.poseCur[ch] += (goal - this.poseCur[ch]) * pk;
      T[ch] = this.poseCur[ch];
    }
    // 3: expression
    if (this.face) {
      const f = this.face.targets();
      for (const k in f) { const ch = k as Channel; T[ch] = f[ch]!; }
      const h = this.face.headOffset();
      T['head.rot'] += h.rot; T['head.nod'] += h.nod; T['head.y'] += h.y;
    }
    // 4: idle breathing / life (Asset 21) — cheap sinusoids, scaled by preferences
    if (this.idleEnabled && this.idleScale > 0) {
      const im = motionScale * this.idleScale;
      const b = Math.sin(t * 1.9);
      T['body.squash'] += b * 0.012 * im;
      T['head.y'] += b * 0.8 * im;
      T['antenna.rot'] += Math.sin(t * 1.1) * 3 * im;
      T['chest.glow'] += (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.2 - 0.1;
      T['armL.raise'] += Math.sin(t * 1.2) * 1.2 * im; T['armR.raise'] += Math.sin(t * 1.2 + 0.6) * 1.2 * im;
    }

    // queue promotion
    if (this.queue.length) for (const a of [...this.queue]) {
      const cs = this.conflicts(a);
      if (cs.every((c) => c.phase === 'hold') && this.activeCount() < ENGINE_LIMITS.maxActive) {
        for (const c of cs) this.fadeOut(c, 'interrupted', 1 / 0.2);
        this.queue.splice(this.queue.indexOf(a), 1); this.start(a);
      }
    }

    // 5: actions
    const owned = new Set<Channel>();
    for (const a of this.actions) {
      if (a.phase === 'done') continue;
      a.wall += dt;
      if (a.phase !== 'hold') a.time += dt * a.speed * this.speedScale;
      if (a.phase === 'in') { a.weight = Math.min(1, a.weight + dt / a.skill.blendIn); if (a.weight >= 1) a.phase = 'run'; }
      if ((a.phase === 'in' || a.phase === 'run') && a.time >= a.total) {
        a.time = a.total;
        if (a.skill.returnToRest) this.fadeOut(a, 'completed');
        else { a.phase = 'hold'; a.weight = 1; this.finish(a, 'completed'); }
      }
      // watchdog: wall-clock budget = scheduled length / min speed + blends + grace
      if (a.phase !== 'hold' && a.phase !== 'out' && a.wall > a.budget) {
        this.emit('recovered', { id: a.id, skillId: a.skill.id, reason: 'exceeded scheduled duration' });
        this.fadeOut(a, 'stuck', 1 / 0.2);
      }
      if (a.phase === 'out') {
        a.weight -= dt * a.outRate;
        if (a.weight <= 0) { a.weight = 0; a.phase = 'done'; this.finish(a, a.result); continue; }
      }
      const lt = localTime(a.skill, a.reps, a.time);
      for (const tr of a.tracks) {
        const v = sampleKeys(tr.keys, lt, T[tr.channel]);
        T[tr.channel] += (v - T[tr.channel]) * a.weight;
        if (a.weight > 0.5) owned.add(tr.channel);
      }
    }
    this.actions = this.actions.filter((a) => a.phase !== 'done');

    // 6: gaze (Asset 23) — pupils follow target; idle mode wanders with saccades
    const g = this.gaze;
    if (g.mode === 'idle') {
      g.idleNext -= dt;
      if (g.idleNext <= 0) { g.idleNext = 1 + this.rng() * 2.5; g.tx = (this.rng() - 0.5) * 1.2; g.ty = (this.rng() - 0.5) * 0.6; }
    }
    const gk = 1 - Math.exp(-dt * 16);
    g.x += (g.tx - g.x) * gk; g.y += (g.ty - g.y) * gk;
    if (!owned.has('pupil.x')) T['pupil.x'] += g.x * 0.85;
    if (!owned.has('pupil.y')) T['pupil.y'] += g.y * 0.85;

    // 7: blink (Asset 22) — single state machine, so blinks never overlap
    const B = this.blink;
    if (B.phase === 0) {
      B.next -= dt * this.blinkRate;
      if (B.next <= 0) { B.phase = 1e-6; B.double = this.rng() < 0.15; B.next = 2 + this.rng() * 3.5; }
    }
    let close = 0;
    if (B.phase > 0) {
      B.phase += dt / 0.16;                        // a blink lasts ~160 ms
      close = Math.sin(Math.min(1, B.phase) * Math.PI);
      if (B.phase >= 1) { if (B.double) { B.double = false; B.phase = 1e-6; } else B.phase = 0; }
    }
    if (!owned.has('eyeL.open')) T['eyeL.open'] *= 1 - close * 0.95;
    if (!owned.has('eyeR.open')) T['eyeR.open'] *= 1 - close * 0.95;

    // 8: speech mouth (Asset 33)
    const S = this.speech;
    if (S.active && this.speechMouth && S.levelMode) {
      // audio-driven: follow the playing audio's loudness, smoothed so shapes interpolate instead of snapping
      S.open += (S.level - S.open) * Math.min(1, dt * 22);
      T['mouth.open'] = Math.max(T['mouth.open'], S.open);
      T['mouth.width'] += S.open * 0.18;                      // louder → slightly wider
      T['mouth.round'] += ((S.open > 0.65 ? 0.25 : 0) - T['mouth.round']) * 0.3;
      T['head.nod'] += Math.sin(t * 6.3) * 0.05 * motionScale * Math.min(1, S.open * 2);
    } else if (S.active && this.speechMouth) {
      S.pulse = Math.max(0, S.pulse - dt * 3.5);
      const osc = (Math.sin(t * 18) * 0.5 + 0.5) * 0.35;
      S.open = Math.max(S.pulse, osc * 0.6 + 0.12);
      T['mouth.open'] = Math.max(T['mouth.open'], S.open);
      T['mouth.round'] += (S.round - T['mouth.round']) * 0.5;
      T['head.nod'] += Math.sin(t * 6.3) * 0.06 * motionScale;
    }

    // 9: clamp + rate-limit (and measure how fast anything is still moving, for the power-saving frame rate)
    let motion = 0;
    for (const ch of CHANNEL_NAMES) {
      const goal = clampChannel(ch, T[ch]);
      const cur = this.values[ch];
      if (this.rateLimit) {
        const m = CHANNELS[ch].maxSpeed * dt;
        this.values[ch] = cur + Math.max(-m, Math.min(m, goal - cur));
      } else this.values[ch] = goal;
      if (dt > 0) { const span = CHANNELS[ch].max - CHANNELS[ch].min || 1; motion = Math.max(motion, Math.abs(this.values[ch] - cur) / dt / span, Math.abs(goal - this.values[ch]) / span * 4); }
    }
    this.motion = motion;
    return this.values;
  }
}
