/**
 * NEXUS visual presenter — what the model may ask the app to SHOW while it explains.
 *
 * Two sources, both validated here (the model only proposes; the app decides what is drawn):
 *   - "image":   a search query for a real-world reference picture. The NEXUS server looks it up on Wikipedia /
 *                Wikimedia Commons (free, no key) and returns the file with its author, licence and source page.
 *   - "diagram": an AI-generated explanatory visual, as DATA (a small typed spec). The app draws it itself as SVG,
 *                so no paid image model is needed and nothing the model writes is ever executed or rendered as HTML.
 * A visual is optional: most replies have none (chit-chat, short answers, personal topics).
 */
import { z } from 'zod';

const label = z.string().trim().min(1).max(48);
const note = z.string().trim().max(80);
const item = z.object({ label, note: note.optional() }).strict();

export const DIAGRAM_TYPES = ['orbit', 'network', 'flow', 'cycle', 'compare', 'timeline', 'forces', 'hierarchy', 'bars'] as const;

export const DiagramSchema = z.discriminatedUnion('type', [
  /** a centre with things around it (solar system, atom, an idea and its parts) */
  z.object({ type: z.literal('orbit'), title: label, center: item, items: z.array(item).min(1).max(9) }).strict(),
  /** layered nodes fully connected layer to layer (neural networks, pipelines of stages with many units) */
  z.object({ type: z.literal('network'), title: label, layers: z.array(z.object({ label, size: z.number().int().min(1).max(8) }).strict()).min(2).max(6) }).strict(),
  /** a left-to-right sequence of steps */
  z.object({ type: z.literal('flow'), title: label, steps: z.array(item).min(2).max(7) }).strict(),
  /** steps that repeat in a loop (water cycle, life cycles) */
  z.object({ type: z.literal('cycle'), title: label, steps: z.array(item).min(3).max(8) }).strict(),
  /** two things side by side */
  z.object({ type: z.literal('compare'), title: label,
    left: z.object({ title: label, points: z.array(note.min(1)).min(1).max(5) }).strict(),
    right: z.object({ title: label, points: z.array(note.min(1)).min(1).max(5) }).strict() }).strict(),
  /** dated events in order */
  z.object({ type: z.literal('timeline'), title: label, events: z.array(z.object({ date: z.string().trim().min(1).max(20), label, note: note.optional() }).strict()).min(2).max(8) }).strict(),
  /** a body with force arrows (gravity, friction, lift…) and an optional attracting body */
  z.object({ type: z.literal('forces'), title: label, body: item, attractor: item.optional(),
    forces: z.array(z.object({ label, direction: z.enum(['up', 'down', 'left', 'right', 'toward', 'away']), strength: z.number().min(0.2).max(1).default(0.7) }).strict()).min(1).max(4) }).strict(),
  /** a root with children (classification, structure) */
  z.object({ type: z.literal('hierarchy'), title: label, root: label, children: z.array(z.object({ label, children: z.array(label).max(4).default([]) }).strict()).min(1).max(6) }).strict(),
  /** a small bar chart of approximate values the explanation uses (the caption must say they are approximate) */
  z.object({ type: z.literal('bars'), title: label, unit: z.string().trim().max(16).default(''), items: z.array(z.object({ label, value: z.number().finite().min(0).max(1e12) }).strict()).min(2).max(8) }).strict(),
]);
export type Diagram = z.infer<typeof DiagramSchema>;

export const VisualRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), query: z.string().trim().min(2).max(80), caption: z.string().trim().max(160).default('') }).strict(),
  z.object({ kind: z.literal('diagram'), diagram: DiagramSchema, caption: z.string().trim().max(160).default('') }).strict(),
]);
export type VisualRequest = z.infer<typeof VisualRequestSchema>;
export type VisualRequestInput = z.input<typeof VisualRequestSchema>;

/**
 * The field as it sits in the model's HEAD line: anything invalid becomes null (the reply and the rest of the head are
 * kept — a bad visual never costs the user the answer).
 */
