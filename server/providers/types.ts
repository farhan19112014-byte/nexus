import type { ChatMessage, ErrorCode } from '../../shared/schema';

export interface CompletionRequest { system: string; messages: ChatMessage[]; maxTokens: number; temperature: number; json: boolean }

/** Asset 41 — replaceable provider interface. */
export interface LLMProvider {
  readonly id: string;
  readonly model: string | null;
  readonly supportsStreaming: boolean;
  configured(): { ok: boolean; note?: string };
  label(): string;
  complete(req: CompletionRequest, signal: AbortSignal): Promise<string>;
  /** Streams text; calls onText for each chunk; resolves with the full text. */
  stream(req: CompletionRequest, signal: AbortSignal, onText: (t: string) => void): Promise<string>;
}

/** Asset 47 — typed provider errors with actionable messages. */
export class ProviderError extends Error {
  constructor(message: string, public code: ErrorCode, public status = 502, public retryable = false, public retryAfterS?: number) { super(message); }
}

export async function httpJSON(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try { res = await fetch(url, { ...init, signal }); }
  catch (e) {
    if (signal.aborted) throw new ProviderError(signal.reason === 'client' ? 'Request cancelled' : 'The AI provider did not respond in time.', signal.reason === 'client' ? 'cancelled' : 'timeout', 504);
    throw new ProviderError(`Could not reach the AI provider (${(e as Error).message}). Check the base URL and your network.`, 'network', 502, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 240);
    try { const j = JSON.parse(text); detail = j?.error?.message ?? j?.message ?? detail; } catch { /* keep */ }
    if (res.status === 401 || res.status === 403) throw new ProviderError(`The AI provider rejected the credentials (${res.status}): ${detail}. Check the API key.`, 'unconfigured', 502);
    if (res.status === 404) throw new ProviderError(`The AI provider returned 404: ${detail}. Check the model name and base URL.`, 'provider', 502);
    if (res.status === 429) { const ra = Number(res.headers.get('retry-after')); throw new ProviderError(`The AI provider is rate-limiting requests${ra ? `; retry in ~${ra}s` : ''}.`, 'rate_limited', 429, true, ra || undefined); }
    throw new ProviderError(`The AI provider returned ${res.status}: ${detail}`, 'provider', 502, res.status >= 500);
  }
  return res;
}

/** Read an SSE body line by line ("data: ..." lines). */
export async function* sseLines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError('Request cancelled', 'cancelled', 499);
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally { try { reader.releaseLock(); } catch { /* ignore */ } }
}
