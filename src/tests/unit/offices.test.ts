/**
 * [A154] Office directory: India's states and territories are stored (stable); WHO holds an office is never stored —
 * it is read live from the office's own Wikipedia page ("incumbent" field). The names below are test data served by
 * a mock Wikipedia, not facts kept by the app.
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { BrainService } from '../../../server/brainService';
import { readConfig } from '../../../server/config';
import { Combined, incumbentOf, makeResearch, plainWiki, type ResearchProvider } from '../../../server/research';
import { buildSystemPrompt } from '../../../server/prompts/system';
import { ChatRequestSchema } from '../../../shared/schema';
import { INDIA, findRegion, indiaDirectoryBlock, officeLookup } from '../../../shared/offices';
import { isTimeSensitive } from '../../../shared/freshness';
import type { CompletionRequest, LLMProvider } from '../../../server/providers/types';

const req = (text: string) => ChatRequestSchema.parse({ messages: [{ role: 'user', content: text }] });
const titles = (q: string) => officeLookup(q)?.titles ?? null;

/** a mock MediaWiki API: office pages with an infobox; "Governor of X" redirects to "List of governors of X" like the real site */
function mockWiki(holders: Record<string, string>) {
  const seen: string[] = [];
  const srv = http.createServer((q, res) => {
    const u = new URL(q.url!, 'http://x'); seen.push(u.search); res.setHeader('content-type', 'application/json');
    const asked = (u.searchParams.get('titles') ?? '').split('|').filter(Boolean);
    if (u.searchParams.get('list') === 'search') return res.end(JSON.stringify({ query: { search: [] } }));
    const redirects = asked.filter((t) => /^Governor of /.test(t)).map((t) => ({ from: t, to: t.replace(/^Governor of /, 'List of governors of ') }));
    const pages: Record<string, unknown> = {};
    asked.forEach((t, i) => {
      const title = redirects.find((r) => r.from === t)?.to ?? t;
      if (!(t in holders)) { pages[-1 - i] = { title, missing: '' }; return; }
      pages[100 + i] = { title, fullurl: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}`,
        extract: `The ${t} is an office. ${holders[t].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/, '$1')} is the current holder, since 1 January 2026.`,
        revisions: [{ timestamp: '2026-11-10T08:00:00Z', slots: { main: { '*': `{{Infobox official post\n| post = ${t}\n| incumbent = ${holders[t]}<ref>cite</ref>\n| incumbentsince = {{start date|2026|1|1}}\n}}\nIntro text.` } } }] };
    });
    res.end(JSON.stringify({ query: { redirects, pages } }));
  });
  return { srv, seen, start: () => new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`))) };
}
class FakeLLM implements LLMProvider {
  readonly id = 'fake'; readonly model = 'fake-1'; readonly supportsStreaming = true; readonly supportsVision = false; systems: string[] = [];
  configured() { return { ok: true }; } label() { return 'fake'; }
  async complete(r: CompletionRequest) { this.systems.push(r.system); return JSON.stringify({ reply: 'ok' }); }
  async stream(r: CompletionRequest, _s: AbortSignal, on: (t: string) => void) { this.systems.push(r.system); const t = 'HEAD {"expression":"neutral","gesture":null,"pose":"neutral","speakingStyle":"calm","emotionIntensity":0.5}\nAnswer.'; on(t); return t; }
}
const cfg = readConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv);

