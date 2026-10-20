import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openStore, MemoryKV } from '../../storage/db';
import { SkillRegistry } from '../../skills/registry';
import { LearningSystem } from '../../skills/learning';
import { validateSkill, validateExpression, validateWithRepair } from '../../skills/validator';
import { compileGeneratorSpec, inventExpression, inventSpec } from '../../skills/generator';
import { SkillSandbox } from '../../skills/sandbox';
import { BUILTIN_MOTIONS, tr } from '../../animation/builtinMotions';
import { MOTIFS, SkillDefSchema, SkillProposalSchema } from '../../../shared/schema';

let n = 0; const db = () => openStore(`skills-${Date.now()}-${n++}`);
const setup = async (kv = db()) => { const reg = new SkillRegistry(kv); await reg.ready; return { kv, reg, learn: new LearningSystem(reg, kv) }; };
const motion = (id: string, extra: object = {}) => ({ id, name: id, kind: 'motion', duration: 1.2, tracks: [{ channel: 'head.rot', keys: [{ t: 0.4, v: 12 }, { t: 1.2, v: 0 }] }], ...extra });

describe('Category G — constrained motion & expression learning', () => {
  it('[A61] registry: built-ins plus learned skills persist across sessions with metadata', async () => {
    const kv = db(); const { reg, learn } = await setup(kv);
    expect(reg.get('wave')).toBeDefined(); expect(reg.getExpression('happy')).toBeDefined();
    const o = await learn.propose({ format: 'generator', spec: { id: 'tiny_nod', name: 'Tiny nod', motifs: [{ motif: 'nod', intensity: 0.5 }] } });
    await reg.approve(o.skillId!, o.version!);
    const reg2 = new SkillRegistry(kv); await reg2.ready;
    const rec = reg2.getRecord('tiny_nod')!; expect(reg2.get('tiny_nod')?.name).toBe('Tiny nod');
    expect(rec.versions[0]).toMatchObject({ status: 'approved', createdBy: 'procedural_generator', compatibility: { rig: 'nexus-2d-rig@1' } });
    expect(rec.versions[0].report?.metrics.samples).toBeGreaterThan(0);
  });
  it('[A62] declarative format: strict schema, no code fields, channel whitelist', () => {
    expect(SkillDefSchema.safeParse({ ...motion('ok') }).success).toBe(true);
    expect(SkillDefSchema.safeParse({ ...motion('x1'), run: 'alert(1)' }).success).toBe(false);
    expect(SkillDefSchema.safeParse({ ...motion('x2'), tracks: [{ channel: 'window.location', keys: [{ t: 1, v: 0 }] }] }).success).toBe(false);
    expect(SkillDefSchema.safeParse({ ...motion('x3'), tracks: [{ channel: 'head.rot', keys: [{ t: 1, v: 0, fn: '() => 1' }] }] }).success).toBe(false);
    expect(SkillProposalSchema.safeParse({ format: 'javascript', code: 'x' }).success).toBe(false);
  });
  it('[A63] motion proposals (generator & raw keyframes) compile and are treated as untrusted', async () => {
    for (const m of MOTIFS) for (const side of ['left', 'right'] as const) expect(validateWithRepair(compileGeneratorSpec({ id: `m_${m}`, name: m, motifs: [{ motif: m, side, intensity: 1.2, repeats: 3 }] })).report.ok, `${m}/${side}`).toBe(true);
    let ok = 0; for (let i = 0; i < 120; i++) if (validateWithRepair(compileGeneratorSpec(inventSpec(['greeting', 'dance', 'celebration', 'gesture'][i % 4], i * 97, new Set()))).report.ok) ok++;
    expect(ok).toBe(120);
    const { learn, reg } = await setup();
    const o = await learn.propose({ format: 'motion', skill: motion('llm_tilt') });
    expect(o.status).toBe('proposed'); expect(reg.get('llm_tilt')).toBeUndefined(); // not usable until approved
  });
  it('[A64] expression proposals: only approved facial components and ranges', async () => {
    const lookup = (id: string) => BUILTIN_MOTIONS.find((m) => m.id === id);
    for (let i = 0; i < 60; i++) expect(validateExpression(inventExpression(i, new Set()), { lookup }).report.ok).toBe(true);
    const bad = validateExpression({ id: 'evil_face', name: 'x', face: { 'armL.raise': 90 } }, { lookup }); expect(bad.report.errors[0].code).toBe('component');
    const oob = validateExpression({ id: 'big_eyes', name: 'x', face: { 'eyes.size': 3 } }, { lookup }); expect(oob.report.errors[0].code).toBe('range');
    const { learn, reg } = await setup();
    const o = await learn.propose({ format: 'expression', expression: inventExpression(5, reg.ids()) });
    expect(o.status).toBe('proposed'); expect(o.kind).toBe('expression');
  });
  it('[A65] validator: limits, speeds, durations, key order, missing components, end state', () => {
    const r = (x: object) => validateSkill(x).report;
    expect(r(motion('oob', { tracks: [{ channel: 'head.rot', keys: [{ t: 0.5, v: 90 }] }] })).errors[0].code).toBe('range');
    expect(r(motion('fast', { duration: 0.3, tracks: [{ channel: 'armR.raise', keys: [{ t: 0.05, v: 170, ease: 'linear' }, { t: 0.1, v: 8, ease: 'linear' }, { t: 0.3, v: 8 }] }] })).errors.some((e) => e.code === 'too_fast')).toBe(true);
    expect(r(motion('order', { tracks: [{ channel: 'head.rot', keys: [{ t: 0.8, v: 1 }, { t: 0.4, v: 0 }] }] })).errors[0].code).toBe('key_order');
    expect(r(motion('long', { duration: 18, params: { speed: { min: 0.4, max: 1, default: 1 }, amplitude: { min: 1, max: 1, default: 1 }, repetitions: { min: 1, max: 3, default: 1 }, mirrorable: true } })).errors.some((e) => e.code === 'duration')).toBe(true);
    expect(r({ ...motion('np'), priority: 5 }).errors.some((e) => e.code === 'priority')).toBe(true);
    expect(r(motion('nan', { tracks: [{ channel: 'head.rot', keys: [{ t: 0.5, v: NaN }] }] })).ok).toBe(false);
    const fixed = validateWithRepair(motion('fixme', { duration: 0.5, tracks: [{ channel: 'armR.raise', keys: [{ t: 0.1, v: 120, ease: 'linear' }, { t: 0.2, v: 8, ease: 'linear' }, { t: 0.5, v: 8 }] }] }));
    expect(fixed.report.ok).toBe(true); expect(fixed.report.fixes[0]).toMatch(/slowed clip/);
  });
  it('[A66] sandbox: previews run on an isolated engine and never touch the main character', async () => {
    const { AnimationEngine } = await import('../../animation/engine');
    const main = new AnimationEngine(); const before = { ...main.values };
    const sb = new SkillSandbox();
    sb.preview({ kind: 'motion', def: BUILTIN_MOTIONS.find((m) => m.id === 'wave')!, lookup: () => undefined });
    for (let i = 0; i < 40; i++) sb.step(1 / 30);
    expect(sb.engine.values['armR.raise']).toBeGreaterThan(40);
    main.update(0); expect(main.values['armR.raise']).toBeCloseTo(before['armR.raise'], 0);
    expect(sb.engine).not.toBe(main);
    sb.stop(); expect(sb.playing).toBeNull();
  });
  it('[A68] approval workflow: proposed → approved/rejected; deprecate/restore; failed never usable', async () => {
    const { reg, learn } = await setup();
    const o = await learn.propose({ format: 'motion', skill: motion('appr') });
    expect(reg.getVersion('appr')!.status).toBe('proposed'); expect(reg.pending().map((p) => p.id)).toContain('appr');
    await learn.approve('appr', o.version!); expect(reg.get('appr')).toBeDefined();
    await reg.deprecate('appr'); expect(reg.get('appr')).toBeUndefined(); expect(reg.catalog().map((c) => c.id)).not.toContain('appr');
    await reg.restore('appr', o.version!); expect(reg.get('appr')).toBeDefined();
    const o2 = await learn.propose({ format: 'motion', skill: motion('rej') }); await learn.reject('rej', o2.version!); expect(reg.get('rej')).toBeUndefined();
    const f = await learn.propose({ format: 'motion', skill: motion('broken', { tracks: [{ channel: 'head.rot', keys: [{ t: 0.5, v: 99 }] }] }) });
    expect(f.status).toBe('rejected'); expect(reg.getVersion('broken')?.status).toBe('failed'); expect(reg.get('broken')).toBeUndefined();
    expect((await reg.failures()).length).toBeGreaterThan(0);
  });
  it('[A69] versioning & rollback; storage failures are reported, not hidden', async () => {
    const kv = new MemoryKV(); const { reg, learn } = await setup(kv as never);
    const r1 = await learn.refine({ skillId: 'wave', speedFactor: 0.7, note: 'slower' }, null);
    expect(r1.status).toBe('proposed'); expect(reg.get('wave')!.params.speed.default).toBe(1); // still v1 until approved
    await reg.approve('wave', r1.version!); expect(reg.get('wave')!.params.speed.default).toBeCloseTo(0.7);
    expect(await reg.revert('wave')).toBe(1); expect(reg.get('wave')!.params.speed.default).toBe(1);
    expect(await reg.activate('wave', 2)).toBe(true);
    kv.failWrites = true;
    await expect(learn.propose({ format: 'motion', skill: motion('nostore') }).then((o) => o.status)).resolves.toBe('error');
    expect(reg.has('nostore')).toBe(false); expect(reg.lastError).toMatch(/failed/);
  });
  it('[A70] feedback refinement is bounded, validated and follows the configured policy', async () => {
    const { reg, learn } = await setup();
    learn.refinementPolicy = () => 'auto_low_risk';
    const r = await learn.refine({ skillId: 'nod', amplitudeFactor: 0.7, note: 'subtler' }, null);
    expect(r.status).toBe('saved'); expect(reg.get('nod')!.params.amplitude.default).toBeCloseTo(0.7);
    const fast = await learn.refine({ skillId: 'wave', speedFactor: 3, note: 'way faster' }, null);
    expect(['rejected', 'proposed', 'saved']).toContain(fast.status);
    if (fast.status !== 'rejected') expect(reg.getVersion('wave', fast.version)!.def).toBeDefined();
    expect(await learn.rate('nod', true, 'nice')).toBe(true);
    expect((await learn.feedback()).length).toBeGreaterThanOrEqual(2);
    expect((await learn.refine({ skillId: 'last', speedFactor: 0.8 } as never, null)).status).toBe('error');
  });
  it('[A61] corrupted and incompatible stored records are quarantined on load', async () => {
    const kv = db();
    await kv.put('skills', { id: 'junk', versions: 'nope' });
    await kv.put('skills', { id: 'evil', kind: 'motion', activeVersion: 1, createdAt: 1, updatedAt: 1, versions: [{ version: 1, kind: 'motion', status: 'approved', createdBy: 'llm_motion', note: '', createdAt: 1, def: motion('evil', { tracks: [{ channel: 'head.rot', keys: [{ t: 0.5, v: 300 }] }] }) }] });
    await kv.put('skills', { id: 'old', kind: 'motion', activeVersion: 1, createdAt: 1, updatedAt: 1, versions: [{ version: 1, kind: 'motion', status: 'approved', createdBy: 'llm_motion', note: '', createdAt: 1, compatibility: { rig: 'nexus-humanoid-3d', schema: 1 }, def: motion('old') }] });
    const reg = new SkillRegistry(kv); await reg.ready;
    expect(reg.quarantined.map((q) => q.id.split('@')[0]).sort()).toEqual(['evil', 'junk', 'old']);
    expect(reg.get('evil')).toBeUndefined(); expect(reg.get('wave')).toBeDefined();
  });
  it('[A67] export → import arrives as proposals (re-validated, never executed)', async () => {
    const a = await setup(); const o = await a.learn.propose({ format: 'motion', skill: motion('exp_me') }); await a.reg.approve('exp_me', o.version!);
    const b = await setup(); const res = await b.reg.importJSON(a.reg.exportJSON());
    expect(res.imported).toBe(1); expect(b.reg.getVersion('exp_me')!.status).toBe('proposed');
    expect((await b.reg.importJSON('{"records":[{"versions":[{"kind":"motion","def":{"id":"x","code":"evil()"}}]}]}')).rejected).toBe(1);
    expect(tr('head.rot', [1, 0]).keys).toHaveLength(1);
  });
});
