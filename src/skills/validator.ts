/**
 * Asset 65 — Skill schema validator, and the simulation half of Asset 66 (sandbox).
 * A candidate is untrusted data. It must pass: strict schema → structural checks → channel ranges →
 * 60 Hz simulation at default AND at max speed/amplitude (speed limits, visual-consistency rules
 * from Asset 08) → duration/resource limits → safe end state. Passing the schema alone is not enough.
 */
import { CHANNELS, isChannel, restOf, type Channel } from '../../shared/channels';
import { ExpressionPresetSchema, LIMITS, SkillDefSchema, type ExpressionPreset, type SkillDef } from '../../shared/schema';
import { localTime, sampleKeys, totalDuration } from '../animation/timeline';
import { checkConsistency } from '../character/consistency';

export interface Issue { code: string; message: string; path?: string }
export interface ValidationReport {
  ok: boolean;
  risk: 'low' | 'medium' | 'high';
  kind: 'motion' | 'expression' | 'composite';
  errors: Issue[]; warnings: Issue[]; notes: Issue[]; fixes: string[];
  metrics: { duration: number; maxDuration: number; peakSpeedRatio: number; worstChannel: string | null; samples: number; channels: number };
  testedAt: number;
}
export interface ValidateOptions {
  origin?: 'builtin' | 'generated';
  lookup?: (id: string) => SkillDef | undefined;
  lookupExpression?: (id: string) => ExpressionPreset | undefined;
  autoFix?: boolean;
}

const report = (kind: ValidationReport['kind']): ValidationReport => ({
  ok: false, risk: 'high', kind, errors: [], warnings: [], notes: [], fixes: [],
  metrics: { duration: 0, maxDuration: 0, peakSpeedRatio: 0, worstChannel: null, samples: 0, channels: 0 }, testedAt: Date.now(),
});
const finalize = (r: ValidationReport) => {
  r.ok = r.errors.length === 0;
  r.risk = !r.ok ? 'high' : r.warnings.length || r.metrics.duration > 8 ? 'medium' : 'low';
  return r;
};
const pct = (ch: Channel) => (CHANNELS[ch].max - CHANNELS[ch].min) * 0.02;

export function validateSkill(input: unknown, opts: ValidateOptions = {}): { report: ValidationReport; skill: SkillDef | null } {
  const parsed = SkillDefSchema.safeParse(input);
  const kind = ((input as { kind?: string })?.kind === 'composite' ? 'composite' : 'motion') as 'motion' | 'composite';
  const r = report(kind);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) r.errors.push({ code: 'schema', message: `${i.path.join('.') || 'skill'}: ${i.message}` });
    return { report: finalize(r), skill: null };
  }
  const s: SkillDef = structuredClone(parsed.data);
  const generated = opts.origin !== 'builtin';
  if (s.kind === 'expression') { r.errors.push({ code: 'kind', message: 'Expression presets are validated with validateExpression()' }); return { report: finalize(r), skill: null }; }
  if (generated && s.priority > 3) r.errors.push({ code: 'priority', message: 'Generated skills are limited to priority ≤ 3 (4–5 are reserved for system alerts and recovery).' });

  if (s.kind === 'composite') return validateComposite(s, opts, r);

  if (!s.tracks.length) r.errors.push({ code: 'no_tracks', message: 'A motion needs at least one track.' });
  const seen = new Set<string>();
  s.tracks.forEach((t, ti) => {
    if (seen.has(t.channel)) r.errors.push({ code: 'dup_channel', message: `Channel "${t.channel}" has two tracks`, path: `tracks.${ti}` });
    seen.add(t.channel);
    let prev = -1;
    t.keys.forEach((k, ki) => {
      if (k.t <= prev) r.errors.push({ code: 'key_order', message: `${t.channel}: keyframe times must strictly increase (key ${ki})` });
      if (k.t > s.duration + 1e-6) r.errors.push({ code: 'key_range', message: `${t.channel}: key at ${k.t}s is after the ${s.duration}s duration` });
      prev = k.t;
      const d = CHANNELS[t.channel];
      const over = Math.max(d.min - k.v, k.v - d.max);
      if (over > pct(t.channel)) r.errors.push({ code: 'range', message: `${t.channel} = ${+k.v.toFixed(2)} is outside its range [${d.min}, ${d.max}] ${d.unit}` });
      else if (over > 0) r.notes.push({ code: 'range_soft', message: `${t.channel} slightly exceeds its range and will be clamped` });
    });
  });
  if (s.loop && (s.loop.end <= s.loop.start || s.loop.end > s.duration + 1e-6)) r.errors.push({ code: 'loop', message: 'Loop segment must satisfy start < end ≤ duration' });
  r.metrics.channels = seen.size;
  if (r.errors.length) return { report: finalize(r), skill: null };

  // durations / resource limits (Asset 94)
  r.metrics.duration = totalDuration(s, s.params.repetitions.default) / s.params.speed.default;
  r.metrics.maxDuration = totalDuration(s, s.params.repetitions.max) / s.params.speed.min;
  if (r.metrics.maxDuration > LIMITS.skillMaxTotal) r.errors.push({ code: 'duration', message: `Worst-case playback ${r.metrics.maxDuration.toFixed(1)}s exceeds the ${LIMITS.skillMaxTotal}s limit` });
  else if (r.metrics.maxDuration > 16) r.warnings.push({ code: 'long', message: `Long skill (${r.metrics.maxDuration.toFixed(1)}s worst case)` });

  // simulation (sandboxed: pure data evaluation with a fixed step budget)
  let safeMax = s.params.speed.max;
  for (const c of [{ speed: s.params.speed.default, amp: s.params.amplitude.default, strict: true }, { speed: s.params.speed.max, amp: s.params.amplitude.max, strict: false }]) {
    const sim = simulate(s, c.speed, c.amp);
    r.metrics.samples += sim.samples;
    if (c.strict) {
      r.metrics.peakSpeedRatio = sim.peak; r.metrics.worstChannel = sim.worst;
      for (const e of sim.violations) (e.severity === 'error' ? r.errors : r.warnings).push({ code: e.code, message: e.message });
      if (sim.peak > 1) r.errors.push({ code: 'too_fast', message: `${sim.worst} moves ${sim.peak.toFixed(2)}× faster than its limit (${CHANNELS[sim.worst as Channel].maxSpeed}/s)` });
    } else if (sim.peak > 1) safeMax = Math.max(s.params.speed.default, (c.speed / sim.peak) * 0.95);
  }
  if (safeMax < s.params.speed.max) {
    if (opts.autoFix !== false) { s.params.speed.max = +safeMax.toFixed(2); r.fixes.push(`capped max speed to ×${s.params.speed.max} to respect channel speed limits`); }
    else r.warnings.push({ code: 'speed_cap', message: `max speed should be ≤ ×${safeMax.toFixed(2)}` });
  }

  // safe end state (Asset 30)
  if (s.returnToRest) {
    for (const t of s.tracks) {
      const last = t.keys[t.keys.length - 1].v; const dev = Math.abs(last - restOf(t.channel));
      if (dev / s.blendOut > CHANNELS[t.channel].maxSpeed) r.errors.push({ code: 'unsafe_exit', message: `${t.channel} cannot return to rest within its speed limit` });
      else if (dev > (CHANNELS[t.channel].max - CHANNELS[t.channel].min) * 0.35) r.notes.push({ code: 'abrupt_exit', message: `${t.channel} ends far from rest; the recovery blend will be visible` });
    }
  } else if (generated) r.warnings.push({ code: 'hold', message: 'Holds its final pose until replaced' });
  return { report: finalize(r), skill: r.errors.length ? null : s };
}

