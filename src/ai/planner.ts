/** Action planner: validated intentions → capability-checked, timed plan of approved skills. */
import type { BrainResponse } from '../../shared/schema';
import type { SkillRegistry } from '../skills/registry';
import type { RunStep } from '../core/skillRunner';

export interface PlannedStep extends RunStep { timing: 'before_speech' | 'with_speech' | 'after_speech'; reason?: string }
export interface Plan { before: PlannedStep[]; during: PlannedStep[]; after: PlannedStep[]; notes: string[]; unsupported: { request: string; reason: string }[] }
const CONTEXT_DEFAULTS: Record<string, string> = { greeting: 'wave', farewell: 'wave', agreement: 'nod', celebration: 'clap', thinking: 'think_chin', apology: 'head_forward' };
const ALIASES: Record<string, string> = { hello: 'wave', point_at: 'point', jump: 'bounce', hop: 'bounce', think: 'think_chin', tilt_head: 'head_tilt', walk: 'walk_across', yes: 'nod', no: 'shake_head' };

export function resolveSkill(raw: string, reg: SkillRegistry): string | null {
  const id = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (reg.get(id)) return id;
  if (ALIASES[id] && reg.get(ALIASES[id])) return ALIASES[id];
  for (const r of reg.list()) { const d = reg.get(r.id); if (d && d.name.toLowerCase().replace(/[\s-]+/g, '_') === id) return r.id; }
  return null;
}

export function planFromResponse(resp: BrainResponse, reg: SkillRegistry, prefs: Record<string, string>): Plan {
  const plan: Plan = { before: [], during: [], after: [], notes: [], unsupported: [] };
  const add = (raw: string, timing: PlannedStep['timing'], extra: Partial<PlannedStep> = {}) => {
    if (plan.before.length + plan.during.length + plan.after.length >= 8) { plan.notes.push('plan truncated to 8 steps'); return; }
    const id = resolveSkill(raw, reg);
    if (!id) { plan.notes.push(`"${raw}" is not an approved skill — skipped`); return; }
    if (reg.get(id)!.tags.includes('system')) { plan.notes.push(`"${id}" is a system animation — skipped`); return; }
    (timing === 'before_speech' ? plan.before : timing === 'with_speech' ? plan.during : plan.after).push({ skillId: id, timing, ...extra });
  };
  for (const a of resp.actions) {
    if (a.type === 'unsupported') plan.unsupported.push({ request: a.request, reason: a.reason });
    else add(a.skillId, a.timing, { speed: a.speed, amplitude: a.amplitude, repetitions: a.repetitions, side: a.side });
  }
  if (resp.gesture) {
    const g = resp.gesture.toLowerCase();
    const id = CONTEXT_DEFAULTS[g] ? (prefs[g] && reg.get(prefs[g]) ? prefs[g] : CONTEXT_DEFAULTS[g]) : g;
    if (![...plan.before, ...plan.during, ...plan.after].some((s) => s.skillId === resolveSkill(id, reg))) add(id, 'with_speech', { reason: CONTEXT_DEFAULTS[g] ? `${g}${prefs[g] ? ' (your preference)' : ''}` : undefined });
  }
  if (resp.followUpAction) add(resp.followUpAction, 'after_speech');
  return plan;
}
