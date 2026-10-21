/**
 * Server configuration (Assets 42, 50). Secrets come from environment variables or from a local
 * runtime config file written through the Model panel (loopback only). Secrets are NEVER returned
 * to the browser — only "set/not set" and a 4-character hint.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ResearchConfig } from './research';
import { SpeechRuntimeSchema, applySpeechRuntime, readSpeechConfig, sttStatus, ttsStatus, type SpeechConfig } from './speech';

export function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export interface ServerConfig {
  provider: 'demo' | 'openai' | 'anthropic' | 'gemini';
  port: number; timeoutMs: number; maxTokens: number; temperature: number;
  historyMaxMessages: number; historyMaxChars: number; rateLimitPerMin: number; maxRetries: number;
  openai: { baseUrl: string; apiKey: string; model: string; jsonMode: boolean };
  anthropic: { apiKey: string; model: string; baseUrl: string };
  /** Google Gemini through the official @google/genai SDK; the key never leaves the server */
  gemini: { apiKey: string; model: string; baseUrl: string; fallbackModels: string[]; retryDelayMs?: number };
  research: ResearchConfig;
  allowRuntimeConfig: boolean; runtimeConfigPath: string;
  /** Timeout used for models on this computer (Ollama, LM Studio): the first reply loads the model and is slow on laptops. */
  localTimeoutMs: number; timeoutExplicit: boolean;
  /** PUBLIC_MODE=true: running on a public host (Render…) — listens on all interfaces, no settings changes from the
   *  browser, key hints hidden, daily budgets protect the owner's API quota. */
  publicMode: boolean;
  /** browser origins allowed to call this API from another site (e.g. the GitHub Pages site), exact matches */
  allowedOrigins: string[];
  budget: { chatsPerDay: number; chatsPerIpPerDay: number; speechCharsPerDay: number };
  /** auto: compact prompt for local models; full / compact to force. */
  promptMode: 'auto' | 'full' | 'compact';
  /** optional server-side speech (text-to-speech and transcription) */
  speech: SpeechConfig;
}
const DEFAULT_TIMEOUT_MS = 45000;
export const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:|\/|$)/i.test(u);
/** Local models get a longer timeout unless LLM_TIMEOUT_MS was set explicitly. */
export function withLocalTimeout(c: ServerConfig): ServerConfig {
  if (!c.timeoutExplicit && c.provider === 'openai' && isLocalUrl(c.openai.baseUrl)) c.timeoutMs = Math.max(c.timeoutMs, c.localTimeoutMs);
  return c;
}
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
/** Gemini voice reuses the Gemini chat key when it has none of its own (same Google account and API). */
function linkGeminiKey(c: ServerConfig): ServerConfig { if (c.speech.tts.provider === 'gemini' && !c.speech.tts.apiKey) c.speech.tts.apiKey = c.gemini.apiKey; return c; }
const n = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Public mode: PUBLIC_MODE=true (any case, also 1/yes/on), or running on Render (which sets RENDER=true), unless PUBLIC_MODE=false. */
export function isPublicMode(env: NodeJS.ProcessEnv): boolean {
  const v = (env.PUBLIC_MODE ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return ['true', '1', 'yes', 'on'].includes(v) || (env.RENDER ?? '').toLowerCase() === 'true';
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const pub = isPublicMode(env);
  // without LLM_PROVIDER, a configured Gemini key selects Gemini; otherwise the labelled demo brain
  const p = (env.LLM_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : 'demo')).toLowerCase();
  const rp = (env.RESEARCH_PROVIDER ?? 'none').toLowerCase();
  return linkGeminiKey(withLocalTimeout({
    provider: p === 'openai' || p === 'anthropic' || p === 'gemini' ? p : 'demo',
    port: n(env.PORT, 8787), timeoutMs: n(env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS), maxTokens: n(env.LLM_MAX_TOKENS, 1400), temperature: n(env.LLM_TEMPERATURE, 0.7),
    historyMaxMessages: n(env.HISTORY_MAX_MESSAGES, 16), historyMaxChars: n(env.HISTORY_MAX_CHARS, 12000), rateLimitPerMin: n(env.RATE_LIMIT_PER_MIN, 30), maxRetries: n(env.LLM_MAX_RETRIES, 1),
    openai: { baseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''), apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_MODEL ?? '', jsonMode: (env.OPENAI_JSON_MODE ?? 'true') !== 'false' },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.ANTHROPIC_MODEL ?? '', baseUrl: (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '') },
    gemini: { apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '', model: env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL, baseUrl: (env.GEMINI_BASE_URL ?? '').replace(/\/+$/, ''),
      // tried in order when the main model is overloaded (HTTP 5xx); "none" turns this off
      fallbackModels: (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map((m) => m.trim()).filter((m) => m && m !== 'none'),
      ...(env.GEMINI_RETRY_DELAY_MS ? { retryDelayMs: Number(env.GEMINI_RETRY_DELAY_MS) } : {}) },
    research: { provider: (['wikipedia', 'searxng', 'tavily'].includes(rp) ? rp : 'none') as ResearchConfig['provider'], searxngUrl: env.SEARXNG_URL ?? '', tavilyKey: env.TAVILY_API_KEY ?? '', wikipediaLang: env.WIKIPEDIA_LANG ?? 'en', wikipediaBase: env.WIKIPEDIA_BASE_URL || undefined, tavilyBase: env.TAVILY_BASE_URL || undefined },
    allowRuntimeConfig: (env.ALLOW_RUNTIME_CONFIG ?? 'true') !== 'false' && !pub,
    publicMode: pub,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter((o) => /^https?:\/\/[^/\s]+$/i.test(o)),
    // 0 = unlimited (the default on your own computer); public hosts get conservative defaults
    budget: pub
      ? { chatsPerDay: n(env.DAILY_CHAT_LIMIT, 400), chatsPerIpPerDay: n(env.DAILY_CHAT_LIMIT_PER_VISITOR, 60), speechCharsPerDay: n(env.DAILY_SPEECH_CHAR_LIMIT, 20000) }
      : { chatsPerDay: n(env.DAILY_CHAT_LIMIT, 0), chatsPerIpPerDay: n(env.DAILY_CHAT_LIMIT_PER_VISITOR, 0), speechCharsPerDay: n(env.DAILY_SPEECH_CHAR_LIMIT, 0) },
    runtimeConfigPath: env.RUNTIME_CONFIG_PATH ?? 'data/runtime-config.json',
    promptMode: (['full', 'compact'].includes(env.PROMPT_MODE ?? '') ? env.PROMPT_MODE : 'auto') as ServerConfig['promptMode'],
    speech: readSpeechConfig(env),
    localTimeoutMs: n(env.LOCAL_LLM_TIMEOUT_MS, 180000), timeoutExplicit: env.LLM_TIMEOUT_MS !== undefined && env.LLM_TIMEOUT_MS !== '',
  }));
}

