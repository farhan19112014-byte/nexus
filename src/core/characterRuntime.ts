/**
 * One animation loop for the whole app (Asset 99): engine + expression controller → rig(s).
 * Pauses when the tab is hidden; `step()` gives deterministic stepping for tests.
 */
import { AnimationEngine } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import type { RigHandle, Indicator } from '../character/Robot';
import type { Channel } from '../../shared/channels';
import type { MotionState } from '../character3d/motion3d';
import type { BodyController, BodyOutput } from '../character3d/body/controller';
import { CLIP_FOR_SKILL } from '../character3d/body/clipMap';
import type { BodyState } from '../character3d/body/clips';
import type { Presence } from '../character3d/body/presence';
import { attention } from '../character3d/attention';

/** What the runtime and the Motion Lab use of the 3D body controller. */
export type BodyLike = Pick<BodyController, 'play' | 'release' | 'stop' | 'setState' | 'setSpeech' | 'update' | 'busy' | 'current' | 'presence' | 'reduced' | 'channelGesture'>;
/**
 * Stands in for the 3D body controller until its code has loaded (it is a separate chunk that only the 3D robot needs).
 * It moves nothing, and it remembers clips the engine started meanwhile so they can still play once the real one is in.
 */
export class PendingBody implements BodyLike {
  presence: Presence | null = null; reduced = false; channelGesture = false;
  readonly pending: { clip: string; o: { engineId?: number; speed?: number; hold?: boolean } }[] = [];
  private state: BodyState = 'IDLE';
  play(clip: string, o: { engineId?: number; speed?: number; hold?: boolean } = {}) { this.pending.push({ clip, o }); if (this.pending.length > 8) this.pending.shift(); return true; }
  release(engineId?: number) { this.drop(engineId); }
  stop(engineId?: number) { this.drop(engineId); }
  private drop(engineId?: number) { for (let i = this.pending.length - 1; i >= 0; i--) if (engineId === undefined || this.pending[i].o.engineId === engineId) this.pending.splice(i, 1); }
  setState(s: BodyState) { this.state = s; }
  setSpeech() { /* nothing to animate yet */ }
  update(): BodyOutput { return { layers: [], active: false, action: null, state: this.state, accent: 0 } as unknown as BodyOutput; }
  busy() { return false; }
  current() { return null; }
}

/** NEXUS's interaction state → the full-body state loop (the expression adds HAPPY / SURPRISED while otherwise idle) */
export function bodyStateFor(m: MotionState, expression: string | null): BodyState {
  switch (m) {
    case 'listening': case 'waiting': return 'LISTENING';
    case 'thinking': return 'THINKING';
    case 'speaking': return 'SPEAKING';
    case 'explaining': return 'EXPLAINING';
    case 'curious': return 'CURIOUS';
    case 'excited': return 'EXCITED';
    case 'confused': return 'CONFUSED';
    case 'greeting': return 'HAPPY';
    case 'idle': return expression === 'happy' || expression === 'excited' ? 'HAPPY' : expression === 'surprised' ? 'SURPRISED' : 'IDLE';
    default: return 'IDLE';
  }
}

export class CharacterRuntime {
  private rigs = new Set<RigHandle>();
  private raf = 0;
  private last = 0;
  private running = false;
  frameTimes: number[] = [];   // ms per frame (rolling) for diagnostics
  frames = 0;
  indicator: Indicator = 'idle';
  private lastIdle: string | null = null;
  onFrameError: ((e: unknown) => void) | null = null;

