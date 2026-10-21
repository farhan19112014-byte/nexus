/**
 * Express API (Assets 42, 46, 47, 50, 92–95).
 *   GET  /api/status          capabilities (no secrets)
 *   POST /api/chat            JSON or Server-Sent Events stream (stream:true)
 *   POST /api/summarize       session summary
 *   GET  /api/config          secret-free configuration view
 *   PUT  /api/config          update runtime config (loopback only; secrets write-only)
 *   POST /api/config/test     connection test against the configured provider
 *   POST /api/speech          { text } → audio from the configured voice (ElevenLabs / Gemini / OpenAI-compatible); alias /api/tts
 *   GET  /api/speech/voices   ElevenLabs voices on the account (loopback only)
 * Logs contain method, path, status and duration only — never message content or secrets.
 */
import { listElevenVoices, SpeechError, sttStatus, synthesize, transcribe, ttsStatus } from './speech';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ChatRequestSchema, SummarizeRequestSchema, type ServerCapabilities, type StreamEvent } from '../shared/schema';
import { applyRuntime, loadRuntime, publicConfig, readConfig, RuntimeConfigSchema, saveRuntime, type ServerConfig } from './config';
import { BrainService } from './brainService';
import { ProviderError, type LLMProvider } from './providers/types';
import { OpenAICompatibleProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { DemoProvider } from './providers/demo';
import { makeResearch, type ResearchProvider } from './research';
import { PROMPT_VERSION } from './prompts/system';
import { DailyBudget } from './budget';

export function makeProvider(c: ServerConfig): LLMProvider {
  if (c.provider === 'openai') return new OpenAICompatibleProvider(c.openai);
  if (c.provider === 'anthropic') return new AnthropicProvider(c.anthropic);
  if (c.provider === 'gemini') return new GeminiProvider(c.gemini);
  return new DemoProvider();
}

function rateLimiter(perMin: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = req.ip ?? '?'; const now = Date.now(); const h = hits.get(k);
    if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + 60_000 }); if (hits.size > 5000) hits.clear(); return next(); }
    if (++h.n > perMin) { res.setHeader('retry-after', String(Math.ceil((h.reset - now) / 1000))); res.status(429).json({ error: 'Too many requests — please wait a moment.', code: 'rate_limited', retryable: true }); return; }
    next();
  };
}
const isLoopback = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

/**
 * Also accepts the simple form { message, history? } (history = earlier { role, content } turns of this session)
 * and turns it into the full request; anything else is validated as-is by ChatRequestSchema.
 */
export function simpleChat(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  if (typeof b.message !== 'string' || 'messages' in b) return body;
  const { message, history, ...rest } = b;
  return { ...rest, messages: [...(Array.isArray(history) ? history : []), { role: 'user', content: message.trim() }] };
}

export interface AppOptions { serveDist?: boolean; distDir?: string; log?: (line: string) => void; persistRuntime?: boolean; ollamaUrl?: string }

