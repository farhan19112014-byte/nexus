/**
 * Assets 72–75 — optional research providers. Results are validated (SourceSchema), HTML-stripped,
 * length-capped, timestamped with OUR retrieval time, and passed to the model as untrusted data.
 *  - wikipedia: free, no key (MediaWiki API)
 *  - searxng:   self-hosted metasearch (SEARXNG_URL)
 *  - tavily:    hosted search API (TAVILY_API_KEY; may be paid)
 */
import { SourceSchema, LIMITS, type Source } from '../../shared/schema';
import { rankSources } from '../../shared/freshness';

/** `fresh`: a time-sensitive question — also look for official / primary pages, and keep each page's last-update date */
export interface ResearchProvider { id: string; configured(): { ok: boolean; note?: string }; search(q: string, signal: AbortSignal, o?: { fresh?: boolean }): Promise<Source[]> }
export interface ResearchConfig { provider: 'none' | 'wikipedia' | 'searxng' | 'tavily'; searxngUrl: string; tavilyKey: string; wikipediaLang: string; wikipediaBase?: string; tavilyBase?: string; /** verify time-sensitive questions with Google Search grounding when a Gemini key is set (GOOGLE_SEARCH_GROUNDING=off disables) */ googleSearch?: boolean }

/** tags out, then entities decoded once (&amp; last, so "&amp;lt;" stays the text "&lt;") */
const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const UA = { 'user-agent': 'NEXUS-companion/2.0 (local app; research adapter)' };

async function getJSON(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { ...init, signal, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`search returned HTTP ${r.status}`);
  return r.json();
}
/** a date the search returned, as ISO — or null (never invented) */
const validDate = (d: string | null | undefined) => { if (!d) return null; const t = Date.parse(d); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
export function finalize(raw: { title: string; url: string; snippet: string; publishedAt?: string | null }[], provider: string): Source[] {
  const at = new Date().toISOString();
  const out: Source[] = []; const seen = new Set<string>();
  // official / primary sources first, then reference works, then the rest (newest first within each), duplicates dropped
  raw = rankSources(raw.map((r, i) => ({ ...r, id: i + 1 }))).filter((r) => !seen.has(r.url) && seen.add(r.url));
  for (const [i, r] of raw.slice(0, LIMITS.researchResults).entries()) {
    const p = SourceSchema.safeParse({ id: i + 1, title: strip(r.title).slice(0, 300), url: r.url, snippet: strip(r.snippet).slice(0, 1200), provider, retrievedAt: at, publishedAt: validDate(r.publishedAt), authority: (r as { authority?: Source['authority'] }).authority });
    if (p.success) out.push({ ...p.data, id: out.length + 1 });
  }
  return out;
}

class Wikipedia implements ResearchProvider {
  id = 'wikipedia';
  constructor(private lang: string, private baseUrl?: string) {}
  configured() { return { ok: true }; }
  async search(q: string, signal: AbortSignal, o: { fresh?: boolean } = {}) {
    const base = `${this.baseUrl ?? `https://${this.lang}.wikipedia.org`}/w/api.php`;
    const s = await getJSON(`${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`, {}, signal) as { query?: { search?: { pageid: number; title: string }[] } };
    const hits = s.query?.search ?? [];
    if (!hits.length) return [];
    const ids = hits.map((h) => h.pageid).join('|');
    const e = await getJSON(`${base}?action=query&prop=extracts|info|revisions&rvprop=timestamp&inprop=url&exintro=1&explaintext=1&exsentences=${o.fresh ? 10 : 6}&pageids=${ids}&format=json&origin=*`, {}, signal) as { query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string; touched?: string; revisions?: { timestamp?: string }[] }> } };
    const pages = e.query?.pages ?? {};
    return finalize(hits.map((h) => pages[h.pageid]).filter(Boolean).map((p) => ({ title: p.title, url: p.fullurl ?? `https://${this.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, snippet: p.extract ?? '', publishedAt: p.revisions?.[0]?.timestamp ?? null })), this.id);   // the page's last edit
  }
}
class SearXNG implements ResearchProvider {
  id = 'searxng';
  constructor(private url: string) {}
  configured() { return this.url ? { ok: true } : { ok: false, note: 'Set SEARXNG_URL to your SearXNG instance (JSON format enabled).' }; }
  async search(q: string, signal: AbortSignal, o: { fresh?: boolean } = {}) {
    const one = (query: string) => getJSON(`${this.url.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`, {}, signal) as Promise<{ results?: { title: string; url: string; content?: string; publishedDate?: string }[] }>;
    const [j, off] = await Promise.all([one(q), o.fresh ? one(officialQuery(q)).catch(() => null) : null]);
    return finalize([...(off?.results ?? []), ...(j.results ?? [])].map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '', publishedAt: r.publishedDate ?? null })), this.id);
  }
}
class Tavily implements ResearchProvider {
  id = 'tavily';
  constructor(private key: string, private base = 'https://api.tavily.com') {}
  configured() { return this.key && !/^replace/.test(this.key) ? { ok: true } : { ok: false, note: 'Set TAVILY_API_KEY.' }; }
  async search(q: string, signal: AbortSignal, o: { fresh?: boolean } = {}) {
    const one = (query: string) => getJSON(`${this.base}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: this.key, query, max_results: LIMITS.researchResults }) }, signal) as Promise<{ results?: { title: string; url: string; content?: string; published_date?: string }[] }>;
    const [j, off] = await Promise.all([one(q), o.fresh ? one(officialQuery(q)).catch(() => null) : null]);
    return finalize([...(off?.results ?? []), ...(j.results ?? [])].map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '', publishedAt: r.published_date ?? null })), this.id);
  }
}

export function makeResearch(c: ResearchConfig): ResearchProvider | null {
  if (c.provider === 'wikipedia') return new Wikipedia(c.wikipediaLang || 'en', c.wikipediaBase);
  if (c.provider === 'searxng') return new SearXNG(c.searxngUrl);
  if (c.provider === 'tavily') return new Tavily(c.tavilyKey, c.tavilyBase);
  return null;
}
/** a second query that favours official pages (government, parliament, courts) for time-sensitive questions */
const officialQuery = (q: string) => `${q} official site (gov OR nic OR parliament)`.slice(0, 220);

/** Build a search query from the user's message (bounded; no conversation content beyond it). */
export const researchQuery = (text: string) => text.replace(/\b(please|can you|could you|search( for)?|look up|research|find|tell me about)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Several providers asked together (independent sources for one question): results merged, official first, duplicates dropped; one failing does not lose the others. */
export class Combined implements ResearchProvider {
  constructor(private parts: ResearchProvider[]) {}
  get id() { return this.parts.map((p) => p.id).join('+'); }
  configured() { return this.parts.some((p) => p.configured().ok) ? { ok: true } : { ok: false, note: this.parts[0]?.configured().note }; }
  async search(q: string, signal: AbortSignal, o: { fresh?: boolean } = {}) {
    const live = this.parts.filter((p) => p.configured().ok);
    const got = await Promise.allSettled(live.map((p) => p.search(q, signal, o)));
    const ok = got.flatMap((g) => (g.status === 'fulfilled' ? g.value : []));
    if (!ok.length) { const bad = got.find((g) => g.status === 'rejected') as PromiseRejectedResult | undefined; if (bad) throw bad.reason; }
    const seen = new Set<string>();
    return rankSources(ok.filter((s) => !seen.has(s.url) && seen.add(s.url))).slice(0, LIMITS.researchResults + 2).map((s, i) => ({ ...s, id: i + 1 }));
  }
}
