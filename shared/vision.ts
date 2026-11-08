/**
 * NEXUS Live Vision — shared vocabulary for the browser and the server: limits, the camera-frame format, the validated
 * observation the AI returns for one frame, and the short text context a chat question carries.
 *
 * Privacy by design: frames are JPEG snapshots (never video), they are sent only while the user has Live Vision on, the
 * server forwards them to the configured AI model and keeps nothing; the browser keeps text observations only.
 */
import { z } from 'zod';

export const VISION_LIMITS = {
  width: 640, height: 480, jpegQuality: 0.72,
  intervalMs: 2000, minIntervalMs: 1000, maxIntervalMs: 15000,
  /** decoded image bytes accepted by the server (a 640×480 JPEG is typically 30–90 KB) */
  maxImageBytes: 600_000,
  /** an observation older than this is "outdated" for a question about the current view */
  staleMs: 15_000,
  question: 300, previous: 1500, description: 600, objects: 16, label: 60, objectText: 200, list: 8, item: 200, text: 8, textItem: 200,
};

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export interface ParsedImage { mime: ImageMime; data: string; bytes: number }

const MAGIC: Record<ImageMime, (b: number[]) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};
/**
 * A `data:image/…;base64,…` URL → its parts, or null when it is not a real, size-limited JPEG/PNG/WebP (the declared type
 * must match the file's own signature bytes, so a renamed file or arbitrary data is refused).
 */
export function parseImageDataUrl(s: unknown, maxBytes = VISION_LIMITS.maxImageBytes): ParsedImage | null {
  if (typeof s !== 'string' || s.length > Math.ceil(maxBytes / 3) * 4 + 64) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return null;
  const mime = m[1] as ImageMime; const data = m[2];
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes < 100 || bytes > maxBytes) return null;
  let head: number[];
  try { head = [...atob(data.slice(0, 16))].map((c) => c.charCodeAt(0)); } catch { return null; }
  return MAGIC[mime](head) ? { mime, data, bytes } : null;
}

/* ------------------------------------------------------------------ the observation of one frame */
const L = VISION_LIMITS;
const str = (n: number) => z.string().trim().min(1).max(n);
export const VisionObjectSchema = z.object({ label: str(L.label), description: z.string().trim().max(L.objectText).default(''), position: z.string().trim().max(80).default('') });
export const VisionObservationSchema = z.object({
  description: str(L.description),
  objects: z.array(VisionObjectSchema).max(L.objects).default([]),
  /** legible text, verbatim */
  text: z.array(str(L.textItem)).max(L.text).default([]),
  /** cautious comparison with the previous observation (empty for the first one) */
  changes: z.array(str(L.item)).max(L.list).default([]),
  uncertainties: z.array(str(L.item)).max(L.list).default([]),
  /** how many people are visible — a count only, never who they are */
  people: z.number().int().min(0).max(50).default(0),
});
export type VisionObservation = z.infer<typeof VisionObservationSchema>;
export interface TimedObservation extends VisionObservation { at: number; model: string | null }

/** Model output → a validated observation: unknown fields dropped, bad list entries dropped one by one, null if unusable. */
export function coerceObservation(raw: unknown): VisionObservation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim().slice(0, max)).slice(0, n) : []);
  const objects = (Array.isArray(r.objects) ? r.objects : []).map((o) => (typeof o === 'string' ? { label: o } : o)).map((o) => VisionObjectSchema.safeParse(o)).filter((p) => p.success).map((p) => p.data!).slice(0, L.objects);
  const people = typeof r.people === 'number' && Number.isFinite(r.people) ? Math.max(0, Math.min(50, Math.round(r.people))) : 0;
  const p = VisionObservationSchema.safeParse({
    description: typeof r.description === 'string' ? r.description.trim().slice(0, L.description) : '', objects,
    text: list(r.text, L.text, L.textItem), changes: list(r.changes, L.list, L.item), uncertainties: list(r.uncertainties, L.list, L.item), people,
  });
  return p.success ? p.data : null;
}

/* ------------------------------------------------------------------ requests */
export const VisionAnalyzeRequestSchema = z.object({
  image: z.string().max(Math.ceil(L.maxImageBytes / 3) * 4 + 64),
  /** the previous observation as text, for change detection */
  previous: z.string().max(L.previous).default(''),
}).strict();
export type VisionAnalyzeRequest = z.input<typeof VisionAnalyzeRequestSchema>;

export { VisionChatContextSchema, type VisionChatContext } from './visionContext';

/** A one-line, human-readable form of an observation (also what is compared next time). */
export function observationText(o: VisionObservation): string {
  const parts = [o.description];
  if (o.objects.length) parts.push(`Objects: ${o.objects.map((x) => `${x.label}${x.position ? ` (${x.position})` : ''}`).join('; ')}.`);
  if (o.text.length) parts.push(`Legible text: ${o.text.map((t) => `"${t}"`).join(', ')}.`);
  if (o.people) parts.push(`${o.people} ${o.people === 1 ? 'person' : 'people'} visible (not identified).`);
  if (o.uncertainties.length) parts.push(`Uncertain: ${o.uncertainties.join('; ')}.`);
  return parts.join(' ');
}

/**
 * Labels that appeared / are no longer listed between two observations. Purely a list comparison: it says what the
 * AI listed, not that anything moved — the camera may simply point elsewhere (the wording shown to the user says so).
 */
export function labelDiff(prev: VisionObservation | null, next: VisionObservation): { added: string[]; gone: string[] } {
  if (!prev) return { added: [], gone: [] };
  const norm = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/s$/, '').trim();
  const a = new Set(prev.objects.map((o) => norm(o.label))); const b = new Set(next.objects.map((o) => norm(o.label)));
  return { added: next.objects.filter((o) => !a.has(norm(o.label))).map((o) => o.label), gone: prev.objects.filter((o) => !b.has(norm(o.label))).map((o) => o.label) };
}
