// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { existsSync } from 'node:fs';
import { Robot, type RigHandle, DEFAULT_ACCESSORIES } from '../../character/Robot';
import { COLORS, SHADE, STROKES, contrast } from '../../character/tokens';
import { GEOMETRY, armFK, DEFORMATION } from '../../character/geometry';
import { POSE_LIBRARY } from '../../character/poses';
import { checkConsistency } from '../../character/consistency';
import { CHANNELS, restPose, type Channel } from '../../../shared/channels';
import { ASSETS } from '../../assets/registry';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const html = (p: Parameters<typeof Robot>[0] = {}) => renderToStaticMarkup(<Robot {...p} />);
function mount(p: Parameters<typeof Robot>[0] = {}) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const ref = createRef<RigHandle>(); const root = createRoot(el);
  act(() => root.render(<Robot ref={ref} {...p} />));
  return { el, ref, unmount: () => act(() => root.unmount()) };
}

describe('Category A — character identity', () => {
  it('[A01] renders the complete original character (head, torso, arms, legs, face) as one SVG', () => {
    const h = html();
    for (const part of ['head', 'torso', 'arm-L', 'arm-R', 'leg-L', 'leg-R', 'face', 'antenna']) expect(h).toContain(`data-part="${part}"`);
    expect(h).toContain('role="img"');
  });
  it('[A02] colours come from one token set and text meets WCAG contrast', () => {
    expect(contrast(COLORS.text, COLORS.deepBlack)).toBeGreaterThan(7);
    expect(contrast(COLORS.textMuted, COLORS.deepBlack)).toBeGreaterThan(4.5);
    expect(contrast(COLORS.textMuted, COLORS.graphite)).toBeGreaterThan(4.5);
    const h = html(); const hexes = new Set(h.match(/#[0-9a-fA-F]{6}\b/g) ?? []);
    const allowed = new Set([...Object.values(COLORS), ...Object.values(SHADE)].map((c) => c.toLowerCase()).concat(['#ffffff', '#000000', '#0a1426', '#081120']));
    for (const x of hexes) expect(allowed.has(x.toLowerCase()), x).toBe(true);
  });
  it('[A06] 3D shading: shell, limbs and joints use volume gradients; glass, rim light and contact shadow are present', () => {
    const h = html();
    for (const g of ['shell-', 'cyl-', 'cylDark-', 'sphere-', 'led-', 'eyeLed-']) expect(h).toMatch(new RegExp(`fill="url\\(#${g}`));
    for (const p of ['rim-light', 'specular', 'screen-bevel', 'screen-glass', 'head-shadow', 'shadow', 'lens-glint']) expect(h).toContain(`data-part="${p}"`);
    // shading never hides the face: the glass layer sits above the face but is non-interactive and translucent
    expect(h).toMatch(/data-part="screen-glass" pointer-events="none"/);
  });
  it('[A03] proportion system: anchors defined once; arm kinematics consistent with geometry', () => {
    const down = armFK('L', 0, 0); expect(down.hand.x).toBeCloseTo(GEOMETRY.torso.cx + GEOMETRY.shoulder.dx);
    const out = armFK('L', 90, 0); expect(out.hand.x).toBeGreaterThan(down.hand.x + 50); expect(Math.abs(out.hand.y - GEOMETRY.shoulder.y)).toBeLessThan(1);
    const outR = armFK('R', 90, 0); expect(outR.hand.x).toBeLessThan(GEOMETRY.torso.cx - 100);
    expect(DEFORMATION.squash.max).toBeLessThanOrEqual(CHANNELS['body.squash'].max);
  });
  it('[A04] facial components are separate and independently driven', () => {
    const { ref, el, unmount } = mount();
    const v = restPose();
    act(() => { ref.current!.apply({ ...v, 'eyeL.open': 0.2, 'eyeR.open': 1 }); });
    const eyes = el.querySelectorAll('[data-part^="eye-"] > rect');
    const hL = Number(el.querySelector('[data-part="eye-L"] > rect:not([data-part])')!.getAttribute('height'));
    const hR = Number(el.querySelector('[data-part="eye-R"] > rect:not([data-part])')!.getAttribute('height'));
    expect(eyes.length).toBeGreaterThanOrEqual(2); expect(hL).toBeLessThan(hR * 0.4);
    const before = el.querySelector('[data-part="mouth"]')!.getAttribute('d');
    act(() => { ref.current!.apply({ ...v, 'mouth.curve': -1 }); });
    expect(el.querySelector('[data-part="mouth"]')!.getAttribute('d')).not.toBe(before);
    for (const p of ['brow', 'eyelid', 'cheeks', 'forehead-indicator']) expect(el.querySelector(`[data-part="${p}"]`)).not.toBeNull();
    unmount();
  });
  it('[A05] pose library: every pose uses only rig channels inside their ranges', () => {
    for (const [name, pose] of Object.entries(POSE_LIBRARY)) for (const [ch, val] of Object.entries(pose)) {
      const d = CHANNELS[ch as Channel]; expect(d, `${name}.${ch}`).toBeDefined();
      expect(val!).toBeGreaterThanOrEqual(d.min); expect(val!).toBeLessThanOrEqual(d.max);
    }
    expect(Object.keys(POSE_LIBRARY)).toEqual(expect.arrayContaining(['neutral', 'standing', 'resting', 'sitting', 'leaning', 'crouching', 'waving', 'reaching']));
  });
  it('[A06] outlines use token widths and glow can be disabled for crisp output', () => {
    expect(html()).toContain(`stroke-width="${STROKES.outline}"`);
    expect(html({ effects: true })).toMatch(/filter="url\(#glow-/);
    expect(html({ effects: false })).not.toMatch(/filter="url\(#glow-/);
    expect(html()).toContain('viewBox="0 0 400 480"');
  });
  it('[A07] accessories toggle independently', () => {
    const all = html();
    for (const [k, part] of [['antenna', 'antenna'], ['sidePanels', 'side-panels'], ['chestLight', 'chest-light'], ['cheekLights', 'cheeks'], ['foreheadIndicator', 'forehead-indicator']] as const) {
      expect(all).toContain(`data-part="${part}"`);
      const off = html({ accessories: { ...DEFAULT_ACCESSORIES, [k]: false } });
      expect(off).not.toContain(`data-part="${part}"`);
      expect(off).toContain('data-part="head"');
    }
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
  it('[A09] environments: transparent, lab and grid; effects independently disabled', () => {
    expect(html({ environment: 'transparent' })).not.toContain('data-part="env"');
    expect(html({ environment: 'grid' })).toMatch(/fill="url\(#grid-/);
    expect(html({ environment: 'lab', effects: true })).toContain('data-part="ambient"');
    expect(html({ environment: 'lab', effects: false })).not.toContain('data-part="ambient"');
  });
  it('[A10] asset manifest: 119 unique assets (100 original + 19 website/identity/companion/desktop/voice) with required fields and existing paths', () => {
    expect(ASSETS).toHaveLength(119);
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(119);
    for (const a of ASSETS) {
      for (const k of ['id', 'name', 'category', 'type', 'version', 'compatibility', 'source', 'license', 'validation'] as const) expect(a[k], `${a.id}.${k}`).toBeTruthy();
      expect(a.tests.length, a.id).toBeGreaterThan(0);
      for (const p of a.paths) expect(existsSync(p), `${a.id}: ${p}`).toBe(true);
    }
  });
});
