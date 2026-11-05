/**
 * One animation loop for the whole app (Asset 99): engine + expression controller → rig(s).
 * Pauses when the tab is hidden; `step()` gives deterministic stepping for tests.
 */
import { AnimationEngine } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import type { RigHandle, Indicator } from '../character/Robot';
import type { Channel } from '../../shared/channels';
import type { MotionState } from '../character3d/motion3d';
import { BodyController, CLIP_FOR_SKILL } from '../character3d/body/controller';
import type { BodyState } from '../character3d/body/clips';

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

  /** the 3D robot's full-body animation controller (states + explicit actions); the 2D rig ignores its output */
  readonly body = new BodyController();
  constructor(readonly engine: AnimationEngine, readonly expressions: ExpressionController) {
    engine.setFaceSource(expressions);
    engine.on('start', (e) => {
      this.kick(); // a new action never waits for a slow (power-saving) frame
      // the engine owns arbitration (priorities, queue, conflicts): the body follows its actions, so explicit commands
      // play, queue or interrupt exactly as the engine decides — never at random
      const clip = CLIP_FOR_SKILL[e.skillId]; if (clip) this.body.play(clip, { engineId: e.id, speed: e.speed });
    });
    engine.on('end', (e) => { if (e.result === 'completed') this.body.release(e.id); else this.body.stop(e.id); });
  }
  attach(r: RigHandle) { this.rigs.add(r); r.setIndicator(this.indicator); r.setMotion?.(this.motion, this.engine.reducedMotion); r.apply(this.engine.values); return () => { this.rigs.delete(r); }; }
  setIndicator(i: Indicator) { this.indicator = i; this.rigs.forEach((r) => r.setIndicator(i)); }
  /** body-language state for the 3D robot's motion engine (ignored by the 2D rig) */
  motion: MotionState = 'idle';
  private motionKey = '';
  setMotion(m: MotionState) { const key = `${m}|${this.engine.reducedMotion}`; if (key === this.motionKey) return; this.motionKey = key; this.motion = m; this.rigs.forEach((r) => r.setMotion?.(m, this.engine.reducedMotion)); this.kick(); }
  /** true while the 3D robot is on screen: its motion engine replaces the 2D-style idle sway of the animation engine */
  is3d = false;
  set3d(on: boolean) { this.is3d = on; this.engine.bodyIdle = !on; this.motionKey = ''; this.rigs.forEach((r) => r.setMotion?.(this.motion, this.engine.reducedMotion)); }

  /** forces a body state (the Motion Lab's state buttons); null = follow the interaction state as usual */
  bodyState: BodyState | null = null;

  step(dt: number): Record<Channel, number> {
    this.expressions.update(dt);
    this.engine.blinkRate = this.expressions.blinkRate();
    const v = this.engine.update(dt);
    this.body.reduced = this.engine.reducedMotion;
    this.body.setState(this.bodyState ?? bodyStateFor(this.motion, this.expressions.current()));
    // the voice drives the speaking gestures: mouth openness (measured audio level / word pulses) only while speaking
    this.body.setSpeech(this.engine.isSpeaking() ? (v['mouth.open'] ?? 0) : 0);
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