function validateComposite(s: SkillDef, opts: ValidateOptions, r: ValidationReport) {
  if (!s.steps?.length) { r.errors.push({ code: 'no_steps', message: 'Composite skill has no steps' }); return { report: finalize(r), skill: null }; }
  const visit = (id: string, depth: number, stack: string[]) => {
    if (stack.includes(id)) { r.errors.push({ code: 'cycle', message: `Composite cycle: ${[...stack, id].join(' → ')}` }); return; }
    if (depth > 3) { r.errors.push({ code: 'depth', message: 'Composite nesting deeper than 3' }); return; }
    const d = id === s.id ? s : opts.lookup?.(id);
    if (!d) { r.errors.push({ code: 'missing_skill', message: `Step references unknown or unapproved skill "${id}"` }); return; }
    if (d.kind === 'composite') for (const st of d.steps ?? []) visit(st.skillId, depth + 1, [...stack, id]);
  };
  visit(s.id, 0, []);
  let total = 0;
  for (const st of s.steps) { const d = opts.lookup?.(st.skillId); if (d && d.kind === 'motion') total += totalDuration(d, st.repetitions ?? d.params.repetitions.default) / (st.speed ?? 1); }
  r.metrics.duration = r.metrics.maxDuration = total;
  if (total > LIMITS.skillMaxTotal) r.errors.push({ code: 'duration', message: `Composite runs ${total.toFixed(1)}s (limit ${LIMITS.skillMaxTotal}s)` });
  return { report: finalize(r), skill: r.errors.length ? null : s };
}

