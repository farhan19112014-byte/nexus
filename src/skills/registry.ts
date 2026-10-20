/**
 * Asset 61 — persistent, versioned registry of motion, composite and expression skills.
 * Asset 68 — status lifecycle: builtin · proposed → approved | rejected; approved → deprecated; failed.
 * Asset 69 — every version is kept; revert/activate restore known-good versions.
 * Asset 79 — writes are verified by reading the record back before success is reported.
 * Stored definitions are re-validated on load; corrupted rows are quarantined, never executed.
 */
import { z } from 'zod';
import { CREATION_METHODS, ExpressionPresetSchema, SKILL_STATUSES, SkillDefSchema, type ExpressionPreset, type SkillCatalogEntry, type SkillDef } from '../../shared/schema';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { validateExpression, validateSkill, type ValidationReport } from './validator';
import { StorageError, type KV } from '../storage/db';

export type SkillStatus = (typeof SKILL_STATUSES)[number];
export type CreationMethod = (typeof CREATION_METHODS)[number];
export type RecordKind = 'motion' | 'composite' | 'expression';
export const USABLE: SkillStatus[] = ['builtin', 'approved'];

export type StoredReport = Pick<ValidationReport, 'ok' | 'risk' | 'errors' | 'warnings' | 'fixes' | 'metrics' | 'testedAt'>;
export interface SkillVersion {
  version: number; kind: RecordKind; def: SkillDef | ExpressionPreset; status: SkillStatus; report: StoredReport | null;
  createdBy: CreationMethod; note: string; createdAt: number; votes: { up: number; down: number };
  compatibility: { rig: string; schema: number };
}
export interface SkillRecord { id: string; kind: RecordKind; activeVersion: number; versions: SkillVersion[]; builtin: boolean; stats: { runs: number; completed: number; interrupted: number; failed: number }; createdAt: number; updatedAt: number }
export interface FailureLog { id?: number; at: number; skillId: string; source: string; errors: string[] }

export const RIG_VERSION = 'nexus-2d-rig@1';
export const SCHEMA_VERSION = 2;

const StoredSchema = z.object({
  id: z.string(), kind: z.enum(['motion', 'composite', 'expression']), activeVersion: z.number().int(),
  versions: z.array(z.object({
    version: z.number().int(), kind: z.enum(['motion', 'composite', 'expression']), def: z.unknown(), status: z.enum(SKILL_STATUSES),
    report: z.unknown().nullable().optional(), createdBy: z.enum(CREATION_METHODS), note: z.string().default(''), createdAt: z.number(),
    votes: z.object({ up: z.number(), down: z.number() }).default({ up: 0, down: 0 }),
    compatibility: z.object({ rig: z.string(), schema: z.number() }).default({ rig: RIG_VERSION, schema: SCHEMA_VERSION }),
  })).max(200),
  stats: z.object({ runs: z.number(), completed: z.number(), interrupted: z.number(), failed: z.number() }).default({ runs: 0, completed: 0, interrupted: 0, failed: 0 }),
  createdAt: z.number(), updatedAt: z.number(),
});

const slim = (r: ValidationReport): StoredReport => ({ ok: r.ok, risk: r.risk, errors: r.errors, warnings: r.warnings, fixes: r.fixes, metrics: r.metrics, testedAt: r.testedAt });
const now = () => Date.now();

export class SkillRegistry {
  private records = new Map<string, SkillRecord>();
  private listeners = new Set<() => void>();
  quarantined: { id: string; reason: string }[] = [];
  version = 0;
  ready: Promise<void>;
  lastError: string | null = null;

  constructor(private kv: KV) {
    for (const d of BUILTIN_MOTIONS) this.records.set(d.id, this.builtin(d, 'motion'));
    for (const e of BUILTIN_EXPRESSIONS) this.records.set(e.id, this.builtin(e, 'expression'));
    this.ready = this.load();
  }
  private builtin(def: SkillDef | ExpressionPreset, kind: RecordKind): SkillRecord {
    const t = now();
    return { id: def.id, kind, activeVersion: 1, builtin: true, createdAt: t, updatedAt: t, stats: { runs: 0, completed: 0, interrupted: 0, failed: 0 },
      versions: [{ version: 1, kind, def, status: 'builtin', report: null, createdBy: 'builtin', note: 'built-in', createdAt: t, votes: { up: 0, down: 0 }, compatibility: { rig: RIG_VERSION, schema: SCHEMA_VERSION } }] };
  }