/** What the Model panel may change. Secrets are write-only. */
export const RuntimeConfigSchema = z.object({
  provider: z.enum(['demo', 'openai', 'anthropic', 'gemini']).optional(),
  gemini: z.object({ model: z.string().max(120).optional(), apiKey: z.string().max(400).optional() }).strict().optional(),
  openai: z.object({ baseUrl: z.string().url().max(300).optional(), model: z.string().max(120).optional(), apiKey: z.string().max(400).optional(), jsonMode: z.boolean().optional() }).strict().optional(),
  anthropic: z.object({ model: z.string().max(120).optional(), apiKey: z.string().max(400).optional() }).strict().optional(),
  research: z.object({ provider: z.enum(['none', 'wikipedia', 'searxng', 'tavily']).optional(), searxngUrl: z.string().max(300).optional(), tavilyKey: z.string().max(400).optional() }).strict().optional(),
  speech: SpeechRuntimeSchema.optional(),
}).strict();
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function applyRuntime(base: ServerConfig, rc: RuntimeConfig): ServerConfig {
  const c = structuredClone(base);
  if (rc.provider) c.provider = rc.provider;
  if (rc.openai) Object.assign(c.openai, Object.fromEntries(Object.entries(rc.openai).filter(([, v]) => v !== undefined && v !== '')));
  if (rc.anthropic) Object.assign(c.anthropic, Object.fromEntries(Object.entries(rc.anthropic).filter(([, v]) => v !== undefined && v !== '')));
  if (rc.gemini) Object.assign(c.gemini, Object.fromEntries(Object.entries(rc.gemini).filter(([, v]) => v !== undefined && v !== '')));
  if (rc.research) Object.assign(c.research, Object.fromEntries(Object.entries(rc.research).filter(([, v]) => v !== undefined && v !== '')));
  c.speech = applySpeechRuntime(base.speech, rc.speech);
  c.openai.baseUrl = c.openai.baseUrl.replace(/\/+$/, '');
  if (!c.timeoutExplicit) c.timeoutMs = DEFAULT_TIMEOUT_MS;
  return linkGeminiKey(withLocalTimeout(c));
}
export function loadRuntime(path: string): RuntimeConfig {
  try { if (existsSync(path)) { const p = RuntimeConfigSchema.safeParse(JSON.parse(readFileSync(path, 'utf8'))); if (p.success) return p.data; } } catch { /* ignore corrupted */ }
  return {};
}
export function saveRuntime(path: string, rc: RuntimeConfig) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rc, null, 2), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* windows */ }
}
const keyHint = (s: string) => (s && !/^replace/.test(s) ? { set: true, hint: `…${s.slice(-4)}` as string | null } : { set: false, hint: null as string | null });
/** Public, secret-free view of the configuration (Asset 50). */
export function publicConfig(c: ServerConfig) {
  // on a public server even the last 4 characters of a key are not shown
  const hint = (k: string) => (c.publicMode ? { set: !!k && !/^replace/.test(k), hint: null } : keyHint(k));
  return {
    publicMode: c.publicMode,
    provider: c.provider, allowRuntimeConfig: c.allowRuntimeConfig,
    openai: { baseUrl: c.openai.baseUrl, model: c.openai.model, jsonMode: c.openai.jsonMode, apiKey: hint(c.openai.apiKey) },
    anthropic: { model: c.anthropic.model, apiKey: hint(c.anthropic.apiKey) },
    gemini: { model: c.gemini.model, apiKey: hint(c.gemini.apiKey) },
    research: { provider: c.research.provider, searxngUrl: c.research.searxngUrl, tavilyKey: hint(c.research.tavilyKey) },
    speech: {
      tts: { provider: c.speech.tts.provider, baseUrl: c.speech.tts.baseUrl, model: c.speech.tts.model, voice: c.speech.tts.voice, style: c.speech.tts.style, apiKey: hint(c.speech.tts.apiKey), ...ttsStatus(c.speech.tts) },
      stt: { provider: c.speech.stt.provider, baseUrl: c.speech.stt.baseUrl, model: c.speech.stt.model, language: c.speech.stt.language, apiKey: hint(c.speech.stt.apiKey), ...sttStatus(c.speech.stt) },
    },
    limits: { timeoutMs: c.timeoutMs, historyMaxMessages: c.historyMaxMessages, historyMaxChars: c.historyMaxChars, rateLimitPerMin: c.rateLimitPerMin, maxTokens: c.maxTokens },
  };
}

