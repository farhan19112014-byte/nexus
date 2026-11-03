// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { COLOUR_LIBRARY, NEXUS_ACCENT, NEXUS_PRIMARY, classify, contrastReport, generateTheme, mapColour } from '../../theme/palette';
import { BASE_COLOURS } from '../../theme/paletteBase';
import { channels, contrastRatio, hexToOklch, normHex } from '../../theme/colour';
import { applyPalette, cachedPalette, currentPalette, validPalette } from '../../theme/studio';
import { SettingsSchema, PERSONALIZATION_KEYS } from '../../memory/store';
import { routeFor } from '../../router';

const CSS = ['src/components/styles.css', 'src/components/app-theme.css', 'src/components/depth.css', 'src/components/workspace.css', 'src/site/site.css', 'src/space/space.css', 'src/holobuild/holobuild.css', 'src/theme/studio.css', 'index.html'];
const hueDist = (x: number, y: number) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };

describe('Colour Studio — theme generation', () => {
  it('[A143] every --k-* channel a stylesheet uses is a known, re-mappable brand colour with a default value', () => {
    const defaults = readFileSync('src/theme/palette.css', 'utf8');
    for (const f of CSS) for (const m of readFileSync(f, 'utf8').matchAll(/--k-([0-9a-f]{6})/g)) {
      expect(BASE_COLOURS, `${f} uses --k-${m[1]}`).toContain(`#${m[1]}`);
      expect(defaults).toContain(`--k-${m[1]}: ${channels(`#${m[1]}`)};`);
    }
    for (const h of BASE_COLOURS) expect(classify(h), h).not.toBeNull();
  });

  it('[A143] the library has at least 40 distinct, valid colours across the spectrum, neutrals and metallics', () => {
    expect(COLOUR_LIBRARY.length).toBeGreaterThanOrEqual(40);
    expect(new Set(COLOUR_LIBRARY.map((c) => c.hex)).size).toBe(COLOUR_LIBRARY.length);
    for (const c of COLOUR_LIBRARY) expect(normHex(c.hex)).toBe(c.hex);
    const names = COLOUR_LIBRARY.map((c) => c.name.toLowerCase()).join(' ');
    for (const n of ['red', 'orange', 'yellow', 'green', 'mint', 'cyan', 'blue', 'navy', 'purple', 'pink', 'rose', 'brown', 'grey', 'black', 'white', 'gold']) expect(names).toContain(n);
  });

  it('[A143] the NEXUS pair reproduces the original design exactly (no drift in the default look)', () => {
    const t = generateTheme({ a: NEXUS_PRIMARY, b: NEXUS_ACCENT });
    for (const h of BASE_COLOURS) expect(t.vars[`--k-${h.slice(1)}`], h).toBe(channels(h));
    expect(t.spaceFilter).toBe('hue-rotate(0deg) saturate(1.00)');
  });

  it('[A143] every pair from the library keeps all design text pairs readable (WCAG AA) in dark and light mode', () => {
    let checked = 0;
    for (const a of COLOUR_LIBRARY) for (const b of COLOUR_LIBRARY) {
      if (a === b) continue;
      for (const r of contrastReport({ a: a.hex, b: b.hex })) { checked++; if (!r.ok) expect.fail(`${a.name} + ${b.name}: ${r.label} ${r.ratio.toFixed(2)}`); }
    }
    expect(checked).toBeGreaterThan(30_000);
  });

  it('[A143] both colours stay recognisable: primary follows colour 1, accent colour 2 — not a muddy mix', () => {
    for (const [a, b] of [['#ef4444', '#facc15'], ['#22c55e', '#ec4899'], ['#8b5cf6', '#f97316'], ['#14b8a6', '#d4af37']]) {
      const t = generateTheme({ a, b });
      expect(hueDist(hexToOklch(t.roles.primary)[2], hexToOklch(a)[2])).toBeLessThan(6);
      expect(hueDist(hexToOklch(t.roles.accent)[2], hexToOklch(b)[2])).toBeLessThan(6);
      expect(hueDist(hexToOklch(t.roles.primary)[2], hexToOklch(t.roles.accent)[2])).toBeGreaterThan(20);
      // a bright accent is used as is
      if (hexToOklch(b)[0] >= 0.74 && hexToOklch(b)[0] <= 0.97) expect(t.roles.accent).toBe(b);
    }
    // backgrounds are tinted by colour 1 but stay dark/light; achromatic choices give neutral greys
    const g = generateTheme({ a: '#0a0a0a', b: '#ffffff' });
    expect(hexToOklch(g.roles.bgDark)[1]).toBeLessThan(0.006); expect(hexToOklch(g.roles.primary)[1]).toBeLessThan(0.006);
    expect(contrastRatio(g.roles.textDark, g.roles.bgDark)).toBeGreaterThan(15);
  });

  it('[A143] status colours and pure neutrals keep their meaning', () => {
    for (const h of ['#34d399', '#fbbf24', '#f87171', '#8b5cf6', '#ffffff', '#000000', '#333333']) expect(mapColour(h, { a: '#ef4444', b: '#facc15' })).toBe(h);
  });

  it('[A143] the generated stylesheet only contains channel values (safe to cache and inject before first paint)', () => {
    const { css } = generateTheme({ a: '#dc143c', b: '#ff77aa' });
    expect(css).toMatch(/^:root\[data-palette="custom"\]\{[-\w:; ./()]+\}$/);
    expect(readFileSync('index.html', 'utf8')).toContain('/^:root\\[data-palette="custom"\\]\\{[-\\w:; ./()]+\\}$/');
  });
});

describe('Colour Studio — applying and remembering', () => {
  beforeEach(() => { applyPalette(null); localStorage.clear(); });

  it('[A143] apply sets the theme on the whole document and caches it; reset restores the original NEXUS theme', () => {
    applyPalette({ a: '#DC143C', b: '#f7a' });
    expect(document.documentElement.dataset.palette).toBe('custom');
    expect(document.getElementById('nexus-palette')?.textContent).toContain('--k-1268f5:');
    expect(currentPalette()).toEqual({ a: '#dc143c', b: '#ff77aa' });
    expect(cachedPalette()).toEqual({ a: '#dc143c', b: '#ff77aa' });
    expect(localStorage.getItem('nexus-palette-css')).toBe(generateTheme({ a: '#dc143c', b: '#ff77aa' }).css);
    applyPalette(null);
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.getElementById('nexus-palette')).toBeNull();
    expect(localStorage.getItem('nexus-palette')).toBeNull();
  });

  it('[A143] exactly two different valid colours are required; bad input never applies', () => {
    expect(validPalette({ a: '#123456', b: '#123456' })).toBeNull();
    expect(validPalette({ a: 'red', b: '#fff' })).toBeNull();
    expect(validPalette({ a: '#abc' })).toBeNull();
    applyPalette({ a: '#zzzzzz', b: '#ffffff' });
    expect(document.documentElement.dataset.palette).toBeUndefined();
    localStorage.setItem('nexus-palette', '{not json'); expect(cachedPalette()).toBeNull();
  });

  it('[A143] the choice is a validated, personalisable setting (reset personalisation restores NEXUS colours)', () => {
    expect(SettingsSchema.parse({}).palette).toBeNull();
    expect(SettingsSchema.parse({ palette: { a: '#dc143c', b: '#ff77aa' } }).palette).toEqual({ a: '#dc143c', b: '#ff77aa' });
    expect(SettingsSchema.parse({ palette: { a: 'javascript:', b: '#ff77aa' } }).palette).toBeNull();
    expect(SettingsSchema.parse({ palette: { a: '#ff77aa', b: '#ff77aa' } }).palette).toBeNull();
    expect(PERSONALIZATION_KEYS).toContain('palette');
    expect(routeFor('/studio')).toBe('studio');
  });
});

