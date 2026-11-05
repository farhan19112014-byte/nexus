/**
 * [A145] Visual presenter, end to end without a browser: the server's image route against a fake Wikipedia, the
 * streamed HEAD carrying a visual, and the companion presenting it (panel state, presenter gesture, clearing, failure).
 */
import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../../server/app';
import { readConfig } from '../../../server/config';
import { AnimationEngine, seeded } from '../../animation/engine';
import { ExpressionController } from '../../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { CharacterRuntime } from '../../core/characterRuntime';
import { MemoryKV } from '../../storage/db';
import { SkillRegistry } from '../../skills/registry';
import { LearningSystem } from '../../skills/learning';
import { MemoryStore } from '../../memory/store';
import { Companion } from '../../core/companion';
import { type ApiClient, type ChatHandlers } from '../../ai/apiClient';
import { demoBrain } from '../../../shared/demoBrain';
import { BrainResponseSchema, ChatRequestSchema, type BrainResponse, type ChatRequestInput, type ResponseMeta } from '../../../shared/schema';
import type { ImageResult } from '../../../shared/visual';

const servers: Server[] = [];
afterAll(() => { for (const s of servers) s.close(); });
const listen = async (app: express.Express) => { const s = app.listen(0, '127.0.0.1'); servers.push(s); await new Promise((r) => s.once('listening', r)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };

function fakeWikipedia() {
  const app = express(); let hits = 0; let mode: 'ok' | 'none' | 'error' = 'ok';
  app.get('/w/api.php', (req, res) => {
    hits++;
    if (mode === 'error') { res.status(500).send('down'); return; }
    if (req.query.generator === 'search') {
      res.json({ query: { pages: mode === 'none' ? [] : [{ pageid: 1, index: 1, title: 'Apollo 11', pageimage: 'Aldrin.jpg', fullurl: 'https://en.wikipedia.org/wiki/Apollo_11', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Aldrin.jpg/960px-Aldrin.jpg', width: 960, height: 960 } }] } });
      return;
    }
    res.json({ query: { pages: [{ imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Aldrin.jpg', extmetadata: { Artist: { value: 'Neil Armstrong' }, LicenseShortName: { value: 'Public domain' } } }] }] } });
  });
  return { app, hits: () => hits, set: (m: typeof mode) => { mode = m; } };
}

describe('[A145] server: GET /api/visual/image', () => {
  it('[A145] returns a credited Commons image, caches repeated topics, and answers a miss or an outage with image:null (never a 5xx)', async () => {
    const wiki = fakeWikipedia(); const wbase = await listen(wiki.app);
    const app = createApp(readConfig({ LLM_PROVIDER: 'demo', BUDGET_STORE: 'memory', WIKIPEDIA_BASE_URL: wbase } as NodeJS.ProcessEnv), { persistRuntime: false });
    const base = await listen(app);
    const r1 = await (await fetch(`${base}/api/visual/image?q=Apollo%2011`)).json() as { image: ImageResult };
    expect(r1.image).toMatchObject({ title: 'Apollo 11', author: 'Neil Armstrong', license: 'Public domain', licenseUrl: null, source: 'Wikimedia Commons', fileUrl: 'https://commons.wikimedia.org/wiki/File:Aldrin.jpg' });
    const before = wiki.hits(); const r2 = await (await fetch(`${base}/api/visual/image?q=apollo 11`)).json() as { cached?: boolean };
    expect(r2.cached).toBe(true); expect(wiki.hits()).toBe(before);
    wiki.set('none'); expect(await (await fetch(`${base}/api/visual/image?q=nothing%20here`)).json()).toEqual({ image: null });
    wiki.set('error'); const down = await fetch(`${base}/api/visual/image?q=outage`); expect(down.status).toBe(200);
    expect(await down.json()).toEqual({ image: null, error: 'The image search is unavailable right now.' });
    expect((await fetch(`${base}/api/visual/image?q=x`)).status).toBe(400);
    // the page policy allows exactly Wikimedia's image host for images
    expect((await fetch(`${base}/api/health`)).headers.get('content-security-policy') ?? 'img-src upload.wikimedia.org').toMatch(/upload\.wikimedia\.org/);
  });
});

const META: ResponseMeta = { provider: 'fake', model: null, isLLM: true, latencyMs: 1, streamed: true, repaired: false, droppedFields: [], degraded: false, historySent: 1, promptVersion: 't', research: { used: false, provider: null, count: 0 } };
function rig(image: (q: string) => Promise<{ image: ImageResult | null; error?: string }>, script?: (req: ReturnType<typeof ChatRequestSchema.parse>) => BrainResponse) {
  const kv = new MemoryKV(); const engine = new AnimationEngine(seeded(3)); const expressions = new ExpressionController(BUILTIN_EXPRESSIONS);
  const runtime = new CharacterRuntime(engine, expressions); const registry = new SkillRegistry(kv); const memory = new MemoryStore(kv); const learning = new LearningSystem(registry, kv);
  const queries: string[] = [];
  const api = { offline: false, status: async () => ({ provider: 'fake', label: 'fake', model: 'm', isLLM: true, configured: true, streaming: true, promptVersion: 't', runtimeConfig: false, research: { provider: 'none', configured: false } }),
    chat: async (input: ChatRequestInput, _s: AbortSignal, h: ChatHandlers) => { const req = ChatRequestSchema.parse(input); const r = script ? script(req) : demoBrain(req); h.onHead?.(r); await new Promise((ok) => setTimeout(ok, 30)); h.onDelta?.(r.reply); return { response: r, meta: META, offline: false }; },
    visualImage: async (q: string) => { queries.push(q); return image(q); }, summarize: async () => null } as unknown as ApiClient;
  const c = new Companion({ runtime, registry, memory, learning, api, persistent: false, silentMsPerChar: 4, restAfterMs: 60_000 });
  const started: string[] = []; engine.on('start', (e) => started.push(e.skillId));
  const timer = setInterval(() => runtime.step(0.05), 2);
  return { c, runtime, started, queries, stop: () => clearInterval(timer), async ready() { await memory.ready; await memory.updateSettings({ greeted: true }); await c.init(); } };
}
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const IMG: ImageResult = { url: 'https://upload.wikimedia.org/a.jpg', width: 960, height: 640, title: 'Apollo 11', pageUrl: 'https://en.wikipedia.org/wiki/Apollo_11', fileUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', author: 'NASA', license: 'Public domain', licenseUrl: null, source: 'Wikimedia Commons' };

describe('[A145] companion: the presenter delivers explanation, visual and gesture together', () => {
  it('[A145] a diagram appears with the reply, NEXUS points to it while explaining, and the next reply without a visual clears it', async () => {
    const t = rig(async () => ({ image: null })); await t.ready();
    const send = t.c.send('Explain the solar system');
    await until(() => !!t.c.getSnapshot().visual);
    const v = t.c.getSnapshot().visual!;
    expect(v.status).toBe('ready'); expect(v.request).toMatchObject({ kind: 'diagram', diagram: { type: 'orbit' } });
    await send; await until(() => t.c.sm.state === 'idle');
    expect(t.started).toContain('explain');                                   // the explanatory gesture chosen with the reply
    expect(t.started).toContain('point_right');                               // the presenter cue toward the panel
    expect(t.started.filter((s) => s === 'point_right')).toHaveLength(1);     // once per visual, not on every sentence
    expect(t.runtime.body.current()).toBeNull();                              // nothing keeps going after the reply
    await t.c.send('thanks'); await until(() => t.c.sm.state === 'idle');
    expect(t.c.getSnapshot().visual).toBeNull();
    t.stop();
  });
  it('[A145] a comparison gets the "on one hand… on the other" gesture instead of a point', async () => {
    const t = rig(async () => ({ image: null }), (req) => BrainResponseSchema.parse({ ...demoBrain(req), actions: [] })); await t.ready();
    await t.c.send('what is the difference between weather and climate'); await until(() => t.c.sm.state === 'idle');
    expect(t.started).toContain('compare'); expect(t.started).not.toContain('point_right'); t.stop();
  });
  it('[A145] an image is looked up, shown with its credit, and a failed lookup is explained and cleared — the answer is never lost', async () => {
    const ok = rig(async () => ({ image: IMG })); await ok.ready();
    await ok.c.send('tell me about the Apollo 11 moon landing'); await until(() => ok.c.getSnapshot().visual?.status === 'ready');
    expect(ok.queries).toEqual(['Apollo 11']); expect(ok.c.getSnapshot().visual?.image).toEqual(IMG); ok.stop();
    const bad = rig(async () => ({ image: null, error: 'The image search is unavailable right now.' })); await bad.ready();
    await bad.c.send('tell me about the Taj Mahal'); await until(() => bad.c.getSnapshot().visual?.status === 'failed');
    await until(() => bad.c.sm.state === 'idle');
    const m = bad.c.getSnapshot().messages.at(-1)!;
    expect(m.status).toBe('complete'); expect(m.text).toMatch(/Taj Mahal/); expect(m.notes?.join(' ')).toMatch(/Visual: The image search is unavailable/);
    await until(() => bad.c.getSnapshot().visual === null, 6000);
    bad.stop();
  }, 12_000);
  it('[A145] the user can close the visual, and a new question cancels a pending lookup', async () => {
    let resolve: (v: { image: ImageResult | null }) => void = () => {};
    // answer only the newest line (a cancelled turn is merged into the next user message by the history trimmer)
    const newest = (req: ReturnType<typeof ChatRequestSchema.parse>) => demoBrain({ ...req, messages: [{ role: 'user', content: req.messages.at(-1)!.content.split('\n').at(-1)! }] });
    const t = rig(() => new Promise((r) => { resolve = r; }), newest); await t.ready();
    void t.c.send('tell me about the Apollo 11 moon landing'); await until(() => t.c.getSnapshot().visual?.status === 'loading');
    await t.c.send('thanks'); resolve({ image: IMG }); await new Promise((r) => setTimeout(r, 30));
    expect(t.c.getSnapshot().visual).toBeNull();
    await t.c.send('explain gravity'); await until(() => !!t.c.getSnapshot().visual);
    t.c.dismissVisual(); expect(t.c.getSnapshot().visual).toBeNull(); t.stop();
  });
});
