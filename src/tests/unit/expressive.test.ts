/** The expressive layer: thinking gaze, cursor-following eyes, the new expressions. */
import { describe, expect, it, vi } from 'vitest';
import { AnimationEngine, seeded } from '../../animation/engine';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { CursorGaze, CURSOR_LIMITS, cursorTarget } from '../../core/cursorGaze';
import type { CompanionState } from '../../core/stateMachine';


describe('[A148] thinking gaze', () => {
  it('[A148] drifts slowly between the two sides above the eye line — no darting, never out of range', () => {
    const e = new AnimationEngine(seeded(5)); e.rateLimit = false; e.idleEnabled = false;
    e.lookAt(-0.2, -0.15, 'think');
    const xs: number[] = []; let maxStep = 0; let prev = e.getGaze().x;
    for (let i = 0; i < 60 * 12; i++) { e.update(1 / 60); const g = e.getGaze(); maxStep = Math.max(maxStep, Math.abs(g.x - prev)); prev = g.x; xs.push(g.x); expect(Math.abs(g.x)).toBeLessThanOrEqual(0.5); expect(g.y).toBeLessThanOrEqual(0); }
    expect(Math.min(...xs)).toBeLessThan(-0.05); expect(Math.max(...xs)).toBeGreaterThan(0.05);   // it looks to both sides over time
    expect(maxStep).toBeLessThan(0.02);                                                              // smooth: < 0.02 per frame (idle saccades are ~10× faster)
    expect(e.getGaze().mode).toBe('think');
  });
});

describe('[A148] cursor-following eyes', () => {
  const box = { left: 0, top: 0, width: 400, height: 600 };
  const setup = (state: CompanionState = 'idle', allowed = true) => {
    const e = new AnimationEngine(seeded(1)); let t = 0; let st = state;
    const g = new CursorGaze({ engine: e, state: () => st, allowed: () => allowed, now: () => t });
    return { e, g, tick: (ms: number) => { t += ms; }, setState: (s: CompanionState) => { st = s; } };
  };
  it('[A148] the target is limited to a small range around the face', () => {
    expect(cursorTarget(5000, 5000, box)).toEqual([CURSOR_LIMITS.x, CURSOR_LIMITS.y]);
    expect(cursorTarget(-5000, -5000, box)).toEqual([-CURSOR_LIMITS.x, -CURSOR_LIMITS.y]);
    const [x, y] = cursorTarget(200, 228, box); expect(Math.abs(x)).toBeLessThan(0.01); expect(Math.abs(y)).toBeLessThan(0.01);
  });
  it('[A148] follows only while idle, only real movement, not touch, and is eased by the engine', () => {
    vi.useFakeTimers();
    const { e, g, tick, setState } = setup();
    expect(g.move(380, 100, box, 'touch')).toBe(false);
    expect(g.move(380, 100, box)).toBe(true); expect(e.getGaze().mode).toBe('cursor');
    tick(100); expect(g.move(385, 102, box)).toBe(false);          // < 24 px: ignored
    e.update(1 / 60); expect(e.getGaze().x).toBeGreaterThan(0); expect(e.getGaze().x).toBeLessThan(0.2);   // eased, not snapped
    setState('speaking'); tick(100); expect(g.move(10, 10, box)).toBe(false);
    vi.useRealTimers();
  });
  it('[A148] lets go after the pointer rests, and looks away instead of staring for long', () => {
    vi.useFakeTimers();
    const { e, g, tick } = setup();
    g.move(380, 100, box); vi.advanceTimersByTime(CURSOR_LIMITS.releaseMs + 10); expect(e.getGaze().mode).toBe('idle');
    let followed = 0, refused = false;
    for (let i = 0; i < 80; i++) { tick(100); const ok = g.move(i % 2 ? 50 : 350, 100 + i, box); if (ok) followed++; else if (followed) { refused = true; break; } }
    expect(refused).toBe(true); expect(e.getGaze().mode).toBe('idle');   // a break after ~5 s of following
    g.dispose(); vi.useRealTimers();
  });
  it('[A148] never takes the eyes from another gaze (typing, thinking) and does nothing when not allowed', () => {
    const a = setup(); a.e.lookAt(0.8, 0.2, 'chat'); expect(a.g.move(300, 300, box)).toBe(false); expect(a.e.getGaze().mode).toBe('chat');
    const b = setup('idle', false); expect(b.g.move(300, 300, box)).toBe(false);
  });
});

