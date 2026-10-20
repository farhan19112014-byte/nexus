import { describe, expect, it } from 'vitest';
import { ExpressionController } from '../../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { validateExpression } from '../../skills/validator';
import { BUILTIN_MOTIONS } from '../../animation/builtinMotions';
import { ExpressionPresetSchema } from '../../../shared/schema';

const lookup = (id: string) => BUILTIN_MOTIONS.find((m) => m.id === id);
const X = () => new ExpressionController(BUILTIN_EXPRESSIONS);
const settle = (x: ExpressionController, s = 2) => { for (let t = 0; t < s; t += 1 / 60) x.update(1 / 60); return x.targets(); };
const P = (id: string) => BUILTIN_EXPRESSIONS.find((e) => e.id === id)!;

describe('Category B — expressions', () => {
  it('[A11] happy: cheerful eyes, smile, gentle idle motion that exists', () => {
    const f = settle((() => { const x = X(); x.set('response', 'happy'); return x; })());
    expect(f['eyes.happy']!).toBeGreaterThan(0.7); expect(f['mouth.curve']!).toBeGreaterThan(0.8);
    expect(lookup(P('happy').idleMotion!)).toBeDefined();
  });
  it('[A12] curious: asymmetric eyes and head tilt, with a smooth (non-instant) transition', () => {
    const x = X(); x.set('response', 'curious'); x.update(0.05);
    const mid = x.targets()['eyeR.open']!; expect(mid).toBeGreaterThan(0.72); expect(mid).toBeLessThan(1);
    const f = settle(x); expect(f['eyeR.open']).not.toBeCloseTo(f['eyeL.open']!); expect(x.headOffset().rot).toBeGreaterThan(5);
  });
  it('[A13] surprised cannot override an urgent error alert', () => {
    const x = X(); x.set('system', 'error'); x.set('reaction', 'surprised', 1, 1); expect(x.current()).toBe('error');
    x.release('system'); expect(x.current()).toBe('surprised'); settle(x, 1.2); expect(x.current()).toBe('neutral');
  });
  it('[A14] thinking preset: focused, glancing up, slower blinks', () => {
    expect(P('thinking').face['pupil.y']).toBeLessThan(0); expect(P('thinking').blinkRate).toBeLessThan(1);
  });
  it('[A15] confused: mismatched brows and tilt', () => { const f = P('confused').face; expect(Math.sign(f['browL.tilt']!)).not.toBe(Math.sign(f['browR.tilt']!)); expect(P('confused').head.rot).not.toBe(0); });
  it('[A16] concerned: gentle frown, dimmer face, slower motion', () => { const p = P('concerned'); expect(p.face['mouth.curve']).toBeLessThan(0); expect(p.transitionMs).toBeGreaterThan(300); expect(p.blinkRate).toBeLessThan(1); });
  it('[A17] determined: focused eyes, firm brows', () => { const f = P('determined').face; expect(f['browL.tilt']).toBeGreaterThan(0); expect(f['eyeL.open']).toBeLessThan(1); });
  it('[A18] playful can be disabled (falls back to happy)', () => {
    const x = X(); x.allowPlayful = false; x.set('response', 'playful'); expect(x.current()).toBe('happy');
    const y = X(); y.set('response', 'playful'); expect(y.current()).toBe('playful');
  });
  it('[A19] resting: relaxed lids, slow blink, lowest priority so any state wakes it', () => {
    const x = X(); x.set('system', 'resting', 1, null, 0); expect(x.current()).toBe('resting'); expect(x.blinkRate()).toBeLessThan(0.5);
    x.set('response', 'happy'); expect(x.current()).toBe('happy');
  });
  it('[A20] presets are versioned, schema-valid and pass validation; registry supports new presets', () => {
    for (const e of BUILTIN_EXPRESSIONS) { expect(ExpressionPresetSchema.safeParse(e).success).toBe(true); expect(e.version).toBe(1); expect(validateExpression(e, { origin: 'builtin', lookup }).report.ok, e.id).toBe(true); }
    const x = X(); x.register({ ...P('happy'), id: 'beaming', name: 'Beaming' }); expect(x.set('user', 'beaming')).toBe(true); expect(x.set('user', 'nope')).toBe(false);
  });
});