/** Hosts the API answers to. Blocks DNS-rebinding: a web page on another domain cannot reach this local server through the browser. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export function hostAllowed(host: string | undefined, extra: string[] = []): boolean {
  if (!host) return false;
  return LOCAL_HOST.test(host) || extra.includes(host.toLowerCase());
}
export function originAllowed(origin: string | undefined, extra: string[] = []): boolean {
  if (!origin) return true; // same-origin navigations, curl, tests
  if (origin === 'null') return false;
  try { const u = new URL(origin); return hostAllowed(u.host, extra) || extra.includes(u.host.toLowerCase()); } catch { return false; }
}

export function createApp(base: ServerConfig = readConfig(), opts: AppOptions = {}) {
  let cfg = base.allowRuntimeConfig && opts.persistRuntime !== false ? applyRuntime(base, loadRuntime(base.runtimeConfigPath)) : base;
  let runtime = opts.persistRuntime !== false && base.allowRuntimeConfig ? loadRuntime(base.runtimeConfigPath) : {};
  let provider = makeProvider(cfg);
  let research: ResearchProvider | null = makeResearch(cfg.research);
  let brain = new BrainService(cfg, provider, research);
  const rebuild = () => { cfg = applyRuntime(base, runtime); provider = makeProvider(cfg); research = makeResearch(cfg.research); brain = new BrainService(cfg, provider, research); };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { const t0 = Date.now(); res.on('finish', () => opts.log?.(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - t0}ms`)); next(); });
  if (base.publicMode) app.set('trust proxy', 1);          // behind the host's HTTPS proxy: req.ip is the visitor, not the proxy
  const extraHosts = [...(process.env.ALLOWED_HOSTS ?? '').split(','), process.env.RENDER_EXTERNAL_HOSTNAME ?? ''].map((h) => h.trim().toLowerCase()).filter(Boolean);
  const corsOrigins = new Set(base.allowedOrigins.map((o) => o.toLowerCase()));
  const originOk = (o: string | undefined) => originAllowed(o, extraHosts) || (!!o && corsOrigins.has(o.toLowerCase()));
  app.use('/api', (req, res, next) => {
    // the liveness probe carries no data, so the host's health checker may use any Host header
    if (!(req.method === 'GET' && req.path === '/health') && !hostAllowed(req.headers.host, extraHosts)) { res.status(403).json({ error: 'Host not allowed', code: 'forbidden_host' }); return; }
    const origin = req.headers.origin;
    // CORS only for the exact origins in ALLOWED_ORIGINS (e.g. https://you.github.io); everyone else gets no CORS headers
    if (origin && corsOrigins.has(origin.toLowerCase())) {
      res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); res.setHeader('access-control-allow-headers', 'content-type'); res.setHeader('access-control-max-age', '600');
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !originOk(origin)) { res.status(403).json({ error: 'Cross-origin request refused', code: 'forbidden_origin' }); return; }
    next();
  });
  if (base.publicMode) {
    app.use((_req, res, next) => { res.setHeader('strict-transport-security', 'max-age=31536000'); next(); });
    // computer-only features make no sense (and must not run) on a public server
    app.use(['/api/local-models', '/api/speech/voices'], (_req, res) => { res.status(404).json({ error: 'Not available on the public NEXUS server.', code: 'not_available' }); });
  }
  const budget = new DailyBudget(base.budget);
  app.use(express.json({ limit: '128kb' }));
  app.use((_req, res, next) => { res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); next(); });

  const caps = (): ServerCapabilities => {
    const st = provider.configured();
    const rs = research?.configured();
    return {
      provider: provider.id, label: provider.label(), model: provider.model, isLLM: provider.id !== 'demo', configured: st.ok,
      streaming: provider.supportsStreaming, promptVersion: PROMPT_VERSION, runtimeConfig: cfg.allowRuntimeConfig, hosted: cfg.publicMode, note: st.note,
      speech: { tts: ttsStatus(cfg.speech.tts), stt: sttStatus(cfg.speech.stt) },
      research: { provider: research?.id ?? 'none', configured: !!rs?.ok, note: research ? rs?.note : 'Set RESEARCH_PROVIDER (wikipedia, searxng or tavily) to enable live research.' },
    };
  };
  app.get('/api/health', (_q, r) => { r.json({ ok: true }); });
  app.get('/api/status', (_q, r) => { r.json(caps()); });

  const limit = rateLimiter(cfg.rateLimitPerMin);
  app.post('/api/chat', limit, async (req, res) => {
    const parsed = ChatRequestSchema.safeParse(simpleChat(req.body));
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request', code: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }); return; }
    if (provider.id !== 'demo') { const b = budget.takeChat(req.ip ?? '?'); if (!b.ok) { res.status(429).json({ error: b.reason, code: 'rate_limited', retryable: false }); return; } }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort('client'); });
    const body = parsed.data;
    if (body.stream) {
      res.status(200).setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform'); res.setHeader('connection', 'keep-alive');
      res.flushHeaders();
      const send = (e: StreamEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
      try {
        const out = await brain.handle(body, ctl.signal, send);
        send({ type: 'final', response: out.response, meta: out.meta });
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
        if (pe.code !== 'cancelled') send({ type: 'error', error: pe.message, code: pe.code, retryable: pe.retryable });
      }
      res.end();
      return;
    }
    try { const out = await brain.handle(body, ctl.signal); res.json(out); }
    catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
      if (!res.headersSent && pe.code !== 'cancelled') { if (pe.retryAfterS) res.setHeader('retry-after', String(pe.retryAfterS)); res.status(pe.status).json({ error: pe.message, code: pe.code, retryable: pe.retryable }); }
    }
  });

  app.post('/api/summarize', limit, async (req, res) => {
    const p = SummarizeRequestSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Invalid request', code: 'invalid_request' }); return; }
    if (provider.id !== 'demo') { const b = budget.takeChat(req.ip ?? '?'); if (!b.ok) { res.status(429).json({ error: b.reason, code: 'rate_limited', retryable: false }); return; } }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try { res.json({ summary: await brain.summarize(p.data.messages, ctl.signal) }); }
    catch (e) { res.status(e instanceof ProviderError ? e.status : 500).json({ error: (e as Error).message, code: e instanceof ProviderError ? e.code : 'internal' }); }
    finally { clearTimeout(t); }
  });

  app.get('/api/config', (_q, r) => { r.json(publicConfig(cfg)); });
  app.put('/api/config', (req, res) => {
    if (!cfg.allowRuntimeConfig) { res.status(403).json({ error: 'Runtime configuration is disabled (ALLOW_RUNTIME_CONFIG=false).' }); return; }
    if (!isLoopback(req)) { res.status(403).json({ error: 'Configuration can only be changed from this computer (loopback).' }); return; }
    const p = RuntimeConfigSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Invalid configuration', issues: p.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }); return; }
    runtime = { ...runtime, ...p.data, openai: { ...runtime.openai, ...p.data.openai }, anthropic: { ...runtime.anthropic, ...p.data.anthropic }, gemini: { ...runtime.gemini, ...p.data.gemini }, research: { ...runtime.research, ...p.data.research }, speech: { ...runtime.speech, ...p.data.speech } };
    if (opts.persistRuntime !== false) { try { saveRuntime(cfg.runtimeConfigPath, runtime); } catch (e) { res.status(500).json({ error: `Could not write config: ${(e as Error).message}` }); return; } }
    rebuild();
    res.json({ ok: true, config: publicConfig(cfg), status: caps() });
  });
  app.post('/api/config/test', limit, async (_req, res) => {
    const t0 = Date.now();
    if (provider.id === 'demo') { res.json({ ok: true, provider: 'demo', message: 'Demo brain is active (no network test needed — it is not an LLM).', latencyMs: 0 }); return; }
    const st = provider.configured(); if (!st.ok) { res.json({ ok: false, message: st.note }); return; }
    { const b = budget.takeChat(_req.ip ?? '?'); if (!b.ok) { res.json({ ok: false, message: b.reason }); return; } }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), Math.min(20000, cfg.timeoutMs));
    try {
      const text = await provider.complete({ system: 'Connection test. Reply with the single word OK.', messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 8, temperature: 0, json: false }, ctl.signal);
      res.json({ ok: true, provider: provider.id, model: provider.model, message: `Connected — the model replied "${text.trim().slice(0, 24)}".`, latencyMs: Date.now() - t0 });
    } catch (e) { res.json({ ok: false, provider: provider.id, message: (e as Error).message, latencyMs: Date.now() - t0 }); }
    finally { clearTimeout(t); }
  });

  /** Text-to-speech through the configured speech service (spec §12). Returns audio bytes; errors are JSON with a stable code. */
  const speechLimit = rateLimiter(Math.max(60, cfg.rateLimitPerMin * 4));
  /** POST /api/speech (and the older /api/tts): { text } → audio from the configured voice service. No other voice is substituted on failure. */
  app.post(['/api/speech', '/api/tts'], speechLimit, async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 1200) { res.status(400).json({ error: 'Text must be 1–1200 characters', code: 'invalid_request' }); return; }
    if (ttsStatus(cfg.speech.tts).configured) { const b = budget.takeSpeech(text.length); if (!b.ok) { res.status(429).json({ error: b.reason, code: 'quota' }); return; } }
    const ctl = new AbortController(); res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    const t = setTimeout(() => ctl.abort('timeout'), 30000);
    try {
      const { audio, mime } = await synthesize(cfg.speech.tts, text, ctl.signal);
      res.setHeader('content-type', mime); res.setHeader('cache-control', 'no-store'); res.end(audio);
    } catch (e) {
      const se = e instanceof SpeechError ? e : new SpeechError('Speech generation failed.', 500, 'internal');
      if (!res.headersSent && se.code !== 'cancelled') res.status(se.status).json({ error: se.message, code: se.code });
      else if (!res.writableEnded) res.end();
    } finally { clearTimeout(t); }
  });
  /** The voices on the configured ElevenLabs account, for the picker in Settings (this computer only). */
  app.get('/api/speech/voices', speechLimit, async (req, res) => {
    if (!isLoopback(req)) { res.status(403).json({ error: 'The voice list is available only on this computer.', code: 'forbidden' }); return; }
    const t = cfg.speech.tts.provider === 'elevenlabs' ? cfg.speech.tts : { ...cfg.speech.tts, provider: 'elevenlabs' as const, baseUrl: cfg.speech.eleven.baseUrl, apiKey: cfg.speech.eleven.apiKey };
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    try { res.json({ provider: 'elevenlabs', current: cfg.speech.tts.provider === 'elevenlabs' ? cfg.speech.tts.voice : null, voices: await listElevenVoices(t, ctl.signal) }); }
    catch (e) { const se = e instanceof SpeechError ? e : new SpeechError('Could not load the voice list.', 500, 'internal'); res.status(se.status === 499 ? 504 : se.status).json({ error: se.message, code: se.code }); }
    finally { clearTimeout(tm); }
  });
  /** Transcribes one recorded utterance (raw audio body, ≤ 8 MB). The audio is forwarded and not stored. */
  app.post('/api/transcribe', speechLimit, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }), async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 100) { res.status(400).json({ error: 'No audio received', code: 'invalid_request' }); return; }
    const mime = String(req.headers['content-type'] ?? 'audio/webm').split(';')[0];
    const ctl = new AbortController(); res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    const t = setTimeout(() => ctl.abort('timeout'), 45000);
    try { res.json({ text: await transcribe(cfg.speech.stt, body, mime, ctl.signal) }); }
    catch (e) {
      const se = e instanceof SpeechError ? e : new SpeechError('Transcription failed.', 500, 'internal');
      if (!res.headersSent && se.code !== 'cancelled') res.status(se.status).json({ error: se.message, code: se.code });
    } finally { clearTimeout(t); }
  });

  /** Detects a local Ollama install (free, offline models) so Settings can offer a one-click setup. Read-only, loopback only. */
  app.get('/api/local-models', async (req, res) => {
    if (!isLoopback(req)) { res.status(403).json({ error: 'Loopback only' }); return; }
    const base = (opts.ollamaUrl ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    try {
      const r = await fetch(`${base}/api/tags`, { signal: ctl.signal });
      if (!r.ok) { res.json({ ollama: { reachable: false, baseUrl: `${base}/v1`, models: [], note: `Ollama answered HTTP ${r.status}` } }); return; }
      const j = (await r.json()) as { models?: { name?: unknown }[] };
      const models = (j.models ?? []).map((m) => String(m.name ?? '')).filter((n) => /^[\w.:/-]{1,120}$/.test(n)).slice(0, 50);
      res.json({ ollama: { reachable: true, baseUrl: `${base}/v1`, models, note: models.length ? `${models.length} model(s) installed` : 'Ollama is running but has no models yet — download one below' } });
    } catch { res.json({ ollama: { reachable: false, baseUrl: `${base}/v1`, models: [], note: 'Ollama is not running on this computer (install it free from ollama.com/download and start it)' } }); }
    finally { clearTimeout(t); }
  });

  /**
   * Downloads an Ollama model from inside the app (replaces the separate setup script). Loopback only; the model
   * name is validated and the request only ever goes to the configured local Ollama. Streams NDJSON progress:
   * {status, completed?, total?} lines, then one final {done:true, ok, message}. Closing the request cancels the download.
   */
  app.post('/api/local-models/pull', async (req, res) => {
    if (!isLoopback(req)) { res.status(403).json({ error: 'Loopback only' }); return; }
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!/^[\w.:/-]{1,120}$/.test(model)) { res.status(400).json({ error: 'Invalid model name' }); return; }
    const base = (opts.ollamaUrl ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    res.status(200).setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    const send = (o: Record<string, unknown>) => { if (!res.writableEnded) res.write(`${JSON.stringify(o)}\n`); };
    const finish = (ok: boolean, message: string) => { send({ done: true, ok, message }); res.end(); };
    let r: globalThis.Response;
    try { r = await fetch(`${base}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, name: model, stream: true }), signal: ctl.signal }); }
    catch { finish(false, 'Ollama is not running on this computer. Install it from ollama.com/download, start it, then try again.'); return; }
    if (!r.ok || !r.body) { finish(false, `Ollama refused the download (HTTP ${r.status}).`); return; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let success = false; let error = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          let j: { status?: unknown; total?: unknown; completed?: unknown; error?: unknown };
          try { j = JSON.parse(line); } catch { continue; }
          if (typeof j.error === 'string') { error = j.error.slice(0, 200); continue; }
          const status = typeof j.status === 'string' ? j.status.slice(0, 80) : '';
          if (status === 'success') success = true;
          send({ status, ...(typeof j.total === 'number' ? { total: j.total } : {}), ...(typeof j.completed === 'number' ? { completed: j.completed } : {}) });
        }
      }
    } catch { if (ctl.signal.aborted) { res.end(); return; } error = error || 'The download was interrupted.'; }
    if (success) finish(true, `${model} is downloaded and ready.`);
    else finish(false, error ? `Ollama could not download ${model}: ${error}` : `The download of ${model} did not finish.`);
  });

  app.use('/api', (_q, r) => { r.status(404).json({ error: 'Not found' }); });
  if (opts.serveDist) {
    const dist = resolve(opts.distDir ?? process.env.NEXUS_DIST_DIR ?? 'dist');
    if (existsSync(dist)) { app.use(express.static(dist)); app.use((_q, r) => r.sendFile(resolve(dist, 'index.html'))); }
  }
  app.use((err: Error & { status?: number; type?: string }, _q: Request, res: Response, _n: NextFunction) => {
    void _n; res.status(err.status ?? 500).json({ error: err.status === 413 ? 'Request too large' : 'Bad request', code: 'invalid_request' });
  });
  return app;
}
