// @vitest-environment happy-dom
/**
 * [A123] light mode: the classic dark NEXUS stays exactly as it was; the light theme shows a white and light-blue
 * NEXUS (same rig, same parts, only colours); one click switches and the robot follows the page theme live.
 */
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Robot } from '../../character/Robot';
import { COLORS, DARK_SKIN, LIGHT_SKIN, SHADE, contrast } from '../../character/tokens';
import { ThemeToggle } from '../../components/ThemeToggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const hexes = (h: string) => new Set((h.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((x) => x.toLowerCase()));
const parts = (h: string) => [...h.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);

describe('[A123] light and dark robot', () => {
  it('[A123] the dark skin is the classic palette, unchanged', () => {
    const classic = new Set([...Object.values(COLORS), ...Object.values(SHADE), '#ffffff', '#000000', '#0a1426', '#081120'].map((c) => c.toLowerCase()));
    for (const v of Object.values(DARK_SKIN)) if (typeof v === 'string') expect(classic.has(v.toLowerCase()), v).toBe(true);
  });
  it('[A123] the light robot uses only light-skin colours, keeps every part, and is labelled as the white and light-blue NEXUS', () => {
    const dark = renderToStaticMarkup(<Robot skin="dark" />); const light = renderToStaticMarkup(<Robot skin="light" />);
    expect(parts(light)).toEqual(parts(dark));                                   // same rig: same parts in the same order
    const allowed = new Set([...Object.values(LIGHT_SKIN).filter((v): v is string => typeof v === 'string'), '#ffffff', '#000000', ...Object.values(COLORS)].map((c) => c.toLowerCase()));
    for (const x of hexes(light)) expect(allowed.has(x), x).toBe(true);
    for (const x of [DARK_SKIN.graphite, DARK_SKIN.screenTop, SHADE.shellCore]) expect(hexes(light).has(x.toLowerCase()), x).toBe(false);   // no dark shell left
    expect(light).toContain('data-skin="light"'); expect(light).toMatch(/aria-label="NEXUS, a small white and light-blue robot"/);
    expect(dark).toContain('data-skin="dark"'); expect(dark).toMatch(/aria-label="NEXUS, a small blue and black robot"/);
  });
  it('[A123] light-skin face features stay clearly visible on the pale screen', () => {
    expect(contrast(LIGHT_SKIN.eyeLow, LIGHT_SKIN.screenBottom)).toBeGreaterThan(4);
    expect(contrast(LIGHT_SKIN.mouth, LIGHT_SKIN.screenTop)).toBeGreaterThan(3);
    expect(contrast(LIGHT_SKIN.brow, LIGHT_SKIN.screenTop)).toBeGreaterThan(4);
    expect(contrast(LIGHT_SKIN.pupil, LIGHT_SKIN.eyeMid)).toBeGreaterThan(3);
  });
  it('[A123] the toggle switches the page theme and the robot re-colours itself live', async () => {
    document.documentElement.dataset.theme = 'dark';
    const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
    await act(async () => { root.render(<><ThemeToggle /><Robot /></>); });
    const btn = () => el.querySelector('[data-testid=theme-toggle]') as HTMLButtonElement;
    expect(btn().getAttribute('aria-label')).toBe('Switch to light mode'); expect(el.querySelector('svg[role=img]')!.getAttribute('data-skin')).toBe('dark');
    await act(async () => { btn().click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(el.querySelector('svg[role=img]')!.getAttribute('data-skin')).toBe('light'); expect(btn().getAttribute('aria-label')).toBe('Switch to dark mode');
    await act(async () => { btn().click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(el.querySelector('svg[role=img]')!.getAttribute('data-skin')).toBe('dark');
    await act(async () => { root.unmount(); });
  });
});