export const VisualFieldSchema = z.preprocess((v) => normalizeVisual(v), VisualRequestSchema.nullable()).catch(null).default(null);

/**
 * Forgive the small slips language models make in a visual (the strict schema above still has the final word):
 * unknown keys dropped, over-long labels shortened, too many items cut to the limit, strings where objects are
 * expected ("items": ["Earth", …]) wrapped, numbers given as strings converted, sizes clamped, the type in any case.
 */
export function normalizeVisual(v: unknown): unknown {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return v ?? null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === 'string' ? x.trim().slice(0, n) : typeof x === 'number' ? String(x) : x);
  const lbl = (x: unknown) => str(x, 48);
  const itm = (x: unknown) => (typeof x === 'string' || typeof x === 'number' ? { label: lbl(x) } : x && typeof x === 'object' ? { label: lbl((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title), ...((x as Record<string, unknown>).note != null ? { note: str((x as Record<string, unknown>).note, 80) } : {}) } : x);
  const arr = (x: unknown, max: number, f: (y: unknown) => unknown) => (Array.isArray(x) ? x.slice(0, max).map(f) : x);
  const kind = typeof o.kind === 'string' ? o.kind.toLowerCase() : o.diagram ? 'diagram' : o.query ? 'image' : o.kind;
  const caption = str(o.caption ?? '', 160);
  if (kind === 'image') return { kind, query: str(o.query, 80), caption };
  if (kind !== 'diagram' || !o.diagram || typeof o.diagram !== 'object') return v;
  const d = o.diagram as Record<string, unknown>; const type = typeof d.type === 'string' ? d.type.toLowerCase() : d.type;
  const num = (x: unknown) => (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x.replace(/,/g, ''))) ? Number(x.replace(/,/g, '')) : x);
  const base = { type, title: lbl(d.title ?? 'Diagram') };
  let out: Record<string, unknown>;
  switch (type) {
    case 'orbit': out = { ...base, center: itm(d.center), items: arr(d.items, 9, itm) }; break;
    case 'network': out = { ...base, layers: arr(d.layers, 6, (l) => (l && typeof l === 'object' ? { label: lbl((l as Record<string, unknown>).label ?? ''), size: Math.max(1, Math.min(8, Math.round(Number(num((l as Record<string, unknown>).size)) || 1))) } : typeof l === 'number' ? { label: '', size: Math.max(1, Math.min(8, Math.round(l))) } : l)) };
      if (Array.isArray(out.layers)) out.layers = (out.layers as { label: string; size: number }[]).map((l, i, a) => ({ ...l, label: l.label || (i === 0 ? 'Input' : i === a.length - 1 ? 'Output' : 'Hidden') }));
      break;
    case 'flow': out = { ...base, steps: arr(d.steps, 7, itm) }; break;
    case 'cycle': out = { ...base, steps: arr(d.steps, 8, itm) }; break;
    case 'compare': { const side = (x: unknown) => (x && typeof x === 'object' ? { title: lbl((x as Record<string, unknown>).title ?? (x as Record<string, unknown>).label), points: arr((x as Record<string, unknown>).points, 5, (p) => str(p, 80)) } : x);
      out = { ...base, left: side(d.left), right: side(d.right) }; break; }
    case 'timeline': out = { ...base, events: arr(d.events, 8, (e) => (e && typeof e === 'object' ? { date: str((e as Record<string, unknown>).date, 20), label: lbl((e as Record<string, unknown>).label ?? (e as Record<string, unknown>).event), ...((e as Record<string, unknown>).note != null ? { note: str((e as Record<string, unknown>).note, 80) } : {}) } : e)) }; break;
    case 'forces': out = { ...base, body: itm(d.body), ...(d.attractor ? { attractor: itm(d.attractor) } : {}), forces: arr(d.forces, 4, (f) => (f && typeof f === 'object' ? { label: lbl((f as Record<string, unknown>).label), direction: typeof (f as Record<string, unknown>).direction === 'string' ? ((f as Record<string, unknown>).direction as string).toLowerCase() : (f as Record<string, unknown>).direction, strength: Math.max(0.2, Math.min(1, Number(num((f as Record<string, unknown>).strength ?? 0.7)) || 0.7)) } : f)) }; break;
    case 'hierarchy': out = { ...base, root: lbl(d.root), children: arr(d.children, 6, (c) => (typeof c === 'string' ? { label: lbl(c), children: [] } : c && typeof c === 'object' ? { label: lbl((c as Record<string, unknown>).label), children: arr((c as Record<string, unknown>).children ?? [], 4, (g) => lbl(typeof g === 'object' && g ? (g as Record<string, unknown>).label : g)) } : c)) }; break;
    case 'bars': out = { ...base, unit: str(d.unit ?? '', 16), items: arr(d.items, 8, (b) => (b && typeof b === 'object' ? { label: lbl((b as Record<string, unknown>).label), value: num((b as Record<string, unknown>).value) } : b)) }; break;
    default: return v;
  }
  return { kind, caption, diagram: out };
}

