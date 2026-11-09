// @vitest-environment happy-dom
/**
 * [A123] light mode: the classic dark NEXUS palette stays exactly as it was; the light theme has its own white and
 * light-blue skin (used by the 3D robot's materials); one click switches the page theme.
 */
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { COLORS, DARK_SKIN, LIGHT_SKIN, SHADE, contrast } from '../../character/tokens';
import { ThemeToggle } from '../../components/ThemeToggle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('[A123] light and dark robot', () => {
  it('[A123] the dark skin is the classic palette, unchanged', () => {
    const classic = new Set([...Object.values(COLORS), ...Object.values(SHADE), '#ffffff', '#000000', '#0a1426', '#081120'].map((c) => c.toLowerCase()));
    for (const v of Object.values(DARK_SKIN)) if (typeof v === 'string') expect(classic.has(v.toLowerCase()), v).toBe(true);
  });
  it('[A123] light-skin face features stay clearly visible on the pale screen', () => {
    expect(contrast(LIGHT_SKIN.eyeLow, LIGHT_SKIN.screenBottom)).toBeGreaterThan(4);
    expect(contrast(LIGHT_SKIN.mouth, LIGHT_SKIN.screenTop)).toBeGreaterThan(3);
    expect(contrast(LIGHT_SKIN.brow, LIGHT_SKIN.screenTop)).toBeGreaterThan(4);
    expect(contrast(LIGHT_SKIN.pupil, LIGHT_SKIN.eyeMid)).toBeGreaterThan(3);
  });
  it('[A123] the toggle switches the page theme', async () => {
    document.documentElement.dataset.theme = 'dark';
    const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
    await act(async () => { root.render(<ThemeToggle />); });
    const btn = () => el.querySelector('[data-testid=theme-toggle]') as HTMLButtonElement;
    expect(btn().getAttribute('aria-label')).toBe('Switch to light mode');
    await act(async () => { btn().click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(btn().getAttribute('aria-label')).toBe('Switch to dark mode');
    await act(async () => { btn().click(); await new Promise((r) => setTimeout(r, 20)); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await act(async () => { root.unmount(); });
  });
});
