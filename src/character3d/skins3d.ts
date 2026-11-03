/**
 * Colours of the 3D NEXUS per theme, by material name (NX_* in public/models/nexus.glb).
 * dark  = the classic NEXUS (same palette as the 2D robot: graphite shell, cyan face, electric-blue lights)
 * light = the light-theme NEXUS (white shell, light-blue limbs, pale glass screen with blue eyes) — matches LIGHT_SKIN.
 */
import { COLORS, DARK_SKIN, LIGHT_SKIN } from '../character/tokens';
import { themeSkin } from '../theme/robotSkin';
import type { Palette } from '../theme/palette';

interface Skin3D { materials: Record<string, { color: string; emissive?: string }>; /** emissive multipliers per material (light screens need stronger LEDs) */ glow: Record<string, number>; core: string; indicator: string; brow: string; floor: string; exposure: number }

export const SKIN_3D: Record<'dark' | 'light', Skin3D> = {
  dark: {
    materials: {
      NX_Shell: { color: COLORS.graphiteLight }, NX_Limb: { color: COLORS.graphite }, NX_Joint: { color: DARK_SKIN.cylDarkShade }, NX_Bezel: { color: DARK_SKIN.socket },
      NX_Screen: { color: '#07101f' }, NX_ChestPanel: { color: COLORS.deepBlack }, NX_Boot: { color: '#232c3d' }, NX_Lid: { color: '#081120' },
      // face LEDs: a near-black base + cyan emission, drawn without tone mapping, so the screen glows clean cyan (never washed to white)
      NX_Eye: { color: '#03161d', emissive: '#38D9FF' }, NX_Mouth: { color: '#03161d', emissive: '#38D9FF' }, NX_Brow: { color: '#06141c', emissive: COLORS.paleBlue },
      NX_Pupil: { color: COLORS.primaryBlue, emissive: '#0a2a80' }, NX_Cheek: { color: COLORS.paleBlue, emissive: COLORS.paleBlue },
      NX_LED_Blue: { color: COLORS.electricBlue, emissive: COLORS.electricBlue }, NX_Trim: { color: COLORS.electricBlue, emissive: COLORS.electricBlue }, NX_Accent: { color: COLORS.primaryBlue, emissive: COLORS.primaryBlue },
      NX_Antenna: { color: COLORS.cyan, emissive: COLORS.cyan },
    },
    glow: { NX_Eye: 1.6, NX_Mouth: 1.2, NX_Brow: 0.9 },
    core: COLORS.cyan, indicator: COLORS.electricBlue, brow: COLORS.paleBlue, floor: COLORS.primaryBlue, exposure: 1,
  },
  light: {
    materials: {
      NX_Shell: { color: '#e4edf8' }, NX_Limb: { color: LIGHT_SKIN.cylMid }, NX_Joint: { color: LIGHT_SKIN.socket }, NX_Bezel: { color: LIGHT_SKIN.bevelTop },
      NX_Screen: { color: '#cfe2f8' }, NX_ChestPanel: { color: LIGHT_SKIN.chestBg }, NX_Boot: { color: '#ffffff' }, NX_Lid: { color: '#dcebfb' },
      NX_Eye: { color: '#2b74f0', emissive: '#1d4ed8' }, NX_Mouth: { color: '#2563eb', emissive: '#1d4ed8' }, NX_Brow: { color: LIGHT_SKIN.brow, emissive: '#1a4fb0' },
      NX_Pupil: { color: LIGHT_SKIN.pupil, emissive: '#000000' }, NX_Cheek: { color: LIGHT_SKIN.cheek, emissive: LIGHT_SKIN.cheek },
      NX_LED_Blue: { color: LIGHT_SKIN.electricBlue, emissive: LIGHT_SKIN.electricBlue }, NX_Trim: { color: LIGHT_SKIN.screenEdge, emissive: LIGHT_SKIN.screenEdge }, NX_Accent: { color: LIGHT_SKIN.primaryBlue, emissive: LIGHT_SKIN.primaryBlue },
      NX_Antenna: { color: LIGHT_SKIN.ledMid, emissive: LIGHT_SKIN.ledMid },
    },
    glow: { NX_Eye: 0.35, NX_Mouth: 0.4, NX_Brow: 0.5, NX_Spark: 0.6 },
    core: LIGHT_SKIN.ledMid, indicator: LIGHT_SKIN.electricBlue, brow: LIGHT_SKIN.brow, floor: LIGHT_SKIN.floor, exposure: 0.8,
  },
};

/** the 3D skin in the applied Colour Studio theme (unchanged without one) */
const cache = new Map<string, Skin3D>();
export function skin3d(skin: 'dark' | 'light', p: Palette | null): Skin3D {
  if (!p) return SKIN_3D[skin];
  const key = `${skin}|${p.a}|${p.b}`;
  let v = cache.get(key); if (!v) { v = { ...themeSkin(SKIN_3D[skin], p), glow: SKIN_3D[skin].glow, exposure: SKIN_3D[skin].exposure }; cache.set(key, v); }
  return v;
}