describe('[A148] expressions', () => {
  it('[A148] "focused" and "calm" exist and look different from neutral and from each other', () => {
    const P = (id: string) => BUILTIN_EXPRESSIONS.find((e) => e.id === id)!;
    expect(P('focused').face['eyeL.open']).toBeLessThan(0.8); expect(P('calm').blinkRate).toBeLessThan(1);
    expect(JSON.stringify(P('focused').face)).not.toBe(JSON.stringify(P('calm').face));
  });
});

describe('[A148] idle never freezes and never loops', () => {
  it('[A148] over two idle minutes: natural blinks at varied intervals, varied gaze, and nothing repeats as a fixed cycle', () => {
    const e = new AnimationEngine(seeded(11)); e.rateLimit = false; e.lookAt(null);   // idle: the companion hands the eyes to idle wandering
    const blinks: number[] = []; const gaze: string[] = []; let closed = false; let t = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const v = e.update(1 / 60); t += 1 / 60;
      const c = v['eyeL.open'] < 0.3; if (c && !closed) blinks.push(t); closed = c;
      if (i % 30 === 0) gaze.push(`${e.getGaze().x.toFixed(1)},${e.getGaze().y.toFixed(1)}`);
    }
    const gaps = blinks.slice(1).map((b, i) => b - blinks[i]);
    expect(blinks.length).toBeGreaterThan(20); expect(blinks.length).toBeLessThan(70);           // ~ every 2–5 s, like people
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length; const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(sd).toBeGreaterThan(0.4);                                                             // not a metronome
    expect(new Set(gaze).size).toBeGreaterThan(15);                                              // the eyes keep moving between many points
  });
});

describe('[A143] Colour Studio reset', () => {
  it('[A143] a theme change whose save was cut short by a reload still wins over the older saved setting, and is saved then', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    const { settledPalette } = await import('../../theme/studio');
    const old = { a: '#dc143c', b: '#ff77aa' };
    const saves: unknown[] = []; const persist = async (p: unknown) => { saves.push(p); };
    expect(settledPalette(old, persist)).toEqual(old); expect(saves).toEqual([]);                 // nothing pending: the saved value
    store.set('nexus-palette-pending', JSON.stringify({ p: null }));                               // "Reset" was clicked, then the page reloaded
    expect(settledPalette(old, persist)).toBeNull(); expect(saves).toEqual([null]);
    await new Promise((r) => setTimeout(r, 0)); expect(store.has('nexus-palette-pending')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('[A123] theme toggle', () => {
  it('[A123] a toggle whose save was cut short by a page change wins over the older saved theme once; old or stale marks are ignored', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    const { settledTheme } = await import('../../theme');
    const saves: string[] = []; const persist = async (t: string) => { saves.push(t); };
    expect(settledTheme('dark', persist)).toBe('dark');
    store.set('nexus-theme-pending', `light|${Date.now()}`); expect(settledTheme('dark', persist)).toBe('light'); expect(saves).toEqual(['light']);
    store.set('nexus-theme-pending', `light|${Date.now() - 60_000}`); expect(settledTheme('dark', persist)).toBe('dark'); expect(store.has('nexus-theme-pending')).toBe(false);
    store.set('nexus-theme-pending', 'purple|1'); expect(settledTheme('system', persist)).toBe('system');
    vi.unstubAllGlobals();
  });
});
