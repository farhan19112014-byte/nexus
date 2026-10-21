/**
 * Server-side speech adapters (optional). Both speak the OpenAI-compatible audio API, which hosted services and
 * local servers implement:
 *   TTS  POST {base}/audio/speech          { model, voice, input, response_format } → audio bytes
 *   STT  POST {base}/audio/transcriptions  multipart { file, model, language? }     → { text }
 * API keys stay here; the browser only learns "configured / not configured". Nothing is enabled by default and
 * no model or voice name is assumed — they must be configured, so NEXUS never claims a voice it does not have.
 * Exception: the Gemini speech adapter (TTS_PROVIDER=gemini) has documented defaults — model gemini-3.8-flash-tts and
 * the prebuilt voice "Leda" (youthful) with a cheerful style — and uses POST {base}/interactions with x-goog-api-key.
 */
import { z } from 'zod';

export interface TtsConfig { provider: 'none' | 'openai' | 'gemini' | 'elevenlabs'; baseUrl: string; apiKey: string; model: string; voice: string; format: 'mp3' | 'wav' | 'opus'; /** Gemini only: delivery style, e.g. "cheerful and cute" */ style: string }
export interface SttConfig { provider: 'none' | 'openai'; baseUrl: string; apiKey: string; model: string; language: string }
/** ElevenLabs values from the environment, used whenever ElevenLabs is (or becomes) the voice service */
export interface ElevenEnv { apiKey: string; voice: string; model: string; baseUrl: string }
export interface SpeechConfig { tts: TtsConfig; stt: SttConfig; eleven: ElevenEnv }

/**
 * ElevenLabs voice configuration — the one place for model and delivery settings.
 * Model: ELEVENLABS_MODEL (default eleven_multilingual_v2, ElevenLabs' documented default). Settings below are
 * tuned for NEXUS: a little expressive (stability under the 0.5 default, a touch of style), close to the chosen
 * voice, normal speed. Voice: ELEVENLABS_VOICE_ID or the picker in Settings → Voice.
 */
export const ELEVEN_BASE = 'https://api.elevenlabs.io';
export const ELEVEN_DEFAULT_MODEL = 'eleven_multilingual_v2';
export const ELEVEN_OUTPUT_FORMAT = 'mp3_44100_128';
export const ELEVEN_VOICE_SETTINGS = { stability: 0.42, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: 1.0 } as const;

const strip = (u: string) => u.replace(/\/+$/, '');
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_TTS_DEFAULTS = { model: 'gemini-3.8-flash-tts', voice: 'Leda', style: 'bright, cheerful and cute, like a friendly little robot — warm and playful, not too fast' };
/** Gemini's prebuilt voices (name → character, from Google's speech-generation docs) — shown in Settings. */
export const GEMINI_VOICES: Record<string, string> = { Leda: 'Youthful', Puck: 'Upbeat', Zephyr: 'Bright', Autonoe: 'Bright', Laomedeia: 'Upbeat', Achird: 'Friendly', Sadachbia: 'Lively', Aoede: 'Breezy', Achernar: 'Soft', Vindemiatrix: 'Gentle', Sulafat: 'Warm', Fenrir: 'Excitable', Kore: 'Firm', Charon: 'Informative', Despina: 'Smooth', Callirrhoe: 'Easy-going' };
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u);

