/**
 * The controlled improvement loop (Part 4; Assets 63, 64, 66, 67, 68, 70):
 *   proposal (untrusted) → compile → validate + sandbox simulation (with speed repair)
 *   → stored as PROPOSED → user previews → approve | reject → reusable, versioned.
 * New skills ALWAYS require explicit approval. Refinements follow the configured policy
 * ("require" approval by default, or "auto_low_risk").
 * This changes application data only — the language model is never trained.
 */
import { ExpressionPresetSchema, SkillDefSchema, SkillProposalSchema, type ExpressionPreset, type SkillDef, type SkillRefinement } from '../../shared/schema';
import { compileGeneratorSpec, uniqueId } from './generator';
import { validateExpression, validateSkill, validateWithRepair, type ValidationReport } from './validator';
import { USABLE, type CreationMethod, type RecordKind, type SkillRegistry } from './registry';
import type { KV } from '../storage/db';

export interface LearnOutcome {
  status: 'proposed' | 'saved' | 'rejected' | 'error';
  skillId?: string; version?: number; kind?: RecordKind; message: string;
  report?: Pick<ValidationReport, 'ok' | 'risk' | 'errors' | 'warnings' | 'fixes' | 'metrics'>;
  /** the change scope, for the training disclosure (Asset 80) */
  scope: 'skill_registry';
}
export interface FeedbackRecord { id?: number; at: number; skillId: string; version: number; kind: 'rating' | 'refinement'; rating?: 'up' | 'down'; note: string; toVersion?: number }

const sum = (r: ValidationReport) => ({ ok: r.ok, risk: r.risk, errors: r.errors, warnings: r.warnings, fixes: r.fixes, metrics: r.metrics });

export class LearningSystem {
  refinementPolicy: () => 'require' | 'auto_low_risk' = () => 'require';
  constructor(private reg: SkillRegistry, private kv: KV) {}

  async propose(input: unknown): Promise<LearnOutcome> {
    const pp = SkillProposalSchema.safeParse(input);
    if (!pp.success) {
      const msg = pp.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await this.reg.logFailure({ skillId: '?', source: 'proposal', errors: [msg] });
      return { status: 'rejected', message: `The proposal was malformed and was not previewed (${msg}).`, scope: 'skill_registry' };
    }
    const p = pp.data;
    if (p.format === 'expression') return this.proposeExpression(p.expression, p.reason);
    let def: SkillDef; let method: CreationMethod;
    try {
      if (p.format === 'generator') { def = compileGeneratorSpec(p.spec); method = 'procedural_generator'; }
      else { def = SkillDefSchema.parse(p.skill); method = p.format === 'composition' ? 'llm_composition' : 'llm_motion'; }
    } catch (e) { return this.fail('?', 'compile', [(e as Error).message.slice(0, 200)]); }
    if (p.format === 'motion' && def.kind !== 'motion') return this.fail(def.id, method, ['format "motion" requires kind "motion"']);
    if (p.format === 'composition' && def.kind !== 'composite') return this.fail(def.id, method, ['format "composition" requires kind "composite"']);
    def = { ...def, id: uniqueId(def.id, this.reg.ids()), priority: Math.min(def.priority, 3), createdBy: method, version: 1 };
    const { report, skill } = def.kind === 'composite'
      ? validateSkill(def, { origin: 'generated', lookup: (x) => this.reg.get(x) })
      : validateWithRepair(def, { origin: 'generated', lookup: (x) => this.reg.get(x) });
    if (!report.ok || !skill) return this.fail(def.id, method, report.errors.map((e) => e.message), report, def, def.kind);
    try {
      const v = await this.reg.addVersion(skill, skill.kind as RecordKind, { status: 'proposed', report, createdBy: method, note: p.reason ?? 'awaiting your approval', activate: false });
      return { status: 'proposed', skillId: skill.id, version: v.version, kind: skill.kind as RecordKind, report: sum(report), scope: 'skill_registry',
        message: `"${skill.name}" passed validation (${report.metrics.samples} simulation samples, risk ${report.risk}). Preview it, then approve or reject — it is not used until you approve.` };
    } catch (e) { return { status: 'error', message: (e as Error).message, scope: 'skill_registry' }; }
  }

  private async proposeExpression(e0: ExpressionPreset, reason?: string): Promise<LearnOutcome> {
    const e = { ...e0, id: uniqueId(e0.id, this.reg.ids()), priority: Math.min(e0.priority, 3), version: 1 };
    const { report, expression } = validateExpression(e, { origin: 'generated', lookup: (x) => this.reg.get(x) });
    if (!report.ok || !expression) return this.fail(e.id, 'llm_expression', report.errors.map((x) => x.message), report, e, 'expression');
    try {
      const v = await this.reg.addVersion(expression, 'expression', { status: 'proposed', report, createdBy: 'llm_expression', note: reason ?? 'awaiting your approval', activate: false });
      return { status: 'proposed', skillId: expression.id, version: v.version, kind: 'expression', report: sum(report), scope: 'skill_registry', message: `New expression "${expression.name}" passed validation. Preview it, then approve or reject.` };
    } catch (err) { return { status: 'error', message: (err as Error).message, scope: 'skill_registry' }; }
  }

