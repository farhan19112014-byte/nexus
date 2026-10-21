/**
 * Google Gemini as NEXUS's brain, through Google's official JavaScript SDK (@google/genai).
 * The API key is read on the server only (GEMINI_API_KEY or Settings → Model) and never reaches the browser.
 * The model id comes from configuration (GEMINI_MODEL) — it is not hard-coded anywhere else.
 */
import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse } from '@google/genai';
import { ProviderError, type CompletionRequest, type LLMProvider } from './types';

export interface GeminiConfig { apiKey: string; model: string; /** optional API base override (tests, proxies); '' = Google's default */ baseUrl: string }

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
  const status = e instanceof ApiError ? e.status : Number((e as { status?: unknown })?.status) || 0;
  const msg = String((e as Error)?.message ?? '');
  if (status === 400 && /api key/i.test(msg)) return new ProviderError('Gemini rejected the API key — check GEMINI_API_KEY (Settings → Model).', 'unconfigured', 401);
  if (status === 401 || status === 403) return new ProviderError('Gemini refused the request: the API key is invalid or not allowed to use this model.', 'unconfigured', 401);
  if (status === 404) return new ProviderError('Gemini does not know this model id — check GEMINI_MODEL (Settings → Model).', 'unconfigured', 404);
  if (status === 429) return new ProviderError(/quota|exhaust/i.test(msg) ? 'Gemini quota reached (the free tier has per-minute and per-day limits) — wait a bit and try again.' : 'Gemini is rate-limiting requests — wait a moment and try again.', 'rate_limited', 429, true, 20);
  if (status === 400) return new ProviderError('Gemini rejected the request as invalid.', 'provider', 502);
  if (status >= 500) return new ProviderError('Gemini is temporarily unavailable — try again shortly.', 'provider', 502, true);
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
  constructor(private cfg: GeminiConfig) {}
  get model() { return this.cfg.model || null; }
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
    let r: GenerateContentResponse;
    try { r = await this.client().models.generateContent({ model: this.cfg.model, contents: toGeminiContents(req.messages), config: this.config(req, signal) }); }
    catch (e) { throw geminiError(e, signal); }
    const t = r.text;
    if (typeof t !== 'string' || !t.trim()) throw emptyReason(r);
    return t;
  }

  async stream(req: CompletionRequest, signal: AbortSignal, onText: (t: string) => void) {
    this.check();
    let full = ''; let last: GenerateContentResponse | undefined;
    try {
      const it = await this.client().models.generateContentStream({ model: this.cfg.model, contents: toGeminiContents(req.messages), config: this.config({ ...req, json: false }, signal) });
      for await (const chunk of it) {
        if (signal.aborted) break;
        last = chunk; const t = chunk.text;
        if (t) { full += t; onText(t); }
      }
    } catch (e) {
      if (full && !signal.aborted && !(e instanceof ApiError)) throw new ProviderError('The connection to Gemini dropped mid-response.', 'network', 502, true);
      throw geminiError(e, signal);
    }
    if (signal.aborted) throw geminiError(new Error('aborted'), signal);
    if (!full.trim()) throw emptyReason(last);
    return full;
  }
}
