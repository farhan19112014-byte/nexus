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
import { cloneUrlAllowed, listElevenVoices, SpeechError, sttStatus, synthesize, synthesizeElevenTimed, transcribe, ttsStatus, type Alignment } from './speech';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { baseSecurityHeaders, buildCsp, inlineScriptHashes } from './security';
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
import { DailyBudget, makeCounterStore, visitorOf, type CounterStore, type Denied, type MeterName } from './budget';
import { createHash, timingSafeEqual } from 'node:crypto';
import { findImage } from '../shared/imageSearch';
import type { ImageResult } from '../shared/visual';
import { z } from 'zod';
import { designModel, editModel, HoloDesignRequestSchema, HoloEditRequestSchema } from './aiTasks';
import { draftSkill, reflect, ReflectRequestSchema, research as researchTask, ResearchRequestSchema, runSkill, SkillDraftRequestSchema, SkillRunRequestSchema } from './learn';

export function makeProvider(c: ServerConfig): LLMProvider {
  if (c.provider === 'openai') return new OpenAICompatibleProvider(c.openai);
  if (c.provider === 'anthropic') return new AnthropicProvider(c.anthropic);
  if (c.provider === 'gemini') return new GeminiProvider(c.gemini);
  return new DemoProvider();
}

/**
 * Per-visitor requests per minute (in memory: a one-minute window needs no durable store). Expired windows are
 * pruned; when too many visitors are active at once, new ones share one "overflow" window instead of everyone's
 * counts being wiped (which would let a flood of addresses reset the limit for a blocked visitor).
 */
export function rateLimiter(perMin: number, maxVisitors = 5000, now = () => Date.now()) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!perMin) return next();
    const t = now(); let k = visitorOf(req.ip);
    if (!hits.has(k) && hits.size >= maxVisitors) { for (const [key, h] of hits) if (h.reset <= t) hits.delete(key); if (hits.size >= maxVisitors) k = 'overflow'; }
    const h = hits.get(k);
    if (!h || h.reset <= t) { hits.set(k, { n: 1, reset: t + 60_000 }); return next(); }
    if (++h.n > perMin) { res.setHeader('retry-after', String(Math.ceil((h.reset - t) / 1000))); res.status(429).json({ error: 'Too many requests — please wait a moment.', code: 'rate_limited', retryable: true }); return; }
    next();
  };
}
/** How many proxies in front of the server add themselves to X-Forwarded-For (TRUST_PROXY; public servers default to 1). */
export function trustProxySetting(raw: string | undefined, publicMode: boolean): number | false {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return publicMode ? 1 : false;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  const n = Number(v); if (Number.isInteger(n) && n > 0 && n <= 10) return n;
  throw new Error(`TRUST_PROXY must be a number of proxies (1–10) or false (got "${raw}")`);   // "true" would trust a client-written header
}
/** The last-resort error handler: client mistakes → 400/413; anything unexpected → 500 with a generic message (never the error's own text or stack). */
export function errorHandler(log?: (line: string) => void) {
  return (err: Error & { status?: number; type?: string }, _q: Request, res: Response, _n: NextFunction) => {
    void _n;
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) { log?.(`internal error: ${err?.name ?? 'Error'}`); if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the NEXUS server.', code: 'internal' }); return; }
    res.status(status).json({ error: status === 413 ? 'Request too large' : 'Bad request', code: 'invalid_request' });
  };
}
const deny = (res: Response, d: Denied) => { res.setHeader('retry-after', String(d.retryAfterS)); res.status(d.status).json({ error: d.reason, code: d.code, retryable: d.status === 503 }); };
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

