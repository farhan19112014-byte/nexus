/**
 * Server-side brain (Assets 41–48, 72–75, 79): research → prompt → provider (streamed when supported)
 * → incremental parse → schema validation (invalid fields dropped, never passed through) → final response.
 * Retries are bounded and only happen before any text has been shown to the user.
 */
import { BrainHeadSchema, BrainResponseSchema, type BrainResponse, type ChatMessage, type ChatRequest, type ResponseMeta, type Source, type StreamEvent } from '../shared/schema';
import { StreamParser } from '../shared/streamParser';
import { demoBrain } from '../shared/demoBrain';
import { isLocalUrl } from './config';
import { buildSystemPrompt, extractJSON, PROMPT_VERSION } from './prompts/system';
import type { ServerConfig } from './config';
import { ProviderError, type LLMProvider } from './providers/types';
import { researchQuery, type ResearchProvider } from './research';

/** Asset 44 — context window policy: newest messages within count & char budgets, starting with a user turn. */
export function trimHistory(messages: ChatMessage[], maxMessages: number, maxChars: number): ChatMessage[] {
  const out: ChatMessage[] = []; let chars = 0;
  for (let i = messages.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = messages[i];
    if (chars + m.content.length > maxChars && out.length) break;
    out.unshift(m); chars += m.content.length;
  }
  while (out.length && out[0].role !== 'user') out.shift();
  const merged: ChatMessage[] = [];
  for (const m of out) { const p = merged.at(-1); if (p && p.role === m.role) p.content = `${p.content}\n${m.content}`.slice(-6000); else merged.push({ ...m }); }
  return merged;
}

/** Asset 48 — validate, dropping invalid optional fields rather than passing them on. */
export function coerceBrainResponse(raw: unknown): { value: BrainResponse | null; dropped: string[]; error?: string } {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: null, dropped, error: 'output is not a JSON object' };
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const k of Object.keys(obj)) if (!(k in BrainResponseSchema.shape)) { delete obj[k]; dropped.push(k); }
  for (let i = 0; i < 16; i++) {
    const r = BrainResponseSchema.safeParse(obj);
    if (r.success) return { value: r.data, dropped };
    const keys = new Set(r.error.issues.map((x) => String(x.path[0] ?? '')));
    if (keys.has('reply') || keys.has('')) return { value: null, dropped, error: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') };
    for (const k of keys) { delete obj[k]; dropped.push(k); }
  }
  return { value: null, dropped, error: 'could not coerce output' };
}

type Emit = (e: StreamEvent) => void;

export class BrainService {
  constructor(private cfg: ServerConfig, private provider: LLMProvider, private research: ResearchProvider | null) {}
  /** Small local models (Ollama, LM Studio) often run with a 2–4k token context: send them a compact prompt and shorter history. */
  get compact(): boolean {
    if (this.cfg.promptMode === 'compact') return true;
    if (this.cfg.promptMode === 'full') return false;
    return this.provider.id === 'openai' && isLocalUrl(this.cfg.openai.baseUrl);
  }

