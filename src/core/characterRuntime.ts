/**
 * One animation loop for the whole app (Asset 99): engine + expression controller → rig(s).
 * Pauses when the tab is hidden; `step()` gives deterministic stepping for tests.
 */
import { AnimationEngine } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import type { RigHandle, Indicator } from '../character/Robot';
import type { Channel } from '../../shared/channels';

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

  constructor(readonly engine: AnimationEngine, readonly expressions: ExpressionController) {
    engine.setFaceSource(expressions);
    engine.on('start', () => this.kick()); // a new action never waits for a slow (power-saving) frame
  }
  attach(r: RigHandle) { this.rigs.add(r); r.setIndicator(this.indicator); r.apply(this.engine.values); return () => { this.rigs.delete(r); }; }
  setIndicator(i: Indicator) { this.indicator = i; this.rigs.forEach((r) => r.setIndicator(i)); }

  step(dt: number): Record<Channel, number> {
    this.expressions.update(dt);
    this.engine.blinkRate = this.expressions.blinkRate();
    const v = this.engine.update(dt);
    for (const r of this.rigs) r.apply(v);
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
      const calm = this.powerSaving && this.engine.isCalm() && this.expressions.settled();
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
