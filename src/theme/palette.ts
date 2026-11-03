/**
 * NEXUS Adaptive Colour Studio — theme generation.
 *
 * Every brand colour in the stylesheets is routed through a channel variable (--k-<hex>, see palette.css and
 * BASE_COLOURS). A custom theme re-maps each of those colours from two user colours:
 *  - colour 1 (primary) takes the place of NEXUS blue: buttons, deep tones, and — at low strength — the tint of
 *    backgrounds, surfaces, borders and muted text;
 *  - colour 2 (accent) takes the place of NEXUS cyan / sky: glows, highlights, accent text, the landing CTA.
 * Each original colour keeps its OKLCH lightness (so every text/background pair keeps the contrast the design was
 * built and tested with) and takes the hue and chroma of its user colour, gamut-clipped to sRGB. The tiers where the
 * user colour must stay recognisable (primary button tones, bright accents) also move toward the user colour's own
 * lightness, inside bounds that keep text readable. Status colours (green, amber, red, violet) and pure neutrals
 * (white, black, plain greys) are never re-mapped — they carry meaning or are already neutral.
 */
import { BASE_COLOURS } from './paletteBase';
import { channels, contrastRatio, hexToOklch, hexToRgb, normHex, oklchToHex } from './colour';

export type Role = 'A' | 'B' | 'N';
export const NEXUS_PRIMARY = '#1268f5';
export const NEXUS_ACCENT = '#38d9ff';
export interface Palette { a: string; b: string }

