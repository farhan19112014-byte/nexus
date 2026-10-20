/**
 * Picks the voice engines (spec §11–§12): the server speech service when it is configured, otherwise the browser's
 * engines. A sentence the server voice fails to produce is spoken by the browser voice instead (when there is one),
 * and the user is told once — a failure is never silent and never leaves the mouth moving.
 */
import { SpeechInput, type ListenCallbacks } from './recognition';
import { SpeechOutput, type TTSHooks } from './tts';
import { ServerSpeechInput, ServerSpeechOutput, type SpeechIn, type SpeechOut } from './serverVoice';
import type { SpeakingStyle } from '../../shared/schema';

export type VoiceEngine = 'auto' | 'server' | 'browser';

export class VoiceOutputRouter implements SpeechOut {
  readonly browser: SpeechOut; readonly server: ServerSpeechOutput;
  private serverReady = false; private pref: VoiceEngine = 'auto'; private warned = false;
  private h: TTSHooks = {};
  onNotice: (msg: string) => void = () => {};
  constructor(browser?: SpeechOut, server?: ServerSpeechOutput) {
    this.browser = browser ?? new SpeechOutput(); this.server = server ?? new ServerSpeechOutput();
    this.server.onFailure = (msg, text) => {
      if (!this.warned) { this.warned = true; this.onNotice(`Server voice failed (${msg})${this.browser.supported ? ' — using this computer\'s voice instead.' : '.'}`); }
      if (this.browser.supported) this.browser.enqueue(text, 'warm');
    };
    this.wire();
  }
  configure(serverConfigured: boolean, pref: VoiceEngine) { this.serverReady = serverConfigured; this.pref = pref; }
  get active(): SpeechOut { return this.useServer ? this.server : this.browser; }
  private get useServer() { return this.server.supported && this.serverReady && this.pref !== 'browser'; }
  get engineName() { return this.useServer ? 'server' : this.browser.supported ? 'browser' : 'none'; }
  get supported() { return this.useServer || this.browser.supported; }
  get speaking() { return this.server.speaking || this.browser.speaking; }
  get lipSync() { return this.active.lipSync ?? 'n/a'; }
  get rate() { return this.browser.rate; } set rate(v: number) { this.browser.rate = v; this.server.rate = v; }
  get voiceURI() { return this.browser.voiceURI; } set voiceURI(v: string | null) { this.browser.voiceURI = v; }
  get boundaryEvents() { return this.active.boundaryEvents; } set boundaryEvents(v: boolean) { this.browser.boundaryEvents = v; }
  get hooks() { return this.h; }
  set hooks(h: TTSHooks) { this.h = h; this.wire(); }
  private wire() {
    // one combined lifecycle: start once, idle only when neither engine is speaking
    let on = false;
    const start = () => { if (!on) { on = true; this.h.onStart?.(); } };
    const idle = () => { setTimeout(() => { if (on && !this.speaking) { on = false; this.h.onIdle?.(); } }, 0); };
    const hooks: TTSHooks = { onStart: start, onIdle: idle, onWord: (w) => this.h.onWord?.(w), onLevel: (l) => this.h.onLevel?.(l) };
    this.browser.hooks = hooks; this.server.hooks = hooks;
  }
  voices() { return this.browser.voices(); }
  enqueue(text: string, style: SpeakingStyle) { this.active.enqueue(text, style); }
  pause() { this.active.pause?.(); }
  resume() { this.active.resume?.(); }
  stop() { this.server.stop(); this.browser.stop(); }
}

export class VoiceInputRouter implements SpeechIn {
  readonly browser: SpeechIn; readonly server: ServerSpeechInput;
  private serverReady = false; private pref: VoiceEngine = 'auto'; private desktop: boolean;
  constructor(browser?: SpeechIn, server?: ServerSpeechInput, desktop = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)) {
    this.browser = browser ?? new SpeechInput(); this.server = server ?? new ServerSpeechInput(); this.desktop = desktop;
  }
  configure(serverConfigured: boolean, pref: VoiceEngine) { this.serverReady = serverConfigured; this.pref = pref; }
  /** a configured transcription service is preferred: it works in the desktop app too, where browser recognition does not */
  private get useServer() { return this.server.supported && this.serverReady && this.pref !== 'browser'; }
  get isDesktop() { return this.desktop; }
  private get active(): SpeechIn { return this.useServer ? this.server : this.browser; }
  get kind() { return this.useServer ? 'server' : this.browser.supported ? 'browser' : 'none'; }
  get supported() { return this.useServer || this.browser.supported; }
  get listening() { return this.server.listening || this.browser.listening; } set listening(v: boolean) { void v; }
  start(cb: ListenCallbacks, lang?: string) { this.active.start(cb, lang); }
  stop() { this.server.stop(); this.browser.stop(); }
  abort() { this.server.abort(); this.browser.abort(); }
}