describe('[A154] the directory stores places, never people', () => {
  it('[A154] 28 states and 8 union territories with capitals; no officeholder names anywhere in the file', () => {
    expect(INDIA.filter((r) => r.kind === 'state')).toHaveLength(28); expect(INDIA.filter((r) => r.kind === 'ut')).toHaveLength(8);
    expect(INDIA.filter((r) => r.cm)).toHaveLength(31);
    expect(findRegion('who runs bihar')?.capital).toBe('Patna'); expect(findRegion('CM of UP')?.name).toBe('Uttar Pradesh'); expect(findRegion('what is up')).toBeNull();
    expect(findRegion('Daman and Diu administrator')?.name).toBe('Dadra and Nagar Haveli and Daman and Diu'); expect(findRegion('J&K')?.name).toBe('Jammu and Kashmir');
    const src = readFileSync('shared/offices.ts', 'utf8');
    for (const name of ['Hasnain', 'Arlekar', 'Modi', 'Murmu', 'Nitish', 'Adityanath', 'Trump', 'Macron']) expect(src, name).not.toContain(name);
    const b = indiaDirectoryBlock('How many states are there in India and what are their capitals?');
    expect(b).toMatch(/28 states/); expect(b).toMatch(/8 union territories/); expect(b).toMatch(/Bihar \(Patna\)/); expect(b).toMatch(/lists no officeholders/);
    expect(indiaDirectoryBlock('Explain photosynthesis')).toBe('');
    expect(buildSystemPrompt(req('List the states of India'), { streaming: true, sources: [] })).toMatch(/INDIA DIRECTORY/);
  });
});

describe('[A154] which office page a question needs', () => {
  it('[A154] Indian states and territories', () => {
    expect(titles('Who is the current Governor of Bihar?')).toEqual(['Governor of Bihar']);
    expect(titles('who is the cm of tamil nadu')).toEqual(['Chief Minister of Tamil Nadu']);
    expect(titles('governor of UP?')).toEqual(['Governor of Uttar Pradesh']);
    expect(titles('Who is the chief minister of Punjab?')).toEqual(['Chief Minister of Punjab, India']);
    expect(titles('Who is the chief minister of Ladakh?')).toEqual(['Lieutenant Governor of Ladakh']);            // no chief minister there
    expect(titles('who is the LG of J&K')).toEqual(['Lieutenant Governor of Jammu and Kashmir']);
    expect(titles('Who is the governor of Delhi?')).toEqual(['Lieutenant Governor of Delhi']);
  });
  it('[A154] India and other countries', () => {
    expect(titles('Who is the Prime Minister of India?')).toEqual(['Prime Minister of India']);
    expect(titles("Who is India's president?")).toEqual(['President of India']);
    expect(titles('who is the indian prime minister')).toEqual(['Prime Minister of India']);
    expect(titles('Who is the president of the USA?')).toEqual(['President of the United States']);
    expect(titles('Who is the prime minister of the uk now?')).toEqual(['Prime Minister of the United Kingdom']);
    expect(titles('prime minister of japan')).toEqual(['Prime Minister of Japan']);
    expect(titles('Who is the leader of France?')).toEqual(['President of France', 'Prime Minister of France']);
    expect(titles('Who is the governor of California?')).toEqual(['Governor of California']);
  });
  it('[A154] lists across India; the past, deputies and non-offices are left to the ordinary search', () => {
    const cms = officeLookup('List the chief ministers of all Indian states')!; expect(cms.bulk).toHaveLength(31); expect(cms.titles).toContain('Chief Minister of Delhi');
    const govs = officeLookup('Who are the governors of all states in India?')!; expect(govs.bulk).toHaveLength(36); expect(govs.titles).toContain('Administrator of Lakshadweep');
    expect(officeLookup('Name the CMs of India')!.bulk).toHaveLength(31);
    for (const q of ['Who was the chief minister of Bihar in 2010?', 'Who was the first Prime Minister of India?', 'Who is the deputy chief minister of Bihar?', 'How many chief ministers has Bihar had?', 'Who is the president of my school club?', 'What is a governor in an engine?', "What is Bihar's capital?"])
      expect(officeLookup(q), q).toBeNull();
    for (const q of ['List the chief ministers of all Indian states', 'prime minister of japan', 'Name the CMs of India']) expect(isTimeSensitive(q), q).toBe(true);
  });
});

