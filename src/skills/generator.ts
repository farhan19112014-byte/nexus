/**
 * Assets 63/64 — proposal generators.
 * compileGeneratorSpec: motif composition → declarative motion (the generator owns the channel math;
 * an LLM or the demo brain only chooses motifs and parameters).
 * inventSpec / inventExpression: seeded procedural invention used in demo mode and as fallback.
 * All outputs are UNTRUSTED until validated (validator.ts).
 */
import { ExpressionPresetSchema, GeneratorSpecSchema, MOTIFS, SkillDefSchema, type ExpressionPreset, type GeneratorSpec, type Motif, type SkillDef, type Track } from '../../shared/schema';
import { CHANNELS, FACE_CHANNELS, mirrorChannel, MIRROR_NEGATE, restOf, type Channel } from '../../shared/channels';
import { tr } from '../animation/builtinMotions';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { seeded } from '../animation/engine';

type K = [number, number, ('easeOut' | 'easeInOut' | 'linear')?];
interface Segment { len: number; tracks: Track[]; expression?: string }
type Builder = (I: number, d: number, n: number) => Segment;
const R = (ch: Channel) => restOf(ch);
/** hold a value between a and b, starting/ending at rest */
const hold = (ch: Channel, L: number, a: number, b: number, v: number): Track => tr(ch, [0, R(ch)], [a * L, v, 'easeOut'], [b * L, v], [L, R(ch)]);
const osc = (ch: Channel, start: number, period: number, n: number, lo: number, hi: number, L: number): Track => {
  const keys: K[] = [[0, R(ch)], [start, lo]];
  for (let i = 0; i < n; i++) keys.push([start + period * (i + 0.5), hi], [start + period * (i + 1), lo]);
  keys.push([L, R(ch)]);
  return tr(ch, ...keys);
};

const B: Record<Motif, Builder> = {
  wave: (I, d, n) => { const up = 0.4 * d, p = 0.6 * d, L = up * 2 + p * n; return { len: L, expression: 'happy', tracks: [hold('armR.raise', L, up / L, 1 - up / L, 8 + 108 * I), osc('armR.bend', up, p, n, 34, 34 + 24 * I, L), osc('handR.spin', up, p, n, -14 * I, 16 * I, L)] }; },
  raise_hand: (I, d) => { const L = 1.6 * d; return { len: L, tracks: [hold('armR.raise', L, 0.3, 0.75, 8 + 140 * I), hold('armR.bend', L, 0.3, 0.75, 16)] }; },
  point: (I, d) => { const L = 1.6 * d; return { len: L, expression: 'curious', tracks: [hold('armR.raise', L, 0.3, 0.75, 8 + 80 * I), hold('armR.bend', L, 0.3, 0.75, 2), hold('pupil.x', L, 0.3, 0.75, -0.9)] }; },
  open_arms: (I, d) => { const L = 1.8 * d; return { len: L, expression: 'happy', tracks: [hold('armL.raise', L, 0.3, 0.7, 8 + 64 * I), hold('armR.raise', L, 0.3, 0.7, 8 + 64 * I), hold('armL.bend', L, 0.3, 0.7, 22), hold('armR.bend', L, 0.3, 0.7, 22)] }; },
  hand_on_chest: (_I, d) => { const L = 1.8 * d; return { len: L, expression: 'happy', tracks: [hold('armR.raise', L, 0.3, 0.7, -20), hold('armR.bend', L, 0.3, 0.7, -75), hold('head.nod', L, 0.3, 0.7, 0.35)] }; },
  clap: (I, d, n) => { const up = 0.35 * d, p = 0.4 * d, L = up * 2 + p * n; return { len: L, expression: 'happy', tracks: [hold('armL.raise', L, up / L, 1 - up / L, 20), hold('armR.raise', L, up / L, 1 - up / L, 20), osc('armL.bend', up, p, n, -60, -60 - 35 * I, L), osc('armR.bend', up, p, n, -60, -60 - 35 * I, L)] }; },
  fist_pump: (I, d, n) => { const up = 0.35 * d, p = 0.4 * d, L = up * 2 + p * n; return { len: L, expression: 'determined', tracks: [hold('armR.raise', L, up / L, 1 - up / L, 70), osc('armR.bend', up, p, n, 60, 60 + 50 * I, L), osc('body.y', up, p, n, 0, -6 * I, L)] }; },
  salute: (_I, d) => { const L = 1.8 * d; return { len: L, expression: 'determined', tracks: [hold('armR.raise', L, 0.3, 0.7, 150), hold('armR.bend', L, 0.3, 0.7, 70), hold('head.nod', L, 0.3, 0.7, -0.2)] }; },
  nod: (I, d, n) => { const p = 0.5 * d, L = p * n + 0.2; return { len: L, tracks: [osc('head.nod', 0.05, p, n, 0, 0.7 * I, L)] }; },
  shake_head: (I, d, n) => { const p = 0.6 * d, L = p * n + 0.3; return { len: L, tracks: [osc('head.x', 0.1, p, n, -6 * I, 6 * I, L), osc('head.rot', 0.1, p, n, -6 * I, 6 * I, L)] }; },
  head_tilt: (I, d) => { const L = 1.4 * d; return { len: L, expression: 'curious', tracks: [hold('head.rot', L, 0.25, 0.75, 16 * I)] }; },
  bounce: (I, d, n) => { const p = 0.5 * d, L = p * n + 0.2; return { len: L, expression: 'happy', tracks: [osc('body.y', 0.05, p, n, 0, -10 * I, L), osc('body.squash', 0.05, p, n, 0.05 * I, -0.04 * I, L)] }; },
  sway: (I, d, n) => { const p = 1.2 * d, L = p * n + 0.3; return { len: L, expression: 'playful', tracks: [osc('body.rot', 0.15, p, n, -7 * I, 7 * I, L), osc('head.rot', 0.15, p, n, 8 * I, -8 * I, L)] }; },
  hop: (I, d) => { const L = 1.0 * d; return { len: L, expression: 'happy', tracks: [tr('body.y', [0, 0], [0.2 * L, 5], [0.45 * L, -18 * I, 'easeOut'], [0.7 * L, 0], [L, 0]), tr('body.squash', [0, 0], [0.2 * L, 0.08], [0.45 * L, -0.06], [0.7 * L, 0.04], [L, 0]), tr('legL.lift', [0, 0], [0.45 * L, 0.4], [0.7 * L, 0], [L, 0]), tr('legR.lift', [0, 0], [0.45 * L, 0.4], [0.7 * L, 0], [L, 0])] }; },
  shrug: (I, d) => { const L = 1.4 * d; return { len: L, expression: 'confused', tracks: [hold('armL.raise', L, 0.25, 0.65, 8 + 30 * I), hold('armR.raise', L, 0.25, 0.65, 8 + 30 * I), hold('armL.bend', L, 0.25, 0.65, 70), hold('armR.bend', L, 0.25, 0.65, 70), hold('head.rot', L, 0.25, 0.65, 10)] }; },
  spin_antenna: (I, d, n) => { const p = 0.5 * d, L = p * n + 0.2; return { len: L, expression: 'playful', tracks: [osc('antenna.rot', 0.05, p, n, -24 * I, 24 * I, L), osc('antenna.glow', 0.05, p, n, 0.4, 1, L)] }; },
  peek: (I, d) => { const L = 1.8 * d; return { len: L, expression: 'curious', tracks: [hold('body.rot', L, 0.3, 0.7, -10 * I), hold('head.rot', L, 0.3, 0.7, -16 * I), hold('body.x', L, 0.3, 0.7, -14 * I), hold('pupil.x', L, 0.3, 0.7, -0.9)] }; },
  step_side: (I, d) => { const L = 1.6 * d; return { len: L, tracks: [hold('body.x', L, 0.4, 0.6, -36 * I), tr('legR.lift', [0, 0], [0.2 * L, 0.5], [0.4 * L, 0], [0.6 * L, 0], [0.8 * L, 0.5], [L, 0]), tr('legL.lift', [0, 0], [0.3 * L, 0], [0.4 * L, 0.4], [0.5 * L, 0], [L, 0])] }; },
};