/** A real image found for an "image" request, with everything needed to credit it. */
export interface ImageResult {
  url: string;            // the image itself (a scaled rendition from upload.wikimedia.org)
  width: number; height: number;
  title: string;          // the Wikipedia article it illustrates
  pageUrl: string;        // that article
  fileUrl: string;        // the file's description page on Commons (licence details)
  author: string;         // plain text, may be "Unknown"
  license: string;        // e.g. "CC BY-SA 4.0", "Public domain"
  licenseUrl: string | null;
  source: 'Wikimedia Commons';
}
/** Wikimedia's image hosts: originals on upload., resized renditions on thumb. (both serve only Commons/Wikipedia files) */
export const IMAGE_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'] as const;
/** only https images from the hosts above are ever shown */
export function isAllowedImageUrl(u: string) { try { const x = new URL(u); return x.protocol === 'https:' && (IMAGE_HOSTS as readonly string[]).includes(x.hostname); } catch { return false; } }

/** Strip markup from a Commons metadata field (it is HTML) — the result is shown as plain text only. */
export function plainText(html: string | undefined, max = 120): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, max);
}

const LEAD = /^(?:(?:hey|hi|ok|okay|so|please|nexus)[,!\s]+)*(?:can you |could you |would you |pls |please )?(?:tell me (?:about|more about)|explain(?: to me)?|show me(?: a picture of| an image of| a photo of)?|describe|teach me about|what (?:is|are|was|were)|what's|who (?:is|are|was|were)|who's|where (?:is|are|was|were)|where's|when (?:was|were|is|did)|why (?:is|are|do|does|did)|how (?:does|do|did|is|are|was|were)|how's)\s+/i;
const TAIL = /\s+(?:look like|looks like|work|works|mean|means|happen|happened|made|built|formed|used|exist|called|located)\??$/i;
const SMALL_TALK = /^(?:hi|hello|hey|yo|thanks|thank you|thx|ok|okay|bye|goodbye|good (?:morning|night|evening)|lol|haha|yes|no|nice|cool|great)\b/i;
/**
 * The subject of a message, as an image-search query — for "always show a visual" when the model sent none:
 * "Who is Shah Rukh Khan?" → "Shah Rukh Khan", "how does the Eiffel Tower look like" → "the Eiffel Tower".
 * Small talk and pronoun-only follow-ups ("how does he look like") return null (the caller then reuses the last topic).
 */
export function topicFromText(text: string): string | null {
  let t = text.trim().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
  if (!t || SMALL_TALK.test(t)) return null;
  for (let i = 0; i < 2; i++) t = t.replace(LEAD, '');
  t = t.replace(TAIL, '').replace(/^(?:the|a|an)\s+/i, '').trim();
  if (/^(?:he|she|it|they|him|her|them|this|that|these|those|e|one)$/i.test(t) || t.length < 2) return null;
  return t.slice(0, 80);
}