describe('[A154] reading the holder from the office page', () => {
  it('[A154] infobox values are cleaned; a page without the field gives nothing', () => {
    expect(plainWiki('[[Balen Shah|Balendra Shah]]<ref name="a">x</ref> {{small|(acting)}}')).toBe('Balendra Shah (acting)');
    expect(incumbentOf('{{Infobox\n| incumbent = [[Example Person]]<!-- note -->\n| incumbentsince = {{start date|2026|3|14|df=y}}\n}}')).toEqual({ name: 'Example Person', since: '2026-03-14' });
    expect(incumbentOf('{{Infobox\n| post = X\n}}')).toBeNull(); expect(incumbentOf('| incumbent = \n| x = 1')).toBeNull();
  });
  it('[A154] one office: holder, date and page date come from the live page; redirects followed; missing pages skipped', async () => {
    const m = mockWiki({ 'Governor of Bihar': '[[Test Governor]]' }); const base = await m.start();
    try {
      const w = makeResearch({ provider: 'wikipedia', searxngUrl: '', tavilyKey: '', wikipediaLang: 'en', wikipediaBase: base })!;
      const s = await w.officeholders!(officeLookup('Who is the current Governor of Bihar?')!, new AbortController().signal);
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({ title: 'Governor of Bihar', url: 'https://en.wikipedia.org/wiki/List_of_governors_of_Bihar', publishedAt: '2026-11-10T08:00:00.000Z', authority: 'reference' });
      expect(s[0].snippet).toMatch(/^Current holder according to this page's "incumbent" field: Test Governor \(since 2026-01-01\)\. Test Governor is the current holder, since 1 January 2026\./);
      expect(await w.officeholders!({ titles: ['Prime Minister of Atlantis'] }, new AbortController().signal)).toEqual([]);
    } finally { m.srv.close(); }
  });
  it('[A154] a list across India is one request; states whose page has no holder are left out, not guessed', async () => {
    const all = Object.fromEntries(officeLookup('chief ministers of all states')!.titles.map((t, i) => [t, `[[CM Number ${i + 1}]]`]));
    delete all['Chief Minister of Goa'];
    const m = mockWiki(all); const base = await m.start();
    try {
      const w = makeResearch({ provider: 'wikipedia', searxngUrl: '', tavilyKey: '', wikipediaLang: 'en', wikipediaBase: base })!;
      const s = await w.officeholders!(officeLookup('List the chief ministers of all Indian states')!, new AbortController().signal);
      expect(m.seen).toHaveLength(1);
      const text = s.map((x) => x.snippet).join(' ');
      expect(text).toMatch(/Andhra Pradesh: CM Number 1;/); expect(text).toMatch(/Puducherry: CM Number 31/); expect(text).not.toMatch(/Goa/);
      expect((text.match(/CM Number/g) ?? []).length).toBe(30);
      expect(s[0].title).toMatch(/^Current chief ministers of India's states and union territories/); expect(s[0].url).toMatch(/List_of_current_Indian_chief_ministers/);
      for (const x of s) expect(x.snippet.length).toBeLessThanOrEqual(1200);
    } finally { m.srv.close(); }
  });
  it('[A154] the pipeline uses the office page for the answer and records it as verified; with no page it falls back to the search', async () => {
    const m = mockWiki({ 'Chief Minister of Bihar': '[[Test Minister]]' }); const base = await m.start();
    try {
      const w = makeResearch({ provider: 'wikipedia', searxngUrl: '', tavilyKey: '', wikipediaLang: 'en', wikipediaBase: base })!;
      const llm = new FakeLLM();
      const out = await new BrainService(cfg, llm, w).handle(req('Who is the chief minister of Bihar?'), new AbortController().signal);
      expect(out.meta.freshness).toMatchObject({ verified: true, source: { title: 'Chief Minister of Bihar', updatedAt: '2026-11-10T08:00:00.000Z' } });
      expect(llm.systems[0]).toMatch(/Current holder according to this page's "incumbent" field: Test Minister/);
      // a search provider with no office pages: the combined provider still reads them from Wikipedia
      const searched: string[] = [];
      const other: ResearchProvider = { id: 'other', configured: () => ({ ok: true }), search: async (q) => { searched.push(q); return []; } };
      const c = new Combined([other, w]);
      expect((await c.officeholders(officeLookup('cm of bihar')!, new AbortController().signal))[0].snippet).toMatch(/Test Minister/);
      const none = await new BrainService(cfg, new FakeLLM(), c).handle(req('Who is the chief minister of Goa?'), new AbortController().signal);
      expect(searched[0]).toBe('chief minister of Goa'); expect(none.meta.freshness!.verified).toBe(false);
    } finally { m.srv.close(); }
  });
});