/** Expression → face tracks held over a segment (so generated skills carry their own face). */
function faceTracks(exprId: string | undefined, start: number, len: number): Track[] {
  const e = BUILTIN_EXPRESSIONS.find((x) => x.id === exprId);
  if (!e || len < 0.5) return [];
  return Object.entries(e.face).filter(([k]) => FACE_CHANNELS.includes(k as Channel) && !k.startsWith('pupil')).map(([k, v]) => {
    const ch = k as Channel; const ramp = Math.min(0.2, len * 0.2);
    return tr(ch, [start, R(ch)], [start + ramp, v], [start + len - ramp, v], [start + len, R(ch)]);
  });
}

function mirrorTrack(t: Track): Track {
  const ch = mirrorChannel(t.channel);
  const neg = MIRROR_NEGATE.has(t.channel);
  return { channel: ch, keys: t.keys.map((k) => ({ ...k, v: neg ? -k.v : k.v })) };
}

/** Compile a generator spec into an (unvalidated) motion SkillDef. */
export function compileGeneratorSpec(input: unknown): SkillDef {
  const spec: GeneratorSpec = GeneratorSpecSchema.parse(input);
  const segs: { seg: Segment; start: number }[] = [];
  let t0 = 0;
  for (const m of spec.motifs) {
    let seg = B[m.motif](m.intensity, m.duration, m.repeats);
    if (m.side === 'left') seg = { ...seg, tracks: seg.tracks.map(mirrorTrack) };
    const ex = m.expression ?? seg.expression;
    seg = { ...seg, tracks: [...seg.tracks, ...faceTracks(ex, 0, seg.len)] };
    segs.push({ seg, start: t0 });
    t0 += seg.len;
  }
  const all = new Set<Channel>(); for (const { seg } of segs) for (const t of seg.tracks) all.add(t.channel);
  const keys = new Map<Channel, Track['keys']>();
  for (const { seg, start } of segs) {
    for (const ch of all) {
      const arr = keys.get(ch) ?? [];
      const push = (t: number, v: number, ease?: Track['keys'][number]['ease']) => {
        const tt = +t.toFixed(4); const last = arr[arr.length - 1];
        if (last && tt <= last.t) return;
        arr.push({ t: tt, v, ...(ease ? { ease } : {}) });
      };
      const track = seg.tracks.filter((t) => t.channel === ch);
      if (!track.length) { push(start, R(ch)); push(start + seg.len, R(ch)); }
      else for (const k of track[0].keys) push(start + k.t, k.v, k.ease);
      keys.set(ch, arr);
    }
  }
  const total = Math.max(0.2, +t0.toFixed(4));
  return SkillDefSchema.parse({
    id: spec.id, name: spec.name,
    description: spec.description || `Generated from motifs: ${spec.motifs.map((m) => m.motif).join(' → ')}`,
    kind: 'motion', priority: 2, duration: total,
    tracks: [...keys.entries()].map(([channel, k]) => ({ channel, keys: k.filter((x) => x.t <= total + 1e-6) })),
    params: { speed: { min: 0.75, max: 1.5, default: 1 }, amplitude: { min: 0.4, max: 1.2, default: 1 }, repetitions: { min: 1, max: 1, default: 1 }, mirrorable: true },
    createdBy: 'procedural_generator', tags: ['generated', ...spec.tags].slice(0, 12),
  });
}

