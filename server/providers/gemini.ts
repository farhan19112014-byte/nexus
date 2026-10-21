/**
 * Google Gemini as NEXUS's brain, through Google's official JavaScript SDK (@google/genai).
 * The API key is read on the server only (GEMINI_API_KEY or Settings → Model) and never reaches the browser.
 * The model id comes from configuration (GEMINI_MODEL) — it is not hard-coded anywhere else.
 */
import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai';
import { ProviderError, type CompletionRequest, type LLMProvider } from './types';

export interface GeminiConfig {
  apiKey: string; model: string; /** optional API base override (tests, proxies); '' = Google's default */ baseUrl: string;
  /** models tried, in order, when the main one is overloaded / unavailable (5xx). The reply's metadata names the model that answered. */
  fallbackModels?: string[];
  /** wait before retrying a transient error, ms (tests use 0) */
  retryDelayMs?: number;
}

/** Google's own short error text, e.g. "The model is overloaded. Please try again later." (never contains the key). */
export function googleMessage(e: unknown): string {
  const raw = String((e as Error)?.message ?? '');
  const m = /\{[\s\S]*\}/.exec(raw);
  if (m) { try { const j = JSON.parse(m[0]) as { error?: { message?: string; status?: string } }; if (j.error?.message) return `${j.error.status ? `${j.error.status}: ` : ''}${j.error.message}`.slice(0, 200); } catch { /* not JSON */ } }
  return raw.replace(/AIza[0-9A-Za-z_-]+/g, '…').slice(0, 200);
}
const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : Number((e as { status?: unknown })?.status) || 0);
const transient = (e: unknown) => { const st = statusOf(e); return st >= 500 || (st === 0 && /fetch failed|ECONNRESET|ETIMEDOUT|socket|network/i.test(String((e as Error)?.message))); };

const placeholder = (s: string) => !s || /^replace|^your-|^<|^\*+$/i.test(s);

/** NEXUS roles → Gemini roles ("assistant" is "model"); consecutive turns with the same role are merged. */
export function toGeminiContents(messages: CompletionRequest['messages']): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = out.at(-1);
    if (last && last.role === role) last.parts!.push({ text: m.content }); else out.push({ role, parts: [{ text: m.content }] });
  }
  return out;
}

/** Maps SDK / HTTP failures to NEXUS's typed errors with messages a user can act on (never including the key). */
export function geminiError(e: unknown, signal: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  if (signal.aborted) return signal.reason === 'client' ? new ProviderError('Request cancelled', 'cancelled', 499) : new ProviderError('Gemini did not respond in time.', 'timeout', 504, true);
  const status = statusOf(e);
  const msg = String((e as Error)?.message ?? '');
  const detail = googleMessage(e);
  if (status === 400 && /api key/i.test(msg)) return new ProviderError('Gemini rejected the API key — check GEMINI_API_KEY (Settings → Model).', 'unconfigured', 401);
  if (status === 401 || status === 403) return new ProviderError('Gemini refused the request: the API key is invalid or not allowed to use this model.', 'unconfigured', 401);
  if (status === 404) return new ProviderError('Gemini does not know this model id — check GEMINI_MODEL (Settings → Model).', 'unconfigured', 404);
  if (status === 429) return new ProviderError(/quota|exhaust/i.test(msg) ? 'Gemini quota reached (the free tier has per-minute and per-day limits) — wait a bit and try again.' : 'Gemini is rate-limiting requests — wait a moment and try again.', 'rate_limited', 429, true, 20);
  if (status === 400) return new ProviderError(`Gemini rejected the request as invalid${detail ? ` (${detail})` : ''}.`, 'provider', 502);
  if (status >= 500) return new ProviderError(`Gemini is temporarily unavailable (HTTP ${status}${detail ? ` — ${detail}` : ''}). Try again shortly.`, 'provider', 502, true);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network|socket/i.test(msg)) return new ProviderError('Could not reach Gemini — check your internet connection.', 'network', 502, true);
  return new ProviderError('The request to Gemini failed.', 'provider', 502, true);
}

