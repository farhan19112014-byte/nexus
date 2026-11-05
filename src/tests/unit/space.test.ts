import { describe, expect, it } from 'vitest';
import { TechScene, rng } from '../../space/techScene';
import { initialQuality } from '../../space/SpaceField';

const scene = (q: 'high' | 'medium' | 'low' = 'high', w = 1440, h = 900) => { const s = new TechScene({ focus: 'right', quality: q, theme: 'dark' }); s.resize(w, h); return s; };

describe('Technology environment (replaces the planetary scene)', () => {
  it('[A141] deterministic and bounded: same layout on every load; counts scale with quality and screen size', () => {
    expect(scene().snapshot()).toEqual(scene().snapshot());
    const hi = scene('high').snapshot(), lo = scene('low').snapshot();
    expect(hi.nodes.length).toBeGreaterThan(lo.nodes.length); expect(hi.traces).toBeGreaterThan(lo.traces); expect(hi.motes.length).toBeGreaterThan(lo.motes.length);
    expect(scene('high', 390, 844).snapshot().nodes.length).toBeLessThan(hi.nodes.length);
    expect(scene('low', 390, 844).snapshot().nodes.length).toBeLessThanOrEqual(10);
    expect(hi.links).toBeGreaterThanOrEqual(hi.nodes.length);                       // a connected-looking network (2 nearest neighbours each)
    expect(hi.panels).toBe(3); expect(lo.panels).toBe(2);
    // the network lives in the right part of the robot page (the robot owns the left)
    expect(Math.min(...hi.nodes.map((n) => n[0]))).toBeGreaterThan(1440 * 0.45);
    const r = rng(5); const xs = Array.from({ length: 1000 }, r); expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThan(1);
  });

  it('[A141] calm, continuous motion: nodes drift on closed paths, motes wrap only off-screen, pulses and signals are occasional and few; long pauses are clamped', () => {
    const s = scene(); let prev = s.snapshot(); let wraps = 0, maxPulses = 0, maxSignals = 0, pulseStarts = 0;
    const start = prev.nodes.map((n) => [...n]);
    for (let i = 0; i < 40 * 60; i++) {                                              // one minute at 40 fps
      s.step(1 / 40); const now = s.snapshot();
      now.nodes.forEach((n, k) => expect(Math.hypot(n[0] - prev.nodes[k][0], n[1] - prev.nodes[k][1])).toBeLessThan(1.5));   // < 1.5 px per frame
      now.motes.forEach((m, k) => { if (Math.abs(m[1] - prev.motes[k][1]) > 0.5) { wraps++; expect(prev.motes[k][1]).toBeLessThan(0); } });
      if (now.pulses > prev.pulses) pulseStarts++;
      maxPulses = Math.max(maxPulses, now.pulses); maxSignals = Math.max(maxSignals, now.signals);
      prev = now;
    }
    expect(wraps).toBeGreaterThan(0);
    expect(pulseStarts).toBeGreaterThanOrEqual(4); expect(maxPulses).toBeLessThanOrEqual(5); expect(maxSignals).toBeLessThanOrEqual(4); expect(maxSignals).toBeGreaterThan(0);
    // drift stays within its small closed path around the base position
    prev.nodes.forEach((n, k) => expect(Math.hypot(n[0] - start[k][0], n[1] - start[k][1])).toBeLessThan(40));
    const n0 = s.snapshot().nodes[0]; s.step(30); const n1 = s.snapshot().nodes[0]; expect(Math.hypot(n1[0] - n0[0], n1[1] - n0[1])).toBeLessThan(3);   // a 30 s stall moves things by at most 0.1 s
  });

  it('[A141] interaction: the layers ease toward the pointer, nodes near the pointer light up and fade back, the robot\'s mood changes the environment', () => {
    const s = scene(); s.pointer(1, 1); s.step(1 / 40); const p1 = s.snapshot().parallax; expect(p1[0]).toBeGreaterThan(0); expect(p1[0]).toBeLessThan(0.1);
    for (let i = 0; i < 200; i++) s.step(1 / 40); expect(s.snapshot().parallax[0]).toBeCloseTo(1, 2);
    s.pointer(0, 0, null); for (let i = 0; i < 300; i++) s.step(1 / 40);
    const [x, y] = s.snapshot().nodes[0]; s.pointer(0, 0, { x, y }); for (let i = 0; i < 20; i++) s.step(1 / 40);
    const lit = s.snapshot().glow; expect(lit).toBeGreaterThan(0.5);
    s.pointer(0, 0, null); for (let i = 0; i < 200; i++) s.step(1 / 40); expect(s.snapshot().glow).toBeLessThan(lit * 0.1);
    s.setMood('thinking'); for (let i = 0; i < 120; i++) s.step(1 / 40); expect(s.snapshot().speedK).toBeGreaterThan(1.5);
    s.setMood('idle'); for (let i = 0; i < 200; i++) s.step(1 / 40); expect(s.snapshot().speedK).toBeCloseTo(1, 1);
  });

  it('[A141] the glass panels\' readouts change slowly and smoothly (no jumps)', () => {
    const s = scene(); let prev = s.snapshot().panelData;
    for (let i = 0; i < 40 * 20; i++) { s.step(1 / 40); const now = s.snapshot().panelData; now.forEach((d, p) => { if (p > 0) d.forEach((v, k) => expect(Math.abs(v - prev[p][k])).toBeLessThan(0.06)); else expect(Math.abs(d[d.length - 1] - prev[p][d.length - 1])).toBeLessThan(0.06); }); prev = now; }
  });

  it('[A141] quality follows the device: phones and 2-core machines start low, wide multi-core screens high', () => {
    expect(initialQuality(390, 8)).toBe('low'); expect(initialQuality(1440, 2)).toBe('low'); expect(initialQuality(900, 8)).toBe('medium'); expect(initialQuality(1600, 8)).toBe('high');
  });
});
