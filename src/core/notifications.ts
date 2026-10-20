/**
 * Assets 38 & 89 — in-app notifications, optional desktop notifications and sounds, and quiet mode.
 * Quiet mode suppresses OPTIONAL effects (sounds, reactions, desktop notifications) but never
 * essential status (errors, state indicator, text status).
 */
export type NoticeKind = 'info' | 'success' | 'error' | 'skill' | 'memory' | 'response' | 'reminder';
export interface Notice { id: number; kind: NoticeKind; text: string; at: number; essential: boolean }
export interface NotifyPrefs { quietMode: boolean; sounds: boolean; notificationReactions: boolean; desktopNotifications: boolean }

export class Notifications {
  notices: Notice[] = [];
  private id = 1; private listeners = new Set<() => void>(); version = 0;
  private audio: AudioContext | null = null;
  suppressed = { sounds: 0, reactions: 0, desktop: 0 };
  constructor(private prefs: () => NotifyPrefs, private react: (kind: NoticeKind) => void) {}
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }
  push(kind: NoticeKind, text: string, o: { essential?: boolean; react?: boolean; sound?: boolean; desktop?: boolean } = {}) {
    const n: Notice = { id: this.id++, kind, text: text.slice(0, 200), at: Date.now(), essential: !!o.essential || kind === 'error' };
    this.notices.push(n); if (this.notices.length > 6) this.notices.shift();
    const p = this.prefs();
    if (o.react !== false) { if (p.quietMode || !p.notificationReactions) this.suppressed.reactions++; else this.react(kind); }
    // reminders you set chime even when UI sounds are off (quiet mode still silences them)
    if (o.sound) { if (p.quietMode || (!p.sounds && kind !== 'reminder')) this.suppressed.sounds++; else this.chime(kind); }
    if (o.desktop) this.desktop(text);
    this.changed();
    setTimeout(() => this.dismiss(n.id), kind === 'reminder' ? 60000 : n.essential ? 12000 : 5000);
    return n;
  }
  dismiss(id: number) { const before = this.notices.length; this.notices = this.notices.filter((n) => n.id !== id); if (this.notices.length !== before) this.changed(); }
  /** Requires the browser permission; only shown while the tab is hidden; content-free. */
  private desktop(text: string) {
    const p = this.prefs();
    if (typeof Notification === 'undefined' || !p.desktopNotifications || p.quietMode || Notification.permission !== 'granted' || !document.hidden) { this.suppressed.desktop++; return; }
    try { new Notification('NEXUS', { body: text.slice(0, 80), silent: true }); } catch { /* ignore */ }
  }
  async requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.requestPermission();
  }
  /** Original synthesized chimes (WebAudio) — no audio assets. */
  chime(kind: NoticeKind) {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio; const t = ctx.currentTime;
      const notes = kind === 'error' ? [330, 262] : kind === 'success' ? [660, 880] : kind === 'reminder' ? [784, 988, 784, 988] : [740];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.25);
        o.connect(g).connect(ctx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.3);
      });
    } catch { /* audio unavailable */ }
  }
}
