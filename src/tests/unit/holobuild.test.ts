// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyOps, coerceModel, describeForAI, HoloModelSchema, modelBounds, rotationMatrix, type HoloModel, type HoloOp } from '../../../shared/holo';
import { parseEdit } from '../../../shared/holoEdit';
import { TEMPLATES, buildSubject, buildTemplate, matchTemplate } from '../../holobuild/templates';

const T = (id: string) => buildTemplate(TEMPLATES.find((t) => t.id === id)!, id);
const ops = (r: ReturnType<typeof parseEdit>): HoloOp[] => { expect(r?.kind).toBe('ops'); return r!.kind === 'ops' ? r!.ops : []; };
/** every part other than `ids` is byte-for-byte unchanged */
const untouchedExcept = (a: HoloModel, b: HoloModel, ids: string[]) => {
  for (const p of a.parts) if (!ids.includes(p.id)) expect(b.parts.find((q) => q.id === p.id), p.id).toEqual(p);
};

describe('HOLOBUILD model format and templates', () => {
  it('[A129] every procedural template builds a valid, labelled model with named, described parts', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(13);
    for (const t of TEMPLATES) {
      const m = buildTemplate(t, `build ${t.name}`);
      expect(HoloModelSchema.safeParse(m).success, t.id).toBe(true);
      expect(m.origin).toBe('template'); expect(m.source).toBe(t.id);
      expect(new Set(m.parts.map((p) => p.id)).size).toBe(m.parts.length);
      for (const p of m.parts) { expect(p.name.length).toBeGreaterThan(0); if (t.id !== 'basic-shape') expect(p.description.length, `${t.id}/${p.id}`).toBeGreaterThan(0); }
      for (const s of m.steps) for (const id of s.parts) expect(m.parts.some((p) => p.id === id), `${t.id} step → ${id}`).toBe(true);
      const b = modelBounds(m); expect(b.size.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      expect(b.min[1]).toBeGreaterThan(-0.6);    // stands on (or very near) the ground plane
    }
  });

  it('[A129] build requests resolve to the right template; unknown subjects match none (→ AI or honest refusal)', () => {
    const cases: [string, string | null][] = [
      ['Build a combustion engine', 'combustion-engine'], ['create a mechanical clock', 'mechanical-clock'], ['make me a suspension bridge', 'suspension-bridge'],
      ['Build a robotic arm', 'robotic-arm'], ['Create a futuristic motorcycle', 'motorcycle'], ['Show me a human heart', 'human-heart'],
      ['build a house', 'house'], ['make a chair', 'chair'], ['build a water molecule', 'molecule'], ['build the solar system', 'solar-system'],
      ['build a rocket', 'rocket'], ['make a red cube', 'basic-shape'], ['create a big blue sphere', 'basic-shape'], ['build a giraffe', null],
    ];
    for (const [text, want] of cases) {
      const subject = buildSubject(text); expect(subject, text).not.toBeNull();
      expect(matchTemplate(subject!)?.id ?? null, text).toBe(want);
    }
    expect(buildSubject('what is a piston?')).toBeNull();
    const cube = buildTemplate(matchTemplate('red cube')!, 'red cube'); expect(cube.parts[0].color).toBe('#d63b3b');
    const ch4 = buildTemplate(matchTemplate('methane molecule')!, 'methane molecule'); expect(ch4.parts.filter((p) => /hydrogen-/.test(p.id)).length).toBe(4);
  });

  it('[A129] coerceModel: untrusted AI output is clamped, cleaned and de-duplicated; junk is dropped and reported', () => {
    const { model, dropped } = coerceModel({
      name: 'Drone', category: 'aerospace', parts: [
        { id: 'Body!', name: 'Body', shape: 'box', size: [1, 0.2, 1], material: 'Brushed Aluminum', color: 'navy' },
        { id: 'body', name: 'Body copy', shape: 'box', size: [9999, -1, 0.5], position: [0, 1e9, 0], opacity: 7 },
        { id: 'blob', shape: 'mesh', size: [1, 1, 1] },
        { id: 'evil', shape: 'box', size: [1, 1, 1], onload: 'alert(1)' },
        { name: 'no shape', size: [1, 1, 1] }, 'nonsense',
      ], steps: [{ title: 'Frame', parts: ['body', 'ghost'] }], facts: ['A quadcopter has four rotors.'],
    }, { id: 'x', origin: 'ai-procedural', source: 'gemini' });
    expect(model).not.toBeNull();
    const ids = model!.parts.map((p) => p.id); expect(ids).toEqual(['body', 'body-2', 'evil']);
    expect(model!.parts[0]).toMatchObject({ material: 'brushed-aluminium', color: '#1b2a5a' });
    expect(model!.parts[1].size[0]).toBe(60); expect(model!.parts[1].position[1]).toBe(120); expect(model!.parts[1].opacity).toBe(1);
    expect(JSON.stringify(model)).not.toContain('onload');
    expect(model!.steps[0].parts).toEqual(['body']);
    expect(dropped.some((d) => /mesh parts only/.test(d))).toBe(true); expect(dropped.length).toBe(3);
    expect(coerceModel({ parts: [] }, { id: 'x', origin: 'ai-procedural' }).model).toBeNull();
    expect(coerceModel('<script>', { id: 'x', origin: 'ai-procedural' }).model).toBeNull();
  });

  it('[A129] describeForAI is bounded and labels the origin honestly', () => {
    const bridge = T('suspension-bridge');
    const d = describeForAI(bridge, 'deck', 1200); expect(d.length).toBeLessThanOrEqual(1200);
    expect(d).toContain('NEXUS procedural template'); expect(d).toContain('Selected part: deck');
    const I = rotationMatrix([0, 0, 0]); I.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 9)));
    const R = rotationMatrix([90, 0, 0]); expect(R[1][2]).toBeCloseTo(-1, 9); expect(R[2][1]).toBeCloseTo(1, 9);   // local z → world −y
  });
});

