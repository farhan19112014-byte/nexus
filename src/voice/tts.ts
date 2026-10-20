/**
 * Asset 83 — text-to-speech with configurable voice and rate, sentence-level queueing (so streamed
 * replies can start speaking before the full text arrives), boundary events for mouth shapes, and stop().
 */
import type { SpeakingStyle } from '../../shared/schema';
const STYLE: Record<SpeakingStyle, { rate: number; pitch: number }> = {
  calm: { rate: 0.95, pitch: 1.05 }, warm: { rate: 1, pitch: 1.15 }, energetic: { rate: 1.1, pitch: 1.25 }, serious: { rate: 0.95, pitch: 1 }, playful: { rate: 1.05, pitch: 1.3 }, soft: { rate: 0.9, pitch: 1.1 },
};
export interface TTSHooks { onStart?(): void; onWord?(word: string): void; onIdle?(): void; /** mouth openness 0…1 measured from the playing audio (server voice only) */ onLevel?(level: number): void }

/** Approximate mouth shape from a word (used only when the engine reports word boundaries). */
export function visemeFor(word: string): { open: number; round: number } {
  const w = word.toLowerCase(); const v = (w.match(/[aeiou]/) ?? w.match(/y/) ?? [''])[0];
  return v === 'o' || v === 'u' ? { open: 0.6, round: 0.8 } : v === 'a' ? { open: 0.9, round: 0 } : v === 'e' || v === 'i' || v === 'y' ? { open: 0.45, round: 0 } : { open: 0.25, round: 0 };
}

export class SpeechOutput {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  rate = 1; voiceURI: string | null = null;
  private queue: string[] = []; private busy = false; private gen = 0; private style: SpeakingStyle = 'warm';
  private paused = false; private wd: { g: number; ms: number; h: ReturnType<typeof setTimeout> } | null = null;
  hooks: TTSHooks = {};
  boundaryEvents = false;
  /** browser voices expose no audio, so the mouth follows word-boundary events (an approximation) */
  get lipSync() { return this.boundaryEvents ? 'word boundaries (approximation)' : 'timed while speaking (this voice reports no word timing)'; }
  voices(): SpeechSynthesisVoice[] { return this.supported ? window.speechSynthesis.getVoices() : []; }
  get speaking() { return this.busy || this.queue.length > 0; }
  /** Queue text (one or more sentences). */
  enqueue(text: string, style: SpeakingStyle) { if (!this.supported || !text.trim()) return; this.style = style; this.queue.push(text.trim()); if (!this.busy) this.next(this.gen); }
  private next(g: number) {
    if (g !== this.gen) return;
    const t = this.queue.shift();
    if (!t) { this.busy = false; this.hooks.onIdle?.(); return; }
    this.busy = true;
    const u = new SpeechSynthesisUtterance(t);
    const s = STYLE[this.style]; u.rate = s.rate * this.rate; u.pitch = s.pitch;
    const v = this.voices().find((x) => x.voiceURI === this.voiceURI); if (v) u.voice = v;
    let started = false;
    const wdMs = 2500 + t.length * 120 / (s.rate * this.rate);
    const watchdog = setTimeout(() => { if (!this.paused) this.next(g); }, wdMs); this.wd = { g, ms: wdMs, h: watchdog };
    u.onstart = () => { if (!started) { started = true; this.hooks.onStart?.(); } };
    u.onboundary = (e) => { if (e.name && e.name !== 'word') return; this.boundaryEvents = true; this.hooks.onWord?.(t.slice(e.charIndex, e.charIndex + (e.charLength || 6))); };
    u.onend = () => { clearTimeout(watchdog); this.next(g); };
    u.onerror = () => { clearTimeout(watchdog); this.next(g); };
    window.speechSynthesis.speak(u);
  }
  pause() { if (!this.supported || !this.busy) return; this.paused = true; if (this.wd) clearTimeout(this.wd.h); try { window.speechSynthesis.pause(); } catch { /* engine gone */ } }
  resume() { if (!this.paused) return; this.paused = false; try { window.speechSynthesis.resume(); } catch { /* engine gone */ } const w = this.wd; if (w) w.h = setTimeout(() => this.next(w.g), w.ms); }
  stop() { this.paused = false; this.gen++; this.queue = []; const was = this.busy; this.busy = false; if (this.supported && typeof window !== 'undefined') try { window.speechSynthesis.cancel(); } catch { /* engine gone */ } if (was) this.hooks.onIdle?.(); }
}

/** Split streamed text into complete sentences, returning [sentences, remainder]. */
export function takeSentences(buf: string): [string[], string] {
  const out: string[] = []; let rest = buf;
  const re = /^([\s\S]*?[.!?…])(\s+|$)/;
  let m;
  while ((m = re.exec(rest)) && m[1].trim().length >= 2 && (m[2] !== '' )) { out.push(m[1].trim()); rest = rest.slice(m[0].length); }
  return [out, rest];
}
