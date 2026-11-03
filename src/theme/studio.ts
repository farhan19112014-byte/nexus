/**
 * Applying and remembering a Colour Studio theme.
 * Source of truth: settings.palette in the memory store (IndexedDB, validated by SettingsSchema) — the same place
 * the light/dark choice lives. A copy of the pair and its generated stylesheet is cached in localStorage only so the
 * very first paint (including the boot screen, see index.html) already uses it, exactly like the theme cache.
 */
import { generateTheme, type Palette } from './palette';
import { normHex } from './colour';

const KEY = 'nexus-palette';
const KEY_CSS = 'nexus-palette-css';
const STYLE_ID = 'nexus-palette';
type Listener = (p: Palette | null) => void;
const listeners = new Set<Listener>();
let current: Palette | null = null;

export function samePalette(x: Palette | null, y: Palette | null) { return x === y || (!!x && !!y && x.a === y.a && x.b === y.b); }
export function validPalette(p: unknown): Palette | null {
  if (!p || typeof p !== 'object') return null;
  const a = normHex(String((p as Palette).a ?? '')), b = normHex(String((p as Palette).b ?? ''));
  return a && b && a !== b ? { a, b } : null;
}
export function currentPalette() { return current; }
export function onPaletteChange(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Apply a theme to the whole page (null = the original NEXUS theme). Animates the change unless motion is reduced. */
export function applyPalette(input: Palette | null, o: { animate?: boolean } = {}) {
  const p = input ? validPalette(input) : null;
  if (samePalette(p, current) && (typeof document === 'undefined' || !!p === (document.documentElement.dataset.palette === 'custom'))) return;
  current = p;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (o.animate && !reduce) { root.classList.add('palette-shift'); window.setTimeout(() => root.classList.remove('palette-shift'), 650); }
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (p) {
      const t = generateTheme(p);
      if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
      el.textContent = t.css; root.dataset.palette = 'custom';
      try { localStorage.setItem(KEY, JSON.stringify(p)); localStorage.setItem(KEY_CSS, t.css); } catch { /* storage blocked: the setting itself is saved elsewhere */ }
    } else {
      el?.remove(); delete root.dataset.palette;
      try { localStorage.removeItem(KEY); localStorage.removeItem(KEY_CSS); } catch { /* ignore */ }
    }
  }
  listeners.forEach((f) => f(p));
}

export function cachedPalette(): Palette | null {
  try { const v = localStorage.getItem(KEY); return v ? validPalette(JSON.parse(v)) : null; } catch { return null; }
}
/** startup: re-generate from the cached pair (index.html may already have injected the cached stylesheet) */
export function initPalette() { applyPalette(cachedPalette()); }

/** Save to settings (the source of truth) and apply. Throws when the settings could not be saved. */
export async function savePalette(p: Palette | null) {
  applyPalette(p, { animate: true });
  const { memory } = await import('../core/runtime');
  await memory.ready;
  await memory.updateSettings({ palette: p });
}
