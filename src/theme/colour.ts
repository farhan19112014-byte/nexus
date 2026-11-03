/**
 * Colour maths for the Colour Studio: hex ⇄ sRGB ⇄ OKLab/OKLCH, gamut clipping and WCAG contrast.
 * OKLCH is used because its lightness tracks perceived brightness: keeping L keeps contrast, while hue and
 * chroma can change freely. No dependency — the formulas are the published OKLab reference (Björn Ottosson).
 */
export type RGB = [number, number, number]; // 0…1
export type LCH = [number, number, number]; // L 0…1, C ≥ 0, H degrees

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** "#abc" / "abc" / "#AABBCC" → "#aabbcc", or null when it is not a hex colour */
export function normHex(v: string): string | null {
  const m = HEX.exec(v.trim()); if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}
export function hexToRgb(hex: string): RGB { const h = normHex(hex) ?? '#000000'; return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB; }
export function rgbToHex([r, g, b]: RGB): string { return `#${[r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`; }
/** "r g b" channel triplet for rgb(var(--x) / a) */
export function channels(hex: string): string { return hexToRgb(hex).map((c) => Math.round(c * 255)).join(' '); }

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: RGB): LCH {
  const [r, g, b] = rgb.map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B); let H = (Math.atan2(B, A) * 180) / Math.PI; if (H < 0) H += 360;
  return [L, C, H];
}
/** OKLCH → linear-unclipped sRGB (may be outside 0…1) */
function oklchToRgbRaw([L, C, H]: LCH): RGB {
  const h = (H * Math.PI) / 180; const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const inGamut = (c: RGB) => c.every((v) => v >= -0.0005 && v <= 1.0005);
/** OKLCH → sRGB hex, reducing chroma (never lightness or hue) until the colour fits sRGB */
export function oklchToHex(lch: LCH): string {
  const L = Math.min(1, Math.max(0, lch[0]));
  let c = oklchToRgbRaw([L, lch[1], lch[2]]);
  if (!inGamut(c)) {
    let lo = 0, hi = lch[1];
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToRgbRaw([L, mid, lch[2]]))) lo = mid; else hi = mid; }
    c = oklchToRgbRaw([L, lo, lch[2]]);
  }
  return rgbToHex(c);
}
export const hexToOklch = (hex: string) => rgbToOklch(hexToRgb(hex));

/** WCAG 2.x relative luminance and contrast ratio */
export function luminance(hex: string) { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrastRatio(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
/** the more readable of near-black / white on a background */
export function inkOn(bg: string, dark = '#03111a', light = '#ffffff') { return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light; }
