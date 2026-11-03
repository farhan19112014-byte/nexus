/**
 * HOLOBUILD model format (shared by the browser and the NEXUS server).
 *
 * A model is a list of named PARTS built from basic shapes (box, cylinder, sphere, cone, torus, capsule, gear, tube) or,
 * for imported files, references to meshes. Everything is validated with strict bounds, so a model written by an AI
 * (or a hand-edited file) can never ask the renderer for absurd geometry.
 *
 * Coordinate convention: metres, y up, the model stands on y = 0, "front" faces +z (towards the default camera).
 *
 * Edits are OPERATIONS (scale, move, material, hide, remove, duplicate …) applied by `applyOps` — a pure function, so
 * the same edit gives the same result, every edit can be undone, and nothing outside the named target changes.
 */
import { z } from 'zod';

export const HOLO_LIMITS = { parts: 150, nameChars: 60, descriptionChars: 400, steps: 20, facts: 12, size: 60, position: 120, opsPerEdit: 12, importBytes: 25 * 1024 * 1024, importMeshes: 400 };

export const SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'capsule', 'gear', 'tube', 'mesh'] as const;
export type Shape = (typeof SHAPES)[number];

/** Material presets: physically-based parameters for the renderer, and a plain name for people. */
export const MATERIALS = {
  'brushed-aluminium': { label: 'Brushed aluminium', color: '#c4cad3', metalness: 0.9, roughness: 0.38 },
  steel: { label: 'Steel', color: '#8d949e', metalness: 0.85, roughness: 0.42 },
  chrome: { label: 'Chrome', color: '#e8edf3', metalness: 1, roughness: 0.08 },
  'cast-iron': { label: 'Cast iron', color: '#4a4f57', metalness: 0.7, roughness: 0.75 },
  brass: { label: 'Brass', color: '#c9a24a', metalness: 0.9, roughness: 0.3 },
  copper: { label: 'Copper', color: '#c47a4a', metalness: 0.9, roughness: 0.32 },
  gold: { label: 'Gold', color: '#e3b84d', metalness: 1, roughness: 0.22 },
  plastic: { label: 'Matte plastic', color: '#3a7bd5', metalness: 0, roughness: 0.65 },
  'gloss-plastic': { label: 'Gloss plastic', color: '#2f6fe0', metalness: 0, roughness: 0.18 },
  rubber: { label: 'Rubber', color: '#1d2026', metalness: 0, roughness: 0.92 },
  glass: { label: 'Glass', color: '#bfe3ff', metalness: 0, roughness: 0.05, opacity: 0.32 },
  wood: { label: 'Wood', color: '#9a6a3c', metalness: 0, roughness: 0.82 },
  'carbon-fibre': { label: 'Carbon fibre', color: '#24272d', metalness: 0.3, roughness: 0.4 },
  concrete: { label: 'Concrete', color: '#a7a9ad', metalness: 0, roughness: 0.95 },
  ceramic: { label: 'Ceramic', color: '#eef0f2', metalness: 0, roughness: 0.3 },
  tissue: { label: 'Organic tissue', color: '#b8404a', metalness: 0, roughness: 0.6 },
  emissive: { label: 'Light (glowing)', color: '#38d9ff', metalness: 0, roughness: 0.5, emissive: true },
} as const;
export type MaterialId = keyof typeof MATERIALS;
export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const vec3 = (min: number, max: number) => z.tuple([num(min, max), num(min, max), num(min, max)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const slug = z.string().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/);

export const HoloPartSchema = z.object({
  id: slug,
  name: z.string().min(1).max(HOLO_LIMITS.nameChars),
  description: z.string().max(HOLO_LIMITS.descriptionChars).default(''),
  shape: z.enum(SHAPES),
  /** box: width, height, depth · cylinder/cone/tube/gear: diameter, height, diameter · sphere: diameter ×3 (ellipsoid) ·
   *  torus: ring diameter, tube thickness, ring diameter · capsule: diameter, total length, diameter (all metres) */
  size: vec3(0.0005, HOLO_LIMITS.size),
  position: vec3(-HOLO_LIMITS.position, HOLO_LIMITS.position).default([0, 0, 0]),
  /** degrees */
  rotation: vec3(-360, 360).default([0, 0, 0]),
  material: z.enum(MATERIAL_IDS as [MaterialId, ...MaterialId[]]).default('plastic'),
  /** overrides the material colour */
  color: hex.optional(),
  opacity: num(0.05, 1).default(1),
  visible: z.boolean().default(true),
  /** assembly group, e.g. "piston assembly" (used for selecting, exploding and explaining together) */
  group: z.string().max(40).default(''),
  /** outer casing: made see-through by "show the internal structure" */
  shell: z.boolean().default(false),
  /** gear: number of teeth · tube: inner diameter as a fraction of the outer · cylinder: top/bottom radius ratio */
  teeth: z.number().int().min(6).max(80).optional(),
  hole: num(0, 0.95).optional(),
  taper: num(0, 4).optional(),
  /** exploded-view direction (normalised by the renderer); default: away from the model's centre */
  explode: vec3(-1, 1).optional(),
  /** imported models: index of the mesh in the imported file */
  mesh: z.number().int().min(0).max(HOLO_LIMITS.importMeshes).optional(),
}).strict();
export type HoloPart = z.infer<typeof HoloPartSchema>;
export type HoloPartInput = z.input<typeof HoloPartSchema>;

export const HoloStepSchema = z.object({ title: z.string().min(1).max(80), text: z.string().max(400).default(''), parts: z.array(slug).max(40).default([]) }).strict();
export type HoloStep = z.infer<typeof HoloStepSchema>;

export const ORIGINS = ['template', 'ai-procedural', 'imported'] as const;
export type HoloOrigin = (typeof ORIGINS)[number];

export const HoloModelSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(HOLO_LIMITS.nameChars),
  /** what the person asked for */
  prompt: z.string().max(400).default(''),
  origin: z.enum(ORIGINS),
  /** template id, AI model id, or file name */
  source: z.string().max(120).default(''),
  category: z.string().max(40).default('object'),
  description: z.string().max(800).default(''),
  /** honest caveat shown with the model (e.g. "schematic — not anatomically exact") */
  caveat: z.string().max(300).default(''),
  parts: z.array(HoloPartSchema).min(1).max(HOLO_LIMITS.parts),
  steps: z.array(HoloStepSchema).max(HOLO_LIMITS.steps).default([]),
  facts: z.array(z.string().min(1).max(300)).max(HOLO_LIMITS.facts).default([]),
  collection: z.string().max(40).default(''),
  createdAt: z.number().default(0),
  updatedAt: z.number().default(0),
  /** whole-model uniform scale applied on top of part sizes */
  scale: num(0.01, 100).default(1),
  /** stored edit history (most recent last), for undo and for learning from corrections */
  edits: z.array(z.string().max(200)).max(200).default([]),
  /** which way the model's front faces ("move it forward"); vehicles drawn side-on face +x */
  front: z.enum(['+z', '+x', '-x', '-z']).default('+z'),
}).strict().superRefine((m, ctx) => {
  const ids = new Set<string>();
  for (const p of m.parts) { if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate part id "${p.id}"` }); ids.add(p.id); }
});
export type HoloModel = z.infer<typeof HoloModelSchema>;
export type HoloModelInput = z.input<typeof HoloModelSchema>;

/**
 * Coerces untrusted input (an AI reply, a stored file) into a valid model: invalid parts are dropped (reported), numbers
 * are clamped, duplicate ids renamed. Returns null when nothing usable is left.
 */
export function coerceModel(raw: unknown, base: Partial<HoloModelInput>): { model: HoloModel | null; dropped: string[] } {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { model: null, dropped: ['not an object'] };
  const r = raw as Record<string, unknown>;
  const clampV = (v: unknown, lo: number, hi: number, d: [number, number, number]): [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v.map((x) => Math.min(hi, Math.max(lo, x))) as [number, number, number]) : d;
  const seen = new Set<string>();
  const parts: HoloPart[] = [];
  for (const [i, p0] of (Array.isArray(r.parts) ? r.parts : []).slice(0, HOLO_LIMITS.parts).entries()) {
    if (!p0 || typeof p0 !== 'object') { dropped.push(`part ${i + 1}: not an object`); continue; }
    const p = { ...(p0 as Record<string, unknown>) };
    let id = String(p.id ?? p.name ?? `part-${i + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || `part-${i + 1}`;
    while (seen.has(id)) id = `${id.slice(0, 33)}-${i + 1}`;
    p.id = id;
    if (typeof p.name !== 'string' || !p.name.trim()) p.name = id.replace(/-/g, ' ');
    p.name = String(p.name).slice(0, HOLO_LIMITS.nameChars);
    if (typeof p.description === 'string') p.description = p.description.slice(0, HOLO_LIMITS.descriptionChars);
    p.size = clampV(p.size, 0.0005, HOLO_LIMITS.size, [0.1, 0.1, 0.1]);
    if (p.position !== undefined) p.position = clampV(p.position, -HOLO_LIMITS.position, HOLO_LIMITS.position, [0, 0, 0]);
    if (p.rotation !== undefined) p.rotation = clampV(p.rotation, -360, 360, [0, 0, 0]);
    if (p.explode !== undefined) p.explode = clampV(p.explode, -1, 1, [0, 1, 0]);
    if (typeof p.material === 'string') { const m = normaliseMaterial(p.material); if (m) p.material = m; else delete p.material; }
    if (typeof p.color === 'string') { const c = colorHex(p.color); if (c) p.color = c; else delete p.color; }
    if (typeof p.opacity === 'number') p.opacity = Math.min(1, Math.max(0.05, p.opacity));
    if (typeof p.teeth === 'number') p.teeth = Math.round(Math.min(80, Math.max(6, p.teeth)));
    if (typeof p.hole === 'number') p.hole = Math.min(0.95, Math.max(0, p.hole));
    if (typeof p.taper === 'number') p.taper = Math.min(4, Math.max(0, p.taper));
    if (typeof p.group === 'string') p.group = p.group.slice(0, 40);
    if (p.shape === 'mesh' && base.origin !== 'imported') { dropped.push(`${id}: mesh parts only come from imported files`); continue; }
    for (const k of Object.keys(p)) if (!(k in HoloPartSchema.shape)) delete p[k];
    const ok = HoloPartSchema.safeParse(p);
    if (ok.success) { parts.push(ok.data); seen.add(id); } else dropped.push(`${id}: ${ok.error.issues[0]?.message ?? 'invalid'}`);
  }
  if (!parts.length) return { model: null, dropped };
  const ids = new Set(parts.map((p) => p.id));
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, HOLO_LIMITS.steps).map((s) => {
    const o = s as Record<string, unknown>;
    return { title: String(o?.title ?? '').slice(0, 80), text: String(o?.text ?? '').slice(0, 400), parts: (Array.isArray(o?.parts) ? o.parts : []).map(String).filter((x) => ids.has(x)).slice(0, 40) };
  }).filter((s) => s.title);
  const facts = (Array.isArray(r.facts) ? r.facts : []).map((f) => String(f).slice(0, 300)).filter(Boolean).slice(0, HOLO_LIMITS.facts);
  const m = HoloModelSchema.safeParse({
    ...base,
    name: String(r.name ?? base.name ?? 'Untitled model').slice(0, HOLO_LIMITS.nameChars) || 'Untitled model',
    category: String(r.category ?? base.category ?? 'object').slice(0, 40),
    description: String(r.description ?? base.description ?? '').slice(0, 800),
    caveat: String(r.caveat ?? base.caveat ?? '').slice(0, 300),
    parts, steps, facts,
  });
  if (!m.success) return { model: null, dropped: [...dropped, m.error.issues[0]?.message ?? 'invalid model'] };
  return { model: m.data, dropped };
}

/* ------------------------------------------------------------------ names → materials and colours */

const MATERIAL_WORDS: [RegExp, MaterialId][] = [
  [/brushed\s*alumin(i)?um|alumin(i)?um/i, 'brushed-aluminium'], [/stainless|steel|metal(lic)?$/i, 'steel'], [/chrome|mirror/i, 'chrome'],
  [/cast\s*iron|iron/i, 'cast-iron'], [/brass/i, 'brass'], [/copper/i, 'copper'], [/gold(en)?/i, 'gold'],
  [/gloss(y)?\s*plastic/i, 'gloss-plastic'], [/plastic/i, 'plastic'], [/rubber/i, 'rubber'], [/glass|transparent|clear/i, 'glass'],
  [/wood(en)?|oak|pine|timber/i, 'wood'], [/carbon\s*fib(re|er)/i, 'carbon-fibre'], [/concrete|stone/i, 'concrete'],
  [/ceramic|porcelain/i, 'ceramic'], [/tissue|muscle|flesh/i, 'tissue'], [/glow(ing)?|light|neon|emissive/i, 'emissive'],
];
export function normaliseMaterial(s: string): MaterialId | null {
  const k = s.trim().toLowerCase().replace(/\s+/g, '-');
  if ((MATERIAL_IDS as string[]).includes(k)) return k as MaterialId;
  for (const [re, id] of MATERIAL_WORDS) if (re.test(s)) return id;
  return null;
}
export const COLORS: Record<string, string> = {
  red: '#d63b3b', crimson: '#b0213a', orange: '#e8892c', yellow: '#e8c93a', gold: '#d9a93a', green: '#3aa65a', lime: '#8ccf3a', teal: '#2aa198',
  cyan: '#38d9ff', blue: '#1268f5', navy: '#1b2a5a', purple: '#7b4ad6', violet: '#8f5ae0', pink: '#e86aa6', magenta: '#c43ab0', brown: '#7a4e2a',
  black: '#15171c', white: '#f4f8ff', grey: '#8a919c', gray: '#8a919c', silver: '#c0c6cf',
};
export function colorHex(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${[...t.slice(1)].map((c) => c + c).join('')}`;
  return COLORS[t.replace(/^(dark|light)\s+/, '')] ?? null;
}

/* ------------------------------------------------------------------ operations */

const target = z.string().min(1).max(60);
export const HoloOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('scale'), target, factor: num(0.05, 20) }).strict(),
  z.object({ op: z.literal('resize'), target, axis: z.enum(['x', 'y', 'z']), factor: num(0.05, 20) }).strict(),
  z.object({ op: z.literal('move'), target, delta: vec3(-50, 50) }).strict(),
  z.object({ op: z.literal('rotate'), target, axis: z.enum(['x', 'y', 'z']), degrees: num(-360, 360) }).strict(),
  z.object({ op: z.literal('material'), target, material: z.enum(MATERIAL_IDS as [MaterialId, ...MaterialId[]]) }).strict(),
  z.object({ op: z.literal('color'), target, color: hex }).strict(),
  z.object({ op: z.literal('opacity'), target, value: num(0.05, 1) }).strict(),
  z.object({ op: z.literal('hide'), target }).strict(),
  z.object({ op: z.literal('show'), target }).strict(),
  z.object({ op: z.literal('isolate'), target }).strict(),
  z.object({ op: z.literal('remove'), target }).strict(),
  z.object({ op: z.literal('duplicate'), target, offset: vec3(-50, 50) }).strict(),
  z.object({ op: z.literal('xray'), on: z.boolean() }).strict(),
  z.object({ op: z.literal('rename'), name: z.string().min(1).max(HOLO_LIMITS.nameChars) }).strict(),
]);
export type HoloOp = z.infer<typeof HoloOpSchema>;

/** "model" = every part; otherwise a part id, or a group name (all parts in that group). */
export function resolveTarget(m: HoloModel, t: string): HoloPart[] | null {
  if (t === 'model' || t === '*') return m.parts;
  const byId = m.parts.filter((p) => p.id === t); if (byId.length) return byId;
  const byGroup = m.parts.filter((p) => p.group && p.group.toLowerCase() === t.toLowerCase()); if (byGroup.length) return byGroup;
  return null;
}

/** Applies validated operations. Returns the new model and a plain description of each change (or why it was skipped). */
export function applyOps(m0: HoloModel, ops: HoloOp[]): { model: HoloModel; log: string[]; changed: boolean } {
  const m: HoloModel = structuredClone(m0); const log: string[] = []; let changed = false;
  for (const op of ops.slice(0, HOLO_LIMITS.opsPerEdit)) {
    if (op.op === 'xray') { for (const p of m.parts) if (p.shell) p.opacity = op.on ? 0.22 : 1; log.push(op.on ? 'Made the outer casing see-through.' : 'Made the casing solid again.'); changed = true; continue; }
    if (op.op === 'rename') { m.name = op.name; log.push(`Renamed the model to “${op.name}”.`); changed = true; continue; }
    if (op.op === 'scale' && op.target === 'model') { m.scale = Math.min(100, Math.max(0.01, m.scale * op.factor)); log.push(`Scaled the whole model ×${round(op.factor)}.`); changed = true; continue; }
    const parts = resolveTarget(m, op.target);
    if (!parts) { log.push(`Skipped: there is no part called “${op.target}”.`); continue; }
    const names = parts.length > 3 ? `${parts.length} parts` : parts.map((p) => p.name).join(', ');
    switch (op.op) {
      case 'scale': {
        // similarity transform about the target's base centre: parts keep their arrangement and stay standing where they were
        const a = anchor(parts);
        for (const p of parts) { p.size = p.size.map((v) => clampSize(v * op.factor)) as HoloPart['size']; p.position = p.position.map((v, i) => clampPos(a[i] + (v - a[i]) * op.factor)) as HoloPart['position']; }
        log.push(`Scaled ${names} ×${round(op.factor)}.`); break;
      }
      case 'resize': {
        // a stretch along one WORLD axis about the target's base (y) or centre (x, z): stacked parts move apart instead of
        // overlapping, and a pitched slab (a roof) gets steeper rather than thicker
        const ax = 'xyz'.indexOf(op.axis) as 0 | 1 | 2; const a = anchor(parts);
        for (const p of parts) stretchPart(p, ax, a[ax], op.factor);
        log.push(`${op.factor > 1 ? 'Enlarged' : 'Reduced'} ${names} along ${op.axis.toUpperCase()} ×${round(op.factor)}.`); break;
      }
      case 'move': for (const p of parts) p.position = p.position.map((v, i) => clampPos(v + op.delta[i])) as HoloPart['position']; log.push(`Moved ${names} by ${op.delta.map(round).join(', ')} m.`); break;
      case 'rotate': { const i = 'xyz'.indexOf(op.axis); for (const p of parts) p.rotation[i] = ((p.rotation[i] + op.degrees + 540) % 360) - 180; log.push(`Rotated ${names} ${round(op.degrees)}° about ${op.axis.toUpperCase()}.`); break; }
      case 'material': for (const p of parts) { p.material = op.material; delete p.color; if (op.material === 'glass') p.opacity = MATERIALS.glass.opacity; } log.push(`Changed ${names} to ${MATERIALS[op.material].label.toLowerCase()}.`); break;
      case 'color': for (const p of parts) p.color = op.color; log.push(`Coloured ${names} ${op.color}.`); break;
      case 'opacity': for (const p of parts) p.opacity = op.value; log.push(op.value < 1 ? `Made ${names} ${Math.round((1 - op.value) * 100)}% transparent.` : `Made ${names} opaque.`); break;
      case 'hide': for (const p of parts) p.visible = false; log.push(`Hid ${names}.`); break;
      case 'show': for (const p of parts) p.visible = true; log.push(`Showed ${names}.`); break;
      case 'isolate': { const keep = new Set(parts.map((p) => p.id)); for (const p of m.parts) p.visible = keep.has(p.id); log.push(`Showing only ${names}.`); break; }
      case 'remove': {
        if (parts.length >= m.parts.length) { log.push('Skipped: removing every part would leave nothing — hide them instead.'); continue; }
        const drop = new Set(parts.map((p) => p.id)); m.parts = m.parts.filter((p) => !drop.has(p.id));
        for (const s of m.steps) s.parts = s.parts.filter((x) => !drop.has(x));
        log.push(`Removed ${names}.`); break;
      }
      case 'duplicate': {
        if (m.parts.length + parts.length > HOLO_LIMITS.parts) { log.push(`Skipped: a model can have at most ${HOLO_LIMITS.parts} parts.`); continue; }
        const ids = new Set(m.parts.map((p) => p.id));
        for (const p of parts) {
          let n = 2, id = `${p.id.slice(0, 34)}-${n}`; while (ids.has(id)) id = `${p.id.slice(0, 34)}-${++n}`; ids.add(id);
          m.parts.push({ ...structuredClone(p), id, name: `${p.name} ${n}`.slice(0, HOLO_LIMITS.nameChars), position: p.position.map((v, i) => clampPos(v + op.offset[i])) as HoloPart['position'] });
        }
        log.push(`Added another ${names}.`); break;
      }
    }
    changed = true;
  }
  if (changed) m.updatedAt = Date.now();
  return { model: m, log, changed };
}
const round = (v: number) => Math.round(v * 100) / 100;

/** Anchor for scaling a set of parts: the x/z centre and the lowest y of their bounds. */
function anchor(parts: HoloPart[]): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) { const h = halfExtent(p); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.position[i] - h[i]); hi[i] = Math.max(hi[i], p.position[i] + h[i]); } }
  return [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
}
/** Rotation matrix for Euler angles in degrees, order XYZ (three.js default): R = Rx · Ry · Rz. Row i = world axis i. */
export function rotationMatrix(r: readonly [number, number, number]): number[][] {
  const [x, y, z] = r.map((d) => (d * Math.PI) / 180); const [a, b, c, d, e, f] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ];
}
/** Stretches one part along world axis `ax` about coordinate `a` by `f`. */
function stretchPart(p: HoloPart, ax: 0 | 1 | 2, a: number, f: number): void {
  const [rx, ry, rz] = p.rotation;
  const tilt = (d: number) => Math.abs(d) > 3 && Math.abs(d) < 85;
  // pitched slab tilted about X (length along local z) or about Z (length along local x): keep its run, scale its rise
  const slabX = ax === 1 && p.shape === 'box' && tilt(rx) && ry === 0 && rz === 0;
  const slabZ = ax === 1 && p.shape === 'box' && tilt(rz) && rx === 0 && ry === 0;
  if (slabX || slabZ) {
    const L = slabX ? p.size[2] : p.size[0]; const ang = ((slabX ? rx : rz) * Math.PI) / 180;
    const dir = slabX ? [0, -Math.sin(ang), Math.cos(ang)] : [Math.cos(ang), Math.sin(ang), 0];
    const s = dir[1] < 0 ? 1 : -1;                                       // which end is the low one
    const low = p.position.map((v, i) => v + (s * dir[i] * L) / 2);
    low[1] = a + (low[1] - a) * f;
    const rise = Math.abs(L * Math.sin(ang)) * f, run = Math.abs(L * Math.cos(ang));
    const nAngle = Math.sign(ang) * Math.min(Math.atan2(rise, run), (85 * Math.PI) / 180); const nL = clampSize(run / Math.cos(nAngle));
    const nd = slabX ? [0, -Math.sin(nAngle), Math.cos(nAngle)] : [Math.cos(nAngle), Math.sin(nAngle), 0];
    if (slabX) { p.size[2] = nL; p.rotation[0] = round((nAngle * 180) / Math.PI); } else { p.size[0] = nL; p.rotation[2] = round((nAngle * 180) / Math.PI); }
    p.position = low.map((v, i) => clampPos(v - (s * nd[i] * nL) / 2)) as HoloPart['position'];
    return;
  }
  // otherwise: grow the local dimension most aligned with the world axis, and move the part with the stretch
  const R = rotationMatrix(p.rotation); const row = R[ax];
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(row[i]) > Math.abs(row[best]) ? i : best), 0);
  p.size[k] = clampSize(p.size[k] * f);
  p.position[ax] = clampPos(a + (p.position[ax] - a) * f);
}
const clampSize = (v: number) => Math.min(HOLO_LIMITS.size, Math.max(0.0005, v));
const clampPos = (v: number) => Math.min(HOLO_LIMITS.position, Math.max(-HOLO_LIMITS.position, v));

/** World-axis half extents of a part's (rotated) bounding box. */
export function halfExtent(p: Pick<HoloPart, 'size' | 'rotation'>): [number, number, number] {
  const R = rotationMatrix(p.rotation);
  return [0, 1, 2].map((i) => (Math.abs(R[i][0]) * p.size[0] + Math.abs(R[i][1]) * p.size[1] + Math.abs(R[i][2]) * p.size[2]) / 2) as [number, number, number];
}
/** Axis-aligned bounds of the model (rotated part boxes; tori/spheres approximated by their boxes). */
export function modelBounds(m: HoloModel): { min: [number, number, number]; max: [number, number, number]; size: [number, number, number]; center: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of m.parts) { const h = halfExtent(p); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.position[i] - h[i]); max[i] = Math.max(max[i], p.position[i] + h[i]); } }
  const s = m.scale; const size = [0, 1, 2].map((i) => (max[i] - min[i]) * s) as [number, number, number];
  return { min: min.map((v) => v * s) as typeof min, max: max.map((v) => v * s) as typeof max, size, center: [0, 1, 2].map((i) => ((min[i] + max[i]) / 2) * s) as [number, number, number] };
}

/** A compact, bounded description of the model for the AI (data, not instructions). */
export function describeForAI(m: HoloModel, selectedId: string | null = null, max = 3500): string {
  const b = modelBounds(m);
  const lines = [
    `Model: ${m.name} (${m.category}; origin: ${m.origin === 'template' ? 'NEXUS procedural template' : m.origin === 'ai-procedural' ? 'AI-designed from basic shapes' : 'imported file'})`,
    `Overall size ≈ ${b.size.map((v) => v.toFixed(2)).join(' × ')} m (W × H × D)`,
    m.caveat ? `Caveat: ${m.caveat}` : '',
    selectedId ? `Selected part: ${selectedId}` : '',
    'Parts (id · name · group · material · description):',
    ...m.parts.map((p) => `- ${p.id} · ${p.name}${p.group ? ` · ${p.group}` : ''} · ${p.material}${p.visible ? '' : ' (hidden)'}${p.description ? ` · ${p.description.slice(0, 120)}` : ''}`),
  ].filter(Boolean);
  let out = lines.join('\n'); if (out.length > max) out = `${out.slice(0, max - 20)}\n… (more parts)`;
  return out;
}
