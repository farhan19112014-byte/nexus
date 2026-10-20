// @vitest-environment happy-dom
/**
 * [A118] master-prompt pass: failure containment (error boundaries), one consistent icon set (no emoji icons),
 * skill lifecycle wording, and the per-reply read-aloud control.
 */
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ICON_PATHS } from '../../components/Icon';
import { statusLabel } from '../../components/SkillsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('[A118] failure containment and interface consistency', () => {
  it('[A118] an error in one area shows an honest notice, leaves siblings working, and "Try again" recovers', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const Bomb = () => { if (broken) throw new Error('rig exploded'); return <p id="ok">robot back</p>; };
    const el = document.createElement('div'); document.body.append(el);
    const root = createRoot(el);
    await act(async () => { root.render(<div><ErrorBoundary area="robot view" compact><Bomb /></ErrorBoundary><textarea id="composer" /></div>); });
    expect(el.querySelector('[data-testid=crash]')?.textContent).toMatch(/robot view hit an unexpected error/);
    expect(el.querySelector('#composer')).not.toBeNull();           // the chat composer is still there
    broken = false;
    await act(async () => { (el.querySelector('[data-testid=crash] button') as HTMLButtonElement).click(); });
    expect(el.querySelector('#ok')?.textContent).toBe('robot back');
    await act(async () => { root.unmount(); }); err.mockRestore();
  });

  it('[A118] interface icons come from the one SVG icon set — no emoji or pictograph glyphs used as icons', () => {
    const dirs = ['src/components', 'src/site'];
    const offenders: string[] = [];
    // pictographs and the dingbat/arrow glyphs previously used as button icons
    const bad = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{23E9}-\u{23FA}\u{2B00}-\u{2BFF}\u{2630}\u{25A0}\u{25B6}\u{21BB}\u{27F2}\u{270E}\u{2726}\u{2715}\u{FF0B}]/u;
    for (const d of dirs) for (const f of readdirSync(d).filter((x) => x.endsWith('.tsx'))) {
      readFileSync(`${d}/${f}`, 'utf8').split('\n').forEach((line, i) => { if (bad.test(line)) offenders.push(`${f}:${i + 1}`); });
    }
    expect(offenders).toEqual([]);
    for (const n of ['play', 'stop', 'close', 'menu', 'plus', 'eye', 'retry', 'reset', 'alarm', 'timer', 'download', 'mute', 'mic', 'pen'] as const) expect(ICON_PATHS[n]).toMatch(/^M/);
  });

  it('[A118] skill badges use the lifecycle words from the spec, without changing stored statuses', () => {
    expect(statusLabel('proposed', true)).toBe('awaiting approval');
    expect(statusLabel('proposed', false)).toBe('failed validation');
    expect(statusLabel('failed')).toBe('failed validation');
    expect(statusLabel('approved')).toBe('approved');
    expect(statusLabel('rejected')).toBe('rejected');
    expect(statusLabel('deprecated')).toBe('unavailable');
    expect(statusLabel('builtin')).toBe('built-in');
  });
});
