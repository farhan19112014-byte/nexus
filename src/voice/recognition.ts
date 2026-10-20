/** Asset 82 — browser speech recognition with interim text and a single, de-duplicated final result. */
type Ctor = new () => Rec;
interface Rec { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; onstart: (() => void) | null; start(): void; stop(): void; abort(): void }
/** The desktop app (Electron) has no built-in speech-to-text service, so recognition fails with "network". */
export const isDesktopApp = () => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
export const DESKTOP_NETWORK = 'Voice input is not available in the NEXUS desktop app (it has no speech-to-text service). Type instead, or open NEXUS in Chrome or Edge (menu NEXUS → Open in browser) to talk to it. Spoken replies still work.';

export interface ListenCallbacks { onInterim(t: string): void; onFinal(t: string): void; onError(msg: string, code: string): void; onState(listening: boolean): void; /** recording finished; the audio is being transcribed (server transcription only) */ onTranscribing?(): void }

const ERR: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. You can allow it in the browser\'s site settings, or type instead.',
  'service-not-allowed': 'Speech recognition is not allowed in this context.', 'no-speech': 'I didn\'t hear anything.',
  'audio-capture': 'No microphone was found.', network: 'This browser\'s speech recognition needs a network connection.',
};

export class SpeechInput {
  private C: Ctor | null = typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition ?? null);
  readonly supported = !!this.C;
  private rec: Rec | null = null;
  private delivered = false;
  listening = false;
  start(cb: ListenCallbacks, lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US') {
    if (!this.C) { cb.onError('Speech recognition isn\'t supported in this browser (try Chrome or Edge), so please type instead.', 'unsupported'); return; }
    this.abort();
    const rec = new this.C(); this.rec = rec; this.delivered = false;
    rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '';
    rec.onstart = () => { this.listening = true; cb.onState(true); };
    rec.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; } cb.onInterim(`${final} ${interim}`.trim()); };
    rec.onerror = (e) => { if (e.error !== 'aborted') cb.onError(e.error === 'network' && isDesktopApp() ? DESKTOP_NETWORK : ERR[e.error] ?? `Speech recognition error: ${e.error}`, e.error); };
    rec.onend = () => { this.listening = false; cb.onState(false); if (this.rec === rec) this.rec = null; const t = final.trim(); if (t && !this.delivered) { this.delivered = true; cb.onFinal(t); } };
    try { rec.start(); } catch (err) { cb.onError(`Could not start listening: ${(err as Error).message}`, 'start'); }
  }
  stop() { this.rec?.stop(); }
  abort() { if (this.rec) { this.delivered = true; this.rec.abort(); this.rec = null; } this.listening = false; }
}

/** Asset 84 — spoken interruption commands recognised instead of being sent as messages. */
export const VOICE_STOP = /^(stop|cancel|be quiet|quiet|shush|never ?mind|stop talking)[.!]?$/i;
