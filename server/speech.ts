/**
 * Server-side speech adapters (optional). Both speak the OpenAI-compatible audio API, which hosted services and
 * local servers implement:
 *   TTS  POST {base}/audio/speech          { model, voice, input, response_format } → audio bytes
 *   STT  POST {base}/audio/transcriptions  multipart { file, model, language? }     → { text }
 * API keys stay here; the browser only learns "configured / not configured". Nothing is enabled by default and
 * no model or voice name is assumed — they must be configured, so NEXUS never claims a voice it does not have.
 */
import { z } from 'zod';

export interface TtsConfig { provider: 'none' | 'openai'; baseUrl: string; apiKey: string; model: string; voice: string; format: 'mp3' | 'wav' | 'opus' }
export interface SttConfig { provider: 'none' | 'openai'; baseUrl: string; apiKey: string; model: string; language: string }
export interface SpeechConfig { tts: TtsConfig; stt: SttConfig }

const strip = (u: string) => u.replace(/\/+$/, '');
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);

export function readSpeechConfig(env: NodeJS.ProcessEnv): SpeechConfig {
  const oBase = strip(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
  const ttsBase = strip(env.TTS_BASE_URL || oBase); const sttBase = strip(env.STT_BASE_URL || oBase);
  // the chat key is reused only when the speech service is the same server as the chat model
  const keyFor = (explicit: string | undefined, base: string) => explicit ?? (base === oBase ? env.OPENAI_API_KEY ?? '' : '');
  const fmt = (env.TTS_FORMAT ?? 'mp3').toLowerCase();
  return {
    tts: { provider: (env.TTS_PROVIDER ?? 'none').toLowerCase() === 'openai' ? 'openai' : 'none', baseUrl: ttsBase, apiKey: keyFor(env.TTS_API_KEY, ttsBase), model: env.TTS_MODEL ?? '', voice: env.TTS_VOICE ?? '', format: (['mp3', 'wav', 'opus'].includes(fmt) ? fmt : 'mp3') as TtsConfig['format'] },
    stt: { provider: (env.STT_PROVIDER ?? 'none').toLowerCase() === 'openai' ? 'openai' : 'none', baseUrl: sttBase, apiKey: keyFor(env.STT_API_KEY, sttBase), model: env.STT_MODEL ?? '', language: env.STT_LANGUAGE ?? '' },
  };
}

export const SpeechRuntimeSchema = z.object({
  ttsProvider: z.enum(['none', 'openai']).optional(), ttsBaseUrl: z.string().url().max(300).optional(), ttsModel: z.string().max(120).optional(), ttsVoice: z.string().max(60).optional(), ttsApiKey: z.string().max(400).optional(),
  sttProvider: z.enum(['none', 'openai']).optional(), sttBaseUrl: z.string().url().max(300).optional(), sttModel: z.string().max(120).optional(), sttApiKey: z.string().max(400).optional(), sttLanguage: z.string().max(12).optional(),
}).strict();
export type SpeechRuntime = z.infer<typeof SpeechRuntimeSchema>;

export function applySpeechRuntime(base: SpeechConfig, r: SpeechRuntime | undefined): SpeechConfig {
  const c = structuredClone(base); if (!r) return c;
  const set = <T extends object>(o: T, k: keyof T, v: unknown) => { if (v !== undefined && v !== '') (o as Record<string, unknown>)[k as string] = v; };
  set(c.tts, 'provider', r.ttsProvider); set(c.tts, 'baseUrl', r.ttsBaseUrl && strip(r.ttsBaseUrl)); set(c.tts, 'model', r.ttsModel); set(c.tts, 'voice', r.ttsVoice); set(c.tts, 'apiKey', r.ttsApiKey);
  set(c.stt, 'provider', r.sttProvider); set(c.stt, 'baseUrl', r.sttBaseUrl && strip(r.sttBaseUrl)); set(c.stt, 'model', r.sttModel); set(c.stt, 'apiKey', r.sttApiKey); set(c.stt, 'language', r.sttLanguage);
  return c;
}

export function ttsStatus(c: TtsConfig): { configured: boolean; note: string } {
  if (c.provider === 'none') return { configured: false, note: 'Server voice is off — NEXUS uses this computer\'s speech voices. Set TTS_PROVIDER=openai to use a speech service.' };
  if (!c.model) return { configured: false, note: 'Server voice needs TTS_MODEL (a speech model id from your provider).' };
  if (!c.voice) return { configured: false, note: 'Server voice needs TTS_VOICE (a voice name from your provider).' };
  if (!c.apiKey && !isLocal(c.baseUrl)) return { configured: false, note: 'Server voice needs TTS_API_KEY.' };
  return { configured: true, note: `${c.model} · ${c.voice}` };
}
export function sttStatus(c: SttConfig): { configured: boolean; note: string } {
  if (c.provider === 'none') return { configured: false, note: 'Server transcription is off — voice input uses the browser\'s speech recognition where available. Set STT_PROVIDER=openai to use a transcription service.' };
  if (!c.model) return { configured: false, note: 'Server transcription needs STT_MODEL (a transcription model id from your provider).' };
  if (!c.apiKey && !isLocal(c.baseUrl)) return { configured: false, note: 'Server transcription needs STT_API_KEY.' };
  return { configured: true, note: c.model };
}

export class SpeechError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); } }
const MIME: Record<TtsConfig['format'], string> = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg' };

