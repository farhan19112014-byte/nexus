/**
 * Browser → server client (Assets 42, 43, 46, 47). Streams via Server-Sent Events when available.
 * Falls back to the LOCAL demo brain only when no API server is reachable (clearly labelled).
 * Never holds API keys.
 */
import { BrainResponseSchema, ChatRequestSchema, type BrainHead, type BrainResponse, type ChatMessage, type ChatRequestInput, type ErrorCode, type ResponseMeta, type ServerCapabilities, type Source, type StreamEvent } from '../../shared/schema';
import { demoBrain } from '../../shared/demoBrain';

export class ApiError extends Error { constructor(msg: string, public code: ErrorCode, public retryable = false) { super(msg); } }
export interface ChatHandlers { onStatus?(s: 'researching' | 'thinking' | 'streaming'): void; onSources?(s: Source[]): void; onHead?(h: BrainHead): void; onDelta?(t: string): void }
export interface ChatResult { response: BrainResponse; meta: ResponseMeta; offline: boolean }

export const OFFLINE_CAPS: ServerCapabilities = {
  provider: 'local-demo', label: 'Local demo brain (API server offline — not an LLM)', model: null, isLLM: false, configured: true, streaming: false,
  promptVersion: 'local', runtimeConfig: false, research: { provider: 'none', configured: false, note: 'API server offline' }, note: 'Start the API server (npm run dev) to use a configured LLM.',
};

export class ApiClient {
  offline = false;
  constructor(private base = '', private timeoutMs = 60000) {}

  async status(): Promise<ServerCapabilities> {
    try {
      const r = await fetch(`${this.base}/api/status`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('no api');
      this.offline = false; return await r.json() as ServerCapabilities;
    } catch { this.offline = true; return OFFLINE_CAPS; }
  }

  async chat(input: ChatRequestInput, signal: AbortSignal, h: ChatHandlers = {}): Promise<ChatResult> {
    const req = ChatRequestSchema.parse(input);
    // No silent substitution: if the server can't be reached we report it; the user may then explicitly ask the offline demo.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort('timeout'), this.timeoutMs);
    const onAbort = () => ctl.abort('cancelled'); signal.addEventListener('abort', onAbort, { once: true });
    try {
      let r: Response;
      try { r = await fetch(`${this.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal: ctl.signal }); }
      catch (e) {
        if (ctl.signal.aborted) throw ctl.signal.reason === 'timeout' ? new ApiError('The request timed out.', 'timeout', true) : new ApiError('Cancelled', 'cancelled');
        this.offline = true; void e; throw new ApiError('Can’t reach the NEXUS server — it may have stopped (run start-nexus.bat again).', 'offline', true);
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

  async summarize(messages: ChatMessage[]): Promise<string | null> {
    if (this.offline) return null;
    try {
      const r = await fetch(`${this.base}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: messages.slice(-40) }), signal: AbortSignal.timeout(30000) });
      return r.ok ? (((await r.json()) as { summary?: string }).summary ?? null) : null;
    } catch { return null; }
  }

  async getConfig() { const r = await fetch(`${this.base}/api/config`); if (!r.ok) throw new ApiError('Config unavailable', 'network'); return r.json(); }
  async putConfig(patch: unknown) {
    const r = await fetch(`${this.base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError((j as { error?: string }).error ?? `HTTP ${r.status}`, 'invalid_request');
    return j as { ok: boolean; config: unknown; status: ServerCapabilities };
  }
  async localModels() { const r = await fetch(`${this.base}/api/local-models`); if (!r.ok) throw new ApiError('Local model check unavailable', 'network'); return r.json() as Promise<{ ollama: { reachable: boolean; baseUrl: string; models: string[]; note: string } }>; }
  /** Downloads an Ollama model through the NEXUS server, reporting real progress. Resolves with Ollama's final result. */
  async pullModel(model: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
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
  async testConnection() { const r = await fetch(`${this.base}/api/config/test`, { method: 'POST' }); return r.json() as Promise<{ ok: boolean; message: string; latencyMs?: number }>; }
}
