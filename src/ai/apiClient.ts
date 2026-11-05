/**
 * Browser → server client (Assets 42, 43, 46, 47). Streams via Server-Sent Events when available.
 * Falls back to the LOCAL demo brain only when no API server is reachable (clearly labelled).
 * Never holds API keys.
 */
import { BrainResponseSchema, ChatRequestSchema, type BrainHead, type BrainResponse, type ChatMessage, type ChatRequestInput, type ErrorCode, type ResponseMeta, type ServerCapabilities, type Source, type StreamEvent } from '../../shared/schema';
import { demoBrain } from '../../shared/demoBrain';
import { API_BASE, REMOTE_API, WEB_DEMO } from '../webDemo';
import { findImage } from '../../shared/imageSearch';
import { isAllowedImageUrl, type ImageResult } from '../../shared/visual';

export class ApiError extends Error { constructor(msg: string, public code: ErrorCode, public retryable = false) { super(msg); } }
export interface ChatHandlers { onStatus?(s: 'researching' | 'thinking' | 'streaming'): void; onSources?(s: Source[]): void; onHead?(h: BrainHead): void; onDelta?(t: string): void }
export interface ChatResult { response: BrainResponse; meta: ResponseMeta; offline: boolean }

export const OFFLINE_CAPS: ServerCapabilities = {
  provider: 'local-demo', label: 'Local demo brain (API server offline — not an LLM)', model: null, isLLM: false, configured: true, streaming: false,
  promptVersion: 'local', runtimeConfig: false, research: { provider: 'none', configured: false, note: 'API server offline' }, note: 'Start the API server (npm run dev) to use a configured LLM.',
};

/** Capabilities of the hosted web demo: no server, the scripted demo brain answers (and says it is not an LLM). */
export const WEB_DEMO_CAPS: ServerCapabilities = {
  provider: 'web-demo', label: 'Web demo — runs in your browser, no AI server (not an LLM)', model: null, isLLM: false, configured: true, streaming: false,
  promptVersion: 'local', runtimeConfig: false, research: { provider: 'none', configured: false, note: 'Not available in the web demo' },
  speech: { tts: { configured: false, note: 'Not available in the web demo' }, stt: { configured: false, note: 'Not available in the web demo' } },
  note: 'This hosted page has no NEXUS server. Run NEXUS on your computer to connect a real AI model.',
};
const noServer = () => new ApiError('Not available in the web demo — this page has no NEXUS server. Run NEXUS on your computer to use it.', 'unconfigured');

export class ApiClient {
  offline = false;
  constructor(private base = API_BASE, private timeoutMs = 60000, readonly webDemo = WEB_DEMO, private remote = REMOTE_API) {}
  private woken = false;
  /** called once if the hosted server is slow to answer the first time (free hosts sleep when idle) */
  onWaking: () => void = () => {};

  async status(): Promise<ServerCapabilities> {
    if (this.webDemo) return WEB_DEMO_CAPS;
    // a sleeping free host needs up to about a minute to wake on the first request
    const first = this.remote && !this.woken;
    const slow = first ? setTimeout(() => this.onWaking(), 3000) : null;
    try {
      const r = await fetch(`${this.base}/api/status`, { signal: AbortSignal.timeout(first ? 90000 : 8000) });
      if (slow) clearTimeout(slow);
      this.woken = true;
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('no api');
      this.offline = false; return await r.json() as ServerCapabilities;
    } catch { if (slow) clearTimeout(slow); this.offline = true; return OFFLINE_CAPS; }
  }