  private revalidate(kind: RecordKind, def: unknown, builtin: boolean): { ok: boolean; def: SkillDef | ExpressionPreset | null; reason?: string } {
    if (kind === 'expression') {
      const r = validateExpression(def, { origin: builtin ? 'builtin' : 'generated', lookup: (x) => this.get(x) });
      return { ok: r.report.ok, def: r.expression, reason: r.report.errors[0]?.message };
    }
    const r = validateSkill(def, { origin: builtin ? 'builtin' : 'generated', lookup: (x) => this.get(x) });
    return { ok: r.report.ok, def: r.skill, reason: r.report.errors[0]?.message };
  }

  private async load() {
    let rows: unknown[] = [];
    try { rows = await this.kv.all('skills'); } catch (e) { this.lastError = `Could not read saved skills: ${(e as Error).message}`; return; }
    // two passes so composites/expressions can reference learned motions
    for (const pass of ['motion', 'other'] as const) {
      for (const row of rows) {
        const p = StoredSchema.safeParse(row);
        const id = (row as { id?: unknown })?.id;
        if (!p.success) { if (pass === 'motion') this.quarantine(String(id ?? '?'), 'corrupted record'); continue; }
        const rec = p.data;
        if ((rec.kind === 'motion') !== (pass === 'motion')) continue;
        const existing = this.records.get(rec.id);
        const versions: SkillVersion[] = [];
        for (const v of rec.versions) {
          if (v.status === 'builtin') continue;
          if (v.compatibility.rig !== RIG_VERSION) { this.quarantine(`${rec.id}@v${v.version}`, `incompatible rig ${v.compatibility.rig}`); continue; }
          let def: SkillDef | ExpressionPreset | null = null;
          let status = v.status;
          const schemaOk = (v.kind === 'expression' ? ExpressionPresetSchema : SkillDefSchema).safeParse(v.def);
          if (!schemaOk.success) { this.quarantine(`${rec.id}@v${v.version}`, 'schema-invalid definition'); continue; }
          def = schemaOk.data as SkillDef | ExpressionPreset;
          if (USABLE.includes(status) || status === 'proposed') {
            const rv = this.revalidate(v.kind, v.def, !!existing?.builtin);
            if (!rv.ok) { status = 'failed'; this.quarantine(`${rec.id}@v${v.version}`, rv.reason ?? 'failed re-validation'); }
            else def = rv.def;
          }
          versions.push({ ...v, def: def!, status, report: (v.report as StoredReport) ?? null });
        }
        if (existing?.builtin) {
          existing.versions.push(...versions); existing.stats = rec.stats;
          existing.activeVersion = existing.versions.some((x) => x.version === rec.activeVersion && USABLE.includes(x.status)) ? rec.activeVersion : 1;
        } else if (versions.length) {
          const active = versions.find((x) => x.version === rec.activeVersion) ? rec.activeVersion : versions[versions.length - 1].version;
          this.records.set(rec.id, { ...rec, builtin: false, versions, activeVersion: active });
        }
      }
    }
    this.changed();
  }
  private quarantine(id: string, reason: string) { this.quarantined.push({ id, reason }); }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }

  /** Persist, then read back to verify (Asset 79). Throws StorageError on failure; memory state unchanged. */
  private async commit(rec: SkillRecord) {
    const stored = { ...rec, versions: rec.versions.filter((v) => v.status !== 'builtin') };
    try {
      if (rec.builtin && !stored.versions.length) await this.kv.del('skills', rec.id);
      else {
        await this.kv.put('skills', structuredClone(stored));
        const back = await this.kv.get<{ activeVersion: number; versions: unknown[] }>('skills', rec.id);
        if (!back || back.activeVersion !== rec.activeVersion || back.versions.length !== stored.versions.length) throw new Error('read-back mismatch');
      }
    } catch (e) {
      this.lastError = `Saving "${rec.id}" failed: ${(e as Error).message}`;
      throw new StorageError(this.lastError);
    }
    this.records.set(rec.id, rec);
    this.lastError = null;
    this.changed();
  }
  private cloneRec(id: string) { const r = this.records.get(id); return r ? structuredClone(r) : undefined; }

  /* ------------ queries ------------ */
  list(kind?: RecordKind) { return [...this.records.values()].filter((r) => !kind || r.kind === kind).sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.id.localeCompare(b.id)); }
  getRecord(id: string) { return this.records.get(id); }
  has(id: string) { return this.records.has(id); }
  ids() { return new Set(this.records.keys()); }
  active(id: string) { const r = this.records.get(id); return r?.versions.find((v) => v.version === r.activeVersion); }
  /** Usable motion/composite definition (builtin or approved). */
  get(id: string): SkillDef | undefined { const v = this.active(id); return v && v.kind !== 'expression' && USABLE.includes(v.status) ? (v.def as SkillDef) : undefined; }
  getExpression(id: string): ExpressionPreset | undefined { const v = this.active(id); return v && v.kind === 'expression' && USABLE.includes(v.status) ? (v.def as ExpressionPreset) : undefined; }
  getVersion(id: string, version?: number) { const r = this.records.get(id); return r?.versions.find((v) => v.version === (version ?? r.activeVersion)); }
  usableExpressions(): ExpressionPreset[] { return this.list('expression').map((r) => this.getExpression(r.id)).filter(Boolean) as ExpressionPreset[]; }
  pending(): (SkillVersion & { id: string })[] { return this.list().flatMap((r) => r.versions.filter((v) => v.status === 'proposed').map((v) => ({ ...v, id: r.id }))); }
  catalog(): SkillCatalogEntry[] {
    return this.list().filter((r) => r.kind !== 'expression' && this.get(r.id) && !this.get(r.id)!.tags.includes('system')).slice(0, 80).map((r) => {
      const d = this.get(r.id)!;
      return { id: d.id, name: d.name.slice(0, 60), description: d.description.slice(0, 200), kind: d.kind, tags: d.tags.slice(0, 12) };
    });
  }

  /* ------------ mutations ------------ */
  async addVersion(def: SkillDef | ExpressionPreset, kind: RecordKind, o: { status: SkillStatus; report: ValidationReport | null; createdBy: CreationMethod; note?: string; activate?: boolean }): Promise<SkillVersion> {
    const rec = this.cloneRec(def.id) ?? { id: def.id, kind, activeVersion: 0, versions: [], builtin: false, stats: { runs: 0, completed: 0, interrupted: 0, failed: 0 }, createdAt: now(), updatedAt: now() };
    if (rec.kind !== kind) throw new StorageError(`"${def.id}" already exists as a ${rec.kind}`);
    const version = Math.max(0, ...rec.versions.map((v) => v.version)) + 1;
    const v: SkillVersion = { version, kind, def: { ...def, version } as SkillDef, status: o.status, report: o.report ? slim(o.report) : null, createdBy: o.createdBy, note: o.note ?? '', createdAt: now(), votes: { up: 0, down: 0 }, compatibility: { rig: RIG_VERSION, schema: SCHEMA_VERSION } };
    rec.versions.push(v);
    if (o.activate ?? USABLE.includes(o.status)) rec.activeVersion = version;
    else if (!rec.activeVersion) rec.activeVersion = version;
    rec.updatedAt = now();
    await this.commit(rec);
    return v;
  }
  async setStatus(id: string, version: number, status: SkillStatus, activate = USABLE.includes(status)) {
    const rec = this.cloneRec(id); const v = rec?.versions.find((x) => x.version === version);
    if (!rec || !v || v.status === 'builtin') return false;
    v.status = status;
    if (activate) rec.activeVersion = version;
    else if (rec.activeVersion === version && !USABLE.includes(status)) {
      const prev = [...rec.versions].reverse().find((x) => x.version !== version && USABLE.includes(x.status));
      if (prev) rec.activeVersion = prev.version;
    }
    rec.updatedAt = now();
    await this.commit(rec);
    return true;
  }
  approve(id: string, version: number) { return this.setStatus(id, version, 'approved', true); }
  reject(id: string, version: number) { return this.setStatus(id, version, 'rejected', false); }
  /** Deprecate the active version: it stops being offered/used, but stays restorable. */
  async deprecate(id: string) { const r = this.records.get(id); return r && !r.builtin ? this.setStatus(id, r.activeVersion, 'deprecated', false) : false; }
  async restore(id: string, version: number) { return this.setStatus(id, version, 'approved', true); }
  async activate(id: string, version: number) {
    const rec = this.cloneRec(id); const v = rec?.versions.find((x) => x.version === version);
    if (!rec || !v || !USABLE.includes(v.status)) return false;
    rec.activeVersion = version; rec.updatedAt = now(); await this.commit(rec); return true;
  }
  async revert(id: string): Promise<number | null> {
    const rec = this.cloneRec(id); if (!rec) return null;
    const older = rec.versions.filter((v) => v.version < rec.activeVersion && USABLE.includes(v.status)).pop();
    if (!older) return null;
    rec.activeVersion = older.version; rec.updatedAt = now(); await this.commit(rec); return older.version;
  }
  async remove(id: string) {
    const rec = this.records.get(id); if (!rec) return;
    try { await this.kv.del('skills', id); } catch (e) { throw new StorageError(`Deleting "${id}" failed: ${(e as Error).message}`); }
    if (rec.builtin) this.records.set(id, this.builtin(rec.versions[0].def, rec.kind)); else this.records.delete(id);
    this.changed();
  }
  async recordRun(id: string, result: 'completed' | 'interrupted' | 'failed') {
    const rec = this.cloneRec(id); if (!rec) return;
    rec.stats.runs++; rec.stats[result]++;
    try { await this.commit(rec); } catch { /* stats are best-effort */ }
  }
  async vote(id: string, up: boolean) {
    const rec = this.cloneRec(id); const v = rec?.versions.find((x) => x.version === rec.activeVersion);
    if (!rec || !v) return false;
    if (up) v.votes.up++; else v.votes.down++;
    if (rec.builtin && v.status === 'builtin') { this.records.set(id, rec); this.changed(); return true; } // built-in v1 votes are session-only
    await this.commit(rec); return true;
  }
  async logFailure(e: Omit<FailureLog, 'id' | 'at'>) { try { await this.kv.put('log', { ...e, at: now() }); } catch { /* ignore */ } this.changed(); }
  async failures(): Promise<FailureLog[]> { try { return (await this.kv.all<FailureLog>('log')).sort((a, b) => b.at - a.at); } catch { return []; } }
  async clearFailures() { try { await this.kv.clear('log'); } catch { /* ignore */ } this.changed(); }

  exportJSON() {
    const records = this.list().map((r) => ({ ...r, versions: r.versions.filter((v) => v.status !== 'builtin') })).filter((r) => r.versions.length);
    return JSON.stringify({ format: 'nexus-skills', schema: SCHEMA_VERSION, rig: RIG_VERSION, exportedAt: new Date().toISOString(), records }, null, 2);
  }
  /** Import: every definition is re-validated and arrives as "proposed" (needs approval). Never executed. */
  async importJSON(text: string) {
    let data: unknown; try { data = JSON.parse(text); } catch { return { imported: 0, rejected: 1 }; }
    const recs = (data as { records?: unknown[] })?.records;
    if (!Array.isArray(recs)) return { imported: 0, rejected: 1 };
    let imported = 0, rejected = 0;
    for (const r of recs.slice(0, 200)) for (const v of ((r as { versions?: unknown[] }).versions ?? []).slice(0, 50)) {
      const kind = (v as { kind?: RecordKind }).kind ?? 'motion';
      const rv = this.revalidate(kind, (v as { def?: unknown }).def, false);
      if (!rv.ok || !rv.def) { rejected++; continue; }
      const existing = this.records.get(rv.def.id);
      if (existing && existing.kind !== kind) { rejected++; continue; }
      try { await this.addVersion(rv.def, kind, { status: 'proposed', report: null, createdBy: 'import', note: 'imported — awaiting approval', activate: false }); imported++; } catch { rejected++; }
    }
    return { imported, rejected };
  }
}
