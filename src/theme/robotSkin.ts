/**
 * The robot follows the Colour Studio theme. Same rule as the site, tuned for a body you can see:
 *  - blue / cyan parts (eyes, mouth, LEDs, trim, antenna, core) map exactly like the site: cyan → colour 2 (accent),
 *    blue → colour 1 (primary);
 *  - the body (shell, limbs, joints, boots, bezel, screen glass) keeps its lightness and takes colour 1's hue with a
 *    clearly visible tint, so the body reads as "a red NEXUS" or "a green NEXUS", not just a grey one;
 *  - pure white/black and status colours (listening green, error red…) never change.
 * With no custom theme every colour is returned unchanged: the original NEXUS.
 */
import { classify, mapColour, NEXUS_ACCENT, NEXUS_PRIMARY, type Palette } from './palette';
import { hexToOklch, normHex, oklchToHex } from './colour';

export function robotColour(hex: string, p: Palette | null): string {
  if (!p || (p.a === NEXUS_PRIMARY && p.b === NEXUS_ACCENT)) return hex; // the original NEXUS
  const h = normHex(hex); if (!h) return hex;
  const role = classify(h);
  if (role === 'A' || role === 'B') return mapColour(h, p);
  if (role !== 'N') return hex;
  const [L, C] = hexToOklch(h); const [, ua, uh] = hexToOklch(p.a); const ba = hexToOklch(NEXUS_PRIMARY)[1];
  if (ua < 0.02) return oklchToHex([L, 0, uh]);                       // black / white / grey primary → a neutral robot
  const tint = Math.min(0.11, ua * 0.45) * Math.min(1, (L + 0.05) / 0.35); // very dark parts get a little less
  return oklchToHex([L, Math.max(C * (ua / ba), tint), uh]);
}

/** map every colour string of a skin object (shallow, plus one level of nested records) */
export function themeSkin<T extends object>(skin: T, p: Palette | null): T {
  if (!p) return skin;
  const conv = (v: unknown): unknown => (typeof v === 'string' && /^#[0-9a-f]{3,6}$/i.test(v) ? robotColour(v, p)
    : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v);
  return conv(skin) as T;
}
