/**
 * Asset 02 — Official Color System & Asset 06 — Rendering/Outline System.
 * The single source of truth for NEXUS colors, strokes, radii and glow.
 * UI CSS variables are generated from these tokens at startup (see applyCssTokens).
 */
export const COLORS = {
  deepBlack: '#07090d',
  black: '#0d1118',
  graphite: '#1b2230',
  graphiteLight: '#2a3446',
  primaryBlue: '#1f6bff',
  electricBlue: '#2f8cff',
  cyan: '#33e1ff',
  paleBlue: '#a9d8ff',
  outline: '#04060a',
  text: '#e8f1ff',
  textMuted: '#9fb3cc',   // 7.9:1 on deepBlack
  warning: '#ffb547',
  danger: '#ff6b7a',
  success: '#46e3a6',
} as const;

/**
 * UI palette (Section 2): blue, dark blue, white, black and grey. The character keeps its own graphite
 * shell colors above; the interface uses only these, exposed as --nexus-* CSS variables.
 */
export const PALETTE = {
  blue: '#2563EB', electric: '#3B82F6', cyan: '#38BDF8',
  darkBlue: '#0B1733', navy: '#101B35', black: '#080B12', white: '#F8FAFC',
  grey100: '#E2E8F0', grey300: '#CBD5E1', grey500: '#64748B', grey700: '#334155', grey900: '#111827',
  // status colors (always paired with text, never the only signal)
  warning: '#FBBF24', danger: '#F87171', success: '#34D399',
} as const;

/**
 * 3D shading ramp for the character: highlights, mid-tones and occlusion used by the gradients that
 * give the flat 2D rig its volume (key light upper-left, cool rim light lower-right).
 */
export const SHADE = {
  void: '#010205',
  abyss: '#030407',
  socket: '#05070b',
  shellCore: '#06080d',
  cylEdge: '#0a0e15',
  bevelMid: '#0b0f17',
  cylDarkShade: '#0e131b',
  ledBlueEdge: '#123f99',
  eyeLow: '#139fd4',
  cylDarkRim: '#16305c',
  cylRim: '#1d3a6e',
  cylDarkLight: '#2b364b',
  cylLight: '#323f58',
  bootTop: '#3a4762',
  cylHighlight: '#46557a',
  bevelLip: '#4a5b7c',
  shellHighlight: '#56668a',
  sphereHighlight: '#6a7ca2',
  eyeHigh: '#b5f6ff',
  ledBlueCore: '#cfe6ff',
  ledCore: '#f0feff',
} as const;

export const STROKES = {
  /** outline width in character units (viewBox units), scaled with the SVG so it stays crisp */
  outline: 3.2,
  detail: 1.6,
  hairline: 0.9,
  faceFeature: 0, // face features are filled shapes, no stroke
} as const;

export const RADII = { head: 34, torso: 18, limb: 9, hand: 9, foot: 8, screen: 26 } as const;

export const GLOW = {
  /** stdDeviation of the glow filter for LEDs (0 disables) */
  led: 2.4,
  ambient: 18,
  ledOpacity: 0.95,
} as const;

/** WCAG contrast ratio helper (used by tests to guarantee readable text). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function applyCssTokens(root: HTMLElement = document.documentElement) {
  const P = PALETTE;
  const map: Record<string, string> = {
    '--nexus-blue': P.blue, '--nexus-electric': P.electric, '--nexus-cyan': P.cyan, '--nexus-dark-blue': P.darkBlue, '--nexus-navy': P.navy,
    '--nexus-black': P.black, '--nexus-white': P.white, '--nexus-grey-100': P.grey100, '--nexus-grey-300': P.grey300, '--nexus-grey-500': P.grey500,
    '--nexus-grey-700': P.grey700, '--nexus-grey-900': P.grey900,
    // theme-dependent tokens (--c-*, --bg, --fg …) live in styles.css so the light theme can override them
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}
