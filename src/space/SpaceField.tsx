/**
 * The animated space environment (decorative: aria-hidden, never takes pointer events). One Canvas 2D, capped frame
 * rate and pixel ratio, paused when off-screen or the tab is hidden, a single still frame under reduced motion, and an
 * automatic quality step-down when frames get slow (low-end hardware).
 */
import { useEffect, useRef } from 'react';
import { TechScene, type Mood, type Quality } from './techScene';

export function initialQuality(width: number, cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4): Quality {
  if (width < 700 || cores <= 2) return 'low';
  if (width < 1100 || cores <= 4) return 'medium';
  return 'high';
}

export function SpaceField({ focus = 'right', className = '', reducedMotion = false, mood = 'idle' }: { focus?: 'right' | 'full' | 'hero'; className?: string; reducedMotion?: boolean; mood?: Mood }) {
  const sceneRef = useRef<TechScene | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const rmRef = useRef(reducedMotion); rmRef.current = reducedMotion;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext('2d', { alpha: true }); if (!g) return;
    const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark') as 'dark' | 'light';
    const sysReduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new TechScene({ focus, quality: initialQuality(window.innerWidth), theme: theme() }); sceneRef.current = scene;
    let dpr = 1, raf = 0, last = performance.now(), visible = true, acc = 0, slow = 0, frames = 0;
    const FRAME = 1 / 40;   // 40 fps is plenty for slow, drifting motion
    const size = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, scene.o.quality === 'high' ? 1.5 : 1);
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0); scene.resize(r.width, r.height); paint();
    };
    const paint = () => scene.draw(g);
    const still = () => rmRef.current || sysReduce();
    const loop = (now: number) => {
      raf = 0; if (!visible || document.hidden) return;
      const dt = (now - last) / 1000; last = now; acc += dt;
      if (acc >= FRAME) {
        const t0 = performance.now(); scene.step(Math.min(acc, 0.1)); paint(); acc = 0;
        // adaptive quality: if drawing alone takes > 12 ms on average, step down once per level
        const cost = performance.now() - t0; frames++; slow = slow * 0.9 + cost * 0.1;
        if (frames > 60 && slow > 12 && scene.o.quality !== 'low') { scene.setQuality(scene.o.quality === 'high' ? 'medium' : 'low'); size(); frames = 0; }
      }
      if (!still()) raf = requestAnimationFrame(loop); else { scene.step(0); paint(); }
    };
    const start = () => { if (!raf && visible && !document.hidden && !still()) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const ro = new ResizeObserver(size); ro.observe(cv);
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }) : null; io?.observe(cv);
    const onVis = () => { if (!document.hidden) start(); };
    // the canvas never takes input; the window's pointer drives parallax, dust proximity and ring highlights
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect(); const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      scene.pointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1, inside && e.pointerType !== 'touch' ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    const onLeave = () => scene.pointer(0, 0, null);
    const mo = new MutationObserver(() => { scene.setTheme(theme()); paint(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cv.addEventListener('nexus:space-resume', start);
    document.addEventListener('visibilitychange', onVis); window.addEventListener('pointermove', onMove, { passive: true }); document.documentElement.addEventListener('pointerleave', onLeave);
    size(); start();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io?.disconnect(); mo.disconnect(); cv.removeEventListener('nexus:space-resume', start); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pointermove', onMove); document.documentElement.removeEventListener('pointerleave', onLeave); sceneRef.current = null; };
  }, [focus]);
  useEffect(() => { sceneRef.current?.setMood(mood); }, [mood]);
  // reduced motion toggled at runtime: the effect's loop checks it each frame; restart when it is turned off
  useEffect(() => { if (!reducedMotion) ref.current?.dispatchEvent(new Event('nexus:space-resume')); }, [reducedMotion]);
  return <canvas ref={ref} className={`space-field ${className}`} aria-hidden="true" data-testid="space-field" data-focus={focus} />;
}
