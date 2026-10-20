import { httpJSON, ProviderError, sseLines, type CompletionRequest, type LLMProvider } from './types';

export interface AnthropicConfig { apiKey: string; model: string; baseUrl: string }
const placeholder = (s: string) => !s || /^replace|^your-|^<|^\*+$/i.test(s);

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly supportsStreaming = true;
  constructor(private cfg: AnthropicConfig) {}
  get model() { return this.cfg.model || null; }
  configured() {
    if (placeholder(this.cfg.apiKey)) return { ok: false, note: 'Set ANTHROPIC_API_KEY (or use the Model panel).' };
    if (placeholder(this.cfg.model)) return { ok: false, note: 'Set ANTHROPIC_MODEL to a current model id from Anthropic\'s docs.' };
    return { ok: true };
  }
  label() { return `Anthropic · ${this.cfg.model || 'no model'}`; }
  private init(req: CompletionRequest, stream: boolean): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.cfg.model, system: req.system, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature, stream }) };
  }
  async complete(req: CompletionRequest, signal: AbortSignal) {
    if (!this.configured().ok) throw new ProviderError(this.configured().note!, 'unconfigured', 503);
    const res = await httpJSON(`${this.cfg.baseUrl}/v1/messages`, this.init(req, false), signal);
    const j = await res.json().catch(() => null) as { content?: { type: string; text?: string }[] } | null;
    const t = j?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!t?.trim()) throw new ProviderError('The AI provider returned an empty completion.', 'malformed', 502, true);
    return t;
  }
  async stream(req: CompletionRequest, signal: AbortSignal, onText: (t: string) => void) {
    if (!this.configured().ok) throw new ProviderError(this.configured().note!, 'unconfigured', 503);
    const res = await httpJSON(`${this.cfg.baseUrl}/v1/messages`, this.init(req, true), signal);
    let full = ''; let finished = false;
    try {
      for await (const data of sseLines(res, signal)) {
        try {
          const j = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
          if (j.type === 'error') throw new ProviderError(`The AI provider reported an error mid-stream: ${j.error?.message ?? 'unknown'}`, 'provider', 502, true);
          if (j.type === 'content_block_delta' && j.delta?.text) { full += j.delta.text; onText(j.delta.text); }
          if (j.type === 'message_stop') { finished = true; break; }
        } catch (e) { if (e instanceof ProviderError) throw e; }
      }
    } catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError('The connection to the AI provider dropped mid-response.', 'network', 502, true); }
    if (!finished) throw new ProviderError('The AI provider stream ended before the reply was complete.', 'network', 502, true);
    if (!full.trim()) throw new ProviderError('The AI provider streamed an empty response.', 'malformed', 502, true);
    return full;
  }
}