  private async fail(id: string, source: string, errors: string[], report?: ValidationReport, def?: unknown, kind?: RecordKind): Promise<LearnOutcome> {
    await this.reg.logFailure({ skillId: id, source, errors });
    // keep a record marked "failed" (never usable) so the user can inspect what was attempted
    if (def && kind) {
      const schema = kind === 'expression' ? ExpressionPresetSchema : SkillDefSchema;
      const ok = schema.safeParse(def);
      if (ok.success && !this.reg.has(id)) { try { await this.reg.addVersion(ok.data as SkillDef, kind, { status: 'failed', report: report ?? null, createdBy: 'user', note: `rejected by validator: ${errors[0] ?? ''}`, activate: false }); } catch { /* ignore */ } }
    }
    return { status: 'rejected', skillId: id, report: report ? sum(report) : undefined, scope: 'skill_registry', message: `The validator rejected this proposal: ${errors.slice(0, 2).join('; ')}` };
  }

  async approve(id: string, version: number) { return this.reg.approve(id, version); }
  async reject(id: string, version: number) { return this.reg.reject(id, version); }

  /** Asset 70 — constrained parameter refinement (speed / amplitude / repetitions only). */
  async refine(ref: SkillRefinement, lastSkillId: string | null): Promise<LearnOutcome> {
    const id = ref.skillId === 'last' ? lastSkillId : ref.skillId;
    if (!id) return { status: 'error', message: 'There is no recent motion to refine yet.', scope: 'skill_registry' };
    const rec = this.reg.getRecord(id); const cur = this.reg.get(id);
    if (!rec || !cur) return { status: 'error', message: `There is no approved motion called "${id}".`, scope: 'skill_registry' };
    if (cur.kind !== 'motion') return { status: 'error', message: `"${cur.name}" is a ${cur.kind}; only motions can be retuned.`, scope: 'skill_registry' };
    const p = structuredClone(cur.params);
    const adj = (r: { min: number; max: number; default: number }, f: number, lo: number, hi: number) => {
      r.default = +(r.default * f).toFixed(3);
      r.min = Math.min(r.min, Math.max(lo, r.default)); r.max = Math.max(r.max, Math.min(hi, r.default));
      r.default = Math.min(r.max, Math.max(r.min, r.default));
    };
    if (ref.speedFactor) adj(p.speed, ref.speedFactor, 0.3, 2.5);
    if (ref.amplitudeFactor) adj(p.amplitude, ref.amplitudeFactor, 0.2, 1.4);
    if (ref.repetitions) p.repetitions.default = Math.min(p.repetitions.max, Math.max(p.repetitions.min, ref.repetitions));
    const { report, skill } = validateSkill({ ...cur, params: p }, { origin: rec.builtin ? 'builtin' : 'generated', lookup: (x) => this.reg.get(x) });
    const from = rec.activeVersion;
    if (!report.ok || !skill) {
      await this.reg.logFailure({ skillId: id, source: 'feedback_refinement', errors: report.errors.map((e) => e.message) });
      return { status: 'rejected', skillId: id, report: sum(report), scope: 'skill_registry', message: `That change would not be safe (${report.errors[0]?.message ?? 'validation failed'}); keeping version ${from}.` };
    }
    const auto = this.refinementPolicy() === 'auto_low_risk' && report.risk === 'low' && USABLE.includes(this.reg.active(id)!.status);
    try {
      const v = await this.reg.addVersion(skill, 'motion', { status: auto ? 'approved' : 'proposed', report, createdBy: 'feedback_refinement', note: ref.note || 'refinement', activate: auto });
      await this.addFeedback({ at: Date.now(), skillId: id, version: from, kind: 'refinement', note: ref.note, toVersion: v.version });
      const what = [ref.speedFactor && `speed ×${ref.speedFactor}`, ref.amplitudeFactor && `size ×${ref.amplitudeFactor}`, ref.repetitions && `${ref.repetitions} reps`].filter(Boolean).join(', ');
      return auto
        ? { status: 'saved', skillId: id, version: v.version, kind: 'motion', report: sum(report), scope: 'skill_registry', message: `Saved "${cur.name}" v${v.version} (${what}). v${from} is kept for rollback.` }
        : { status: 'proposed', skillId: id, version: v.version, kind: 'motion', report: sum(report), scope: 'skill_registry', message: `Prepared "${cur.name}" v${v.version} (${what}). Preview and approve it to make it active; v${from} stays active until then.` };
    } catch (e) { return { status: 'error', message: (e as Error).message, scope: 'skill_registry' }; }
  }

  async rate(id: string, up: boolean, note: string) {
    const v = this.reg.active(id); if (!v) return false;
    const ok = await this.reg.vote(id, up);
    await this.addFeedback({ at: Date.now(), skillId: id, version: v.version, kind: 'rating', rating: up ? 'up' : 'down', note });
    return ok;
  }
  async addFeedback(f: FeedbackRecord) { try { await this.kv.put('feedback', f); } catch { /* best-effort */ } }
  async feedback(): Promise<FeedbackRecord[]> { try { return (await this.kv.all<FeedbackRecord>('feedback')).sort((a, b) => b.at - a.at); } catch { return []; } }
}
