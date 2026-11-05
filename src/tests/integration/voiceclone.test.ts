/**
 * [A146] Your own voice: NEXUS's server speaks through the Gradio app of the voice-clone Colab notebook (Chatterbox).
 * The link and access code live only in the server's environment; a fake Gradio app stands in for Colab here.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cloneUrlAllowed, parseSse, readSpeechConfig, synthesizeClone, ttsStatus } from '../../../server/speech';
import { createApp } from '../../../server/app';
import { readConfig } from '../../../server/config';

const servers: Server[] = [];
afterAll(() => { for (const s of servers) s.close(); });
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(200)]);

function fakeGradio(o: { prefix?: string; code?: string } = {}) {
  const app = express(); app.use(express.json()); const prefix = o.prefix ?? '/gradio_api'; const jobs = new Map<string, unknown[]>(); let host = '';
  app.use((req, _res, next) => { host = `http://${req.headers.host}`; next(); });
  app.post(`${prefix}/call/speak`, (req, res) => { const id = `e${jobs.size + 1}`; jobs.set(id, req.body.data); res.json({ event_id: id }); });
  app.get(`${prefix}/call/speak/:id`, (req, res) => {
    const [text, code] = jobs.get(req.params.id) ?? [];
    res.setHeader('content-type', 'text/event-stream');
    if (code !== (o.code ?? 'secret-1')) { res.end('event: error\ndata: null\n\n'); return; }
    res.end(`event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"path": "/tmp/gradio/x/out.wav", "url": "${host}${prefix}/file=/tmp/gradio/x/out.wav", "orig_name": "out.wav", "meta": {"_type": "gradio.FileData"}, "text": ${JSON.stringify(text)}}]\n\n`);
  });
  app.get(`${prefix}/file=*splat`, (_req, res) => { res.setHeader('content-type', 'audio/wav'); res.end(WAV); });
  return app;
}
const listen = async (app: express.Express) => { const s = app.listen(0, '127.0.0.1'); servers.push(s); await new Promise((r) => s.once('listening', r)); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`; };
const cfgFor = (url: string, code = 'secret-1') => readSpeechConfig({ TTS_PROVIDER: 'clone', VOICE_CLONE_URL: url, VOICE_CLONE_CODE: code } as NodeJS.ProcessEnv).tts;

describe('[A146] your own cloned voice (Colab + Gradio)', () => {
  it('[A146] configuration: needs an https link and the access code; both stay server-side', () => {
    expect(ttsStatus(cfgFor('https://abc123.gradio.live')).configured).toBe(true);
    expect(ttsStatus(readSpeechConfig({ TTS_PROVIDER: 'clone' } as NodeJS.ProcessEnv).tts).note).toMatch(/VOICE_CLONE_URL/);
    expect(ttsStatus(cfgFor('https://abc.gradio.live', '')).note).toMatch(/VOICE_CLONE_CODE/);
    expect(ttsStatus(cfgFor('http://insecure.example')).configured).toBe(false);
  });
  it('[A146] speaks: POST → event id → complete event → the WAV file (with and without the /gradio_api prefix)', async () => {
    for (const prefix of ['/gradio_api', '']) {
      const base = await listen(fakeGradio({ prefix }));
      const out = await synthesizeClone(cfgFor(base), 'Hello from NEXUS.', new AbortController().signal);
      expect(out.mime).toBe('audio/wav'); expect(out.audio.subarray(0, 4).toString()).toBe('RIFF');
    }
  });
  it('[A146] fast lane: one POST /nexus/speak → WAV + timing (older notebooks without it fall back to the Gradio API, asked once)', async () => {
    const fast = fakeGradio(); let hits = 0;
    fast.post('/nexus/speak', (req, res) => {
      hits++;
      if (req.body.code !== 'secret-1') { res.status(401).json({ error: 'Wrong access code' }); return; }
      if (!req.body.text) { res.status(400).json({ error: 'Please type something to say.' }); return; }
      res.setHeader('content-type', 'audio/wav'); res.setHeader('x-nexus-infer-ms', '1800'); res.setHeader('x-nexus-queue-ms', '0'); res.setHeader('x-nexus-total-ms', '1850'); res.end(WAV);
    });
    const base = await listen(fast);
    const out = await synthesizeClone(cfgFor(base), 'Hello from NEXUS.', new AbortController().signal);
    expect(out.audio.subarray(0, 4).toString()).toBe('RIFF'); expect(out.timing).toMatchObject({ lane: 'fast', inferMs: 1800, queueMs: 0, colabMs: 1850 });
    await expect(synthesizeClone(cfgFor(base, 'wrong'), 'Hi', new AbortController().signal)).rejects.toMatchObject({ code: 'auth' });
    expect(hits).toBe(2);
    // an older notebook: 404 once, then straight to the Gradio API
    const old = await listen(fakeGradio()); let seen = 0;
    const r1 = await synthesizeClone(cfgFor(old), 'Hi', new AbortController().signal); seen++;
    const r2 = await synthesizeClone(cfgFor(old), 'Hi again', new AbortController().signal); seen++;
    expect(seen).toBe(2); expect(r1.timing.lane).toBe('gradio'); expect(r2.timing.lane).toBe('gradio');
  });
  it('[A146] the speech route reports where the time went (Server-Timing: voice round trip, GPU inference, network)', async () => {
    const fast = fakeGradio();
    fast.post('/nexus/speak', (_q, res) => { res.setHeader('content-type', 'audio/wav'); res.setHeader('x-nexus-infer-ms', '1500'); res.setHeader('x-nexus-queue-ms', '20'); res.setHeader('x-nexus-total-ms', '1530'); res.end(WAV); });
    const voice = await listen(fast);
    const cfg = readConfig({ LLM_PROVIDER: 'demo', BUDGET_STORE: 'memory', TTS_PROVIDER: 'clone', VOICE_CLONE_URL: 'https://x.gradio.live', VOICE_CLONE_CODE: 'secret-1' } as NodeJS.ProcessEnv);
    const base = await listen(createApp(cfg, { persistRuntime: false }) as unknown as express.Express);
    // the real link is https; route it to the local (plain http) fake
    const real = globalThis.fetch; const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((u, init) => real(String(u).replace('https://x.gradio.live', voice), init));
    const r = await fetch(`${base}/api/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Timing test.' }) });
    spy.mockRestore();
    expect(r.status).toBe(200); const st = r.headers.get('server-timing') ?? '';
    expect(st).toMatch(/total;dur=\d+/); expect(st).toMatch(/voice;dur=\d+;desc="fast"/); expect(st).toMatch(/infer;dur=1500/); expect(st).toMatch(/gpuqueue;dur=20/); expect(st).toMatch(/net;dur=\d+/);
  });
  it('[A146] a wrong code, a stopped notebook or a foreign file URL are clear errors (the reply still shows as text)', async () => {
    const base = await listen(fakeGradio());
    await expect(synthesizeClone(cfgFor(base, 'wrong'), 'Hi', new AbortController().signal)).rejects.toMatchObject({ code: 'auth', message: expect.stringMatching(/VOICE_CLONE_CODE/) });
    await expect(synthesizeClone(cfgFor('http://127.0.0.1:9'), 'Hi', new AbortController().signal)).rejects.toMatchObject({ code: 'network', message: expect.stringMatching(/Colab notebook still running/) });
    const evil = express(); evil.use(express.json()); evil.post('/gradio_api/call/speak', (_q, r) => { r.json({ event_id: '1' }); });
    evil.get('/gradio_api/call/speak/1', (_q, r) => { r.end('event: complete\ndata: [{"url": "https://attacker.example/x.wav"}]\n\n'); });
    await expect(synthesizeClone(cfgFor(await listen(evil)), 'Hi', new AbortController().signal)).rejects.toMatchObject({ code: 'malformed' });
    expect(parseSse('event: generating\ndata: 1\n\nevent: complete\ndata: [2]\n\n')).toEqual([{ event: 'generating', data: '1' }, { event: 'complete', data: '[2]' }]);
  });
  it('[A146] the notebook connects itself: POST /api/voice-clone/register needs VOICE_CLONE_KEY, accepts only gradio.live / hf.space links, and switches the voice on', async () => {
    const KEY = 'k'.repeat(10) + '-0123456789';
    const base = await listen(createApp(readConfig({ LLM_PROVIDER: 'demo', BUDGET_STORE: 'memory', TTS_PROVIDER: 'clone', VOICE_CLONE_KEY: KEY } as NodeJS.ProcessEnv), { persistRuntime: false }) as unknown as express.Express);
    const reg = (body: unknown, key = KEY) => fetch(`${base}/api/voice-clone/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nexus-voice-key': key }, body: JSON.stringify(body) });
    const status = async () => ((await (await fetch(`${base}/api/status`)).json()) as { speech: { tts: { configured: boolean; note: string } } }).speech.tts;
    expect((await status()).configured).toBe(false); expect((await status()).note).toMatch(/waiting for the voice-clone Colab notebook/);
    expect((await reg({ url: 'https://abc.gradio.live', code: 'code-1234' }, 'wrong-key-wrong-key-x')).status).toBe(401);
    expect((await reg({ url: 'https://abc.gradio.live', code: 'code-1234' }, '')).status).toBe(401);
    for (const url of ['http://abc.gradio.live', 'https://evil.example', 'https://gradio.live.evil.example', 'https://user:pw@abc.gradio.live', 'not a url']) expect((await reg({ url, code: 'code-1234' })).status, url).toBe(400);
    expect((await reg({ url: 'https://abc.gradio.live', code: 'short' })).status).toBe(400);
    const ok = await reg({ url: 'https://abc123.gradio.live/', code: 'code-1234' }); expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true, changed: true });
    expect(await (await reg({ url: 'https://abc123.gradio.live', code: 'code-1234' })).json()).toEqual({ ok: true, changed: false });   // the minute-by-minute reminder
    expect((await status()).configured).toBe(true);
    const other = await listen(createApp(readConfig({ LLM_PROVIDER: 'demo', BUDGET_STORE: 'memory', VOICE_CLONE_KEY: KEY } as NodeJS.ProcessEnv), { persistRuntime: false }) as unknown as express.Express);
    expect((await fetch(`${other}/api/voice-clone/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nexus-voice-key': KEY }, body: JSON.stringify({ url: 'https://a.gradio.live', code: 'code-1234' }) })).status).toBe(409);
    const nokey = await listen(createApp(readConfig({ LLM_PROVIDER: 'demo', BUDGET_STORE: 'memory', TTS_PROVIDER: 'clone' } as NodeJS.ProcessEnv), { persistRuntime: false }) as unknown as express.Express);
    expect((await fetch(`${nokey}/api/voice-clone/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nexus-voice-key': '' }, body: '{}' })).status).toBe(401);   // no key configured = registration off
    expect(cloneUrlAllowed('https://nexus-voice.hf.space')).toBe(true);
  });
});
