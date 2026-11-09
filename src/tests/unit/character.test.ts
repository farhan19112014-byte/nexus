import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { COLORS, contrast } from '../../character/tokens';
import { GEOMETRY, armFK, DEFORMATION } from '../../character/geometry';
import { POSE_LIBRARY } from '../../character/poses';
import { checkConsistency } from '../../character/consistency';
import { CHANNELS, type Channel } from '../../../shared/channels';
import { ASSETS } from '../../assets/registry';

describe('Category A — character identity', () => {
  it('[A02] colours come from one token set and text meets WCAG contrast', () => {
    expect(contrast(COLORS.text, COLORS.deepBlack)).toBeGreaterThan(7);
    expect(contrast(COLORS.textMuted, COLORS.deepBlack)).toBeGreaterThan(4.5);
    expect(contrast(COLORS.textMuted, COLORS.graphite)).toBeGreaterThan(4.5);
  });
  it('[A03] proportion system: anchors defined once; arm kinematics consistent with geometry', () => {
    const down = armFK('L', 0, 0); expect(down.hand.x).toBeCloseTo(GEOMETRY.torso.cx + GEOMETRY.shoulder.dx);
    const out = armFK('L', 90, 0); expect(out.hand.x).toBeGreaterThan(down.hand.x + 50); expect(Math.abs(out.hand.y - GEOMETRY.shoulder.y)).toBeLessThan(1);
    const outR = armFK('R', 90, 0); expect(outR.hand.x).toBeLessThan(GEOMETRY.torso.cx - 100);
    expect(DEFORMATION.squash.max).toBeLessThanOrEqual(CHANNELS['body.squash'].max);
  });
  it('[A05] pose library: every pose uses only rig channels inside their ranges', () => {
    for (const [name, pose] of Object.entries(POSE_LIBRARY)) for (const [ch, val] of Object.entries(pose)) {
      const d = CHANNELS[ch as Channel]; expect(d, `${name}.${ch}`).toBeDefined();
      expect(val!).toBeGreaterThanOrEqual(d.min); expect(val!).toBeLessThanOrEqual(d.max);
    }
    expect(Object.keys(POSE_LIBRARY)).toEqual(expect.arrayContaining(['neutral', 'standing', 'resting', 'sitting', 'leaning', 'crouching', 'waving', 'reaching']));
  });
  it('[A08] consistency rules flag broken poses and accept normal ones', () => {
    expect(checkConsistency({})).toEqual([]);
    expect(checkConsistency({ 'armR.raise': 116, 'armR.bend': 34 })).toEqual([]);
    expect(checkConsistency({ 'armR.raise': 110, 'armR.bend': 100 }).map((v) => v.code)).toContain('hand_on_face');
    expect(checkConsistency({ 'armR.raise': 140, 'armR.bend': 55, 'head.nod': 1, 'head.y': 8 }).map((v) => v.code)).toContain('hand_covers_eyes');
    expect(checkConsistency({ 'head.rot': 80 }).map((v) => v.code)).toContain('range');
    expect(checkConsistency({ 'legL.lift': 0.9, 'legR.lift': 0.9 }).map((v) => v.code)).toContain('no_support');
    expect(checkConsistency({ 'body.x': NaN }).map((v) => v.code)).toContain('nan');
  });
  it('[A10] asset manifest: 146 unique assets (100 original + 28 website/identity/companion/desktop/voice/gemini/elevenlabs/brain/light/hosting/3d/redesign/motion/reference + 4 HOLOBUILD + 4 learning + 4 interaction + space interface + live experience + colour studio + full-body motion + visual presenter + own voice) with required fields and existing paths', () => {
    expect(ASSETS).toHaveLength(146);
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(146);
    for (const a of ASSETS) {
      for (const k of ['id', 'name', 'category', 'type', 'version', 'compatibility', 'source', 'license', 'validation'] as const) expect(a[k], `${a.id}.${k}`).toBeTruthy();
      expect(a.tests.length, a.id).toBeGreaterThan(0);
      for (const p of a.paths) expect(existsSync(p), `${a.id}: ${p}`).toBe(true);
    }
  });
});
