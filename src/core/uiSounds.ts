/**
 * Optional interface sounds, synthesized with Web Audio (no audio files, no music). Off by default; they follow
 * Settings → "Interface sounds" and quiet mode, and never play before the visitor has interacted with the page.
 */
export type UiSound = 'startup' | 'listen' | 'listenEnd' | 'activate';
type Prefs = { sounds: boolean; quietMode: boolean };
/** [frequency Hz, start s, length s, gain] per note — short, low-gain, soft attack */
export const UI_SOUNDS: Record<UiSound, [number, number, number, number][]> = {
  startup: [[392, 0, 0.5, 0.035], [587.33, 0.12, 0.55, 0.03], [783.99, 0.24, 0.7, 0.025]],
  listen: [[660, 0, 0.12, 0.04], [990, 0.07, 0.16, 0.035]],
  listenEnd: [[880, 0, 0.12, 0.03], [587.33, 0.07, 0.18, 0.03]],
  activate: [[740, 0, 0.14, 0.03]],
};
export class UiSounds {
  private ctx: AudioContext | null = null;
  played: UiSound[] = [];   // for tests / diagnostics
  constructor(private prefs: () => Prefs) {}
  enabled() { const p = this.prefs(); return p.sounds && !p.quietMode; }
  play(kind: UiSound): boolean {
    if (!this.enabled()) return false;
    const act = (globalThis.navigator as { userActivation?: { hasBeenActive: boolean } } | undefined)?.userActivation;
    if (act && !act.hasBeenActive) return false;
    try {
      const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext; if (!AC) return false;
      this.ctx ??= new AC(); const ctx = this.ctx; void ctx.resume?.(); const t = ctx.currentTime + 0.01;
      for (const [f, at, len, gain] of UI_SOUNDS[kind]) {
        const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(gain, t + at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
        o.connect(g).connect(ctx.destination); o.start(t + at); o.stop(t + at + len + 0.05);
      }
      this.played.push(kind); if (this.played.length > 50) this.played.shift();
      return true;
    } catch { return false; }
  }
}
