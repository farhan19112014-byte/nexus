import { describe, it, expect, vi } from 'vitest';
import { AnimationEngine } from '../../animation/engine';
import { ExpressionController } from '../../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { CharacterRuntime } from '../../core/characterRuntime';

let fail = true;
vi.mock('../../character3d/body3d', async (orig) => { if (fail) throw new Error('chunk failed to load'); return orig(); });

describe('[A99] the 3D body animation loads on demand', () => {
  it('[A99] a failed download keeps the placeholder (no crash) and a later attempt can succeed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rt = new CharacterRuntime(new AnimationEngine(), new ExpressionController(BUILTIN_EXPRESSIONS));
    expect(await rt.loadBody()).toBe(false); expect(rt.bodyReady).toBe(false);
    rt.step(1 / 60); expect(rt.body.current()).toBe(null);
    fail = false; vi.resetModules();
    const p = rt.loadBody(); expect(rt.loadBody()).toBe(p);          // one shared load, never two
    expect(await p).toBe(true); expect(rt.bodyReady).toBe(true);
    warn.mockRestore();
  });
});
