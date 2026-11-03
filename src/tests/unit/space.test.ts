import { describe, expect, it } from 'vitest';
import { SpaceScene, rng, shapeEdges } from '../../space/spaceScene';
import { initialQuality } from '../../space/SpaceField';

const scene = (q: 'high' | 'medium' | 'low' = 'high', w = 1440, h = 900) => { const s = new SpaceScene({ focus: 'right', quality: q, theme: 'dark' }); s.resize(w, h); return s; };
/** an angle difference without the 2π wrap */
const dAng = (a: number, b: number) => Math.abs(a - b);

describe('Space environment', () => {
  it('[A141] deterministic and bounded: same layout on every load; object counts scale with quality and screen size', () => {
    expect(scene().snapshot()).toEqual(scene().snapshot());
    expect(scene('high').snapshot().stars).toBeGreaterThan(scene('low').snapshot().stars);
    expect(scene('high', 390, 844).snapshot().dust.length).toBeLessThan(scene('high').snapshot().dust.length);
    expect(scene('low', 390, 844).snapshot().dust.length).toBeLessThanOrEqual(14);
    expect(scene('low').snapshot().belt.length).toBeLessThan(scene('high').snapshot().belt.length);
    expect([shapeEdges('octa'), shapeEdges('cube'), shapeEdges('icosa')]).toEqual([12, 12, 30]);
    const r = rng(5); const xs = Array.from({ length: 1000 }, r); expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('[A141] smooth, continuous motion on orbits in both directions; dust only wraps off-screen; shooting stars are occasional; long pauses are clamped', () => {
    const s = scene(); let wraps = 0; let meteors = 0;
    const dir = s.snapshot().orbits; s.step(0.5); const after = s.snapshot().orbits; let prev = s.snapshot(); const signs = after.map((a, i) => Math.sign(a - dir[i]));
    expect(signs).toContain(1); expect(signs).toContain(-1);                       // orbits turn in different directions
    for (let i = 0; i < 40 * 60; i++) {                                              // one minute at 40 fps
      s.step(1 / 40); const now = s.snapshot();
      now.orbits.forEach((a, k) => expect(dAng(a, prev.orbits[k])).toBeLessThan(0.02));
      now.belt.forEach((a, k) => expect(dAng(a, prev.belt[k])).toBeLessThan(0.01));
      now.dust.forEach((p, k) => { const d = Math.hypot(p[0] - prev.dust[k][0], p[1] - prev.dust[k][1]); if (d > 0.05) { wraps++; expect(p[1] > 1 || p[0] < 0 || p[0] > 1 || prev.dust[k][1] < 0).toBe(true); } });
      if (now.meteor && !prev.meteor) meteors++;
      prev = now;
    }
    expect(wraps).toBeGreaterThan(0); expect(meteors).toBeGreaterThanOrEqual(2); expect(meteors).toBeLessThanOrEqual(6);
    const o0 = s.snapshot().orbits; s.step(30); expect(dAng(s.snapshot().orbits[0], o0[0])).toBeLessThan(0.1);   // a 30 s stall moves things by at most 0.1 s
  });

  it('[A141] interaction: the camera eases toward the pointer, dust near the pointer is pushed aside and springs back, the robot\'s mood changes the environment', () => {
    const s = scene(); s.pointer(1, 1); s.step(1 / 40); const p1 = s.snapshot().parallax; expect(p1[0]).toBeGreaterThan(0); expect(p1[0]).toBeLessThan(0.1);
    for (let i = 0; i < 200; i++) s.step(1 / 40); expect(s.snapshot().parallax[0]).toBeCloseTo(1, 2);
    // proximity: put the pointer on a dust mote; its offset grows, then decays once the pointer leaves
    const d0 = (s as unknown as { dust: { p: number[]; ox: number; oy: number }[] }).dust[0];
    s.pointer(0, 0, { x: d0.p[0] * s.w + 20, y: d0.p[1] * s.h }); for (let i = 0; i < 20; i++) s.step(1 / 40);
    const pushed = Math.hypot(d0.ox, d0.oy); expect(pushed).toBeGreaterThan(5);
    s.pointer(0, 0, null); for (let i = 0; i < 200; i++) s.step(1 / 40); expect(Math.hypot(d0.ox, d0.oy)).toBeLessThan(pushed * 0.1);
    s.setMood('thinking'); for (let i = 0; i < 120; i++) s.step(1 / 40); expect(s.snapshot().speedK).toBeGreaterThan(1.5);
    s.setMood('idle'); for (let i = 0; i < 200; i++) s.step(1 / 40); expect(s.snapshot().speedK).toBeCloseTo(1, 1);
  });

  it('[A141] quality follows the device: phones and 2-core machines start low, wide multi-core screens high', () => {
    expect(initialQuality(390, 8)).toBe('low'); expect(initialQuality(1440, 2)).toBe('low'); expect(initialQuality(900, 8)).toBe('medium'); expect(initialQuality(1600, 8)).toBe('high');
  });
});
