/**
 * Asset 66 — animation sandbox. A candidate is previewed on a SEPARATE engine + expression controller
 * + rig, never on the main character's state. Candidates are data interpreted by the engine, so they have
 * no access to network, storage, secrets or code. Previews are time-boxed and can be stopped.
 */
import { AnimationEngine, seeded } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import type { ExpressionPreset, SkillDef } from '../../shared/schema';
import type { RigHandle } from '../character/Robot';

export const SANDBOX_MAX_SECONDS = 45;

export class SkillSandbox {
  readonly engine = new AnimationEngine(seeded(1));
  readonly expressions = new ExpressionController(BUILTIN_EXPRESSIONS);
  private rig: RigHandle | null = null;
  private raf = 0; private last = 0; private elapsed = 0; private idleFor = 0;
  playing: string | null = null;
  onEnd: (() => void) | null = null;
  constructor() { this.engine.setFaceSource(this.expressions); this.engine.idleEnabled = true; }
  attach(r: RigHandle | null) { this.rig = r; r?.apply(this.engine.values); }
  /** Preview a motion (with its own face tracks) or an expression preset. */
  preview(item: { kind: 'motion' | 'composite'; def: SkillDef; lookup: (id: string) => SkillDef | undefined } | { kind: 'expression'; def: ExpressionPreset }) {
    this.stop();
    this.elapsed = 0;
    if (item.kind === 'expression') {
      this.expressions.register({ ...item.def, id: '__preview' });
      this.expressions.set('user', '__preview', 1);
      this.playing = item.def.name;
      setTimeout(() => { if (this.playing === item.def.name) { this.expressions.release('user'); this.playing = null; this.onEnd?.(); } }, 3000);
    } else {
      const steps = item.kind === 'composite' ? (item.def.steps ?? []).map((s) => ({ s, d: item.lookup(s.skillId) })).filter((x) => x.d) : [{ s: {}, d: item.def }];
      this.playing = item.def.name;
      (async () => {
        for (const { s, d } of steps) { const h = this.engine.play(d!, { ...(s as object), preview: true }); const r = await h.done; if (r === 'cancelled') return; }
        this.playing = null; this.onEnd?.();
      })();
    }
    this.loop();
  }
  private loop() {
    if (typeof requestAnimationFrame === 'undefined') return;
    cancelAnimationFrame(this.raf); this.last = performance.now();
    const f = (t: number) => {
      const dt = (t - this.last) / 1000; this.last = t; this.elapsed += dt;
      this.expressions.update(dt); this.engine.update(dt); this.rig?.apply(this.engine.values);
      if (this.elapsed > SANDBOX_MAX_SECONDS) { this.stop(); return; }
      if (!this.playing && !this.engine.active().length) { this.idleFor += dt; if (this.idleFor > 1.5) return; } else this.idleFor = 0;
      this.raf = requestAnimationFrame(f);
    };
    this.raf = requestAnimationFrame(f);
  }
  step(dt: number) { this.expressions.update(dt); this.engine.update(dt); this.rig?.apply(this.engine.values); }
  stop() { this.engine.stopAll(); this.expressions.release('user'); this.playing = null; }
  dispose() { this.stop(); cancelAnimationFrame(this.raf); }
}