const THEMES: Record<string, Motif[][]> = {
  greeting: [['wave', 'raise_hand', 'open_arms', 'hand_on_chest', 'salute'], ['nod', 'head_tilt', 'hop', 'bounce']],
  dance: [['sway', 'bounce', 'clap', 'spin_antenna', 'step_side', 'hop'], ['sway', 'clap', 'bounce', 'fist_pump']],
  celebration: [['fist_pump', 'clap', 'hop', 'raise_hand'], ['bounce', 'spin_antenna']],
  gesture: [[...MOTIFS]],
};

export function uniqueId(base: string, existing: Set<string>) {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'x_').slice(0, 40) || 'skill';
  if (!existing.has(clean)) return clean;
  let n = 2; while (existing.has(`${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

export function inventSpec(theme: string, seed: number, existing: Set<string>): GeneratorSpec {
  const rnd = seeded(seed);
  const pools = THEMES[theme] ?? THEMES.gesture;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const count = theme === 'dance' ? 3 : 2 + Math.floor(rnd() * 2);
  const motifs: GeneratorSpec['motifs'] = [];
  for (let i = 0; i < count; i++) {
    const pool = pools[Math.min(i, pools.length - 1)];
    let m = pick(pool); if (motifs.at(-1)?.motif === m) m = pick(pool);
    motifs.push({ motif: m, side: rnd() < 0.3 ? 'left' : 'right', intensity: +(0.6 + rnd() * 0.5).toFixed(2), duration: +(0.8 + rnd() * 0.5).toFixed(2), repeats: 1 + Math.floor(rnd() * 2) });
  }
  const base = theme === 'gesture' ? 'move' : theme;
  let n = 1; while (existing.has(`${base}_${n}`)) n++;
  return GeneratorSpecSchema.parse({ id: `${base}_${n}`, name: `${base[0].toUpperCase()}${base.slice(1)} #${n}`, description: `Invented ${theme}: ${motifs.map((m) => m.motif.replace(/_/g, ' ')).join(', ')}`, motifs, tags: [theme] });
}

/** Demo-mode expression invention: a weighted blend of two built-ins plus small asymmetric tweaks. */
export function inventExpression(seed: number, existing: Set<string>, mood?: string): ExpressionPreset {
  const rnd = seeded(seed);
  const pool = BUILTIN_EXPRESSIONS.filter((e) => !['error', 'neutral', 'listening', 'thinking'].includes(e.id));
  const a = pool.find((e) => e.id === mood) ?? pool[Math.floor(rnd() * pool.length)];
  let b = pool[Math.floor(rnd() * pool.length)]; if (b.id === a.id) b = pool[(pool.indexOf(b) + 1) % pool.length];
  const w = 0.55 + rnd() * 0.25;
  const face: Record<string, number> = {};
  for (const ch of FACE_CHANNELS) {
    if (ch === 'pupil.x' || ch === 'pupil.y') continue;
    const va = a.face[ch] ?? restOf(ch), vb = b.face[ch] ?? restOf(ch);
    let v = va * w + vb * (1 - w);
    if (/brow.\.y/.test(ch)) v += (rnd() - 0.5) * 0.3;
    const d = CHANNELS[ch];
    v = Math.min(d.max, Math.max(d.min, +v.toFixed(3)));
    if (Math.abs(v - restOf(ch)) > 0.02) face[ch] = v;
  }
  const name = `${a.name}-${b.name}`.slice(0, 40);
  return ExpressionPresetSchema.parse({
    id: uniqueId(`expr_${a.id}_${b.id}`, existing), name, description: `Blend of ${a.name} (${Math.round(w * 100)}%) and ${b.name}`,
    face, head: { rot: +(((a.head.rot ?? 0) * w + (b.head.rot ?? 0) * (1 - w))).toFixed(1) }, transitionMs: 280, tags: ['generated'],
  });
}
