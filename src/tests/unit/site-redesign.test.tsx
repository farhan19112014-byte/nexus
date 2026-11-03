// @vitest-environment happy-dom
/**
 * [A126] Website redesign & 3D integration: robot-style default and migration, WebGL decision, startup transition,
 * the state demo uses real expressions, and the About / Privacy content.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryKV } from '../../storage/db';
import { MemoryStore, DEFAULT_SETTINGS } from '../../memory/store';
import { _resetWebglProbe, effectiveStyle, softwareRenderer, webglAvailable } from '../../character3d/webgl';
import { finishBoot } from '../../boot';
import { DEMO_STATES } from '../../site/PreviewRobot';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { About, Privacy } from '../../site/Pages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); _resetWebglProbe(); document.body.innerHTML = ''; });

describe('[A126] robot style', () => {
  it('[A126] the default is "auto" (3D where it works); an old saved "2d" default is migrated, an explicit "3d" is kept', async () => {
    expect(DEFAULT_SETTINGS.robotStyle).toBe('auto');
    const kv = new MemoryKV(); await kv.put('kv', { ...DEFAULT_SETTINGS, robotStyle: '2d', settingsVersion: 3 }, 'settings');
    const m = new MemoryStore(kv); await m.ready; expect(m.settings.robotStyle).toBe('auto');
    const kv2 = new MemoryKV(); await kv2.put('kv', { ...DEFAULT_SETTINGS, robotStyle: '3d', settingsVersion: 3 }, 'settings');
    const m2 = new MemoryStore(kv2); await m2.ready; expect(m2.settings.robotStyle).toBe('3d');
    const kv3 = new MemoryKV(); await kv3.put('kv', { ...DEFAULT_SETTINGS, robotStyle: '2d', settingsVersion: 4 }, 'settings');
    const m3 = new MemoryStore(kv3); await m3.ready; expect(m3.settings.robotStyle).toBe('2d');   // chosen after v4: respected
  });
  it('[A127] the 3D robot is shown wherever WebGL exists (also software WebGL); 2D only without WebGL', () => {
    const fake = (renderer: string | null) => { _resetWebglProbe(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => renderer === null || kind === '2d' ? null : ({ getExtension: () => null, getParameter: () => renderer, RENDERER: 0 })) as never); };
    fake(null); expect(webglAvailable()).toBe(false); expect(effectiveStyle('auto')).toBe('2d');
    fake('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'); expect(webglAvailable()).toBe(true); expect(softwareRenderer()).toBe(true); expect(effectiveStyle('auto')).toBe('3d');
    fake('ANGLE (NVIDIA GeForce RTX 3060)'); expect(effectiveStyle('auto')).toBe('3d'); expect(softwareRenderer()).toBe(false);
  });
});

describe('[A126] startup transition', () => {
  const overlay = () => { const b = document.createElement('div'); b.id = 'boot'; document.body.append(b); return b; };
  it('[A126] stays at least ~0.6 s on a first visit, then fades, is removed, and releases the entrance animation', () => {
    vi.useFakeTimers(); sessionStorage.clear(); document.documentElement.classList.add('booting');
    const b = overlay(); const main = document.createElement('main'); main.id = 'main'; document.body.append(main);
    finishBoot();
    vi.advanceTimersByTime(400); expect(b.classList.contains('done')).toBe(false);
    vi.advanceTimersByTime(300); expect(b.classList.contains('done')).toBe(true);
    expect(document.documentElement.classList.contains('booting')).toBe(false); expect(document.documentElement.classList.contains('booted')).toBe(true);
    vi.advanceTimersByTime(600); expect(document.getElementById('boot')).toBeNull();
  });
  it('[A126] waits for the robot to be drawn, but never longer than ~1.5 s (a slow 3D download never holds the page)', () => {
    vi.useFakeTimers(); sessionStorage.clear();
    const b = overlay(); const main = document.createElement('main'); main.id = 'main'; main.innerHTML = '<div class="hero-robot"><div class="robot3d"></div></div>'; document.body.append(main);
    finishBoot();
    vi.advanceTimersByTime(900); expect(b.classList.contains('done')).toBe(false);           // 3D model not ready yet
    main.querySelector('.robot3d')!.setAttribute('data-ready', '1');
    vi.advanceTimersByTime(100); expect(b.classList.contains('done')).toBe(true);
    sessionStorage.clear(); const b2 = overlay(); document.getElementById('main')!.innerHTML = '<div class="hero-robot"><div class="robot3d"></div></div>';
    b.remove(); finishBoot(); vi.advanceTimersByTime(1600); expect(b2.classList.contains('done')).toBe(true);
  });
  it('[A126] later loads in the same tab do not hold the page', () => {
    vi.useFakeTimers(); sessionStorage.setItem('nexus-booted', '1');
    const b = overlay(); const main = document.createElement('main'); main.id = 'main'; document.body.append(main);
    finishBoot(); vi.advanceTimersByTime(60); expect(b.classList.contains('done')).toBe(true);
  });
});

describe('[A126] public pages', () => {
  it('[A126] every demo state uses a real built-in expression and an honest description', () => {
    const ids = new Set(BUILTIN_EXPRESSIONS.map((e) => e.id));
    expect(DEMO_STATES.map((d) => d.id)).toEqual(['idle', 'listening', 'thinking', 'speaking', 'greeting', 'curious', 'excited', 'confused', 'concerned', 'resting', 'error']);
    for (const d of DEMO_STATES) { if (d.face) expect(ids.has(d.face)).toBe(true); expect(d.note.length).toBeGreaterThan(10); }
  });
  const render = async (C: () => React.JSX.Element) => { const el = document.createElement('div'); document.body.append(el); const r = createRoot(el); await act(async () => { r.render(<C />); }); const text = el.textContent ?? ''; await act(async () => { r.unmount(); }); return text; };
  it('[A126] About says exactly "Made by Muhammad Farhan Khan" and invents no biography or endorsements', async () => {
    const t = await render(About);
    expect(t).toContain('Made by Muhammad Farhan Khan');
    expect(t).not.toMatch(/award|partner|testimonial|trusted by|years of experience|founder of/i);
  });
  it('[A126] Privacy describes the real data flows: browser storage, server without chat storage, Gemini free tier, IP for limits, hosts', async () => {
    const t = await render(Privacy);
    for (const s of ['IndexedDB', 'does not save conversations', 'Google Gemini', 'free tier', 'IP address', 'GitHub Pages', 'Render', 'not a legal certification', 'never sends keys']) expect(t).toContain(s);
    expect(t).not.toMatch(/GDPR compliant|HIPAA|fully compliant|military-grade/i);
  });
});