  private async gatherSources(req: ChatRequest, signal: AbortSignal, emit: Emit, meta: ResponseMeta): Promise<Source[]> {
    if (!req.research) return [];
    meta.research.provider = this.research?.id ?? null;
    if (!this.research || !this.research.configured().ok) {
      meta.research.error = this.research ? this.research.configured().note : 'No research provider is configured on the server (RESEARCH_PROVIDER).';
      return [];
    }
    emit({ type: 'status', stage: 'researching' });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const onAbort = () => ctl.abort(); signal.addEventListener('abort', onAbort);
    try {
      const q = researchQuery(req.messages.at(-1)!.content);
      const s = q ? await this.research.search(q, ctl.signal) : [];
      meta.research.used = s.length > 0; meta.research.count = s.length;
      if (!s.length) meta.research.error = 'The search returned no results.';
      emit({ type: 'sources', sources: s });
      return s;
    } catch (e) {
      meta.research.error = `Research failed: ${ctl.signal.aborted ? 'timed out' : (e as Error).message}`;
      return [];
    } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); }
  }

  async handle(req: ChatRequest, clientSignal: AbortSignal, emit: Emit = () => {}): Promise<{ response: BrainResponse; meta: ResponseMeta }> {
    const t0 = Date.now();
    const meta: ResponseMeta = { provider: this.provider.id, model: this.provider.model, isLLM: this.provider.id !== 'demo', latencyMs: 0, streamed: false, repaired: false, droppedFields: [], degraded: false, historySent: 0, promptVersion: PROMPT_VERSION, research: { used: false, provider: null, count: 0 } };
    const sources = await this.gatherSources(req, clientSignal, emit, meta);
    if (clientSignal.aborted) throw new ProviderError('Request cancelled', 'cancelled', 499);

    if (!meta.isLLM) {
      const response = demoBrain(req, sources);
      emit({ type: 'head', head: BrainHeadSchema.parse(response) });
      emit({ type: 'delta', text: response.reply });   // one chunk: the demo brain does not stream
      meta.latencyMs = Date.now() - t0;
      return { response, meta };
    }
    const status = this.provider.configured();
    if (!status.ok) throw new ProviderError(status.note ?? 'The AI provider is not configured.', 'unconfigured', 503);

    const history = this.compact
      ? trimHistory(req.messages, Math.min(this.cfg.historyMaxMessages, 10), Math.min(this.cfg.historyMaxChars, 6000))
      : trimHistory(req.messages, this.cfg.historyMaxMessages, this.cfg.historyMaxChars);
    meta.promptMode = this.compact ? 'compact' : 'full';
    meta.historySent = history.length;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort('timeout'), this.cfg.timeoutMs);
    const onAbort = () => ctl.abort('client'); clientSignal.addEventListener('abort', onAbort);
    const useStream = req.stream && this.provider.supportsStreaming;
    try {
      for (let attempt = 0; ; attempt++) {
        let sentText = false;
        try {
          const out = useStream
            ? await this.streamed(req, history, sources, ctl.signal, emit, meta, () => (sentText = true))
            : await this.json(req, history, sources, ctl.signal, meta);
          emit({ type: 'head', head: BrainHeadSchema.parse(out) });
          if (!useStream) emit({ type: 'delta', text: out.reply });
          meta.latencyMs = Date.now() - t0; meta.model = this.provider.model;   // the model that actually answered (may be a fallback)
          return { response: out, meta };
        } catch (e) {
          const pe = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 'internal', 500);
          if (!pe.retryable || sentText || attempt >= this.cfg.maxRetries || ctl.signal.aborted) throw pe;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) throw new ProviderError(ctl.signal.reason === 'client' ? 'Request cancelled' : `The AI provider did not respond within ${Math.round(this.cfg.timeoutMs / 1000)}s.`, ctl.signal.reason === 'client' ? 'cancelled' : 'timeout', ctl.signal.reason === 'client' ? 499 : 504);
      throw e;
    } finally { clearTimeout(timer); clientSignal.removeEventListener('abort', onAbort); }
  }

  private async streamed(req: ChatRequest, history: ChatMessage[], sources: Source[], signal: AbortSignal, emit: Emit, meta: ResponseMeta, onSent: () => void): Promise<BrainResponse> {
    const parser = new StreamParser();
    const system = buildSystemPrompt(req, { streaming: true, sources, compact: this.compact });
    emit({ type: 'status', stage: 'thinking' });
    await this.provider.stream({ system, messages: history, maxTokens: this.cfg.maxTokens, temperature: this.cfg.temperature, json: false }, signal, (chunk) => {
      const { delta, headParsed } = parser.feed(chunk);
      if (headParsed) { const h = BrainHeadSchema.safeParse(parser.head); if (h.success) emit({ type: 'head', head: h.data }); }
      if (delta) { onSent(); emit({ type: 'delta', text: delta }); }
    });
    meta.streamed = true;
    const p = parser.end();
    if (!p.text) throw new ProviderError('The model produced no reply text.', 'malformed', 502, true);
    const head = BrainHeadSchema.safeParse(p.head ?? {});
    if (!head.success || p.headError) meta.droppedFields.push('head');
    let extra: Record<string, unknown> = {};
    if (p.metaRaw) { try { extra = extractJSON(p.metaRaw) as Record<string, unknown>; } catch { meta.droppedFields.push('meta'); } }
    const merged = { ...(head.success ? head.data : {}), ...extra, reply: p.text };
    const c = coerceBrainResponse(merged);
    meta.droppedFields.push(...c.dropped);
    if (!c.value) { meta.degraded = true; return BrainResponseSchema.parse({ reply: p.text.slice(0, 6000) }); }
    return c.value;
  }

  private async json(req: ChatRequest, history: ChatMessage[], sources: Source[], signal: AbortSignal, meta: ResponseMeta): Promise<BrainResponse> {
    const system = buildSystemPrompt(req, { streaming: false, sources, compact: this.compact });
    const call = (msgs: ChatMessage[]) => this.provider.complete({ system, messages: msgs, maxTokens: this.cfg.maxTokens, temperature: this.cfg.temperature, json: true }, signal);
    let text = await call(history);
    let res: ReturnType<typeof coerceBrainResponse>;
    try { res = coerceBrainResponse(extractJSON(text)); } catch (e) { res = { value: null, dropped: [], error: (e as Error).message }; }
    if (!res.value) {
      meta.repaired = true;
      text = await call([...history, { role: 'assistant', content: text.slice(0, 3000) }, { role: 'user', content: `SYSTEM NOTICE: your previous output was invalid (${(res.error ?? '').slice(0, 200)}). Reply again with ONLY the JSON object described in the system prompt.` }]);
      try { res = coerceBrainResponse(extractJSON(text)); } catch (e) { res = { value: null, dropped: [], error: (e as Error).message }; }
    }
    if (!res.value) {
      meta.degraded = true;
      const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[{}"]/g, '').trim().slice(0, 1500) || 'Sorry — the language model returned something I could not understand.';
      return BrainResponseSchema.parse({ reply: plain, expression: 'confused' });
    }
    meta.droppedFields.push(...res.dropped);
    return res.value;
  }

  async summarize(messages: ChatMessage[], signal: AbortSignal): Promise<string> {
    if (this.provider.id === 'demo') {
      const users = messages.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 80));
      return `Demo session (${messages.length} messages, not an AI summary). Topics the user raised: ${users.slice(-5).join(' | ')}`.slice(0, 600);
    }
    const text = await this.provider.complete({
      system: 'Summarize this conversation in at most 3 short sentences for future context. Include only non-sensitive, useful facts and preferences the user shared. Plain text.',
      messages: trimHistory([...messages, { role: 'user', content: 'Summarize our conversation now.' }], 30, 16000), maxTokens: 200, temperature: 0.2, json: false,
    }, signal);
    return text.trim().slice(0, 600);
  }
}
