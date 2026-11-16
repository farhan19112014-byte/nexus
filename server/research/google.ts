/**
 * Live web search through Gemini's Google Search grounding, with the Gemini key NEXUS already has (server side only).
 * Used to verify time-sensitive questions. Sources are ONLY the pages Google returned in the grounding metadata, with
 * the passages the search supported — when the search returns no grounded pages, this returns nothing (never the
 * model's unsupported text), so the answer is reported as "not verified".
 */
import { GoogleGenAI } from '@google/genai';
import type { Source } from '../../shared/schema';
import { finalize, type ResearchProvider } from './index';

export interface GoogleSearchConfig { apiKey: string; model: string; baseUrl: string }
const placeholder = (s: string) => !s || /^replace|^your-|^<|^\*+$/i.test(s);

interface Grounding {
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
}

/** grounding metadata → raw sources: one per page, its snippet made of the passages that page supported */
export function groundingSources(meta: Grounding | undefined): { title: string; url: string; snippet: string; publishedAt: null }[] {
  const chunks = meta?.groundingChunks ?? [];
  const texts: string[][] = chunks.map(() => []);
  for (const s of meta?.groundingSupports ?? []) {
    const t = s.segment?.text?.trim(); if (!t) continue;
    for (const i of s.groundingChunkIndices ?? []) if (texts[i] && !texts[i].includes(t)) texts[i].push(t);
  }
  return chunks.map((c, i) => ({ title: c.web?.title ?? '', url: c.web?.uri ?? '', snippet: texts[i].join(' '), publishedAt: null as null }))
    .filter((s) => /^https?:\/\//.test(s.url) && s.title && s.snippet);   // a page with no supported passage is not evidence
}

export class GoogleSearch implements ResearchProvider {
  id = 'google';
  private ai: GoogleGenAI | null = null;
  constructor(private cfg: GoogleSearchConfig) {}
  configured() { return placeholder(this.cfg.apiKey) || placeholder(this.cfg.model) ? { ok: false, note: 'Google Search needs the Gemini API key (GEMINI_API_KEY).' } : { ok: true }; }
  async search(q: string, signal: AbortSignal): Promise<Source[]> {
    this.ai ??= new GoogleGenAI({ apiKey: this.cfg.apiKey, httpOptions: { retryOptions: { attempts: 1 }, ...(this.cfg.baseUrl ? { baseUrl: this.cfg.baseUrl } : {}) } });
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const r = await this.ai.models.generateContent({
      model: this.cfg.model,
      contents: [{ role: 'user', parts: [{ text: `Today is ${today}. Search the web and report what the most recent and most official pages say about: ${q}\nState the current situation, the date it took effect, and each page's publication date when it is given (a publication date is not the event date). Name earlier holders or values as former. If pages disagree, report both. Facts only, no advice, at most 120 words.` }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0, maxOutputTokens: 2048, abortSignal: signal },
    });
    return finalize(groundingSources(r.candidates?.[0]?.groundingMetadata as Grounding | undefined), this.id);
  }
}
