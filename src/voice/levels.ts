/**
 * Live audio levels for the voice visualizers — measured, never simulated.
 *  - 'voice': the loudness of NEXUS's server voice while it actually plays (ServerSpeechOutput's analyser).
 *  - 'mic':   your microphone while NEXUS listens (the server-transcription recorder's analyser, or a separate meter
 *             opened only during browser speech recognition, which gives no audio access of its own).
 * When no level arrives (browser voices, no microphone access) the visualizers show a plain state instead of bars.
 */
export type LevelSource = 'mic' | 'voice';
const HISTORY = 40;

class LevelBus {
  private hist: Record<LevelSource, number[]> = { mic: [], voice: [] };
  private last: Record<LevelSource, number> = { mic: -Infinity, voice: -Infinity };
  private listeners = new Set<() => void>();
  constructor(private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {}
  emit(src: LevelSource, level: number) {
    const v = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    const h = this.hist[src]; h.push(v); if (h.length > HISTORY) h.shift();
    this.last[src] = this.now(); this.listeners.forEach((f) => f());
  }
  /** levels arrived within the last `ms` */
  live(src: LevelSource, ms = 400) { return this.now() - this.last[src] < ms; }
  history(src: LevelSource): readonly number[] { return this.hist[src]; }
  reset(src: LevelSource) { this.hist[src] = []; this.last[src] = -Infinity; this.listeners.forEach((f) => f()); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
}
export const levels = new LevelBus();
export { LevelBus };

/** Microphone loudness (RMS of a time-domain frame) → 0…1 with a noise floor. */
export function micLevel(rms: number) { const v = Math.max(0, rms - 0.008) * 9; return Math.min(1, v / (1 + v * 0.4)); }

/**
 * A level meter for the microphone while the browser's own speech recognition listens (that API exposes no audio).
 * Opens the microphone only on request, only while listening, and closes it right after. Fails quietly: then there is
 * simply no waveform.
 */
export class MicMeter {
  private stream: MediaStream | null = null; private ctx: AudioContext | null = null; private timer: ReturnType<typeof setInterval> | null = null; private session = 0;
  start() {
    const s = ++this.session;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((stream) => {
      if (s !== this.session) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC(); const an = this.ctx.createAnalyser(); an.fftSize = 512; this.ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      this.timer = setInterval(() => { an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x; } levels.emit('mic', micLevel(Math.sqrt(sum / buf.length))); }, 60);
    }).catch(() => { /* no meter: the indicator shows "listening" without a waveform */ });
  }
  stop() { this.session++; if (this.timer) clearInterval(this.timer); this.timer = null; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; void this.ctx?.close().catch(() => {}); this.ctx = null; levels.reset('mic'); }
}
