/**
 * Scroll reveal for the public pages: sections marked `.reveal` fade/slide in once as they enter the viewport.
 * Opacity + transform only (no layout animation), one IntersectionObserver for the page, nothing under reduced motion,
 * and content is fully visible if JavaScript or IntersectionObserver is unavailable (the hidden state is opt-in via
 * the `js-reveal` class on <html>, added here).
 */
import { useEffect } from 'react';

export function useReveal(selector = '.reveal') {
  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver !== 'function') return;
    const root = document.documentElement;
    const els = [...document.querySelectorAll<HTMLElement>(selector)];
    // anything already on screen stays visible (no flash); the rest waits for the viewport
    for (const el of els) if (el.getBoundingClientRect().top < innerHeight * 0.92) el.classList.add('in');
    root.classList.add('js-reveal');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach((el) => { if (!el.classList.contains('in')) io.observe(el); });
    return () => { io.disconnect(); root.classList.remove('js-reveal'); els.forEach((el) => el.classList.add('in')); };
  }, [selector]);
}