  /**
   * the 3D robot's full-body animation controller (states + explicit actions).
   * A PendingBody until loadBody() has fetched the real one (only when the 3D robot is shown).
   */
  body: BodyLike = new PendingBody();
  private gesturing: ((v: Record<string, number>) => boolean) | null = null;
  private bodyLoad: Promise<boolean> | null = null;
  /** true once the real body controller is in place */
  get bodyReady() { return !(this.body instanceof PendingBody); }
  /**
   * Loads the 3D body-animation chunk once (later calls share the same promise) and swaps it in, carrying over the
   * presence layer, the settings and any clip the engine started while it was loading. A failed download leaves the
   * placeholder in place (the robot simply has no full-body clips) and can be tried again.
   */
  loadBody(): Promise<boolean> {
    return (this.bodyLoad ??= import('../character3d/body3d').then((m) => {
      const old = this.body as PendingBody; const real = new m.BodyController();
      real.presence = old.presence; real.reduced = old.reduced; real.channelGesture = old.channelGesture;
      const live = new Set(this.engine.active().filter((a) => a.phase !== 'out').map((a) => a.id));
      for (const p of old.pending) if (p.o.engineId === undefined || live.has(p.o.engineId)) real.play(p.clip, p.o);
      this.body = real; this.gesturing = m.gesturingFrom; this.kick();
      return true;
    }).catch((e) => { this.bodyLoad = null; console.warn('[body] the 3D body animation could not be loaded', e); return false; }));
  }
  /** the 3D robot's presence layer (idle life, attention, meaningful gestures, walking); attached while 3D is shown */
  /** loaded with the 3D view (its own chunk: pages without the 3D robot never download it) */
  presence: Presence | null = null;
  private presenceLoad: Promise<void> | null = null;
  private loadPresence() {
    this.presenceLoad ??= import('../character3d/body/presence').then((m) => {
      this.presence = new m.Presence();
      if (this.is3d) { this.body.presence = this.presence; this.kick(); }
    }).catch((e) => { this.presenceLoad = null; console.warn('[presence] could not load', e); });
    return this.presenceLoad;
  }
  private walkId: number | null = null;
  constructor(readonly engine: AnimationEngine, readonly expressions: ExpressionController) {
    engine.setFaceSource(expressions);
    engine.on('start', (e) => {
      this.kick(); // a new action never waits for a slow (power-saving) frame
      // the engine owns arbitration (priorities, queue, conflicts): the body follows its actions, so explicit commands
      // play, queue or interrupt exactly as the engine decides — never at random
      const clip = CLIP_FOR_SKILL[e.skillId]; if (clip) this.body.play(clip, { engineId: e.id, speed: e.speed });
      // the 2D "walk across" (a slide with leg lifts) becomes a real walk in 3D: steps, planted feet, back again
      if (e.skillId === 'walk_across' && this.body.presence && !engine.reducedMotion) { this.walkId = e.id; this.body.presence.startWalkSkill(); }
    });
    engine.on('end', (e) => {
      if (e.result === 'completed') this.body.release(e.id); else this.body.stop(e.id);
      if (e.id === this.walkId) { this.walkId = null; this.presence?.endWalkSkill(e.result === 'completed'); }
    });
  }
  attach(r: RigHandle) { this.rigs.add(r); r.setIndicator(this.indicator); r.setMotion?.(this.motion, this.engine.reducedMotion); r.apply(this.engine.values); return () => { this.rigs.delete(r); }; }
  setIndicator(i: Indicator) { this.indicator = i; this.rigs.forEach((r) => r.setIndicator(i)); }
  /** body-language state for the 3D robot's motion engine */
  motion: MotionState = 'idle';
  private motionKey = '';
  setMotion(m: MotionState) { const key = `${m}|${this.engine.reducedMotion}`; if (key === this.motionKey) return; this.motionKey = key; this.motion = m; this.rigs.forEach((r) => r.setMotion?.(m, this.engine.reducedMotion)); this.kick(); }
  /** true while the 3D robot is on screen: its motion engine replaces the 2D-style idle sway of the animation engine */
  is3d = false;
  set3d(on: boolean) { this.is3d = on; this.engine.bodyIdle = !on; this.body.presence = on ? this.presence : null; if (on) void this.loadBody(); if (on && !this.presence) void this.loadPresence(); this.motionKey = ''; this.rigs.forEach((r) => r.setMotion?.(this.motion, this.engine.reducedMotion)); }

  private targetT = 0;
  /** a page target asked for attention (a new visual, a selected HOLOBUILD part): look — and present it while speaking */
  readonly offFocus = attention.on((id, kind) => { if (kind !== 'focus' || !this.body.presence) return; this.targetT = 0; this.pendingFocus = id; });
  private pendingFocus: 'visual' | 'holo' | null = null;
    /** forces a body state (the Motion Lab's state buttons); null = follow the interaction state as usual */
  bodyState: BodyState | null = null;