/** Plain-language startup notes about missing or incomplete settings (never includes secret values). */
export function configWarnings(c: ServerConfig): string[] {
  const w: string[] = [];
  if (c.provider === 'demo') w.push('No AI brain configured — NEXUS uses its scripted demo brain (not an AI). Set GEMINI_API_KEY in .env for Gemini.');
  if (c.provider === 'gemini' && !c.gemini.apiKey) w.push('LLM_PROVIDER is gemini but GEMINI_API_KEY is missing — chat will answer with an error until it is set (get a key at aistudio.google.com/apikey).');
  if (c.provider === 'gemini' && !c.gemini.model) w.push('GEMINI_MODEL is empty.');
  const t = c.speech.tts;
  if (t.provider === 'elevenlabs' && !t.apiKey) w.push('ElevenLabs voice selected but ELEVENLABS_API_KEY is missing — spoken replies will report an error.');
  if (t.provider === 'elevenlabs' && t.apiKey && !t.voice) w.push('ELEVENLABS_VOICE_ID is missing — choose a voice in Settings → Voice → Speech services, or set it in .env.');
  if (c.publicMode) w.push(`Public mode: settings cannot be changed from the browser; daily limits — ${c.budget.chatsPerDay || '∞'} chats, ${c.budget.chatsPerIpPerDay || '∞'} per visitor, ${c.budget.speechCharsPerDay || '∞'} spoken characters.${c.allowedOrigins.length ? ` Other sites allowed: ${c.allowedOrigins.join(', ')}.` : ''}`);
  if (t.provider === 'none') w.push('No voice service configured — spoken replies use this computer\'s built-in voices. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for the ElevenLabs voice.');
  return w;
}
