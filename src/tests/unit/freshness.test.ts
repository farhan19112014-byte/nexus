/**
 * [A151] Time-sensitive facts: current officeholders, dates and prices are checked with live research (even when
 * research is off), official sources come first, the prompt carries today's date and current-vs-former rules, and the
 * server records whether the answer was verified, when and from where. (The Bihar example is test data for the
 * mocked search, not a statement made by the app.)
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrainService } from '../../../server/brainService';
import { buildSystemPrompt, dateLine, freshnessBlock } from '../../../server/prompts/system';
import { readConfig } from '../../../server/config';
import { Combined, makeResearch, type ResearchProvider } from '../../../server/research';
import { GoogleSearch, groundingSources } from '../../../server/research/google';
import { ChatRequestSchema, type Source } from '../../../shared/schema';
import { authorityOf, freshQuery, freshQueryWith, isTimeSensitive, rankSources } from '../../../shared/freshness';
import type { CompletionRequest, LLMProvider } from '../../../server/providers/types';

const req = (text: string, o: Record<string, unknown> = {}) => ChatRequestSchema.parse({ messages: [{ role: 'user', content: text }], ...o });
const NOW = new Date('2026-11-15T09:00:00Z');
const SRC = (o: Partial<Source>): Source => ({ id: 1, title: 'x', url: 'https://example.com', snippet: '', provider: 'test', retrievedAt: NOW.toISOString(), publishedAt: null, ...o });
const BIHAR: Source[] = [
  SRC({ id: 1, title: 'Governor of Bihar', url: 'https://en.wikipedia.org/wiki/Governor_of_Bihar', snippet: 'The governor of Bihar is the head of state of Bihar.', publishedAt: '2026-10-02T10:00:00Z' }),
  SRC({ id: 2, title: 'Raj Bhavan Bihar — The Governor', url: 'https://governor.bih.nic.in/governor', snippet: 'Lt. Gen. Syed Ata Hasnain (Retd.) assumed office as Governor of Bihar on 14 March 2026.', publishedAt: '2026-03-14T08:00:00Z' }),
];

class FakeResearch implements ResearchProvider {
  id = 'fake'; queries: { q: string; fresh?: boolean }[] = [];
  constructor(private out: Source[] = BIHAR) {}
  configured() { return { ok: true }; }
  async search(q: string, _s: AbortSignal, o: { fresh?: boolean } = {}) { this.queries.push({ q, fresh: o.fresh }); return rankSources(this.out); }
}
class FakeLLM implements LLMProvider {
  readonly id = 'fake'; readonly model = 'fake-1'; readonly supportsStreaming = true; readonly supportsVision = false; systems: string[] = [];
  configured() { return { ok: true }; } label() { return 'fake'; }
  async complete(r: CompletionRequest) { this.systems.push(r.system); return JSON.stringify({ reply: 'ok' }); }
  async stream(r: CompletionRequest, _s: AbortSignal, on: (t: string) => void) { this.systems.push(r.system); const t = 'HEAD {"expression":"neutral","gesture":null,"pose":"neutral","speakingStyle":"calm","emotionIntensity":0.5}\nAnswer.'; on(t); return t; }
}
const cfg = readConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv);

describe('[A151] recognising time-sensitive questions', () => {
  it('[A151] current officeholders, prices and "latest" are time-sensitive; timeless questions and small talk are not', () => {
    for (const t of ['Who is the governor of Bihar?', "who's the current CM of Delhi", 'President of India?', 'Who is the CEO of OpenAI', 'What is the repo rate today?', 'what is the latest iPhone?', 'Is he still the prime minister?', 'When is the next general election in 2027?'])
      expect(isTimeSensitive(t), t).toBe(true);
    for (const t of ['Explain photosynthesis', 'Who wrote Hamlet?', 'how are you today', 'wave', 'tell me a story', 'What is 2 + 2?'])
      expect(isTimeSensitive(t), t).toBe(false);
    expect(freshQuery('Who is the current Governor of Bihar?')).toBe('Governor of Bihar');
  });
  it('[A151] official / primary sources are ranked first; relevance order kept within a group', () => {
    expect(authorityOf('https://governor.bih.nic.in/x')).toBe('official'); expect(authorityOf('https://www.india.gov.in')).toBe('official');
    expect(authorityOf('https://www.gov.uk/x')).toBe('official'); expect(authorityOf('https://www.whitehouse.gov')).toBe('official');
    expect(authorityOf('https://en.wikipedia.org/wiki/X')).toBe('reference'); expect(authorityOf('https://news.example.com')).toBe('other');
    expect(authorityOf('https://gov.example.com')).toBe('other');                // "gov" as a sub-domain of any site is not official
    const r = rankSources([SRC({ url: 'https://news.example.com/a' }), SRC({ url: 'https://en.wikipedia.org/wiki/A' }), SRC({ url: 'https://pib.gov.in/x' }), SRC({ url: 'https://en.wikipedia.org/wiki/B' })]);
    expect(r.map((s) => s.url)).toEqual(['https://pib.gov.in/x', 'https://en.wikipedia.org/wiki/A', 'https://en.wikipedia.org/wiki/B', 'https://news.example.com/a']);
    expect(r.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('[A151] the prompt: today\'s date, sources first, current vs former, unverified said plainly', () => {
  it('[A151] every prompt carries today\'s date and the warning that training data is older', () => {
    expect(dateLine(NOW)).toMatch(/TODAY'S DATE: Sunday, 15 November 2026/);
    for (const compact of [false, true]) expect(buildSystemPrompt(req('hello'), { streaming: true, sources: [], compact, now: NOW })).toMatch(/TODAY'S DATE: Sunday, 15 November 2026/);
  });
  it('[A151] with sources: official first, check dates, current vs former, "Source: …, checked <date>"', () => {
    const p = buildSystemPrompt(req('Who is the governor of Bihar?'), { streaming: true, sources: rankSources(BIHAR), fresh: true, now: NOW });
    expect(p).toMatch(/TIME-SENSITIVE QUESTION/); expect(p).toMatch(/Answer from the SOURCES, not from your memory/);
    expect(p).toMatch(/call predecessors "former"/); expect(p).toMatch(/checked 15 November 2026/);
    expect(p).toMatch(/\[1\] Raj Bhavan Bihar — The Governor \(https:\/\/governor\.bih\.nic\.in\/governor; official source; page updated 2026-03-14/);
    expect(p.indexOf('[1] Raj Bhavan')).toBeLessThan(p.indexOf('[2] Governor of Bihar'));
  });
  it('[A151] without sources: say it could not be verified live, never present memory as current', () => {
    const b = freshnessBlock([], NOW);
    expect(b).toMatch(/NO live source could be retrieved/); expect(b).toMatch(/could not verify it live today \(15 November 2026\)/); expect(b).toMatch(/possibly out of date/);
    expect(buildSystemPrompt(req('Explain photosynthesis'), { streaming: true, sources: [], now: NOW })).not.toMatch(/TIME-SENSITIVE/);
  });
});

describe('[A151] the pipeline researches time-sensitive questions automatically and records the verification', () => {
  it('[A151] research off: a current-officeholder question is still checked live; the answer records source and date', async () => {
    const r = new FakeResearch(); const llm = new FakeLLM();
    const out = await new BrainService(cfg, llm, r).handle(req('Who is the current Governor of Bihar?'), new AbortController().signal);
    expect(r.queries).toEqual([{ q: 'Governor of Bihar', fresh: true }]);
    expect(out.meta.autoResearch).toBe(true); expect(out.meta.research.used).toBe(true);
    expect(out.meta.freshness).toMatchObject({ timeSensitive: true, verified: true, source: { title: 'Raj Bhavan Bihar — The Governor', authority: 'official', updatedAt: '2026-03-14T08:00:00Z' } });
    expect(out.meta.freshness!.checkedAt).toBeTruthy();
    expect(llm.systems[0]).toMatch(/TIME-SENSITIVE QUESTION — the user is asking about something that changes over time\. Live sources were retrieved/);
  });
  it('[A151] a timeless question does not trigger research; no freshness record', async () => {
    const r = new FakeResearch();
    const out = await new BrainService(cfg, new FakeLLM(), r).handle(req('Explain photosynthesis'), new AbortController().signal);
    expect(r.queries).toEqual([]); expect(out.meta.freshness).toBeUndefined(); expect(out.meta.autoResearch).toBeUndefined();
  });
  it('[A151] nothing retrieved, no provider, or checking turned off: recorded as NOT verified, and the model is told to say so', async () => {
    const empty = new FakeLLM();
    const a = await new BrainService(cfg, empty, new FakeResearch([])).handle(req('Who is the CM of Delhi?'), new AbortController().signal);
    expect(a.meta.freshness).toMatchObject({ verified: false, source: null }); expect(a.meta.freshness!.note).toMatch(/no results/i);
    expect(empty.systems[0]).toMatch(/NO live source could be retrieved/);
    const b = await new BrainService(cfg, new FakeLLM(), null).handle(req('Who is the CM of Delhi?'), new AbortController().signal);
    expect(b.meta.freshness!.verified).toBe(false); expect(b.meta.freshness!.note).toMatch(/No research provider/);
    const r = new FakeResearch();
    const c = await new BrainService(cfg, new FakeLLM(), r).handle(req('Who is the CM of Delhi?', { verifyCurrent: false }), new AbortController().signal);
    expect(r.queries).toEqual([]); expect(c.meta.freshness!.note).toMatch(/turned off/);
  });
  it('[A151] the demo brain quotes the retrieved sources with their dates instead of guessing', async () => {
    const demo = new BrainService(readConfig({} as NodeJS.ProcessEnv), Object.assign(new FakeLLM(), { id: 'demo' }) as unknown as LLMProvider, new FakeResearch());
    const out = await demo.handle(req('Who is the governor of Bihar?'), new AbortController().signal);
    expect(out.response.reply).toMatch(/\[1\] Raj Bhavan Bihar — The Governor \(official\) — page updated 2026-03-14: Lt\. Gen\. Syed Ata Hasnain/);
  });
});

describe('[A151] Wikipedia adapter keeps each page\'s last-edit date', () => {
  it('[A151] the revision timestamp becomes the source\'s update date', async () => {
    const srv = http.createServer((q, res) => {
      res.setHeader('content-type', 'application/json');
      if (q.url!.includes('list=search')) return res.end(JSON.stringify({ query: { search: [{ pageid: 5, title: 'Governor of Bihar' }] } }));
      expect(q.url).toMatch(/prop=extracts%7Cinfo%7Crevisions|prop=extracts\|info\|revisions/);
      res.end(JSON.stringify({ query: { pages: { 5: { title: 'Governor of Bihar', extract: 'The governor of Bihar…', fullurl: 'https://en.wikipedia.org/wiki/Governor_of_Bihar', revisions: [{ timestamp: '2026-10-02T10:00:00Z' }] } } } }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const w = makeResearch({ provider: 'wikipedia', searxngUrl: '', tavilyKey: '', wikipediaLang: 'en', wikipediaBase: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` })!;
      const s = await w.search('Governor of Bihar', new AbortController().signal, { fresh: true });
      expect(s[0]).toMatchObject({ title: 'Governor of Bihar', publishedAt: '2026-10-02T10:00:00.000Z', authority: 'reference' });
    } finally { srv.close(); }
  });
});

describe('[A152] searches only when needed', () => {
  it('[A152] technology releases, news and results are checked; maths, coding and explanations are not', () => {
    for (const t of ['What is the latest Python version?', 'Which is the newest Gemini model?', 'Any news about ISRO?', 'Who won the last IPL?', 'How much is a litre of petrol in Patna?', 'Has the new iPhone been released?'])
      expect(isTimeSensitive(t), t).toBe(true);
    for (const t of ['What is 2024 * 3?', '12 + 30 = ?', 'Calculate 15 percent of 2025', 'Fix this code: for (let i = 0; i < 2026; i++) {}', 'Write a function that returns the latest item in an array', 'Why is my regex still failing?', 'Explain how inflation works', 'What is a governor in an engine?', 'The King of Pop was a great singer.', 'Write a poem about today'])
      expect(isTimeSensitive(t), t).toBe(false);
  });
  it('[A152] a follow-up borrows its subject from the previous question', () => {
    expect(freshQueryWith('And who is it now?', 'Who was the Governor of Bihar in 2020?')).toMatch(/Governor of Bihar/);
    expect(freshQueryWith('Who is the Chief Minister of Delhi?', 'Who is the Governor of Bihar?')).toBe('Chief Minister of Delhi');
  });
  it('[A152] the same time-sensitive question within ten minutes is answered from the cached search', async () => {
    const r = new FakeResearch(); const b = new BrainService(cfg, new FakeLLM(), r);
    await b.handle(req('Who is the Governor of Bihar?'), new AbortController().signal);
    const again = await b.handle(req('who is the governor of bihar'), new AbortController().signal);
    expect(r.queries).toHaveLength(1); expect(again.meta.freshness!.verified).toBe(true);
  });
  it('[A152] sources that are all over a year old are flagged; the prompt separates page dates from event dates', async () => {
    const old = [SRC({ title: 'Old page', url: 'https://example.org/a', snippet: 'x', publishedAt: '2023-01-05T00:00:00Z' })];
    const out = await new BrainService(cfg, new FakeLLM(), new FakeResearch(old)).handle(req('Who is the CEO of Example Corp?'), new AbortController().signal);
    expect(out.meta.freshness).toMatchObject({ verified: true, count: 1 }); expect(out.meta.freshness!.note).toMatch(/last updated on 2023-01-05/);
    const b = freshnessBlock(BIHAR, NOW);
    expect(b).toMatch(/NOT when the event happened/); expect(b).toMatch(/sources disagree and what each says/); expect(b).toMatch(/never invent a date, a source or a link/);
  });
});

describe('[A153] Google Search grounding through the Gemini key', () => {
  const GROUND = { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'governor.bih.nic.in' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'thehindu.com' } }, { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ghi', title: 'unused.example' } }],
    groundingSupports: [{ segment: { text: 'Example Person took office as Governor on 1 January 2026.' }, groundingChunkIndices: [0, 1] }, { segment: { text: 'The previous governor left office in December 2025.' }, groundingChunkIndices: [1] }] };
  it('[A153] only pages with a supported passage become sources; the official site is ranked first', () => {
    const raw = groundingSources(GROUND);
    expect(raw.map((r) => r.title)).toEqual(['governor.bih.nic.in', 'thehindu.com']);
    expect(raw[1].snippet).toBe('Example Person took office as Governor on 1 January 2026. The previous governor left office in December 2025.');
    expect(groundingSources(undefined)).toEqual([]); expect(groundingSources({ groundingChunks: [{ web: { uri: 'https://x.example', title: 'x.example' } }] })).toEqual([]);
    expect(authorityOf('https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', 'governor.bih.nic.in')).toBe('official');
    expect(authorityOf('https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', 'Some page title')).toBe('other');
  });
  it('[A153] the search request carries the googleSearch tool and the key; no grounded pages means no sources', async () => {
    const seen: { url: string; key: unknown; body: { tools?: unknown[] } }[] = []; let grounded = true;
    const srv = http.createServer((q, res) => { let d = ''; q.on('data', (c) => (d += c)); q.on('end', () => {
      seen.push({ url: q.url!, key: q.headers['x-goog-api-key'], body: JSON.parse(d) }); res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'An ungrounded sentence from memory.' }] }, finishReason: 'STOP', ...(grounded ? { groundingMetadata: GROUND } : {}) }] }));
    }); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const g = new GoogleSearch({ apiKey: 'AIza-test', model: 'gemini-test', baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` });
      const s = await g.search('Governor of Bihar', new AbortController().signal);
      expect(seen[0].url).toMatch(/models\/gemini-test:generateContent/); expect(seen[0].key).toBe('AIza-test'); expect(seen[0].body.tools).toEqual([{ googleSearch: {} }]);
      expect(s.map((x) => [x.title, x.authority, x.provider])).toEqual([['governor.bih.nic.in', 'official', 'google'], ['thehindu.com', 'other', 'google']]);
      expect(JSON.stringify(s)).not.toMatch(/ungrounded/);
      grounded = false; expect(await g.search('Governor of Bihar', new AbortController().signal)).toEqual([]);
      expect(new GoogleSearch({ apiKey: '', model: 'm', baseUrl: '' }).configured().ok).toBe(false);
    } finally { srv.close(); }
  });
  it('[A153] Google and the configured provider are asked together; one failing does not lose the other; all failing is reported', async () => {
    const boom: ResearchProvider = { id: 'google', configured: () => ({ ok: true }), search: async () => { throw new Error('quota'); } };
    const wiki = new FakeResearch();
    const c = new Combined([boom, wiki]); expect(c.id).toBe('google+fake');
    expect((await c.search('Governor of Bihar', new AbortController().signal, { fresh: true })).map((s) => s.title)).toEqual(['Raj Bhavan Bihar — The Governor', 'Governor of Bihar']);
    const out = await new BrainService(cfg, new FakeLLM(), null, new Combined([boom])).handle(req('Who is the Governor of Bihar?'), new AbortController().signal);
    expect(out.meta.freshness).toMatchObject({ verified: false, source: null }); expect(out.meta.freshness!.note).toMatch(/Research failed: quota/);
  });
});
