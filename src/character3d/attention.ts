/**
 * Things on the page NEXUS can look and point at — the visual it is presenting (IVES) and the HOLOBUILD model or the
 * selected part. Each source reports a REAL page position (a DOM rectangle, or a 3D part projected by the HOLOBUILD
 * camera); the 3D robot converts it into a point on its own stage (Robot3D: camera ray → stage plane). Nothing here
 * invents a position: no source, or a source that is off screen, means NEXUS simply looks at the user.
 */
export type AttentionId = 'visual' | 'holo';
export interface AttentionSource {
  /** page coordinates (CSS px, viewport) of the point to look at, or null while not visible */
  point(): { x: number; y: number } | null;
  /** short label for tests and the motion lab ("diagram", "Wheel") */
  label?: string;
}
type Listener = (id: AttentionId, kind: 'set' | 'clear' | 'focus') => void;

const sources = new Map<AttentionId, AttentionSource>();
const listeners = new Set<Listener>();
export const attention = {
  set(id: AttentionId, s: AttentionSource | null) {
    if (s) sources.set(id, s); else sources.delete(id);
    listeners.forEach((f) => f(id, s ? 'set' : 'clear'));
  },
  get: (id: AttentionId) => sources.get(id) ?? null,
  ids: () => [...sources.keys()],
  /** ask NEXUS to look at a source now (a new visual, a part the user selected) */
  focus(id: AttentionId) { if (sources.has(id)) listeners.forEach((f) => f(id, 'focus')); },
  on(f: Listener) { listeners.add(f); return () => { listeners.delete(f); }; },
};
/** the centre of an element's box if any of it is on screen */
export function rectPoint(el: Element | null, fx = 0.5, fy = 0.45): { x: number; y: number } | null {
  if (!el) return null; const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > (globalThis.innerHeight || 1e5) || r.left > (globalThis.innerWidth || 1e5)) return null;
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}
