/**
 * Startup transition: the #boot overlay (index.html) shows NEXUS powering on while the page loads, then fades.
 * It clears once the page has rendered and its robot is drawn (or the page has no robot) — never later than ~1.5 s, so a
 * slow 3D download never holds the page (the robot viewport shows its own loading state). First visit in a tab: at least
 * 0.6 s so the transition reads; reloads in the same tab and reduced motion: removed as soon as the page is ready. It
 * never blocks clicks (pointer-events: none), and a CSS fallback hides it after 6 s even if this script fails.
 * Clearing it also releases the landing page's entrance choreography (html.booting → html.booted).
 */
export function finishBoot(doc: Document = document) {
  const el = doc.getElementById('boot'); if (!el) { doc.documentElement.classList.remove('booting'); return; }
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('nexus-booted') === '1'; sessionStorage.setItem('nexus-booted', '1'); } catch { /* storage blocked: treat as first visit */ }
  const start = performance.now();
  const min = reduce || seen ? 0 : 600, max = 1500;   // never hold a ready page; the 3D model keeps its own loading state
  const drawn = () => {
    if (!doc.getElementById('main') && !doc.querySelector('.app, #composer')) return false;            // the page itself hasn't rendered yet
    const robot = doc.querySelector('.hero-robot, .stage-box, .nf-robot');
    if (!robot) return true;                                                                              // page without a robot
    return !!robot.querySelector('.robot3d[data-ready], svg[role=img]');
  };
  const done = () => { const r = doc.documentElement; r.dataset.bootMs = String(Math.round(performance.now())); r.classList.remove('booting'); r.classList.add('booted'); el.classList.add('done'); el.addEventListener('transitionend', () => el.remove(), { once: true }); setTimeout(() => el.remove(), reduce ? 0 : 500); };
  const tick = () => {
    const t = performance.now() - start;
    if (t >= max || (t >= min && drawn())) done(); else setTimeout(tick, 50);
  };
  tick();
}