export interface AppOptions {
  serveDist?: boolean; distDir?: string; log?: (line: string) => void; persistRuntime?: boolean; ollamaUrl?: string;
  /** tests: the budget counter store (default: chosen from the environment, see makeCounterStore) */
  counterStore?: CounterStore;
  /** tests: overrides TRUST_PROXY */
  trustProxy?: string;
  /** tests: speech / transcription time limits in ms (default 30 s / 45 s) */
  speechTimeoutMs?: number; transcribeTimeoutMs?: number;
}

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
  // security headers on every response (pages, API, errors) — see server/security.ts
  const distDir = resolve(opts.distDir ?? process.env.NEXUS_DIST_DIR ?? 'dist');
  const indexHtml = opts.serveDist && existsSync(resolve(distDir, 'index.html')) ? readFileSync(resolve(distDir, 'index.html'), 'utf8') : '';
  const headers = { ...baseSecurityHeaders(base.publicMode), 'content-security-policy': buildCsp({ publicMode: base.publicMode, inlineScripts: inlineScriptHashes(indexHtml) }) };
  app.use((_req, res, next) => { for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); next(); });
  app.use((req, res, next) => { const t0 = Date.now(); res.on('finish', () => opts.log?.(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - t0}ms`)); next(); });
  // behind the host's HTTPS proxy: req.ip is the visitor, not the proxy (the right-most hops are the trusted proxies)
  const trust = trustProxySetting(opts.trustProxy ?? process.env.TRUST_PROXY, base.publicMode);
  if (trust) app.set('trust proxy', trust);
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
    // computer-only features make no sense (and must not run) on a public server; the connection test would let any
    // visitor make extra AI calls (the owner checks the live service with `npm run verify:live` instead)
    app.use(['/api/local-models', '/api/speech/voices', '/api/config/test'], (_req, res) => { res.status(404).json({ error: 'Not available on the public NEXUS server.', code: 'not_available' }); });
  }
  const { store: counterStore, note: storeNote } = opts.counterStore ? { store: opts.counterStore, note: undefined } : makeCounterStore(base.budgetStore, base.publicMode);
  if (storeNote) opts.log?.(`budget: ${storeNote}`);
  const budget = new DailyBudget(base.budget, counterStore);
  /** reserve or answer with the refusal; null = refused (already answered) */
  const take = async (res: Response, m: MeterName, ip: string | undefined, n: number) => { const r = await budget.reserve(m, ip, n); if (!r.ok) { deny(res, r); return null; } return r; };
  app.use(express.json({ limit: '128kb' }));
  /** What the server sees as this visitor (their own address and the number of forwarding hops) — for checking the proxy setup. */
  app.get('/api/visitor', rateLimiter(30), (req, res) => {
    const xff = String(req.headers['x-forwarded-for'] ?? ''); const hops = xff ? xff.split(',').length : 0;
    res.setHeader('cache-control', 'no-store');
    res.json({ ip: req.ip ?? null, visitor: visitorOf(req.ip), forwardedEntries: hops, trustProxy: trust || 0 });
  });

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

  // visual presenter: a free, credited reference image for a topic (Wikipedia / Wikimedia Commons, no key).
  // Cached (same topic → one lookup), short timeout; a miss or an error is an honest {image:null}, never a 5xx.
  const imageCache = new Map<string, { at: number; image: ImageResult | null }>();
  const imageLimit = rateLimiter(Math.max(20, cfg.rateLimitPerMin * 2));
  app.get('/api/visual/image', imageLimit, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    if (q.length < 2) { res.status(400).json({ error: 'Give a topic to look up (q).', code: 'invalid_request' }); return; }
    const key = q.toLowerCase(); const hit = imageCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600_000) { res.json({ image: hit.image, cached: true }); return; }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const image = await findImage(q, { base: cfg.research.wikipediaBase, lang: cfg.research.wikipediaLang, signal: ctl.signal, headers: { 'user-agent': 'NEXUS-companion/2.0 (visual presenter; https://github.com/farhan19112014-byte/nexus)' } });
      if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value as string);
      imageCache.set(key, { at: Date.now(), image });
      res.json({ image });
    } catch (e) {
      opts.log?.(`[visual] image lookup failed: ${(e as Error).message}`);
      res.json({ image: null, error: ctl.signal.aborted ? 'The image search took too long.' : 'The image search is unavailable right now.' });
    } finally { clearTimeout(timer); }
  });
  app.post('/api/chat', limit, async (req, res) => {
    const parsed = ChatRequestSchema.safeParse(simpleChat(req.body));
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request', code: 'invalid_request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }); return; }
    const metered = provider.id !== 'demo';
    const ticket = metered ? await take(res, 'chat', req.ip, 1) : null; if (metered && !ticket) return;
    // a request the AI service rejected before writing any reply is given back; one the visitor cancelled or that
    // timed out is not (the provider may already have done — and counted — the work)
    let produced = false;
    const refund = (pe: ProviderError) => { if (ticket && !produced && pe.code !== 'cancelled' && pe.code !== 'timeout') void ticket.refund(); };
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort('client'); });
    const body = parsed.data;
    if (body.stream) {
      res.status(200).setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform'); res.setHeader('connection', 'keep-alive');
      res.flushHeaders();
      const send = (e: StreamEvent) => { if (e.type === 'delta' || e.type === 'head') produced = true; if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
      try {
        const out = await brain.handle(body, ctl.signal, send);
        send({ type: 'final', response: out.response, meta: out.meta });
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
        refund(pe);
        if (pe.code !== 'cancelled') send({ type: 'error', error: pe.message, code: pe.code, retryable: pe.retryable });
      }
      res.end();
      return;
    }
    try { const out = await brain.handle(body, ctl.signal); res.json(out); }
    catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
      refund(pe);
      if (!res.headersSent && pe.code !== 'cancelled') { if (pe.retryAfterS) res.setHeader('retry-after', String(pe.retryAfterS)); res.status(pe.status).json({ error: pe.message, code: pe.code, retryable: pe.retryable }); }
    }
  });

  app.post('/api/summarize', limit, async (req, res) => {
    const p = SummarizeRequestSchema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Invalid request', code: 'invalid_request' }); return; }
    const ticket = provider.id !== 'demo' ? await take(res, 'chat', req.ip, 1) : null; if (provider.id !== 'demo' && !ticket) return;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), cfg.timeoutMs);
    res.on('close', () => { if (!res.writableEnded) ctl.abort('client'); });
    try { res.json({ summary: await brain.summarize(p.data.messages, ctl.signal) }); }
    catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
      if (ticket && !ctl.signal.aborted && pe.code !== 'cancelled' && pe.code !== 'timeout') void ticket.refund();
      if (!res.headersSent && ctl.signal.reason !== 'client') res.status(ctl.signal.reason === 'timeout' ? 504 : pe.status).json({ error: ctl.signal.reason === 'timeout' ? 'The AI provider did not respond in time.' : pe.message, code: ctl.signal.reason === 'timeout' ? 'timeout' : pe.code });
    } finally { clearTimeout(t); }
  });

  /**
   * Structured AI tasks (HOLOBUILD, learning engine): one AI call (+ one repair) each, charged to the same daily chat
   * allowance as a message; given back when the AI service fails before answering. Demo mode answers 503 honestly.
   */
  const aiTask = <T>(schema: z.ZodType<T>, run: (body: T, signal: AbortSignal) => Promise<unknown>) => async (req: Request, res: Response) => {
    const p = schema.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Invalid request', code: 'invalid_request', issues: p.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }); return; }
    if (provider.id === 'demo') { res.status(503).json({ error: 'No AI model is connected to this NEXUS server (demo mode), so this needs an AI model.', code: 'unconfigured' }); return; }
    const ticket = await take(res, 'chat', req.ip, 1); if (!ticket) return;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), Math.max(cfg.timeoutMs, 45000));
    res.on('close', () => { if (!res.writableEnded) ctl.abort('client'); });
    try { res.json(await run(p.data, ctl.signal)); }
    catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError('Internal server error', 'internal', 500);
      if (!ctl.signal.aborted && pe.code !== 'cancelled' && pe.code !== 'timeout') void ticket.refund();
      const timeout = ctl.signal.reason === 'timeout';
      if (!res.headersSent && ctl.signal.reason !== 'client') res.status(timeout ? 504 : pe.status).json({ error: timeout ? 'The AI provider did not respond in time.' : pe.message, code: timeout ? 'timeout' : pe.code, retryable: pe.retryable });
    } finally { clearTimeout(t); }
  };
  app.post('/api/holo/design', limit, aiTask(HoloDesignRequestSchema, (b, signal) => designModel(provider, b.prompt, signal)));
  app.post('/api/holo/edit', limit, aiTask(HoloEditRequestSchema, (b, signal) => editModel(provider, b, signal)));
  // learning engine (research, reflection, workflow skills) — same allowance, same refund rules
  app.post('/api/learn/research', limit, aiTask(ResearchRequestSchema, (b, signal) => researchTask(provider, research, b.question, signal)));
  app.post('/api/learn/reflect', limit, aiTask(ReflectRequestSchema, (b, signal) => reflect(provider, b, signal)));
  app.post('/api/learn/skill/draft', limit, aiTask(SkillDraftRequestSchema, (b, signal) => draftSkill(provider, b, signal)));
  app.post('/api/learn/skill/run', limit, aiTask(SkillRunRequestSchema, (b, signal) => runSkill(provider, b, signal)));

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
    { const b = await budget.reserve('chat', _req.ip, 1); if (!b.ok) { res.json({ ok: false, message: b.reason }); return; } }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), Math.min(20000, cfg.timeoutMs));
    try {
      const text = await provider.complete({ system: 'Connection test. Reply with the single word OK.', messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 8, temperature: 0, json: false }, ctl.signal);
      res.json({ ok: true, provider: provider.id, model: provider.model, message: `Connected — the model replied "${text.trim().slice(0, 24)}".`, latencyMs: Date.now() - t0 });
    } catch (e) { res.json({ ok: false, provider: provider.id, message: (e as Error).message, latencyMs: Date.now() - t0 }); }
    finally { clearTimeout(t); }
  });

  /** Text-to-speech through the configured speech service (spec §12). Returns audio bytes; errors are JSON with a stable code. */
  const speechLimit = rateLimiter(Math.max(60, cfg.rateLimitPerMin * 4));
  /**
   * Recently generated audio, per visitor: replaying the same sentence (e.g. "repeat that", or a retry after a playback
   * error) is served again without a second provider call or a second charge. Small, short-lived, in memory, and keyed
   * by a hash that includes the visitor, so one visitor can never receive (or detect) another visitor's audio.
   */
  const audioCache = new Map<string, { audio: Buffer; mime: string; exp: number; alignment?: Alignment | null }>();
  const AUDIO_CACHE_MAX = 24, AUDIO_CACHE_TTL = 10 * 60_000, AUDIO_CACHE_BYTES = 12 * 1024 * 1024;
  const cacheKey = (ip: string | undefined, text: string, timed = false) => { const t = cfg.speech.tts; return createHash('sha256').update(JSON.stringify([visitorOf(ip), t.provider, t.baseUrl, t.model, t.voice, t.style, t.format, text, timed])).digest('base64url'); };
  const cachePut = (k: string, audio: Buffer, mime: string, alignment?: Alignment | null) => {
    if (audio.length > AUDIO_CACHE_BYTES / 4) return;
    audioCache.set(k, { audio, mime, exp: Date.now() + AUDIO_CACHE_TTL, alignment });
    let bytes = 0; for (const e of audioCache.values()) bytes += e.audio.length;
    for (const key of audioCache.keys()) { if (audioCache.size <= AUDIO_CACHE_MAX && bytes <= AUDIO_CACHE_BYTES) break; bytes -= audioCache.get(key)!.audio.length; audioCache.delete(key); }
  };
  /** POST /api/speech (and the older /api/tts): { text } → audio from the configured voice service. No other voice is substituted on failure. */
  // your own voice: the voice-clone Colab notebook registers its current public link + access code here (every minute
  // while it runs), authenticated by VOICE_CLONE_KEY — so the changing Colab link never has to be copied into Render
  const cloneSeen = { at: 0 };
  app.post('/api/voice-clone/register', rateLimiter(20), (req, res) => {
    const key = cfg.speech.cloneKey; const given = typeof req.headers['x-nexus-voice-key'] === 'string' ? req.headers['x-nexus-voice-key'] : '';
    const ok = key.length >= 16 && given.length === key.length && timingSafeEqual(Buffer.from(given), Buffer.from(key));
    if (!ok) { res.status(401).json({ error: 'Wrong or missing voice key (VOICE_CLONE_KEY on the server, NEXUS_VOICE_KEY in the notebook).', code: 'unauthorized' }); return; }
    if (cfg.speech.tts.provider !== 'clone') { res.status(409).json({ error: 'The server is not set to your own voice: set TTS_PROVIDER=clone in Render.', code: 'not_clone' }); return; }
    const url = typeof req.body?.url === 'string' ? req.body.url.trim().replace(/\/+$/, '') : ''; const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!cloneUrlAllowed(url) || code.length < 8 || code.length > 200) { res.status(400).json({ error: 'Send the notebook\'s https://….gradio.live link and its access code.', code: 'invalid_request' }); return; }
    const changed = url !== cfg.speech.tts.baseUrl || code !== cfg.speech.tts.apiKey;
    cfg.speech.tts.baseUrl = url; cfg.speech.tts.apiKey = code; cloneSeen.at = Date.now();
    if (changed) opts.log?.(`[voice] your own voice connected: ${new URL(url).hostname}`);
    res.json({ ok: true, changed });
  });

  app.post(['/api/speech', '/api/tts'], speechLimit, async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 1200) { res.status(400).json({ error: 'Text must be 1–1200 characters', code: 'invalid_request' }); return; }
    if (!ttsStatus(cfg.speech.tts).configured) { res.status(503).json({ error: ttsStatus(cfg.speech.tts).note, code: 'not_configured' }); return; }
    // {timing:true} with ElevenLabs: JSON { audio (base64), mime, alignment } — same voice and cost, character timing for lip-sync
    const timed = req.body?.timing === true && cfg.speech.tts.provider === 'elevenlabs';
    const send = (audio: Buffer, mime: string, alignment: Alignment | null | undefined, replay: boolean) => {
      res.setHeader('cache-control', 'no-store'); if (replay) res.setHeader('x-nexus-audio', 'replay');
      if (timed) { res.json({ audio: audio.toString('base64'), mime, alignment: alignment ?? null }); return; }
      res.setHeader('content-type', mime); res.end(audio);
    };
    const key = cacheKey(req.ip, text, timed); const hit = audioCache.get(key);
    if (hit && hit.exp > Date.now()) { send(hit.audio, hit.mime, hit.alignment, true); return; }
    // spoken characters are reserved BEFORE the provider is called (parallel requests cannot share the same allowance)
    const ticket = await take(res, 'speech', req.ip, [...text].length); if (!ticket) return;
    const ctl = new AbortController(); res.on('close', () => { if (!res.writableFinished) ctl.abort('client'); });
    const t = setTimeout(() => ctl.abort('timeout'), opts.speechTimeoutMs ?? (cfg.speech.tts.provider === 'clone' ? 90000 : 30000));   // a free Colab GPU is slower than a speech API
    try {
      const out = timed ? await synthesizeElevenTimed(cfg.speech.tts, text, ctl.signal) : { ...(await synthesize(cfg.speech.tts, text, ctl.signal)), alignment: null };
      cachePut(key, out.audio, out.mime, out.alignment);
      send(out.audio, out.mime, out.alignment, false);
    } catch (e) {
      const why = ctl.signal.aborted ? ctl.signal.reason : null;
      if (why === 'timeout') {
        // our time limit: the service may still produce (and bill) the audio, so the characters stay counted
        if (!res.headersSent) res.status(504).json({ error: 'The voice service did not answer in time. The reply is shown as text.', code: 'timeout' });
        else res.end();
        return;
      }
      if (why === 'client') { if (!res.writableEnded) res.end(); return; }   // the visitor stopped it: counted, nothing to send
      // the service returned an error, so no audio was produced: give the characters back (once)
      const se = e instanceof SpeechError ? e : new SpeechError('Speech generation failed.', 500, 'internal');
      void ticket.refund();
      if (!res.headersSent) res.status(se.status === 499 ? 502 : se.status).json({ error: se.message, code: se.code });
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
    const mime = String(req.headers['content-type'] ?? 'audio/webm').split(';')[0].trim().toLowerCase();
    if (!/^(audio\/[\w.+-]{1,40}|application\/octet-stream)$/.test(mime)) { res.status(415).json({ error: 'Unsupported audio type', code: 'invalid_request' }); return; }
    if (!sttStatus(cfg.speech.stt).configured) { res.status(503).json({ error: sttStatus(cfg.speech.stt).note, code: 'not_configured' }); return; }
    const ticket = await take(res, 'stt', req.ip, 1); if (!ticket) return;
    const ctl = new AbortController(); res.on('close', () => { if (!res.writableFinished) ctl.abort('client'); });
    const t = setTimeout(() => ctl.abort('timeout'), opts.transcribeTimeoutMs ?? 45000);
    try { res.json({ text: await transcribe(cfg.speech.stt, body, mime, ctl.signal) }); }
    catch (e) {
      const why = ctl.signal.aborted ? ctl.signal.reason : null;
      if (why === 'timeout') { if (!res.headersSent) res.status(504).json({ error: 'The transcription service did not answer in time — please try again or type.', code: 'timeout' }); return; }
      if (why === 'client') { if (!res.writableEnded) res.end(); return; }
      const se = e instanceof SpeechError ? e : new SpeechError('Transcription failed.', 500, 'internal');
      void ticket.refund();
      if (!res.headersSent) res.status(se.status === 499 ? 502 : se.status).json({ error: se.message, code: se.code });
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
    const dist = distDir;
    if (existsSync(dist)) { app.use(express.static(dist)); app.use((_q, r) => r.sendFile(resolve(dist, 'index.html'))); }
  }
  app.use(errorHandler(opts.log));
  return app;
}
