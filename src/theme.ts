/**
 * Theme: 'dark' (default), 'light', or 'system' (follows the OS). The saved setting is the source of truth;
 * a copy is cached in localStorage only so the first paint uses the right theme (no flash) before IndexedDB loads.
 */
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F8FAFC' : '#0B1733');
  try { localStorage.setItem(KEY, p); } catch { /* storage blocked: fine, the setting itself is saved elsewhere */ }
}
export function cachedTheme(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light' || v === 'system') return v; } catch { /* ignore */ }
  return 'dark';
}
/** Call once at startup: applies the cached theme and follows OS changes while "system" is chosen. */
export function initTheme() {
  applyTheme(cachedTheme());
  mq()?.addEventListener('change', () => { if (current === 'system') applyTheme('system'); });
}