const providerError = (r: Response, what: string): SpeechError => r.status === 401 || r.status === 403
  ? new SpeechError(`The ${what} service rejected the API key.`, 502, 'auth')
  : r.status === 429 ? new SpeechError(`The ${what} service is rate-limiting requests — try again shortly.`, 429, 'rate_limited')
    : new SpeechError(`The ${what} service answered HTTP ${r.status}.`, 502, 'provider_error');

export async function synthesize(c: TtsConfig, text: string, signal: AbortSignal): Promise<{ audio: Buffer; mime: string }> {
  const st = ttsStatus(c); if (!st.configured) throw new SpeechError(st.note, 503, 'not_configured');
  let r: Response;
  try {
    r = await fetch(`${c.baseUrl}/audio/speech`, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) }, body: JSON.stringify({ model: c.model, voice: c.voice, input: text, response_format: c.format }) });
  } catch (e) { if (signal.aborted) throw new SpeechError('cancelled', 499, 'cancelled'); throw new SpeechError(`Could not reach the speech service: ${(e as Error).message}`, 502, 'network'); }
  if (!r.ok) throw providerError(r, 'speech');
  const ct = r.headers.get('content-type') ?? '';
  if (/json|text\/html/i.test(ct)) throw new SpeechError('The speech service did not return audio.', 502, 'malformed');
  const audio = Buffer.from(await r.arrayBuffer());
  if (audio.length < 64) throw new SpeechError('The speech service returned empty audio.', 502, 'malformed');
  return { audio, mime: /^audio\//.test(ct) ? ct.split(';')[0] : MIME[c.format] };
}

export async function transcribe(c: SttConfig, audio: Buffer, mime: string, signal: AbortSignal): Promise<string> {
  const st = sttStatus(c); if (!st.configured) throw new SpeechError(st.note, 503, 'not_configured');
  const ext = /webm/.test(mime) ? 'webm' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mp4|m4a|aac/.test(mime) ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append('model', c.model);
  if (c.language) form.append('language', c.language);
  let r: Response;
  try { r = await fetch(`${c.baseUrl}/audio/transcriptions`, { method: 'POST', signal, headers: c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}, body: form }); }
  catch (e) { if (signal.aborted) throw new SpeechError('cancelled', 499, 'cancelled'); throw new SpeechError(`Could not reach the transcription service: ${(e as Error).message}`, 502, 'network'); }
  if (!r.ok) throw providerError(r, 'transcription');
  const j = (await r.json().catch(() => null)) as { text?: unknown } | null;
  if (!j || typeof j.text !== 'string') throw new SpeechError('The transcription service returned an unexpected answer.', 502, 'malformed');
  return j.text.trim().slice(0, 2000);
}
