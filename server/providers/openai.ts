import { httpJSON, ProviderError, sseLines, type CompletionRequest, type LLMProvider } from './types';

export interface OpenAIConfig { baseUrl: string; apiKey: string; model: string; jsonMode: boolean }
const placeholder = (s: string) => !s || /^replace|^your-|^<|^\*+$/i.test(s);

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter, Groq, Together, Ollama, LM Studio, vLLM…). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string = 'openai';
  readonly supportsStreaming = true;
  constructor(protected cfg: OpenAIConfig) {}
  get model() { return this.cfg.model || null; }
  private local() { return /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/.test(this.cfg.baseUrl); }
  configured() {
    if (placeholder(this.cfg.model)) return { ok: false, note: 'Set a model name (OPENAI_MODEL or the Model panel).' };
    if (placeholder(this.cfg.apiKey) && !this.local()) return { ok: false, note: 'Set an API key (OPENAI_API_KEY or the Model panel).' };
    try { new URL(this.cfg.baseUrl); } catch { return { ok: false, note: 'Base URL is not a valid URL.' }; }
    return { ok: true };
  }
  label() { let host = '?'; try { host = new URL(this.cfg.baseUrl).host; } catch { /* */ } return `OpenAI-compatible · ${this.cfg.model || 'no model'} @ ${host}`; }
  private body(req: CompletionRequest, stream: boolean) {
    const b: Record<string, unknown> = { model: this.cfg.model, messages: [{ role: 'system', content: req.system }, ...req.messages], max_tokens: req.maxTokens, temperature: req.temperature, stream };
    if (req.json && this.cfg.jsonMode && !stream) b.response_format = { type: 'json_object' };
    return JSON.stringify(b);
  }
  private headers() { const h: Record<string, string> = { 'content-type': 'application/json' }; if (!placeholder(this.cfg.apiKey)) h.authorization = `Bearer ${this.cfg.apiKey}`; return h; }
  async complete(req: CompletionRequest, signal: AbortSignal) {
    if (!this.configured().ok) throw new ProviderError(this.configured().note!, 'unconfigured', 503);
    const res = await httpJSON(`${this.cfg.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(), body: this.body(req, false) }, signal);
    const j = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
    const t = j?.choices?.[0]?.message?.content;
    if (typeof t !== 'string' || !t.trim()) throw new ProviderError('The AI provider returned an empty completion.', 'malformed', 502, true);
    return t;
  }
  async stream(req: CompletionRequest, signal: AbortSignal, onText: (t: string) => void) {
    if (!this.configured().ok) throw new ProviderError(this.configured().note!, 'unconfigured', 503);
    const res = await httpJSON(`${this.cfg.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(), body: this.body(req, true) }, signal);
    let full = ''; let finished = false;
    try {
      for await (const data of sseLines(res, signal)) {
        if (data === '[DONE]') { finished = true; break; }
        try {
          const j = JSON.parse(data) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
          const t = j.choices?.[0]?.delta?.content;
          if (t) { full += t; onText(t); }
          if (j.choices?.[0]?.finish_reason) finished = true;
        } catch { /* ignore keep-alive / non-JSON lines */ }
      }
    } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError('The connection to the AI provider dropped mid-response.', 'network', 502, true); }
    if (!finished) throw new ProviderError('The AI provider stream ended before the reply was complete.', 'network', 502, true);
    if (!full.trim()) throw new ProviderError('The AI provider streamed an empty response.', 'malformed', 502, true);
    return full;
  }
}