/** A response with no text: explain why (safety block, output limit) instead of inventing a reply. */
function emptyReason(r: GenerateContentResponse | undefined): ProviderError {
  const block = r?.promptFeedback?.blockReason; const fin = r?.candidates?.[0]?.finishReason;
  if (block) return new ProviderError(`Gemini declined to answer this message (${String(block).toLowerCase()}).`, 'provider', 502);
  if (fin === 'SAFETY' || fin === 'PROHIBITED_CONTENT' || fin === 'BLOCKLIST') return new ProviderError('Gemini stopped this reply for safety reasons.', 'provider', 502);
  if (fin === 'MAX_TOKENS') return new ProviderError('Gemini ran out of output tokens before writing a reply.', 'malformed', 502, true);
  return new ProviderError('Gemini returned an empty reply.', 'malformed', 502, true);
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini';
  readonly supportsStreaming = true;
  private ai: GoogleGenAI | null = null;
  private used: string | null = null;
  constructor(private cfg: GeminiConfig) {}
  /** the model that produced the last reply (a fallback when the main model was overloaded), else the configured one */
  get model() { return this.used ?? (this.cfg.model || null); }
  private candidates() { return [this.cfg.model, ...(this.cfg.fallbackModels ?? [])].filter((m, i, a) => m && a.indexOf(m) === i); }
  /** Try the main model (one retry for transient errors), then each fallback; never retries once text has streamed. */
  private async withFallback<T>(signal: AbortSignal, run: (model: string) => Promise<T>, streamed: () => boolean): Promise<T> {
    const models = this.candidates(); let lastErr: unknown;
    for (const [i, model] of models.entries()) {
      for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
        try { const out = await run(model); this.used = model; return out; }
        catch (e) {
          lastErr = e;
          if (signal.aborted || streamed() || e instanceof ProviderError) throw e;
          console.warn(`[gemini] ${model}: HTTP ${statusOf(e) || '-'} ${googleMessage(e)}`);
          const notFound = statusOf(e) === 404 && i > 0;               // a fallback this key can't use: try the next one
          if (!transient(e) && !notFound) throw geminiError(e, signal);
          if (notFound) break;
          if (attempt === 0 && i === 0) await new Promise((r) => setTimeout(r, this.cfg.retryDelayMs ?? 1200));
        }
      }
    }
    throw geminiError(lastErr, signal);
  }
  configured() {
    if (placeholder(this.cfg.apiKey)) return { ok: false, note: 'Gemini needs an API key: set GEMINI_API_KEY in .env (or Settings → Model). Get one at aistudio.google.com/apikey.' };
    if (placeholder(this.cfg.model)) return { ok: false, note: 'Set GEMINI_MODEL to a Gemini model id (for example gemini-3.8-flash).' };
    return { ok: true };
  }
  label() { return `Google Gemini · ${this.cfg.model || 'no model'}`; }
  private client() {
    // retries are left to NEXUS (one quick retry for transient errors): the SDK default waits up to a minute per retry
    this.ai ??= new GoogleGenAI({ apiKey: this.cfg.apiKey, httpOptions: { retryOptions: { attempts: 1 }, ...(this.cfg.baseUrl ? { baseUrl: this.cfg.baseUrl } : {}) } });
    return this.ai;
  }
  private config(req: CompletionRequest, signal: AbortSignal): GenerateContentConfig {
    return {
      systemInstruction: req.system,
      temperature: req.temperature,
      // newer Gemini models spend part of the output budget on internal reasoning, so the cap is roomier than the
      // reply limit; the reply itself is still limited by the response schema and the prompt
      maxOutputTokens: Math.max(2048, req.maxTokens * 3),
      ...(req.json ? { responseMimeType: 'application/json' } : {}),
      abortSignal: signal,
    };
  }
  private check() { const st = this.configured(); if (!st.ok) throw new ProviderError(st.note!, 'unconfigured', 503); }

  async complete(req: CompletionRequest, signal: AbortSignal) {
    this.check();
    const r: GenerateContentResponse = await this.withFallback(signal, (model) => this.client().models.generateContent({ model, contents: toGeminiContents(req.messages), config: this.config(req, signal) }), () => false);
    const t = r.text;
    if (typeof t !== 'string' || !t.trim()) throw emptyReason(r);
    return t;
  }

  async stream(req: CompletionRequest, signal: AbortSignal, onText: (t: string) => void) {
    this.check();
    let full = ''; let last: GenerateContentResponse | undefined;
    try {
      await this.withFallback(signal, async (model) => {
        const it = await this.client().models.generateContentStream({ model, contents: toGeminiContents(req.messages), config: this.config({ ...req, json: false }, signal) });
        for await (const chunk of it) {
          if (signal.aborted) break;
          last = chunk; const t = chunk.text;
          if (t) { full += t; onText(t); }
        }
      }, () => full.length > 0);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (full && !signal.aborted && !(e instanceof ApiError)) throw new ProviderError('The connection to Gemini dropped mid-response.', 'network', 502, true);
      throw geminiError(e, signal);
    }
    if (signal.aborted) throw geminiError(new Error('aborted'), signal);
    if (!full.trim()) throw emptyReason(last);
    return full;
  }
}
