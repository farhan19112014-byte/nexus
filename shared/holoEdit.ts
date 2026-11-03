/**
 * HOLOBUILD: natural-language edit commands → validated operations, without any AI (works offline, instantly, and
 * the same way every time). Commands the parser does not understand return null, and NEXUS may then ask the
 * configured AI model (server) — whose answer is validated against the same operation schema.
 *
 * Target words ("the body", "rear wheel", "it", "this") are matched against part names, ids and groups. If a singular
 * target matches several parts equally well, NEXUS asks which one instead of changing something it was not asked to.
 */
import { HoloOpSchema, colorHex, modelBounds, normaliseMaterial, type HoloModel, type HoloOp } from './holo';

export type EditResult =
  | { kind: 'ops'; ops: HoloOp[] }
  | { kind: 'ui'; action: 'explode' | 'assemble' | 'reset-view' | 'undo' }
  | { kind: 'clarify'; message: string; candidates: string[] };

const STOP = new Set(['the', 'a', 'an', 'of', 'its', 'part', 'parts', 'component', 'components', 'piece', 'pieces', 'please', 'model', 'whole', 'entire', 'all', 'on', 'in', 'for']);
/** everyday words for structural parts → the words templates and AI models use in part names */
const SYNONYMS: Record<string, string[]> = {
  support: ['leg', 'pier', 'pillar', 'post', 'column', 'strut', 'tower', 'brace', 'suspender', 'hanger'], wheel: ['tyre', 'tire', 'rim'],
  tire: ['tyre'], body: ['body', 'shell', 'casing', 'chassis'], top: ['top', 'roof', 'lid'], motor: ['engine', 'motor'], hand: ['hand', 'gripper', 'finger'],
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
const singular = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Resolve a target phrase to a part id, group name, 'model', or a clarification. */
export function findTarget(phrase: string, m: HoloModel, selected: string | null, viaSynonym = false): { target: string; plural: boolean } | { clarify: string; candidates: string[] } | null {
  const p = phrase.trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
  if (!p || /^(it|everything|all|the whole thing|whole thing|the model|model|this model|object|the object|all of it|them)$/.test(p)) return { target: 'model', plural: true };
  if (/^(this|that|this part|that part|this one|that one|selected|the selected( part| one)?|selection)$/.test(p)) {
    return selected ? { target: selected, plural: false } : { clarify: 'Which part? Select one in the viewport first, or name it.', candidates: [] };
  }
  const q = words(p).filter((w) => !STOP.has(w));
  if (!q.length) return { target: 'model', plural: true };
  const plural = q.some((w) => singular(w) !== w) || /\b(all|every|both)\b/.test(p);
  const qs = q.map(singular);
  // whole-phrase matches first: exact name / id / group
  const exact = m.parts.filter((x) => x.name.toLowerCase() === p || x.id === p.replace(/\s+/g, '-'));
  if (exact.length === 1) return { target: exact[0].id, plural: false };
  const groups = [...new Set(m.parts.map((x) => x.group).filter(Boolean))];
  // a group is meant when it is named as such ("the legs", "the piston assembly") — or when it has only one part
  const g = groups.find((x) => x.toLowerCase() === p || (words(x).map(singular).join(' ') === qs.join(' ') && (plural || m.parts.filter((y) => y.group === x).length === 1)));
  if (g) return { target: g, plural: true };
  // word overlap score
  const scored = m.parts.map((x) => {
    const nameW = words(x.name).map(singular), idW = words(x.id).map(singular), groupW = words(x.group).map(singular);
    let s = 0; for (const w of qs) { if (nameW.includes(w)) s += 2; else if (idW.includes(w)) s += 1.5; else if (groupW.includes(w)) s += 1; }
    const all = qs.every((w) => nameW.includes(w) || idW.includes(w));
    return { id: x.id, name: x.name, s: s + (all ? 2 : 0), all };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) {
    // no direct match: try everyday synonyms once ("support" → legs / piers / pillars)
    const alt = q.map(singular).flatMap((w) => SYNONYMS[w] ?? []);
    if (!viaSynonym) for (const a of alt) { const r = findTarget(`${a}${plural ? 's' : ''}`, m, selected, true); if (r) return r; }
    return null;
  }
  const top = scored.filter((x) => x.s === scored[0].s);
  if (top.length === 1) return { target: top[0].id, plural: false };
  // a group shared by all equally-good matches
  const topGroups = new Set(top.map((t) => m.parts.find((x) => x.id === t.id)!.group));
  if (topGroups.size === 1 && [...topGroups][0] && plural) return { target: [...topGroups][0], plural: true };
  if (plural) return { clarify: '', candidates: top.map((t) => t.id) };   // several, as asked → expanded by the caller
  return { clarify: `Which one — ${top.slice(0, 6).map((t) => t.name).join(', ')}? Select it in the viewport or use its full name.`, candidates: top.map((t) => t.id) };
}

const MOVE: Record<string, [number, number, number]> = { forward: [0, 0, 1], forwards: [0, 0, 1], front: [0, 0, 1], back: [0, 0, -1], backward: [0, 0, -1], backwards: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], upward: [0, 1, 0], upwards: [0, 1, 0], higher: [0, 1, 0], down: [0, -1, 0], downward: [0, -1, 0], lower: [0, -1, 0] };
/** forward/back follow the model's front; for models facing the viewer (+z) left/right are the viewer's; for models
 *  facing ±x (vehicles drawn side-on) left/right are the vehicle's own sides */
function moveDir(word: string, front: HoloModel['front']): [number, number, number] {
  const base = MOVE[word]; if (front === '+z' || base[1] !== 0) return base;
  const f: [number, number, number] = front === '+x' ? [1, 0, 0] : front === '-x' ? [-1, 0, 0] : [0, 0, -1];
  const right: [number, number, number] = front === '+x' ? [0, 0, 1] : front === '-x' ? [0, 0, -1] : [-1, 0, 0];
  if (base[2] !== 0) return f.map((v) => v * base[2]) as [number, number, number];
  return right.map((v) => v * base[0]) as [number, number, number];
}
const NUMWORD: Record<string, number> = { twice: 2, double: 2, two: 2, three: 3, triple: 3, thrice: 3, four: 4, five: 5, ten: 10, half: 0.5 };
function amountMetres(s: string | undefined): number | null {
  if (!s) return null;
  const m = /([\d.]+)\s*(mm|millimet(?:re|er)s?|cm|centimet(?:re|er)s?|m|met(?:re|er)s?)?/i.exec(s); if (!m) return null;
  const v = Number(m[1]); if (!Number.isFinite(v)) return null;
  const u = (m[2] ?? 'cm').toLowerCase();
  return u.startsWith('mm') || u.startsWith('milli') ? v / 1000 : u.startsWith('c') ? v / 100 : v;
}

/** Parses one edit command. `selected` = the part currently selected in the viewport (or null). */
export function parseEdit(raw: string, m: HoloModel, selected: string | null): EditResult | null {
  let t = raw.trim().replace(/^(hey\s+)?nexus[,:]?\s*/i, '').replace(/^(please|can you|could you|would you|now)\s+/i, '').replace(/[.!?]+$/, '').replace(/\s+please$/i, '').trim();
  t = t.replace(/^(please\s+)/i, '');
  if (!t) return null;
  const b = modelBounds(m); const span = Math.max(...b.size) / m.scale || 1;
  const T = (phrase: string) => findTarget(phrase, m, selected);
  const out = (ops: HoloOp[]): EditResult | null => { const v = ops.map((o) => HoloOpSchema.safeParse(o)).filter((x) => x.success).map((x) => x.data!); return v.length ? { kind: 'ops', ops: v } : null; };
  /** builds ops for a target phrase; expands a plural match over several parts */
  const forTarget = (phrase: string, make: (target: string) => HoloOp[]): EditResult | null => {
    const r = T(phrase);
    if (!r) return { kind: 'clarify', message: `I couldn't find “${phrase.trim()}” in ${m.name}. Parts: ${m.parts.slice(0, 8).map((p) => p.name).join(', ')}${m.parts.length > 8 ? '…' : ''}.`, candidates: [] };
    if ('clarify' in r) return r.clarify ? { kind: 'clarify', message: r.clarify, candidates: r.candidates } : out(r.candidates.flatMap(make));
    return out(make(r.target));
  };

  // view actions
  if (/^(explode( it| the model| this)?|(show (the )?)?exploded view|take (it|this) apart|separate (the )?(parts|components)|pull (it )?apart)$/i.test(t)) return { kind: 'ui', action: 'explode' };
  if (/^(assemble|reassemble|put (it )?(back )?together|collapse)( (it|the model))?$/i.test(t)) return { kind: 'ui', action: 'assemble' };
  if (/^(reset|reset (the )?(view|camera)|centre|center)( the (view|camera))?$/i.test(t)) return { kind: 'ui', action: 'reset-view' };
  if (/^undo( that| the last (edit|change))?$/i.test(t)) return { kind: 'ui', action: 'undo' };

  // internal structure / x-ray
  if (/\b(show|reveal|see|let me see)\b.*\b(inside|internal|interior|inner|insides|workings)\b|\bx-?ray\b|\bcut-?away\b/i.test(t)) {
    if (!m.parts.some((p) => p.shell)) return { kind: 'clarify', message: `${m.name} has no outer casing marked to make see-through. Try “make the <part> transparent” or hide a part.`, candidates: [] };
    return out([{ op: 'xray', on: true }]);
  }
  if (/\b(hide the (inside|internals)|solid (casing|shell)|turn off x-?ray|make (it|the casing) solid( again)?)\b/i.test(t)) return out([{ op: 'xray', on: false }]);

  // rename
  let r = /^(?:rename|call)\s+(?:it|this|the model)\s+(?:to\s+|as\s+)?["“]?(.+?)["”]?$/i.exec(t);
  if (r) return out([{ op: 'rename', name: r[1].slice(0, 60) }]);

  // whole-model or part scale
  r = /^(?:make|scale)\s+(.+?)\s+(twice|double|two times|three times|triple|2x|3x|half)\s+(?:as\s+)?(?:large|big|the size|bigger|larger|size)$/i.exec(t)
    ?? /^(?:make|scale)\s+(.+?)\s+([\d.]+)\s*(?:x|times)\s*(?:as\s+)?(?:large|big|bigger|larger|the size)?$/i.exec(t);
  if (r) { const f = NUMWORD[r[2].toLowerCase()] ?? Number(r[2].replace(/x$/i, '')); if (Number.isFinite(f) && f > 0) return forTarget(r[1], (target) => [{ op: 'scale', target, factor: f }]); }
  r = /^(double|halve|triple)\s+(?:the\s+)?size(?:\s+of\s+(.+))?$/i.exec(t);
  if (r) return forTarget(r[2] ?? 'it', (target) => [{ op: 'scale', target, factor: r![1].toLowerCase() === 'halve' ? 0.5 : r![1].toLowerCase() === 'triple' ? 3 : 2 }]);
  r = /^scale\s+(.+?)\s+(?:by\s+)?([\d.]+)$/i.exec(t) ?? /^scale\s+(?:it\s+)?(?:by\s+)?([\d.]+)$/i.exec(t);
  if (r) { const phrase = r.length === 3 ? r[1] : 'it'; const f = Number(r.at(-1)); if (f > 0) return forTarget(phrase, (target) => [{ op: 'scale', target, factor: f }]); }

  // one dimension
  r = /^make\s+(.+?)\s+(taller|higher|shorter|longer|wider|broader|narrower|thinner|thicker|deeper|shallower|bigger|larger|smaller|tinier)$/i.exec(t);
  if (r) {
    const adj = r[2].toLowerCase();
    return forTarget(r[1], (target) => {
      const parts = target === 'model' ? m.parts : m.parts.filter((p) => p.id === target || p.group === target);
      const longer = parts.length && Math.max(...parts.map((p) => p.size[0])) >= Math.max(...parts.map((p) => p.size[2])) ? 'x' : 'z';
      switch (adj) {
        case 'taller': case 'higher': return [{ op: 'resize', target, axis: 'y', factor: 1.3 }];
        case 'shorter': return [{ op: 'resize', target, axis: 'y', factor: 0.75 }];
        case 'longer': return [{ op: 'resize', target, axis: longer, factor: 1.3 }];
        case 'wider': case 'broader': return [{ op: 'resize', target, axis: 'x', factor: 1.3 }];
        case 'narrower': return [{ op: 'resize', target, axis: 'x', factor: 0.75 }];
        case 'thinner': return [{ op: 'resize', target, axis: 'x', factor: 0.75 }, { op: 'resize', target, axis: 'z', factor: 0.75 }];
        case 'thicker': return [{ op: 'resize', target, axis: 'x', factor: 1.3 }, { op: 'resize', target, axis: 'z', factor: 1.3 }];
        case 'deeper': return [{ op: 'resize', target, axis: 'z', factor: 1.3 }];
        case 'shallower': return [{ op: 'resize', target, axis: 'z', factor: 0.75 }];
        case 'bigger': case 'larger': return [{ op: 'scale', target, factor: 1.25 }];
        default: return [{ op: 'scale', target, factor: 0.8 }];
      }
    });
  }

  // material
  r = /^(?:change|set|switch|turn)\s+(?:the\s+)?material(?:\s+of\s+(.+?))?\s+(?:to|into)\s+(.+)$/i.exec(t)
    ?? /^(?:change|switch|turn)\s+(.+?)\s+(?:to|into)\s+(.+)$/i.exec(t)
    ?? /^make\s+(.+?)\s+(?:out\s+of|from|in)\s+(.+)$/i.exec(t)
    ?? /^use\s+(.+?)\s+for\s+(.+)$/i.exec(t);
  if (r) {
    const [phrase, what] = /^use\s/i.test(t) ? [r[2], r[1]] : [r[1] ?? (selected ? 'this' : 'it'), r[2]];
    const mat = normaliseMaterial(what); const col = colorHex(what);
    if (mat && !/transparent|clear/i.test(what)) return forTarget(phrase, (target) => [{ op: 'material', target, material: mat }]);
    if (/transparent|see-?through|clear/i.test(what)) return forTarget(phrase, (target) => [{ op: 'opacity', target, value: 0.3 }]);
    if (col) return forTarget(phrase, (target) => [{ op: 'color', target, color: col }]);
  }
  // transparency / opacity
  r = /^make\s+(.+?)\s+(transparent|see-?through|translucent|invisible|opaque|solid)$/i.exec(t);
  if (r) { const v = r[2].toLowerCase(); return forTarget(r[1], (target) => [v === 'invisible' ? { op: 'hide', target } : { op: 'opacity', target, value: v === 'opaque' || v === 'solid' ? 1 : v === 'translucent' ? 0.55 : 0.3 }]); }
  // colour
  r = /^(?:colou?r|paint)\s+(.+?)\s+(?:in\s+)?([a-z#0-9 ]+)$/i.exec(t) ?? /^make\s+(.+?)\s+([a-z#0-9]+(?:\s+[a-z]+)?)$/i.exec(t);
  if (r) {
    const col = colorHex(r[2]); const mat = normaliseMaterial(r[2]);
    if (col) return forTarget(r[1], (target) => [{ op: 'color', target, color: col }]);
    if (mat) return forTarget(r[1], (target) => [{ op: 'material', target, material: mat }]);
  }
  // move
  r = /^(?:move|shift|slide|push)\s+(.+?)\s+(forwards?|front|backwards?|back|left|right|up|upwards?|down|downwards?|higher|lower)(?:\s+(?:by\s+)?(.+))?$/i.exec(t);
  if (r) {
    const dir = moveDir(r[2].toLowerCase(), m.front); const d = amountMetres(r[3]) ?? Math.max(0.02, span * 0.1);
    return forTarget(r[1], (target) => [{ op: 'move', target, delta: dir.map((v) => v * d) as [number, number, number] }]);
  }
  // rotate
  r = /^(?:rotate|turn|spin)\s+(.+?)\s+(?:by\s+)?(-?[\d.]+)\s*(?:°|deg(?:rees)?)?(?:\s+(?:around|about|on)\s+(?:the\s+)?([xyz])(?:[\s-]*axis)?)?$/i.exec(t);
  if (r) { const deg = Number(r[2]); const axis = (r[3]?.toLowerCase() ?? 'y') as 'x' | 'y' | 'z'; if (Number.isFinite(deg)) return forTarget(r[1], (target) => [{ op: 'rotate', target, axis, degrees: deg }]); }
  // visibility
  if (/^(show|unhide|reveal)\s+(everything|all|all parts|all the parts|the whole model)$/i.test(t)) return out([{ op: 'show', target: 'model' }]);
  r = /^(?:isolate|only show|show only|focus on)\s+(.+)$/i.exec(t);
  if (r) return forTarget(r[1], (target) => [{ op: 'isolate', target }]);
  r = /^(hide|show|unhide|remove|delete|take off|take away|get rid of)\s+(.+)$/i.exec(t);
  if (r) {
    const v = r[1].toLowerCase(); const op = v === 'hide' ? 'hide' : v === 'show' || v === 'unhide' ? 'show' : 'remove';
    return forTarget(r[2], (target) => [{ op, target } as HoloOp]);
  }
  // duplicate
  r = /^(?:add\s+(?:another|one more|a second|an extra|a)|duplicate|copy|clone)\s+(.+)$/i.exec(t);
  if (r) {
    // "add another leg" when there are four equal legs means one more of those, not "which one?"
    const hit = T(r[1]);
    if (hit && 'clarify' in hit && hit.clarify && hit.candidates.length > 1) {
      const gs = new Set(hit.candidates.map((id) => m.parts.find((p) => p.id === id)?.group ?? ''));
      if (gs.size === 1 && [...gs][0]) r[1] = hit.candidates.at(-1)!;
    }
    return forTarget(r[1], (target) => {
      if (target === 'model') return [];
      const parts = m.parts.filter((p) => p.id === target || p.group === target); if (!parts.length) return [];
      const sx = Math.max(...parts.map((p) => p.size[0])); const cx = parts.reduce((a, p) => a + p.position[0], 0) / parts.length;
      const dir = cx >= (b.center[0] / m.scale) ? 1 : -1;
      return [{ op: 'duplicate', target, offset: [dir * Math.max(sx * 1.4, span * 0.08), 0, 0] }];
    });
  }
  return null;
}
