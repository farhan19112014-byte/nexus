/**
 * Startup transition: the #boot overlay (index.html) shows NEXUS powering on while the page loads, then fades.
 * It stays until the robot is actually drawn (3D model ready, or the 2D robot) — or the page has no robot — and never
 * longer than ~2.6 s. First visit in a tab: at least 1 s so the transition reads; later navigations/reloads in the
 * same tab and reduced motion: removed as soon as the page is ready. It never blocks clicks (pointer-events: none),
 * and a CSS fallback hides it after 6 s even if this script fails.
 */
export function finishBoot(doc: Document = document) {
  const el = doc.getElementById('boot'); if (!el) return;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('nexus-booted') === '1'; sessionStorage.setItem('nexus-booted', '1'); } catch { /* storage blocked: treat as first visit */ }
  const start = performance.now();
  const min = reduce || seen ? 0 : 1000, max = 2600;
  const drawn = () => {
    if (!doc.getElementById('main') && !doc.querySelector('.app, #composer')) return false;            // the page itself hasn't rendered yet
    const robot = doc.querySelector('.hero-robot, .stage-box, .nf-robot');
    if (!robot) return true;                                                                              // page without a robot
    return !!robot.querySelector('.robot3d[data-ready], svg[role=img]');
  };
  const done = () => { doc.documentElement.dataset.bootMs = String(Math.round(performance.now())); el.classList.add('done'); setTimeout(() => el.remove(), reduce ? 0 : 500); };
  const tick = () => {
    const t = performance.now() - start;
    if (t >= max || (t >= min && drawn())) done(); else setTimeout(tick, 50);
  };
  tick();
}