export function readSpeechConfig(env: NodeJS.ProcessEnv): SpeechConfig {
  const oBase = strip(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1');
  const ttsBase = strip(env.TTS_BASE_URL || oBase); const sttBase = strip(env.STT_BASE_URL || oBase);
  // the chat key is reused only when the speech service is the same server as the chat model
  const keyFor = (explicit: string | undefined, base: string) => explicit ?? (base === oBase ? env.OPENAI_API_KEY ?? '' : '');
  const fmt = (env.TTS_FORMAT ?? 'mp3').toLowerCase();
  const eleven: ElevenEnv = { apiKey: env.ELEVENLABS_API_KEY ?? '', voice: env.ELEVENLABS_VOICE_ID ?? '', model: env.ELEVENLABS_MODEL || ELEVEN_DEFAULT_MODEL, baseUrl: strip(env.ELEVENLABS_BASE_URL || ELEVEN_BASE) };
  // without TTS_PROVIDER, an ElevenLabs key selects ElevenLabs
  const tp = (env.TTS_PROVIDER || (eleven.apiKey ? 'elevenlabs' : 'none')).toLowerCase();
  const gem = tp === 'gemini';
  const tts: TtsConfig = tp === 'elevenlabs'
    ? { provider: 'elevenlabs', baseUrl: eleven.baseUrl, apiKey: eleven.apiKey, model: eleven.model, voice: eleven.voice, format: 'mp3', style: '' }
    : gem
    ? { provider: 'gemini', baseUrl: strip(env.TTS_BASE_URL || GEMINI_API_BASE), apiKey: env.TTS_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '', model: env.TTS_MODEL || GEMINI_TTS_DEFAULTS.model, voice: env.TTS_VOICE || GEMINI_TTS_DEFAULTS.voice, format: 'wav', style: env.TTS_STYLE ?? GEMINI_TTS_DEFAULTS.style }
    : { provider: tp === 'openai' ? 'openai' : 'none', baseUrl: ttsBase, apiKey: keyFor(env.TTS_API_KEY, ttsBase), model: env.TTS_MODEL ?? '', voice: env.TTS_VOICE ?? '', format: (['mp3', 'wav', 'opus'].includes(fmt) ? fmt : 'mp3') as TtsConfig['format'], style: env.TTS_STYLE ?? '' };
  return {
    eleven, tts,
    stt: { provider: (env.STT_PROVIDER ?? 'none').toLowerCase() === 'openai' ? 'openai' : 'none', baseUrl: sttBase, apiKey: keyFor(env.STT_API_KEY, sttBase), model: env.STT_MODEL ?? '', language: env.STT_LANGUAGE ?? '' },
  };
}

export const SpeechRuntimeSchema = z.object({
  ttsProvider: z.enum(['none', 'openai', 'gemini', 'elevenlabs']).optional(), ttsBaseUrl: z.string().url().max(300).optional(), ttsModel: z.string().max(120).optional(), ttsVoice: z.string().max(120).regex(/^[\w.:-]*$/, 'letters, digits, . _ : - only').optional(), ttsApiKey: z.string().max(400).optional(), ttsStyle: z.string().max(200).optional(),
  sttProvider: z.enum(['none', 'openai']).optional(), sttBaseUrl: z.string().url().max(300).optional(), sttModel: z.string().max(120).optional(), sttApiKey: z.string().max(400).optional(), sttLanguage: z.string().max(12).optional(),
}).strict();
export type SpeechRuntime = z.infer<typeof SpeechRuntimeSchema>;

export function applySpeechRuntime(base: SpeechConfig, r: SpeechRuntime | undefined): SpeechConfig {
  const c = structuredClone(base); if (!r) return c;
  const set = <T extends object>(o: T, k: keyof T, v: unknown) => { if (v !== undefined && v !== '') (o as Record<string, unknown>)[k as string] = v; };
  const wasGemini = c.tts.provider === 'gemini';
  set(c.tts, 'provider', r.ttsProvider);
  if (c.tts.provider === 'gemini' && !wasGemini) Object.assign(c.tts, { baseUrl: GEMINI_API_BASE, model: GEMINI_TTS_DEFAULTS.model, voice: GEMINI_TTS_DEFAULTS.voice, style: GEMINI_TTS_DEFAULTS.style, format: 'wav', apiKey: '' });
  if (c.tts.provider === 'elevenlabs' && base.tts.provider !== 'elevenlabs' && r.ttsProvider === 'elevenlabs') Object.assign(c.tts, { baseUrl: base.eleven.baseUrl, model: base.eleven.model, voice: base.eleven.voice, apiKey: base.eleven.apiKey, format: 'mp3', style: '' });
  set(c.tts, 'style', r.ttsStyle);
  set(c.tts, 'baseUrl', r.ttsBaseUrl && strip(r.ttsBaseUrl)); set(c.tts, 'model', r.ttsModel); set(c.tts, 'voice', r.ttsVoice); set(c.tts, 'apiKey', r.ttsApiKey);
  set(c.stt, 'provider', r.sttProvider); set(c.stt, 'baseUrl', r.sttBaseUrl && strip(r.sttBaseUrl)); set(c.stt, 'model', r.sttModel); set(c.stt, 'apiKey', r.sttApiKey); set(c.stt, 'language', r.sttLanguage);
  return c;
}

export function ttsStatus(c: TtsConfig): { configured: boolean; note: string } {
  if (c.provider === 'none') return { configured: false, note: 'Server voice is off — NEXUS uses this computer\'s speech voices. Set ELEVENLABS_API_KEY (or TTS_PROVIDER=gemini / openai) to use a speech service.' };
  if (c.provider === 'elevenlabs') {
    if (!c.apiKey) return { configured: false, note: 'ElevenLabs voice needs an API key: set ELEVENLABS_API_KEY in .env (or the key field in Settings → Voice).' };
    if (!c.voice) return { configured: false, note: 'ElevenLabs voice needs a voice: set ELEVENLABS_VOICE_ID, or choose one in Settings → Voice → Speech services.' };
    return { configured: true, note: `ElevenLabs · ${c.model} · voice ${c.voice}` };
  }
  if (c.provider === 'gemini') {
    if (!c.apiKey) return { configured: false, note: 'Gemini voice needs a Gemini API key (GEMINI_API_KEY, or the key field in Settings).' };
    return { configured: true, note: `Gemini · ${c.model} · ${c.voice}${GEMINI_VOICES[c.voice] ? ` (${GEMINI_VOICES[c.voice].toLowerCase()})` : ''}` };
  }
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

/** Wrap headerless 16-bit PCM (audio/l16) in a WAV header so every browser can play it. */
export function pcmToWav(pcm: Buffer, rate = 24000, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
/** Find the first base64 audio payload in a Gemini answer (Interactions: steps[].content[].data; generateContent: inlineData.data). */
export function findAudioPart(j: unknown, depth = 0): { data: string; mime: string } | null {
  if (!j || typeof j !== 'object' || depth > 8) return null;
  const o = j as Record<string, unknown>;
  const mime = String(o.mime_type ?? o.mimeType ?? '');
  if (typeof o.data === 'string' && o.data.length > 40 && (!mime || /^audio\//.test(mime))) return { data: o.data, mime };
  for (const v of Array.isArray(j) ? j : Object.values(o)) { const f = findAudioPart(v, depth + 1); if (f) return f; }
  return null;
}

async function synthesizeGemini(c: TtsConfig, text: string, signal: AbortSignal): Promise<{ audio: Buffer; mime: string }> {
  const content: Record<string, unknown> = { type: 'text', text };
  if (c.style.trim()) content.annotations = [{ type: 'speech_metadata', style: c.style.trim() }];
  let r: Response;
  try {
    r = await fetch(`${c.baseUrl}/interactions`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': c.apiKey }, body: JSON.stringify({ model: c.model, input: [{ type: 'user_input', content: [content] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: c.voice }] } }) });
  } catch (e) { if (signal.aborted) throw new SpeechError('cancelled', 499, 'cancelled'); throw new SpeechError(`Could not reach Gemini: ${(e as Error).message}`, 502, 'network'); }
  if (r.status === 400) { const t = await r.text().catch(() => ''); throw new SpeechError(/api key/i.test(t) ? 'Gemini rejected the API key.' : `Gemini refused the speech request (HTTP 400${/voice/i.test(t) ? ' — check the voice name' : /model/i.test(t) ? ' — check the speech model id' : ''}).`, 502, /api key/i.test(t) ? 'auth' : 'provider_error'); }
  if (!r.ok) throw providerError(r, 'Gemini speech');
  const j = await r.json().catch(() => null);
  const part = findAudioPart(j);
  if (!part) throw new SpeechError('Gemini answered without audio.', 502, 'malformed');
  let audio: Buffer = Buffer.from(part.data, 'base64');
  if (audio.length < 64) throw new SpeechError('Gemini returned empty audio.', 502, 'malformed');
  const isWav = audio.subarray(0, 4).toString('latin1') === 'RIFF';
  if (!isWav && (/l16|pcm/i.test(part.mime) || !part.mime)) { const rate = Number(/rate=(\d+)/.exec(part.mime)?.[1]) || 24000; audio = pcmToWav(audio, rate); return { audio, mime: 'audio/wav' }; }
  return { audio, mime: isWav ? 'audio/wav' : part.mime.split(';')[0] };
}

/** ElevenLabs error bodies look like { detail: { status, message } } (or a validation list); map them to clear messages. */
async function elevenError(r: Response): Promise<SpeechError> {
  const j = (await r.json().catch(() => null)) as { detail?: { status?: string; message?: string } | unknown[] } | null;
  const d = j && !Array.isArray(j.detail) ? (j.detail as { status?: string; message?: string } | undefined) : undefined;
  const status = String(d?.status ?? ''); const msg = String(d?.message ?? '');
  if (status === 'quota_exceeded' || /quota|credits/i.test(msg)) return new SpeechError('ElevenLabs quota used up — no characters left on this plan this month.', 402, 'quota');
  if (r.status === 402 || /payment|paid|subscription/i.test(status + msg)) return new SpeechError('ElevenLabs needs a paid plan for this voice or model.', 402, 'payment_required');
  if (status === 'voice_not_found' || r.status === 404) return new SpeechError('ElevenLabs does not know this voice id — choose another voice in Settings or fix ELEVENLABS_VOICE_ID.', 502, 'voice_not_found');
  if (r.status === 401 || r.status === 403) return new SpeechError('ElevenLabs rejected the API key — check ELEVENLABS_API_KEY.', 502, 'auth');
  if (r.status === 429) return new SpeechError('ElevenLabs is rate-limiting requests (too many at once) — try again shortly.', 429, 'rate_limited');
  if (r.status === 422 || r.status === 400) return new SpeechError(`ElevenLabs refused the request${/model/i.test(msg) ? ' — check ELEVENLABS_MODEL' : ''}.`, 502, 'invalid_config');
  return new SpeechError(`ElevenLabs answered HTTP ${r.status}.`, 502, 'provider_error');
}

async function synthesizeEleven(c: TtsConfig, text: string, signal: AbortSignal): Promise<{ audio: Buffer; mime: string }> {
  let r: Response;
  try {
    r = await fetch(`${c.baseUrl}/v1/text-to-speech/${encodeURIComponent(c.voice)}?output_format=${ELEVEN_OUTPUT_FORMAT}`, { method: 'POST', signal, headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': c.apiKey }, body: JSON.stringify({ text, model_id: c.model, voice_settings: ELEVEN_VOICE_SETTINGS }) });
  } catch (e) { if (signal.aborted) throw new SpeechError('cancelled', 499, 'cancelled'); throw new SpeechError(`Could not reach ElevenLabs: ${(e as Error).message}`, 502, 'network'); }
  if (!r.ok) throw await elevenError(r);
  const ct = r.headers.get('content-type') ?? '';
  if (/json|text\/html/i.test(ct)) throw new SpeechError('ElevenLabs did not return audio.', 502, 'malformed');
  const audio = Buffer.from(await r.arrayBuffer());
  if (audio.length < 64) throw new SpeechError('ElevenLabs returned empty audio.', 502, 'malformed');
  return { audio, mime: 'audio/mpeg' };
}

export interface VoiceInfo { id: string; name: string; description: string; previewUrl: string | null; category: string }
/** The voices on the configured ElevenLabs account (GET /v2/voices), for the voice picker. */
export async function listElevenVoices(c: TtsConfig, signal: AbortSignal): Promise<VoiceInfo[]> {
  if (!c.apiKey) throw new SpeechError('ElevenLabs voice needs an API key: set ELEVENLABS_API_KEY in .env (or the key field in Settings → Voice).', 503, 'not_configured');
  let r: Response;
  try { r = await fetch(`${c.baseUrl}/v2/voices?page_size=100`, { signal, headers: { 'xi-api-key': c.apiKey } }); }
  catch (e) { if (signal.aborted) throw new SpeechError('cancelled', 499, 'cancelled'); throw new SpeechError(`Could not reach ElevenLabs: ${(e as Error).message}`, 502, 'network'); }
  if (!r.ok) throw await elevenError(r);
  const j = (await r.json().catch(() => null)) as { voices?: { voice_id?: unknown; name?: unknown; category?: unknown; preview_url?: unknown; description?: unknown; labels?: Record<string, unknown> }[] } | null;
  if (!j || !Array.isArray(j.voices)) throw new SpeechError('ElevenLabs returned an unexpected voice list.', 502, 'malformed');
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  return j.voices.filter((v) => typeof v.voice_id === 'string' && /^[\w.:-]{1,120}$/.test(v.voice_id)).slice(0, 200).map((v) => ({
    id: v.voice_id as string, name: str(v.name, 80) || (v.voice_id as string), category: str(v.category, 30),
    description: str(v.description, 160) || Object.values(v.labels ?? {}).filter((x) => typeof x === 'string').join(', ').slice(0, 160),
    previewUrl: typeof v.preview_url === 'string' && /^https:\/\//.test(v.preview_url) ? v.preview_url : null,
  }));
}

export async function synthesize(c: TtsConfig, text: string, signal: AbortSignal): Promise<{ audio: Buffer; mime: string }> {
  const st = ttsStatus(c); if (!st.configured) throw new SpeechError(st.note, 503, 'not_configured');
  if (c.provider === 'elevenlabs') return synthesizeEleven(c, text, signal);
  if (c.provider === 'gemini') return synthesizeGemini(c, text, signal);
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
