/**
 * Theme: 'dark' (default), 'light', or 'system' (follows the OS). The saved setting is the source of truth;
 * a copy is cached in localStorage only so the first paint uses the right theme (no flash) before IndexedDB loads.
 */
import { initPalette } from './theme/studio';

export type ThemePref = 'dark' | 'light' | 'system';
const KEY = 'nexus-theme';
const mq = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null);

export function resolveTheme(p: ThemePref): 'dark' | 'light' { return p === 'system' ? (mq()?.matches ? 'light' : 'dark') : p; }

let current: ThemePref = 'dark';
export function applyTheme(p: ThemePref) {
  current = p;
  if (typeof document === 'undefined') return;
  const t = resolveTheme(p);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F4F8FF' : '#07111F');
  try { localStorage.setItem(KEY, p); } catch { /* storage blocked: fine, the setting itself is saved elsewhere */ }
}
const PENDING = 'nexus-theme-pending';
/**
 * A theme picked with the one-click toggle: shown at once, then saved to the settings (the source of truth). Until that
 * save has finished the choice is also kept as "pending", so a page change or reload in that moment cannot bring the
 * older saved theme back (see settledTheme).
 */
export function chooseTheme(p: ThemePref, persist: (p: ThemePref) => Promise<unknown>) {
  applyTheme(p);
  const mark = `${p}|${Date.now()}`;
  try { localStorage.setItem(PENDING, mark); } catch { /* storage blocked */ }
  void persist(p).then(() => { try { if (localStorage.getItem(PENDING) === mark) localStorage.removeItem(PENDING); } catch { /* ignore */ } }, () => {});
}
/** The theme to show for the saved setting: an unfinished toggle (pending) wins and is saved now. */
export function settledTheme(saved: ThemePref, persist: (p: ThemePref) => Promise<unknown>): ThemePref {
  let raw: string | null = null; try { raw = localStorage.getItem(PENDING); } catch { return saved; }
  if (!raw) return saved;
  const [v, at] = raw.split('|'); const clear = () => { try { localStorage.removeItem(PENDING); } catch { /* ignore */ } };
  // only a moment-old choice counts: a newer choice made in Settings (or a long-failed save) is never overridden
  if ((v !== 'dark' && v !== 'light' && v !== 'system') || !(Date.now() - Number(at) < 10_000) || v === saved) { clear(); return saved; }
  const p = v as ThemePref;
  void persist(p).then(() => { try { if (localStorage.getItem(PENDING) === raw) localStorage.removeItem(PENDING); } catch { /* ignore */ } }, () => {});
  return p;
}
export function cachedTheme(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light' || v === 'system') return v; } catch { /* ignore */ }
  return 'dark';
}
/** Call once at startup: applies the cached theme and follows OS changes while "system" is chosen. */
export function initTheme() {
  applyTheme(cachedTheme());
  initPalette();
  mq()?.addEventListener('change', () => { if (current === 'system') applyTheme('system'); });
}
