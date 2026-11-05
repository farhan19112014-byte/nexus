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
export const VisualFieldSchema = VisualRequestSchema.nullable().catch(null).default(null);

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
export const IMAGE_HOSTS = ['upload.wikimedia.org'] as const;
/** only https images from the hosts above are ever shown */
export function isAllowedImageUrl(u: string) { try { const x = new URL(u); return x.protocol === 'https:' && (IMAGE_HOSTS as readonly string[]).includes(x.hostname); } catch { return false; } }

/** Strip markup from a Commons metadata field (it is HTML) — the result is shown as plain text only. */
export function plainText(html: string | undefined, max = 120): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, max);
}
