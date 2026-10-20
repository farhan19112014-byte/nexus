/** Runs registry skills on the engine: composites, previews, and run statistics. */
import type { SkillDef } from '../../shared/schema';
import type { AnimationEngine, ActionResult } from '../animation/engine';
import type { SkillRegistry } from '../skills/registry';

export interface RunStep { skillId: string; speed?: number; amplitude?: number; repetitions?: number; side?: 'left' | 'right' }
export type RunResult = ActionResult | 'missing';

export class SkillRunner {
  lastSkillId: string | null = null;
  constructor(private engine: AnimationEngine, private reg: SkillRegistry) {}
  async run(step: RunStep, o: { tag?: string; signal?: AbortSignal; def?: SkillDef; preview?: boolean; depth?: number } = {}): Promise<RunResult> {
    if (o.signal?.aborted) return 'cancelled';
    const def = o.def ?? this.reg.get(step.skillId);
    if (!def) return 'missing';
    if (def.kind === 'composite') {
      if ((o.depth ?? 0) > 3) return 'rejected';
      let r: RunResult = 'completed';
      for (const s of def.steps ?? []) { r = await this.run(s, { ...o, def: undefined, depth: (o.depth ?? 0) + 1 }); if (r === 'cancelled') return r; }
      if (!o.preview) this.lastSkillId = def.id;
      return r;
    }
    const h = this.engine.play(def, { ...step, tag: o.tag, preview: o.preview });
    const abort = () => h.cancel(); o.signal?.addEventListener('abort', abort, { once: true });
    const res = await h.done.finally(() => o.signal?.removeEventListener('abort', abort));
    if (!o.preview && !def.tags.includes('system')) {
      this.lastSkillId = def.id;
      void this.reg.recordRun(def.id, res === 'completed' ? 'completed' : res === 'rejected' || res === 'stuck' ? 'failed' : 'interrupted');
    }
    return res;
  }
}