/** which user colour an original design colour follows (null = left as is) */
export function classify(hex: string): Role | null {
  const [, C, H] = hexToOklch(hex);
  if (C < 0.006) return null;                  // white, black, plain greys
  if (H < 200 || H > 285) return null;         // status colours keep their meaning
  if (C < 0.07) return 'N';                     // tinted neutrals: backgrounds, surfaces, lines, muted text
  return H < 245 ? 'B' : 'A';                   // cyan/sky family → accent; blue family → primary
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hueOf = (base: number, orig: number, user: number) => (user + (orig - base) + 360) % 360;

/** map one original design colour for the user's pair */
export function mapColour(hex: string, p: Palette): string {
  const role = classify(hex); if (!role) return hex;
  const [L, C, H] = hexToOklch(hex);
  const ua = hexToOklch(p.a), ub = hexToOklch(p.b), ba = hexToOklch(NEXUS_PRIMARY), bb = hexToOklch(NEXUS_ACCENT);
  if (role === 'N') {
    // backgrounds and greys: never more colourful than the original design's tint
    const k = Math.min(1.25, ua[1] / ba[1]);
    return oklchToHex([L, C * k, hueOf(ba[2], H, ua[2])]);
  }
  if (role === 'A') {
    // button-tone tier may only get darker (white text sits on it), never lighter
    const tier = L >= 0.42 && L <= 0.72;
    let L2 = tier ? L + clamp(ua[0] - ba[0], -0.18, 0) : L;
    const C2 = C * (ua[1] / ba[1]), H2 = hueOf(ba[2], H, ua[2]);
    let out = oklchToHex([L2, C2, H2]);
    if (tier) {
      // equal perceived lightness is not equal WCAG luminance for every hue (greens and yellows read brighter):
      // darken until light text on it is at least as readable as on the original colour (AA 4.5 where the original met it)
      const text = mapColour('#f4f8ff', p), target = Math.min(4.5, contrastRatio(hex, '#f4f8ff'));
      while (contrastRatio(out, text) < target && L2 > 0.2) { L2 -= 0.01; out = oklchToHex([L2, C2, H2]); }
    }
    return out;
  }
  // accent: bright tier follows the user colour's brightness, bounded so dark ink on it and it on dark stay readable
  const L2 = L >= 0.74 ? clamp(L + clamp(ub[0] - bb[0], -0.08, 0.12), 0.74, 0.97) : L;
  return oklchToHex([L2, C * (ub[1] / bb[1]), hueOf(bb[2], H, ub[2])]);
}

const hslHue = (hex: string) => {
  const [r, g, b] = hexToRgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

export interface GeneratedTheme {
  palette: Palette;
  /** --k-<hex> → "r g b" for every routed colour */
  vars: Record<string, string>;
  /** the canvas space scene is painted in NEXUS blue/cyan; a filter turns it toward colour 1 */
  spaceFilter: string;
  /** a stylesheet that applies the theme when <html data-palette="custom"> */
  css: string;
  /** named roles for previews and checks */
  roles: { primary: string; accent: string; bgDark: string; bgLight: string; textDark: string; textLight: string };
}

export function generateTheme(p: Palette): GeneratedTheme {
  const palette = { a: normHex(p.a) ?? NEXUS_PRIMARY, b: normHex(p.b) ?? NEXUS_ACCENT };
  const vars: Record<string, string> = {};
  for (const hex of BASE_COLOURS) vars[`--k-${hex.slice(1)}`] = channels(mapColour(hex, palette));
  const sat = clamp(hexToOklch(palette.a)[1] / hexToOklch(NEXUS_PRIMARY)[1], 0.05, 1.4);
  const spaceFilter = `hue-rotate(${Math.round(hslHue(palette.a) - hslHue(NEXUS_PRIMARY))}deg) saturate(${sat.toFixed(2)})`;
  const decl = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
  const css = `:root[data-palette="custom"]{${decl};--space-filter:${spaceFilter}}`;
  const m = (h: string) => mapColour(h, palette);
  return { palette, vars, spaceFilter, css, roles: { primary: m(NEXUS_PRIMARY), accent: m(NEXUS_ACCENT), bgDark: m('#05080d'), bgLight: m('#f6faff'), textDark: m('#f4f8ff'), textLight: m('#07111f') } };
}

/**
 * Readability checks shown in the Studio and enforced by tests: the text/background pairs the design relies on, in
 * both light and dark mode, after re-mapping. Ratios are WCAG 2.x (AA body text ≥ 4.5, large/UI ≥ 3).
 */
export const CONTRAST_PAIRS: { label: string; fg: string; bg: string; min: number }[] = [
  { label: 'Text on background (dark)', fg: '#f4f8ff', bg: '#05080d', min: 4.5 },
  { label: 'Secondary text (dark)', fg: '#c5cfdd', bg: '#05080d', min: 4.5 },
  { label: 'Muted text (dark)', fg: '#8b97a9', bg: '#05080d', min: 4.5 },
  { label: 'Text on panel (dark)', fg: '#f4f8ff', bg: '#0d1828', min: 4.5 },
  { label: 'Accent text (dark)', fg: '#38d9ff', bg: '#05080d', min: 4.5 },
  { label: 'Button text on accent (dark)', fg: '#03111a', bg: '#38d9ff', min: 4.5 },
  { label: 'Button text on primary', fg: '#f4f8ff', bg: '#1268f5', min: 4.5 },
  { label: 'Text on background (light)', fg: '#07111f', bg: '#f6faff', min: 4.5 },
  { label: 'Secondary text (light)', fg: '#2a3950', bg: '#f4f8ff', min: 4.5 },
  { label: 'Muted text (light)', fg: '#56657a', bg: '#f4f8ff', min: 4.5 },
  { label: 'Accent text (light)', fg: '#0f5bdb', bg: '#f4f8ff', min: 4.5 },
  { label: 'Button text on primary (light)', fg: '#ffffff', bg: '#0f5bdb', min: 4.5 },
  { label: 'Sky text (light)', fg: '#0369a1', bg: '#f4f8ff', min: 4.5 },
  { label: 'Link text (light)', fg: '#1d4ed8', bg: '#ffffff', min: 4.5 },
  { label: 'Sky text (dark)', fg: '#7dd3fc', bg: '#0d1828', min: 4.5 },
];
export function contrastReport(p: Palette) {
  return CONTRAST_PAIRS.map((c) => { const ratio = contrastRatio(mapColour(c.fg, p), mapColour(c.bg, p)); return { ...c, ratio, ok: ratio >= c.min }; });
}

/** The colour library: 48 named colours across the spectrum, plus neutrals and metallics. */
export const COLOUR_LIBRARY: { name: string; hex: string }[] = [
  { name: 'NEXUS Blue', hex: '#1268f5' }, { name: 'NEXUS Cyan', hex: '#38d9ff' },
  { name: 'Crimson', hex: '#dc143c' }, { name: 'Red', hex: '#ef4444' }, { name: 'Coral', hex: '#ff7f50' }, { name: 'Rose', hex: '#f43f5e' },
  { name: 'Blush', hex: '#fda4af' }, { name: 'Pink', hex: '#ec4899' }, { name: 'Hot Pink', hex: '#ff1f8f' }, { name: 'Magenta', hex: '#d946ef' },
  { name: 'Orange', hex: '#f97316' }, { name: 'Tangerine', hex: '#ff9f1c' }, { name: 'Amber', hex: '#f59e0b' }, { name: 'Peach', hex: '#ffb38a' },
  { name: 'Yellow', hex: '#facc15' }, { name: 'Lemon', hex: '#fff176' }, { name: 'Gold', hex: '#d4af37' }, { name: 'Bronze', hex: '#b0782f' },
  { name: 'Lime', hex: '#84cc16' }, { name: 'Green', hex: '#22c55e' }, { name: 'Emerald', hex: '#059669' }, { name: 'Forest', hex: '#166534' },
  { name: 'Olive', hex: '#6b7c2c' }, { name: 'Mint', hex: '#6ee7b7' }, { name: 'Teal', hex: '#14b8a6' }, { name: 'Aqua', hex: '#2dd4bf' },
  { name: 'Cyan', hex: '#06b6d4' }, { name: 'Sky', hex: '#38bdf8' }, { name: 'Azure', hex: '#0ea5e9' }, { name: 'Blue', hex: '#3b82f6' },
  { name: 'Cobalt', hex: '#1d4ed8' }, { name: 'Navy', hex: '#1e3a8a' }, { name: 'Midnight', hex: '#0f172a' }, { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' }, { name: 'Purple', hex: '#9333ea' }, { name: 'Lavender', hex: '#c4b5fd' }, { name: 'Plum', hex: '#7e22ce' },
  { name: 'Brown', hex: '#8b5a2b' }, { name: 'Chocolate', hex: '#5c3317' }, { name: 'Sand', hex: '#d6b88a' }, { name: 'Copper', hex: '#c26a3a' },
  { name: 'White', hex: '#ffffff' }, { name: 'Silver', hex: '#c0c7d0' }, { name: 'Grey', hex: '#6b7280' }, { name: 'Slate', hex: '#475569' },
  { name: 'Charcoal', hex: '#2b2f36' }, { name: 'Black', hex: '#0a0a0a' },
];