describe('Colour Studio — the robot follows the theme', () => {
  it('[A143] without a theme (or with the NEXUS pair) the robot is exactly the original', async () => {
    const { SKIN_3D, skin3d } = await import('../../character3d/skins3d');
    const { themeSkin } = await import('../../theme/robotSkin');
    const { skinFor } = await import('../../character/tokens');
    expect(skin3d('dark', null)).toBe(SKIN_3D.dark);
    expect(themeSkin(skinFor('light'), null)).toEqual(skinFor('light'));
    expect(skin3d('dark', { a: NEXUS_PRIMARY, b: NEXUS_ACCENT })).toEqual(SKIN_3D.dark);
  });

  it('[A143] with a theme: face/lights take the accent, the body a visible primary tint; status and pure white stay', async () => {
    const { skin3d } = await import('../../character3d/skins3d');
    const { robotColour } = await import('../../theme/robotSkin');
    const p = { a: '#dc143c', b: '#d4af37' };
    const k = skin3d('dark', p);
    expect(k.materials.NX_Eye.emissive).toBe('#d4af37');                                         // cyan face → accent
    const shell = hexToOklch(k.materials.NX_Shell.color), red = hexToOklch(p.a);
    expect(shell[1]).toBeGreaterThan(0.05); expect(hueDist(shell[2], red[2])).toBeLessThan(3);    // a clearly red body
    expect(Math.abs(shell[0] - hexToOklch('#2a3446')[0])).toBeLessThan(0.01);                    // same lightness as the original shell
    for (const h of ['#34d399', '#fbbf24', '#f87171', '#ffffff']) expect(robotColour(h, p)).toBe(h);
    expect(hexToOklch(robotColour('#2a3446', { a: '#0a0a0a', b: '#ffffff' }))[1]).toBeLessThan(0.006); // black primary → neutral robot
  });
});
