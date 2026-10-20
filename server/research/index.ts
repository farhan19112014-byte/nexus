/**
 * Assets 72–75 — optional research providers. Results are validated (SourceSchema), HTML-stripped,
 * length-capped, timestamped with OUR retrieval time, and passed to the model as untrusted data.
 *  - wikipedia: free, no key (MediaWiki API)
 *  - searxng:   self-hosted metasearch (SEARXNG_URL)
 *  - tavily:    hosted search API (TAVILY_API_KEY; may be paid)
 */
import { SourceSchema, LIMITS, type Source } from '../../shared/schema';

export interface ResearchProvider { id: string; configured(): { ok: boolean; note?: string }; search(q: string, signal: AbortSignal): Promise<Source[]> }
export interface ResearchConfig { provider: 'none' | 'wikipedia' | 'searxng' | 'tavily'; searxngUrl: string; tavilyKey: string; wikipediaLang: string; wikipediaBase?: string; tavilyBase?: string }

const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const UA = { 'user-agent': 'NEXUS-companion/2.0 (local app; research adapter)' };

async function getJSON(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { ...init, signal, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`search returned HTTP ${r.status}`);
  return r.json();
}
function finalize(raw: { title: string; url: string; snippet: string; publishedAt?: string | null }[], provider: string): Source[] {
  const at = new Date().toISOString();
  const out: Source[] = [];
  for (const [i, r] of raw.slice(0, LIMITS.researchResults).entries()) {
    const p = SourceSchema.safeParse({ id: i + 1, title: strip(r.title).slice(0, 300), url: r.url, snippet: strip(r.snippet).slice(0, 1200), provider, retrievedAt: at, publishedAt: r.publishedAt ?? null });
    if (p.success) out.push({ ...p.data, id: out.length + 1 });
  }
  return out;
}

class Wikipedia implements ResearchProvider {
  id = 'wikipedia';
  constructor(private lang: string, private baseUrl?: string) {}
  configured() { return { ok: true }; }
  async search(q: string, signal: AbortSignal) {
    const base = `${this.baseUrl ?? `https://${this.lang}.wikipedia.org`}/w/api.php`;
    const s = await getJSON(`${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`, {}, signal) as { query?: { search?: { pageid: number; title: string }[] } };
    const hits = s.query?.search ?? [];
    if (!hits.length) return [];
    const ids = hits.map((h) => h.pageid).join('|');
    const e = await getJSON(`${base}?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exsentences=5&pageids=${ids}&format=json&origin=*`, {}, signal) as { query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string; touched?: string }> } };
    const pages = e.query?.pages ?? {};
    return finalize(hits.map((h) => pages[h.pageid]).filter(Boolean).map((p) => ({ title: p.title, url: p.fullurl ?? `https://${this.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, snippet: p.extract ?? '', publishedAt: null })), this.id);
  }
}
class SearXNG implements ResearchProvider {
  id = 'searxng';
  constructor(private url: string) {}
  configured() { return this.url ? { ok: true } : { ok: false, note: 'Set SEARXNG_URL to your SearXNG instance (JSON format enabled).' }; }
  async search(q: string, signal: AbortSignal) {
    const j = await getJSON(`${this.url.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json`, {}, signal) as { results?: { title: string; url: string; content?: string; publishedDate?: string }[] };
    return finalize((j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '', publishedAt: r.publishedDate ?? null })), this.id);
  }
}
class Tavily implements ResearchProvider {
  id = 'tavily';
  constructor(private key: string, private base = 'https://api.tavily.com') {}
  configured() { return this.key && !/^replace/.test(this.key) ? { ok: true } : { ok: false, note: 'Set TAVILY_API_KEY.' }; }
  async search(q: string, signal: AbortSignal) {
    const j = await getJSON(`${this.base}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: this.key, query: q, max_results: LIMITS.researchResults }) }, signal) as { results?: { title: string; url: string; content?: string; published_date?: string }[] };
    return finalize((j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '', publishedAt: r.published_date ?? null })), this.id);
  }
}

export function makeResearch(c: ResearchConfig): ResearchProvider | null {
  if (c.provider === 'wikipedia') return new Wikipedia(c.wikipediaLang || 'en', c.wikipediaBase);
  if (c.provider === 'searxng') return new SearXNG(c.searxngUrl);
  if (c.provider === 'tavily') return new Tavily(c.tavilyKey, c.tavilyBase);
  return null;
}
/** Build a search query from the user's message (bounded; no conversation content beyond it). */
export const researchQuery = (text: string) => text.replace(/\b(please|can you|could you|search( for)?|look up|research|find|tell me about)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