export interface SimViolation { code: string; message: string; severity: 'error' | 'warning' }
/** Sandbox evaluation: samples the clip at 60 Hz with a hard step budget; no side effects. */
export function simulate(s: SkillDef, speed: number, amp: number, hz = 60) {
  const reps = s.params.repetitions.default;
  const total = totalDuration(s, reps);
  const dtClip = speed / hz;
  const budget = Math.min(20000, Math.ceil(total / dtClip) + 2);
  const prev = new Map<Channel, number>();
  let peak = 0, worst: string | null = null, samples = 0;
  const violations: SimViolation[] = []; const seen = new Set<string>();
  let eyesClosedFor = 0;
  for (let i = 0; i <= budget; i++) {
    const tt = Math.min(total, i * dtClip);
    const lt = localTime(s, reps, tt);
    const vals: Partial<Record<Channel, number>> = {};
    for (const t of s.tracks) {
      if (!isChannel(t.channel)) continue;
      const rest = restOf(t.channel);
      const raw = sampleKeys(t.keys, lt, rest);
      const v = rest + (raw - rest) * amp;
      vals[t.channel] = v;
      const p = prev.get(t.channel);
      if (p !== undefined) {
        const ratio = (Math.abs(v - p) * hz) / CHANNELS[t.channel].maxSpeed;
        if (ratio > peak) { peak = ratio; worst = t.channel; }
      }
      prev.set(t.channel, v);
    }
    if (i % 3 === 0) for (const v of checkConsistency(vals)) if (!seen.has(v.code)) { seen.add(v.code); violations.push({ ...v, message: `${v.message} at t=${tt.toFixed(2)}s` }); }
    const closed = (vals['eyeL.open'] ?? 1) < 0.15 && (vals['eyeR.open'] ?? 1) < 0.15;
    eyesClosedFor = closed ? eyesClosedFor + 1 / hz / speed : 0;
    if (eyesClosedFor > 1.5 && !seen.has('eyes_closed')) { seen.add('eyes_closed'); violations.push({ code: 'eyes_closed', message: 'Both eyes stay closed for over 1.5 s', severity: 'warning' }); }
    samples++;
    if (tt >= total) break;
  }
  return { peak, worst, samples, violations };
}

/** Asset 64/65 — validate an expression proposal. */
export function validateExpression(input: unknown, opts: ValidateOptions = {}): { report: ValidationReport; expression: ExpressionPreset | null } {
  const r = report('expression');
  const parsed = ExpressionPresetSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 8)) r.errors.push({ code: 'schema', message: `${i.path.join('.') || 'expression'}: ${i.message}` });
    return { report: finalize(r), expression: null };
  }
  const e = structuredClone(parsed.data);
  for (const [k, v] of Object.entries(e.face)) {
    if (!isChannel(k) || !CHANNELS[k].face) { r.errors.push({ code: 'component', message: `"${k}" is not an approved facial component` }); continue; }
    const d = CHANNELS[k];
    if (v < d.min - pct(k) || v > d.max + pct(k)) r.errors.push({ code: 'range', message: `${k} = ${v} is outside [${d.min}, ${d.max}]` });
  }
  const H = { rot: CHANNELS['head.rot'], nod: CHANNELS['head.nod'], y: CHANNELS['head.y'] };
  for (const k of ['rot', 'nod', 'y'] as const) { const v = e.head[k]; if (v !== undefined && (v < H[k].min || v > H[k].max)) r.errors.push({ code: 'range', message: `head.${k} = ${v} is outside [${H[k].min}, ${H[k].max}]` }); }
  if (e.idleMotion && !opts.lookup?.(e.idleMotion)) r.errors.push({ code: 'missing_skill', message: `Idle motion "${e.idleMotion}" is not an approved skill` });
  if (opts.origin !== 'builtin' && e.priority > 3) r.errors.push({ code: 'priority', message: 'Generated expressions are limited to priority ≤ 3' });
  const vals = Object.fromEntries(Object.entries(e.face).filter(([k]) => isChannel(k))) as Partial<Record<Channel, number>>;
  if ((vals['eyeL.open'] ?? 1) < 0.15 && (vals['eyeR.open'] ?? 1) < 0.15) r.warnings.push({ code: 'eyes_closed', message: 'Both eyes closed — may read as "offline"' });
  for (const v of checkConsistency(vals)) (v.severity === 'error' ? r.errors : r.warnings).push({ code: v.code, message: v.message });
  r.metrics.duration = e.transitionMs / 1000; r.metrics.channels = Object.keys(e.face).length;
  return { report: finalize(r), expression: r.errors.length ? null : e };
}

/** Uniform time-stretch (repairs "too fast" candidates). */
export function retime(s: SkillDef, f: number): SkillDef {
  const q = (t: number) => +(t * f).toFixed(4);
  return { ...s, duration: Math.min(LIMITS.skillMaxDuration, q(s.duration)), loop: s.loop ? { start: q(s.loop.start), end: q(s.loop.end) } : undefined, tracks: s.tracks.map((t) => ({ ...t, keys: t.keys.map((k) => ({ ...k, t: q(k.t) })) })) };
}

/** Validate; if the only problem is speed, slow the clip (≤3 attempts) and record the repair. */
export function validateWithRepair(input: unknown, opts: ValidateOptions = {}) {
  let out = validateSkill(input, opts);
  const parsed = SkillDefSchema.safeParse(input);
  if (out.report.ok || !parsed.success) return out;
  let s = parsed.data; const repairs: string[] = [];
  for (let i = 0; i < 3 && !out.report.ok && out.report.errors.every((e) => e.code === 'too_fast'); i++) {
    const m = /moves ([\d.]+)× faster/.exec(out.report.errors[0].message);
    const f = Math.min(2.5, (m ? Number(m[1]) : 1.3) * 1.1);
    if (s.duration * f > LIMITS.skillMaxDuration) break;
    s = retime(s, f); repairs.push(`slowed clip ×${f.toFixed(2)} to respect speed limits`);
    out = validateSkill(s, opts);
  }
  out.report.fixes.unshift(...repairs);
  return out;
}