describe('HOLOBUILD natural-language edits', () => {
  it('[A130] the directive’s example commands parse to operations that change only what was named', () => {
    // "Make it twice as large." → whole-model scale, parts untouched
    const engine = T('combustion-engine');
    const big = applyOps(engine, ops(parseEdit('Make it twice as large.', engine, null)));
    expect(big.model.scale).toBe(2); expect(big.model.parts).toEqual(engine.parts);

    // "Change the material to brushed aluminium." with a selected part → only that part
    const alu = applyOps(engine, ops(parseEdit('Change the material to brushed aluminium.', engine, 'piston')));
    expect(alu.model.parts.find((p) => p.id === 'piston')!.material).toBe('brushed-aluminium'); untouchedExcept(engine, alu.model, ['piston']);
    // … and with nothing selected → the whole model
    const aluAll = applyOps(engine, ops(parseEdit('Change the material to brushed aluminium.', engine, null)));
    expect(aluAll.model.parts.every((p) => p.material === 'brushed-aluminium')).toBe(true);

    // "Make the body transparent." → the motorcycle's body group
    const moto = T('motorcycle');
    const glass = applyOps(moto, ops(parseEdit('Make the body transparent.', moto, null)));
    const body = moto.parts.filter((p) => p.group === 'body').map((p) => p.id); expect(body.length).toBeGreaterThan(1);
    for (const id of body) expect(glass.model.parts.find((p) => p.id === id)!.opacity).toBeLessThan(1);
    untouchedExcept(moto, glass.model, body);

    // "Move the engine forward." → +z, only the engine
    const fwd = applyOps(moto, ops(parseEdit('Move the engine forward.', moto, null)));
    const e0 = moto.parts.find((p) => p.id === 'engine')!, e1 = fwd.model.parts.find((p) => p.id === 'engine')!;
    expect(moto.front).toBe('+x');   // drawn side-on: its front is +x
    expect(e1.position[0]).toBeGreaterThan(e0.position[0]); expect(e1.position[2]).toBe(e0.position[2]); untouchedExcept(moto, fwd.model, ['engine']);
    const exact = applyOps(moto, ops(parseEdit('move the engine up by 5 cm', moto, null)));
    expect(exact.model.parts.find((p) => p.id === 'engine')!.position[1]).toBeCloseTo(e0.position[1] + 0.05, 6);

    // "Remove the rear wheel." → the rear-wheel group, nothing else
    const noRear = applyOps(moto, ops(parseEdit('Remove the rear wheel.', moto, null)));
    const rear = moto.parts.filter((p) => p.group === 'rear wheel').map((p) => p.id);
    expect(noRear.model.parts.some((p) => rear.includes(p.id))).toBe(false);
    expect(noRear.model.parts.length).toBe(moto.parts.length - rear.length); untouchedExcept(moto, noRear.model, rear);

    // "Add another support." → "support" means the table's legs: one more leg, the others untouched
    const table = T('table');
    const more = applyOps(table, ops(parseEdit('Add another support.', table, null)));
    expect(more.model.parts.length).toBe(table.parts.length + 1); untouchedExcept(table, more.model, []);
    const added = more.model.parts.at(-1)!; expect(added.group).toBe('legs'); expect(added.name).toMatch(/Leg/);

    // "Make the roof taller." → steeper roof with the same eaves; chimney grows upward from its base; walls untouched
    const house = T('house');
    const tall = applyOps(house, ops(parseEdit('Make the roof taller.', house, null)));
    const rf0 = house.parts.find((p) => p.id === 'roof-front')!, rf1 = tall.model.parts.find((p) => p.id === 'roof-front')!;
    expect(rf1.rotation[0]).toBeGreaterThan(rf0.rotation[0]); expect(rf1.size[1]).toBe(rf0.size[1]);   // steeper, not thicker
    const eave = (p: typeof rf0) => { const a = (p.rotation[0] * Math.PI) / 180; return [p.position[1] - (Math.sin(a) * p.size[2]) / 2, p.position[2] + (Math.cos(a) * p.size[2]) / 2]; };
    expect(eave(rf1)[0]).toBeCloseTo(eave(rf0)[0], 1); expect(eave(rf1)[1]).toBeCloseTo(eave(rf0)[1], 1);   // eaves stay (within the slab thickness)
    const ridge = (p: typeof rf0) => p.position[1] + (Math.sin((p.rotation[0] * Math.PI) / 180) * p.size[2]) / 2;
    expect(ridge(rf1)).toBeGreaterThan(ridge(rf0) + 0.2);
    untouchedExcept(house, tall.model, house.parts.filter((p) => p.group === 'roof').map((p) => p.id));

    // "Show the internal structure." → x-ray of casing only
    const xr = applyOps(engine, ops(parseEdit('Show the internal structure.', engine, null)));
    for (const p of xr.model.parts) expect(p.opacity).toBe(p.shell ? 0.22 : 1);
  });

  it('[A130] ambiguous singular targets ask instead of guessing; unknown parts are reported; unknown commands fall through', () => {
    const table = T('table');
    const r = parseEdit('remove the leg', table, null);
    expect(r?.kind).toBe('clarify'); if (r?.kind === 'clarify') expect(r.candidates.length).toBe(4);
    // plural asks for all of them
    const all = ops(parseEdit('make the legs thicker', table, null)); expect(all.every((o) => 'target' in o && o.target === 'legs')).toBe(true);
    // selection resolves "this"
    expect(ops(parseEdit('hide this', table, 'leg-2'))).toEqual([{ op: 'hide', target: 'leg-2' }]);
    expect(parseEdit('hide this', table, null)?.kind).toBe('clarify');
    const miss = parseEdit('remove the propeller', table, null); expect(miss?.kind).toBe('clarify'); if (miss?.kind === 'clarify') expect(miss.message).toMatch(/couldn't find/);
    expect(parseEdit('what does a piston do', table, null)).toBeNull();
    expect(parseEdit('explode it', table, null)).toEqual({ kind: 'ui', action: 'explode' });
    expect(parseEdit('undo', table, null)).toEqual({ kind: 'ui', action: 'undo' });
    expect(parseEdit('show the internal structure', table, null)?.kind).toBe('clarify');   // table has no casing
  });

  it('[A130] applyOps is pure, validated and refuses destructive or unbounded edits', () => {
    const chair = T('chair'); const before = structuredClone(chair);
    const r = applyOps(chair, [{ op: 'remove', target: 'model' }]); expect(r.changed).toBe(false); expect(r.log[0]).toMatch(/leave nothing/);
    expect(chair).toEqual(before);
    const ghost = applyOps(chair, [{ op: 'hide', target: 'propeller' }]); expect(ghost.changed).toBe(false); expect(ghost.log[0]).toMatch(/no part called/);
    const iso = applyOps(chair, [{ op: 'isolate', target: 'seat' }]); expect(iso.model.parts.filter((p) => p.visible).map((p) => p.id)).toEqual(['seat']);
    const legs2 = applyOps(chair, [{ op: 'scale', target: 'legs', factor: 2 }]);
    const l0 = chair.parts.find((p) => p.id === 'leg-1')!, l1 = legs2.model.parts.find((p) => p.id === 'leg-1')!;
    expect(l1.size[1]).toBeCloseTo(l0.size[1] * 2); expect(l1.position[1] - l1.size[1] / 2).toBeCloseTo(l0.position[1] - l0.size[1] / 2, 6);   // still on the floor
    // the op schema bounds factors (an AI asking for ×1e6 never reaches the renderer)
    expect(parseEdit('scale it by 1000000', chair, null)).toBeNull();
  });
});

describe('HOLOBUILD scene, export and import', () => {
  it('[A131] every template builds three.js meshes for every part with finite geometry; explode moves parts apart and back', async () => {
    const THREE = await import('three');
    const { buildModel, applyExplode, applySelection } = await import('../../holobuild/scene');
    for (const t of TEMPLATES) {
      const m = buildTemplate(t, t.id); const b = buildModel(THREE, m, { wireframe: false });
      expect(b.meshes.size, t.id).toBe(m.parts.length);
      for (const mesh of b.meshes.values()) {
        mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox!;
        expect([bb.min.x, bb.max.y, bb.max.z].every(Number.isFinite), `${t.id}/${mesh.userData.partId}`).toBe(true);
      }
      const box0 = new THREE.Box3().setFromObject(b.root); applyExplode(b, m, 1, 1);
      const box1 = new THREE.Box3().setFromObject(b.root);
      if (m.parts.length > 1) expect(box1.getSize(new THREE.Vector3()).length(), t.id).toBeGreaterThan(box0.getSize(new THREE.Vector3()).length());
      applyExplode(b, m, 0, 1); const box2 = new THREE.Box3().setFromObject(b.root);
      expect(box2.min.distanceTo(box0.min)).toBeLessThan(1e-6);
      applySelection(THREE, b, m.parts[0].id);
      expect((b.meshes.get(m.parts[0].id)!.material as import('three').MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(0.3);
      b.dispose();
    }
    // rendered bounds agree with the model's computed bounds (house: within the slab-thickness approximation)
    const house = buildTemplate(TEMPLATES.find((t) => t.id === 'house')!, 'house'); const hb = buildModel(THREE, house, { wireframe: false });
    const real = new THREE.Box3().setFromObject(hb.root); const calc = modelBounds(house);
    expect(real.max.y).toBeCloseTo(calc.max[1], 1); expect(real.min.y).toBeCloseTo(calc.min[1], 1);
  });

  it('[A132] GLB/GLTF export is valid and re-imports with the same part count; unsafe or broken imports are refused with a reason', async () => {
    const THREE = await import('three');
    const { buildModel, partsFromScene } = await import('../../holobuild/scene');
    const { exportObject, inspectGltf } = await import('../../holobuild/io');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const m = buildTemplate(TEMPLATES.find((t) => t.id === 'robotic-arm')!, 'robotic arm'); const b = buildModel(THREE, m, { wireframe: false });
    for (const binary of [true, false]) {
      const { data, check } = await exportObject(b.root, binary);
      expect(check.ok, check.error).toBe(true); expect(check.kind).toBe(binary ? 'glb' : 'gltf'); expect(check.meshes).toBe(m.parts.length);
      const buf = typeof data === 'string' ? new TextEncoder().encode(data).buffer as ArrayBuffer : data;
      const gltf = await new GLTFLoader().parseAsync(buf, '');
      const back = partsFromScene(THREE, gltf.scene, 400); expect(back.parts.length).toBe(m.parts.length);
      expect(back.parts.map((p) => p.name).sort()).toEqual(m.parts.map((p) => p.name).sort());
      const max = Math.max(...back.parts.map((p) => p.position[1] + p.size[1] / 2)); expect(max).toBeLessThanOrEqual(2.0001);
    }
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).buffer as ArrayBuffer;
    expect(inspectGltf(new ArrayBuffer(0)).error).toMatch(/empty/);
    expect(inspectGltf(new ArrayBuffer(26 * 1024 * 1024)).error).toMatch(/limit/);
    expect(inspectGltf(enc({ hello: 1 }), 'x.gltf').error).toMatch(/2\.0/);
    expect(inspectGltf(enc({ asset: { version: '2.0' }, meshes: [{}], buffers: [{ uri: 'model.bin' }] }), 'x.gltf').error).toMatch(/separate files/);
    expect(inspectGltf(enc({ asset: { version: '2.0' }, meshes: [{}], extensionsRequired: ['KHR_draco_mesh_compression'] }), 'x.gltf').error).toMatch(/Draco/);
    expect(inspectGltf(enc({ asset: { version: '2.0' }, meshes: [] }), 'x.gltf').error).toMatch(/no meshes/);
    expect(inspectGltf(new TextEncoder().encode('MZ\u0090 not a model').buffer as ArrayBuffer, 'evil.exe').ok).toBe(false);
    const glb = (await exportObject(b.root, true)).data as ArrayBuffer; const cut = glb.slice(0, glb.byteLength - 8);
    expect(inspectGltf(cut).error).toMatch(/truncated/);
    b.dispose();
  });

  it('[A132] the model library saves, lists newest first, skips corrupted records and deletes model + file together', async () => {
    const { HoloStore } = await import('../../holobuild/store');
    const { MemoryKV } = await import('../../storage/db');
    const kv = new MemoryKV(); const store = new HoloStore(kv);
    const a = await store.save({ ...T('chair'), collection: 'Furniture' }); await new Promise((r) => setTimeout(r, 3));
    const b = await store.save(T('table'));
    await kv.put('holo', { id: 'bad', name: 'x', parts: 'nope' });
    await store.saveFile(b.id, new Uint8Array([1, 2, 3]).buffer);
    const { models, skipped } = await store.list(); expect(models.map((m) => m.id)).toEqual([b.id, a.id]); expect(skipped).toBe(1);
    expect(await store.collections()).toEqual(['Furniture']);
    await store.remove(b.id); expect(await store.get(b.id)).toBeNull(); expect(await store.getFile(b.id)).toBeNull();
    kv.failWrites = true; await expect(store.save(a)).rejects.toThrow(/Could not save/);
  });
});

describe('HOLOBUILD workspace controller', () => {
  const setup = async (ai: boolean | null, reply?: (path: string, body: unknown) => unknown) => {
    const { HoloController } = await import('../../holobuild/controller');
    const { HoloStore } = await import('../../holobuild/store');
    const { MemoryKV } = await import('../../storage/db');
    const calls: { path: string; body: unknown }[] = []; const asks: [string, string][] = []; const said: string[] = []; const xp: string[] = []; const acts: string[] = [];
    const c = new HoloController({
      store: new HoloStore(new MemoryKV()), aiAvailable: () => ai,
      task: async (path, body) => { calls.push({ path, body }); if (!reply) throw new Error('no server'); return reply(path, body); },
      ask: (t, w) => asks.push([t, w]), announce: (t) => said.push(t), experience: (e) => xp.push(e.type),
      activity: (kind, label) => { acts.push(`start:${kind}:${label}`); return (o) => acts.push(`end:${o}`); },
    });
    await c.init();
    return { c, calls, asks, said, xp, acts };
  };

  it('[A131] builds from templates offline, routes edits / view actions / questions, and undoes exactly', async () => {
    const { c, calls, asks, said, acts } = await setup(false);
    expect((await c.command('Build a combustion engine')).kind).toBe('build');
    const m0 = c.getSnapshot().model!; expect(m0.origin).toBe('template'); expect(said[0]).toMatch(/24 parts/); expect(acts).toEqual(['start:building:Single-cylinder combustion engine', 'end:done']);
    expect(c.getSnapshot().dirty).toBe(true);
    expect((await c.command('Make it twice as large.')).kind).toBe('edit'); expect(c.getSnapshot().model!.scale).toBe(2);
    expect((await c.command('explode it')).kind).toBe('ui'); expect(c.getSnapshot().view.exploded).toBe(true);
    expect((await c.command('What does the camshaft do?')).kind).toBe('question');
    expect(asks[0][0]).toBe('What does the camshaft do?'); expect(asks[0][1]).toMatch(/camshaft · Camshaft/);
    c.undo(); expect(c.getSnapshot().model).toEqual(m0); c.redo(); expect(c.getSnapshot().model!.scale).toBe(2);
    expect(calls).toHaveLength(0);   // nothing needed the server
    c.select('piston'); expect((await c.command('make this brass')).kind).toBe('edit');
    expect(c.getSnapshot().model!.parts.find((p) => p.id === 'piston')!.material).toBe('brass');
    c.select('does-not-exist'); expect(c.getSnapshot().selected).toBe('piston');
  });

  it('[A131] without a template or an AI model NEXUS says so instead of showing something else; with AI the design is re-validated', async () => {
    const off = await setup(false);
    const r = await off.c.command('build a giraffe'); expect(r.kind).toBe('refused'); expect(r.message).toMatch(/no AI model is connected/);
    expect(off.c.getSnapshot().model).toBeNull(); expect(off.xp).toContain('build-unmatched');
    expect((await off.c.command('what is a gear ratio?')).kind).toBe('question');

    const on = await setup(true, (path) => path === '/api/holo/design'
      ? { model: { name: 'Giraffe', source: 'AI model: test', parts: [{ id: 'body', name: 'Body', shape: 'capsule', size: [0.8, 1.6, 0.8], position: [0, 1.8, 0], rotation: [0, 0, 90] }, { id: 'neck', name: 'Neck', shape: 'cylinder', size: [0.2, 1.8, 0.2], position: [0.7, 2.8, 0] }, { id: 'x', shape: 'mesh', size: [1, 1, 1] }] }, dropped: [] }
      : { ops: [{ op: 'resize', target: 'neck', axis: 'y', factor: 1.5 }, { op: 'remove', target: 'tail' }], reply: 'Longer neck.' });
    const b = await on.c.command('build a giraffe'); expect(b.kind).toBe('build');
    const m = on.c.getSnapshot().model!; expect(m.origin).toBe('ai-procedural'); expect(m.parts.map((p) => p.id)).toEqual(['body', 'neck']); expect(m.caveat).toMatch(/approximation/);
    expect(b.message).toMatch(/1 invalid part/);
    const e = await on.c.command('stretch the neck upwards a lot'); expect(e.kind).toBe('edit');
    expect(on.calls.at(-1)!.path).toBe('/api/holo/edit');
    expect(on.c.getSnapshot().model!.parts.find((p) => p.id === 'neck')!.size[1]).toBeCloseTo(2.7);
    expect(e.message).toMatch(/no part called “tail”/);   // an op on a part that does not exist changes nothing
  });

  it('[A132] save reads back before confirming; rename, reopen and delete work; a storage failure is reported, not hidden', async () => {
    const { c } = await setup(false);
    await c.command('build a chair');
    expect(await c.save({ collection: 'Furniture' })).toBe(true);
    const s = c.getSnapshot(); expect(s.dirty).toBe(false); expect(s.saved).toHaveLength(1); expect(s.saved[0].collection).toBe('Furniture');
    expect(await c.rename('Reading chair')).toBe(true); expect(c.getSnapshot().saved[0].name).toBe('Reading chair');
    c.close(); expect(await c.reopen(s.saved[0].id)).toBe(true); expect(c.getSnapshot().model!.name).toBe('Reading chair');
    expect(await c.remove(s.saved[0].id)).toBe(true); expect(c.getSnapshot().saved).toHaveLength(0);
    const exp = await c.exportFile(true); expect(exp?.name).toBe('reading-chair.glb'); expect(exp!.data.size).toBeGreaterThan(500);
    const { MemoryKV } = await import('../../storage/db'); const { HoloStore } = await import('../../holobuild/store'); const { HoloController } = await import('../../holobuild/controller');
    const kv = new MemoryKV(); kv.failWrites = true; const bad = new HoloController({ store: new HoloStore(kv), task: async () => ({}), aiAvailable: () => false });
    await bad.command('build a table'); expect(await bad.save()).toBe(false); expect(bad.getSnapshot().status.text).toMatch(/Could not save/);
  });
});

describe('HOLOBUILD ↔ conversation', () => {
  it('[A131] the conversation hands clear 3D-build requests to HOLOBUILD and leaves everything else to the AI', async () => {
    const { isChatBuildRequest } = await import('../../holobuild/intent');
    for (const t of ['Build a combustion engine', 'build me a suspension bridge', 'Create a 3D model of a human heart', 'NEXUS, make a model of a rocket', 'show me a 3d motorcycle']) expect(isChatBuildRequest(t), t).toBe(true);
    for (const t of ['Create a poem about rain', 'make me laugh', 'how do you build trust?', 'What is a 3D model?', 'design tips for my website']) expect(isChatBuildRequest(t), t).toBe(false);
  });
});