  async chat(input: ChatRequestInput, signal: AbortSignal, h: ChatHandlers = {}): Promise<ChatResult> {
    const req = ChatRequestSchema.parse(input);
    if (this.webDemo) { const r = await this.local(req, h, 'web demo'); return { ...r, offline: false, meta: { ...r.meta, provider: 'web-demo' } }; } // labelled, never presented as an AI
    // No silent substitution: if the server can't be reached we report it; the user may then explicitly ask the offline demo.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort('timeout'), this.timeoutMs);
    const onAbort = () => ctl.abort('cancelled'); signal.addEventListener('abort', onAbort, { once: true });
    try {
      let r: Response;
      try { r = await fetch(`${this.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: ctl.signal }); }
      catch (e) {
        if (ctl.signal.aborted) throw ctl.signal.reason === 'timeout' ? new ApiError('The request timed out.', 'timeout', true) : new ApiError('Cancelled', 'cancelled');
        this.offline = true; void e; throw new ApiError(this.remote ? 'Can’t reach the NEXUS server — check your internet connection and try again.' : 'Can’t reach the NEXUS server — it may have stopped (run start-nexus.bat again).', 'offline', true);
      }
      const ct = r.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream')) return await this.readStream(r, ctl.signal, h);
      if (!ct.includes('json')) { this.offline = true; throw new ApiError('There is no NEXUS server at this address, so nothing could answer.', 'offline', true); }
      this.offline = false;
      const body = await r.json().catch(() => null) as { response?: unknown; meta?: ResponseMeta; error?: string; code?: ErrorCode; retryable?: boolean } | null;
      if (!r.ok) throw new ApiError(body?.error ?? `Server error ${r.status}`, body?.code ?? 'provider', body?.retryable ?? r.status >= 500);
      const p = BrainResponseSchema.safeParse(body?.response);
      if (!p.success || !body?.meta) throw new ApiError('The AI response failed validation.', 'malformed', true);
      h.onHead?.(p.data); h.onDelta?.(p.data.reply);
      return { response: p.data, meta: body.meta, offline: false };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }

  private async readStream(r: Response, signal: AbortSignal, h: ChatHandlers): Promise<ChatResult> {
    const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    let final: ChatResult | null = null;
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch { if (signal.aborted) throw signal.reason === 'timeout' ? new ApiError('The request timed out.', 'timeout', true) : new ApiError('Cancelled', 'cancelled'); throw new ApiError('The connection dropped during the response.', 'network', true); }
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let ev: StreamEvent; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.type === 'status') h.onStatus?.(ev.stage);
          else if (ev.type === 'sources') h.onSources?.(ev.sources);
          else if (ev.type === 'head') h.onHead?.(ev.head);
          else if (ev.type === 'delta') h.onDelta?.(ev.text);
          else if (ev.type === 'error') throw new ApiError(ev.error, ev.code, ev.retryable);
          else if (ev.type === 'final') {
            const p = BrainResponseSchema.safeParse(ev.response);
            if (!p.success) throw new ApiError('The AI response failed validation.', 'malformed', true);
            final = { response: p.data, meta: ev.meta, offline: false };
          }
        }
      }
    } finally { try { reader.releaseLock(); } catch { /* */ } }
    if (signal.aborted) throw new ApiError('Cancelled', 'cancelled');
    if (!final) throw new ApiError('The response ended before it was complete.', 'network', true);
    return final;
  }

  /** Explicit, user-chosen offline answer from the scripted demo brain (not an LLM). */
  async offlineDemo(input: ChatRequestInput, _signal: AbortSignal, h: ChatHandlers = {}): Promise<ChatResult> { return this.local(ChatRequestSchema.parse(input), h, 'offline demo'); }

  private async local(req: ReturnType<typeof ChatRequestSchema.parse>, h: ChatHandlers, note?: string): Promise<ChatResult> {
    const response = demoBrain({ ...req, research: false });
    h.onHead?.(response); h.onDelta?.(response.reply);
    return { response, offline: true, meta: { provider: 'local-demo', model: null, isLLM: false, latencyMs: 0, streamed: false, repaired: false, droppedFields: note ? [] : [], degraded: false, historySent: 0, promptVersion: 'local', research: { used: false, provider: null, count: 0, error: req.research ? 'API server offline — research unavailable' : undefined } } };
  }

  /**
   * Structured AI task on the server (HOLOBUILD design/edit, research, reflection, skill runs). The answer is returned
   * as unknown JSON — callers validate it again before use. Throws ApiError with an honest reason (demo mode, offline, budget).
   */
  async task(path: string, body: unknown, signal?: AbortSignal, timeoutMs = 90000): Promise<unknown> {
    if (this.webDemo) throw noServer();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort('timeout'), timeoutMs);
    const onAbort = () => ctl.abort('cancelled'); signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let r: Response;
      try { r = await fetch(`${this.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }); }
      catch {
        if (ctl.signal.aborted) throw ctl.signal.reason === 'timeout' ? new ApiError('The request timed out.', 'timeout', true) : new ApiError('Cancelled', 'cancelled');
        this.offline = true; throw new ApiError('Can’t reach the NEXUS server.', 'offline', true);
      }
      if (!(r.headers.get('content-type') ?? '').includes('json')) { this.offline = true; throw new ApiError('There is no NEXUS server at this address.', 'offline', true); }
      const j = await r.json().catch(() => null) as { error?: string; code?: ErrorCode; retryable?: boolean } | null;
      if (!r.ok) throw new ApiError(j?.error ?? `Server error ${r.status}`, j?.code ?? 'provider', j?.retryable ?? r.status >= 500);
      return j;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }

  /**
   * Visual presenter: a free, credited reference image for a topic. Through the NEXUS server when there is one
   * (cached there); without a server (web demo, server unreachable) straight from Wikipedia. Never throws — null on
   * any failure, so the explanation simply goes on without a picture.
   */
  async visualImage(query: string, signal?: AbortSignal): Promise<{ image: ImageResult | null; error?: string }> {
    const direct = async () => { try { return { image: await findImage(query, { signal }) }; } catch (e) { return { image: null, error: (e as Error).name === 'AbortError' ? 'cancelled' : 'The image search is unavailable right now.' }; } };
    if (this.webDemo) return direct();
    try {
      const r = await fetch(`${this.base}/api/visual/image?q=${encodeURIComponent(query.slice(0, 80))}`, { signal });
      if (r.status === 404) return direct();                       // an older server without the route
      if (!r.ok) return { image: null, error: r.status === 429 ? 'Too many image requests — try again in a minute.' : `The image search returned HTTP ${r.status}.` };
      const j = await r.json() as { image?: ImageResult | null; error?: string };
      const img = j.image && isAllowedImageUrl(j.image.url) ? j.image : null;
      return { image: img, ...(j.error ? { error: j.error } : {}) };
    } catch (e) { if ((e as Error).name === 'AbortError') return { image: null, error: 'cancelled' }; return direct(); }
  }

  async summarize(messages: ChatMessage[]): Promise<string | null> {
    if (this.offline || this.webDemo) return null;
    try {
      const r = await fetch(`${this.base}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: messages.slice(-40) }), signal: AbortSignal.timeout(30000) });
      return r.ok ? (((await r.json()) as { summary?: string }).summary ?? null) : null;
    } catch { return null; }
  }

  async getConfig() { if (this.webDemo) throw noServer(); const r = await fetch(`${this.base}/api/config`); if (!r.ok) throw new ApiError('Config unavailable', 'network'); return r.json(); }
  async putConfig(patch: unknown) {
    if (this.webDemo) throw noServer();
    const r = await fetch(`${this.base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError((j as { error?: string }).error ?? `HTTP ${r.status}`, 'invalid_request');
    return j as { ok: boolean; config: unknown; status: ServerCapabilities };
  }
  /** ElevenLabs voices on the account configured on the server (keys stay on the server) */
  async speechVoices() {
    if (this.webDemo) throw noServer();
    const r = await fetch(`${this.base}/api/speech/voices`); const j = await r.json().catch(() => ({})) as { error?: string; voices?: { id: string; name: string; description: string; category: string }[]; current?: string | null };
    if (!r.ok || !j.voices) throw new ApiError(j.error ?? 'The voice list is unavailable.', 'network');
    return { voices: j.voices, current: j.current ?? null };
  }
  async localModels() { if (this.webDemo) throw noServer(); const r = await fetch(`${this.base}/api/local-models`); if (!r.ok) throw new ApiError('Local model check unavailable', 'network'); return r.json() as Promise<{ ollama: { reachable: boolean; baseUrl: string; models: string[]; note: string } }>; }
  /** Downloads an Ollama model through the NEXUS server, reporting real progress. Resolves with Ollama's final result. */
  async pullModel(model: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (this.webDemo) return { ok: false, message: noServer().message };
    let r: Response;
    try { r = await fetch(`${this.base}/api/local-models/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), signal }); }
    catch (e) { if (signal?.aborted) return { ok: false, message: 'Download cancelled.' }; throw new ApiError((e as Error).message, 'offline', true); }
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); return { ok: false, message: (j as { error?: string }).error ?? `HTTP ${r.status}` }; }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let result: { ok: boolean; message: string } | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          try { const j = JSON.parse(line); if (j.done) result = { ok: !!j.ok, message: String(j.message ?? '') }; else onProgress({ status: String(j.status ?? ''), completed: j.completed, total: j.total }); } catch { /* skip bad line */ }
        }
      }
    } catch { if (signal?.aborted) return { ok: false, message: 'Download cancelled.' }; }
    return result ?? { ok: false, message: signal?.aborted ? 'Download cancelled.' : 'The download ended without a result.' };
  }
  async testConnection(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    if (this.webDemo) return { ok: false, message: noServer().message };
    const r = await fetch(`${this.base}/api/config/test`, { method: 'POST' });
    const j = await r.json().catch(() => null) as { ok?: unknown; message?: unknown; error?: unknown; latencyMs?: number } | null;
    // a refusal (public server, rate limit) is a failed test with the server's reason, never "undefined"
    if (!r.ok || !j || typeof j.ok !== 'boolean') return { ok: false, message: String(j?.error ?? j?.message ?? `The connection test is not available (HTTP ${r.status}).`) };
    return { ok: j.ok, message: String(j.message ?? ''), latencyMs: j.latencyMs };
  }
}
