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

/**
 * Robot skins. The DARK skin is the classic NEXUS (built from COLORS/SHADE — unchanged). The LIGHT skin is the
 * light-theme NEXUS: a white shell, light-blue limbs and joints, a pale glass face screen with blue LED eyes and a
 * soft blue outline. Same rig, geometry and animation — only colours differ.
 */
export interface RobotSkin {
  outline: string; deepBlack: string; graphite: string; graphiteLight: string; primaryBlue: string; electricBlue: string; cyan: string; paleBlue: string; textMuted: string;
  shellHighlight: string; shellMid: string; shellLow: string; shellCore: string; shadeTop: number; shadeBottom: number;
  cylEdge: string; cylLight: string; cylHighlight: string; cylMid: string; cylLow: string; cylRim: string;
  cylDarkEdge: string; cylDarkMid: string; cylDarkLight: string; cylDarkShade: string; cylDarkLow: string; cylDarkRim: string;
  sphereHighlight: string; sphereMid: string; sphereLow: string; socket: string;
  ledCore: string; ledMid: string; ledOuter: string; ledEdge: string; ledBlueCore: string; ledBlueEdge: string;
  eyeHigh: string; eyeMid: string; eyeLow: string; pupil: string; lid: string; brow: string; cheek: string; mouth: string;
  screenTop: string; screenBottom: string; screenEdge: string; bevelTop: string; bevelMid: string; bevelLip: string; insetOpacity: number;
  chestBg: string; chestRing: string; bootTop: string; bootMid: string; bootLow: string; headStripe: string;
  ambient: string; ambientOpacity: number; ambientFade: string; floor: string; shadowOpacity: number;
}
export const DARK_SKIN: RobotSkin = {
  outline: COLORS.outline, deepBlack: COLORS.deepBlack, graphite: COLORS.graphite, graphiteLight: COLORS.graphiteLight, primaryBlue: COLORS.primaryBlue, electricBlue: COLORS.electricBlue, cyan: COLORS.cyan, paleBlue: COLORS.paleBlue, textMuted: COLORS.textMuted,
  shellHighlight: SHADE.shellHighlight, shellMid: COLORS.graphiteLight, shellLow: COLORS.graphite, shellCore: SHADE.shellCore, shadeTop: 0.1, shadeBottom: 0.45,
  cylEdge: SHADE.cylEdge, cylLight: SHADE.cylLight, cylHighlight: SHADE.cylHighlight, cylMid: COLORS.graphite, cylLow: COLORS.black, cylRim: SHADE.cylRim,
  cylDarkEdge: SHADE.abyss, cylDarkMid: COLORS.graphite, cylDarkLight: SHADE.cylDarkLight, cylDarkShade: SHADE.cylDarkShade, cylDarkLow: SHADE.socket, cylDarkRim: SHADE.cylDarkRim,
  sphereHighlight: SHADE.sphereHighlight, sphereMid: COLORS.graphiteLight, sphereLow: COLORS.graphite, socket: SHADE.socket,
  ledCore: SHADE.ledCore, ledMid: COLORS.cyan, ledOuter: COLORS.electricBlue, ledEdge: COLORS.primaryBlue, ledBlueCore: SHADE.ledBlueCore, ledBlueEdge: SHADE.ledBlueEdge,
  eyeHigh: SHADE.eyeHigh, eyeMid: COLORS.cyan, eyeLow: SHADE.eyeLow, pupil: COLORS.primaryBlue, lid: '#081120', brow: COLORS.paleBlue, cheek: COLORS.paleBlue, mouth: COLORS.cyan,
  screenTop: '#0a1426', screenBottom: COLORS.deepBlack, screenEdge: COLORS.electricBlue, bevelTop: SHADE.void, bevelMid: SHADE.bevelMid, bevelLip: SHADE.bevelLip, insetOpacity: 0.75,
  chestBg: COLORS.deepBlack, chestRing: COLORS.graphiteLight, bootTop: SHADE.bootTop, bootMid: COLORS.graphite, bootLow: SHADE.abyss, headStripe: COLORS.paleBlue,
  ambient: COLORS.primaryBlue, ambientOpacity: 0.28, ambientFade: COLORS.deepBlack, floor: COLORS.primaryBlue, shadowOpacity: 1,
};
export const LIGHT_SKIN: RobotSkin = {
  outline: '#4a6fa5', deepBlack: '#e6effa', graphite: '#dfe9f6', graphiteLight: '#eef4fb', primaryBlue: '#2f7bf6', electricBlue: '#4c9bff', cyan: '#3ab8f5', paleBlue: '#8cc4ff', textMuted: '#94a3b8',
  shellHighlight: '#ffffff', shellMid: '#f7faff', shellLow: '#e4edf8', shellCore: '#c4d6ec', shadeTop: 0.35, shadeBottom: 0.12,
  cylEdge: '#9fc3ee', cylLight: '#cfe4fb', cylHighlight: '#f2f8ff', cylMid: '#b9d6f6', cylLow: '#93bbe9', cylRim: '#6fa6e6',
  cylDarkEdge: '#88b3e6', cylDarkMid: '#a8cbf2', cylDarkLight: '#d6e8fc', cylDarkShade: '#94bdeb', cylDarkLow: '#7eaae0', cylDarkRim: '#5f97da',
  sphereHighlight: '#ffffff', sphereMid: '#e3effc', sphereLow: '#b3d1f3', socket: '#a9c6ea',
  ledCore: '#ffffff', ledMid: '#7cd3ff', ledOuter: '#4c9bff', ledEdge: '#2f7bf6', ledBlueCore: '#eaf4ff', ledBlueEdge: '#3b82f6',
  eyeHigh: '#7cc6ff', eyeMid: '#3b8df5', eyeLow: '#1f5fd6', pupil: '#0f2f6b', lid: '#dcebfb', brow: '#2f6fd6', cheek: '#ffb3c7', mouth: '#2f7bf6',
  screenTop: '#f4f9ff', screenBottom: '#cfe2f8', screenEdge: '#7fb4f2', bevelTop: '#a9c3e4', bevelMid: '#d3e3f6', bevelLip: '#ffffff', insetOpacity: 0.12,
  chestBg: '#eaf3fe', chestRing: '#b6d2f2', bootTop: '#ffffff', bootMid: '#dce9f8', bootLow: '#a9c6ea', headStripe: '#ffffff',
  ambient: '#7cc0ff', ambientOpacity: 0.35, ambientFade: '#ffffff', floor: '#4c9bff', shadowOpacity: 0.4,
};
export const skinFor = (theme: 'dark' | 'light'): RobotSkin => (theme === 'light' ? LIGHT_SKIN : DARK_SKIN);