  step(dt: number): Record<Channel, number> {
    this.expressions.update(dt);
    this.engine.blinkRate = this.expressions.blinkRate();
    const v = this.engine.update(dt);
    this.body.reduced = this.engine.reducedMotion;
    this.body.setState(this.bodyState ?? bodyStateFor(this.motion, this.expressions.current()));
    // the voice drives the speaking gestures: mouth openness (measured audio level / word pulses) only while speaking
    this.body.setSpeech(this.engine.isSpeaking() ? (v['mouth.open'] ?? 0) : 0, this.engine.isSpeaking());
    const P = this.body.presence;
    if (P) {
      // real positions of what NEXUS can look at (from the 3D view: camera, IVES panel, HOLOBUILD part) — at ~6 Hz
      this.targetT -= dt;
      if (this.targetT <= 0) {
        this.targetT = 0.16;
        for (const r of this.rigs) { const t = r.attentionTargets?.(); if (!t) continue; for (const id of ['user', 'visual', 'holo'] as const) P.setTarget(id, t[id] ?? null); break; }
      }
      if (this.pendingFocus && P.hasTarget(this.pendingFocus)) { P.attend(this.pendingFocus, 2.6, this.engine.isSpeaking()); this.pendingFocus = null; }
      this.body.channelGesture = this.walkId === null && !!this.gesturing?.(v);
      // the chat box (the user typing, the reply streaming in) — never over a spoken reply or a visual/model it is attending
      const g = this.engine.getGaze(); const f = P.attending();
      if ((g.mode === 'chat' || g.mode === 'cursor') && !this.engine.isSpeaking() && (f === 'user' || f === 'aside')) P.lookScreen(g.x, g.y);
    }
    const b = this.body.update(dt);
    for (const r of this.rigs) { r.setBody?.(b); r.apply(v); }
    this.frames++;
    return v;
  }

  /** Power saving (laptops): full frame rate while anything moves, ~20 fps when calm, ~8 fps while resting. */
  powerSaving = true;
  resting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loopFn: (() => void) | null = null;
  start() {
    if (this.running || typeof requestAnimationFrame === 'undefined') return;
    this.running = true; this.last = performance.now();
    const loop = () => {
      this.timer = null;
      if (!this.running) return;
      const now = performance.now();
      const t0 = now;
      try { this.step(Math.min(0.25, (now - this.last) / 1000)); }
      catch (e) { console.error('[frame]', e); this.onFrameError?.(e); } // never let one bad frame kill the loop
      this.last = now;
      const ft = performance.now() - t0;
      this.frameTimes.push(ft); if (this.frameTimes.length > 120) this.frameTimes.shift();
      const calm = this.powerSaving && this.engine.isCalm() && this.expressions.settled() && !this.body.busy() && ![...this.rigs].some((r) => r.busy?.());
      if (calm) this.timer = setTimeout(() => { this.raf = requestAnimationFrame(loop); }, this.resting ? 120 : 45);
      else this.raf = requestAnimationFrame(loop);
    };
    this.loopFn = loop;
    this.raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', this.onVis);
  }
  /** wake the loop immediately (e.g. an action was just started while in a slow frame) */
  kick() { if (this.running && this.timer && this.loopFn) { clearTimeout(this.timer); this.timer = null; this.raf = requestAnimationFrame(this.loopFn); } }
  stop() { this.running = false; cancelAnimationFrame(this.raf); if (this.timer) clearTimeout(this.timer); document.removeEventListener('visibilitychange', this.onVis); }
  private onVis = () => { if (document.hidden) { cancelAnimationFrame(this.raf); if (this.timer) clearTimeout(this.timer); this.timer = null; this.running = false; } else this.start(); };
  stats() {
    const n = this.frameTimes.length || 1;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / n;
    return { avgFrameMs: avg, maxFrameMs: Math.max(0, ...this.frameTimes), frames: this.frames };
  }
  /** idle motion attached to the current expression (Asset 11's gentle positive idle). */
  get lastIdleMotion() { return this.lastIdle; }
  set lastIdleMotion(v) { this.lastIdle = v; }
}
