/**
 * Assets 72–75 — optional research providers. Results are validated (SourceSchema), HTML-stripped,
 * length-capped, timestamped with OUR retrieval time, and passed to the model as untrusted data.
 *  - wikipedia: free, no key (MediaWiki API)
 *  - searxng:   self-hosted metasearch (SEARXNG_URL)
 *  - tavily:    hosted search API (TAVILY_API_KEY; may be paid)
 */
import { SourceSchema, LIMITS, type Source } from '../../shared/schema';
import { rankSources } from '../../shared/freshness';
import type { OfficePlan } from '../../shared/offices';

/** `fresh`: a time-sensitive question — also look for official / primary pages, and keep each page's last-update date */
export interface ResearchProvider { id: string; configured(): { ok: boolean; note?: string }; search(q: string, signal: AbortSignal, o?: { fresh?: boolean }): Promise<Source[]>;
  /** who currently holds the given offices, read from each office's own page (providers that can) */
  officeholders?(plan: OfficePlan, signal: AbortSignal): Promise<Source[]> }
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

/** wikitext value → plain text: comments, references, templates and link syntax removed ("[[Balen Shah|Balendra Shah]]" → "Balendra Shah") */
export function plainWiki(v: string): string {
  return v.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{(?:start date(?: and age)?|dts)\|(\d{4})\|(\d{1,2})\|(\d{1,2})[^}]*\}\}/gi, (_m, y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    .replace(/\{\{(?:nowrap|small|nobold)\|([^{}]*)\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
/** the "incumbent" (and "incumbentsince") fields of an office page's infobox — null when the page has none */
export function incumbentOf(wikitext: string): { name: string; since: string | null } | null {
  const f = (k: string) => { const m = new RegExp(`\\|[^\\S\\n]*${k}[^\\S\\n]*=[^\\S\\n]*([^\\n]*)`, 'i').exec(wikitext); return m ? plainWiki(m[1]) : ''; };
  const name = f('incumbent'); if (!name || name.length > 90) return null;
  return { name, since: f('incumbentsince') || null };
}
type WikiPage = { title: string; fullurl?: string; missing?: string; extract?: string; revisions?: { timestamp?: string; slots?: { main?: { '*'?: string } } }[] };

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
  /**
   * Who holds each office now, from the office page's infobox ("incumbent"), with the page's last-edit date. One request
   * for all the pages (redirects followed); a page with no incumbent field contributes nothing — never a guess.
   */
  async officeholders(plan: OfficePlan, signal: AbortSignal) {
    const base = `${this.baseUrl ?? `https://${this.lang}.wikipedia.org`}/w/api.php`;
    const titles = plan.titles.slice(0, 50);
    const single = !plan.bulk;
    const [j, x] = await Promise.all([
      getJSON(`${base}?action=query&prop=revisions|info&rvprop=content|timestamp&rvslots=main&rvsection=0&inprop=url&redirects=1&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, {}, signal) as Promise<{ query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: Record<string, WikiPage> } }>,
      single ? (getJSON(`${base}?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, {}, signal).catch(() => null) as Promise<{ query?: { pages?: Record<string, WikiPage> } } | null>) : null,
    ]);
    const pages = Object.values(j.query?.pages ?? {}).filter((p) => !('missing' in p));
    const byTitle = new Map(pages.map((p) => [p.title, p]));
    const hop = (t: string) => { const n = j.query?.normalized?.find((r) => r.from === t)?.to ?? t; return j.query?.redirects?.find((r) => r.from === n)?.to ?? n; };
    const found = titles.map((t) => { const p = byTitle.get(hop(t)); const inc = p ? incumbentOf(p.revisions?.[0]?.slots?.main?.['*'] ?? '') : null; return p && inc ? { asked: t, p, inc } : null; }).filter(Boolean) as { asked: string; p: WikiPage; inc: { name: string; since: string | null } }[];
    if (!found.length) return [];
    const url = (p: WikiPage) => p.fullurl ?? `https://${this.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
    if (single) {
      const intro = new Map(Object.values(x?.query?.pages ?? {}).map((p) => [p.title, p.extract ?? '']));
      return finalize(found.map(({ asked, p, inc }) => {
        // sentences of the page's introduction that speak about the present holder (they carry the dates)
        const sents = (intro.get(p.title) ?? '').split(/(?<=[.!?])\s+/).filter((q) => /\b(current|incumbent|since|took office|assumed|sworn)\b/i.test(q)).slice(0, 3).join(' ');
        return { title: asked, url: url(p), publishedAt: p.revisions?.[0]?.timestamp ?? null, snippet: `Current holder according to this page's "incumbent" field: ${inc.name}${inc.since ? ` (since ${inc.since})` : ''}. ${/^(King|Queen|Emperor|Sultan)\b/.test(asked) ? '' : `Respectful form: the Honourable ${asked}, ${inc.name}. `}${sents}` };
      }), this.id);
    }
    // a list across India: one line per state / territory, split over as many sources as the length limit needs
    const lines = plan.bulk!.map((b) => { const f = found.find((q) => q.asked === b.title); return f ? `${b.label}: ${f.inc.name}${b.title.startsWith('Chief Minister') ? '' : ` (${b.title.split(' of ')[0]})`}` : null; }).filter(Boolean) as string[];
    const newest = found.map((f) => f.p.revisions?.[0]?.timestamp ?? '').sort().at(-1) || null;
    const chunks: string[][] = [[]]; for (const l of lines) { if (chunks.at(-1)!.join('; ').length + l.length > 1010) chunks.push([]); chunks.at(-1)!.push(l); }
    return finalize(chunks.map((c, i) => ({ title: `${plan.heading ?? 'Current officeholders'}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}`, url: `${plan.listUrl ?? `https://${this.lang}.wikipedia.org`}${i ? `#part-${i + 1}` : ''}`, publishedAt: newest, snippet: `From each office's own page ("incumbent" field; refer to each as Hon'ble): ${c.join('; ')}.` })), this.id);
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
  async officeholders(plan: OfficePlan, signal: AbortSignal) {
    for (const p of this.parts) if (p.officeholders && p.configured().ok) { const s = await p.officeholders(plan, signal).catch(() => []); if (s.length) return s; }
    return [];
  }
  async search(q: string, signal: AbortSignal, o: { fresh?: boolean } = {}) {
    const live = this.parts.filter((p) => p.configured().ok);
    const got = await Promise.allSettled(live.map((p) => p.search(q, signal, o)));
    const ok = got.flatMap((g) => (g.status === 'fulfilled' ? g.value : []));
    if (!ok.length) { const bad = got.find((g) => g.status === 'rejected') as PromiseRejectedResult | undefined; if (bad) throw bad.reason; }
    const seen = new Set<string>();
    return rankSources(ok.filter((s) => !seen.has(s.url) && seen.add(s.url))).slice(0, LIMITS.researchResults + 2).map((s, i) => ({ ...s, id: i + 1 }));
  }
}
