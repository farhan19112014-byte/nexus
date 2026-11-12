/**
 * Outfit manager: puts one outfit on the existing NEXUS model and takes it off again.
 *  - only the requested outfit's code is downloaded (one small chunk each) and only its meshes are built;
 *  - clothing is attached to the model's own nodes (Torso, arms, hand), so every animation, gesture, gaze and
 *    lip-sync keeps working unchanged — nothing of the robot is replaced, recoloured or reloaded;
 *  - the change is a ~400 ms cross-fade (old outfit out, new one in, with a brief ring of blue light) that runs on its
 *    own frames without touching the animation loop; instant under reduced motion;
 *  - the previous outfit's geometry and materials are disposed;
 *  - parts of the robot under the clothes (chest panel and light, back vents) are hidden while clothed, shown again after.
 */
import type * as T3 from 'three';
import type { OutfitId } from '../../../shared/modes';
import { COVERED_PARTS, type Piece } from './kit';

export interface OutfitHost { THREE: typeof T3; scene: T3.Scene; render: () => void }
type Builder = (THREE: typeof T3) => Piece[];
const LOAD: Record<Exclude<OutfitId, 'default'>, () => Promise<{ build: Builder }>> = {
  legal: () => import('./legal'), medical: () => import('./medical'), it: () => import('./it'), education: () => import('./education'),
};
export const TRANSITION_MS = 400;

interface Worn { id: OutfitId; accessories: boolean; objects: T3.Object3D[] }
const state = new WeakMap<T3.Scene, { worn: Worn | null; token: number; fx: number; leaving: T3.Object3D[]; ring: (() => void) | null }>();

const materialsOf = (objs: T3.Object3D[]) => { const out = new Set<T3.Material>(); for (const o of objs) o.traverse((x) => { const m = (x as T3.Mesh).material; if (m) ([] as T3.Material[]).concat(m).forEach((k) => out.add(k)); }); return [...out]; };
function setOpacity(mats: T3.Material[], k: number) { for (const m of mats) { const fading = k < 1; if (m.transparent !== fading) { m.transparent = fading; m.needsUpdate = true; } m.opacity = k; m.depthWrite = !fading || k > 0.5; } }
function dispose(objs: T3.Object3D[]) {
  for (const o of objs) { o.removeFromParent(); o.traverse((x) => { (x as T3.Mesh).geometry?.dispose(); }); }
  for (const m of materialsOf(objs)) m.dispose();
}

/**
 * Wear `id` ('default' = the original NEXUS, no clothing). Resolves to the outfit actually worn: if the outfit's code
 * cannot be loaded, the robot keeps its current appearance and the error is thrown to the caller.
 */
export async function wearOutfit(host: OutfitHost, id: OutfitId, accessories: boolean, reduced: boolean): Promise<OutfitId> {
  const st = state.get(host.scene) ?? { worn: null, token: 0, fx: 0, leaving: [], ring: null }; state.set(host.scene, st);
  const token = ++st.token;
  const cur = st.worn;
  if ((cur?.id ?? 'default') === id && (id === 'default' || cur?.accessories === accessories)) return id;
  let next: Worn | null = null;
  if (id !== 'default') {
    const { build } = await LOAD[id]();
    if (token !== st.token) return st.worn?.id ?? 'default';               // a newer request won while this one loaded
    const objects: T3.Object3D[] = [];
    for (const p of build(host.THREE)) {
      if (p.accessory && !accessories) { p.object.traverse((x) => (x as T3.Mesh).geometry?.dispose()); continue; }
      const node = host.scene.getObjectByName(p.attach); if (!node) continue;
      p.object.userData.outfit = id; node.add(p.object); objects.push(p.object);
    }
    next = { id, accessories, objects };
  }
  st.worn = next;
  // the robot's chest and back parts under the clothes are hidden while clothed (they would poke through) and shown again
  for (const n of COVERED_PARTS) { const o = host.scene.getObjectByName(n); if (o) o.visible = !next; }
  // an outfit still fading out from an interrupted change goes at once
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.fx);
  st.ring?.(); st.ring = null; if (st.leaving.length) { dispose(st.leaving); st.leaving = []; }
  st.leaving = cur ? cur.objects : [];
  const outMats = cur ? materialsOf(cur.objects) : []; const inMats = next ? materialsOf(next.objects) : [];
  if (reduced || typeof requestAnimationFrame !== 'function') { if (cur) dispose(cur.objects); st.leaving = []; setOpacity(inMats, 1); host.render(); return id; }
  // cross-fade, a slight settle (clothing "lands" on the body) and a brief ring of blue light around the robot
  const ring = sparkle(host); st.ring = () => ring.dispose(); const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / TRANSITION_MS); const e = 1 - (1 - k) ** 3;
    setOpacity(outMats, 1 - e); setOpacity(inMats, e);
    // the settle multiplies each piece's OWN scale (pieces such as the trouser seat are shaped by their scale)
    for (const o of next?.objects ?? []) { if (o.parent?.name !== 'Torso') continue; const b = (o.userData.baseScale ??= o.scale.clone()) as T3.Vector3; o.scale.copy(b).multiplyScalar(1.03 - 0.03 * e); }
    ring.update(k);
    host.render();
    if (k < 1) { st.fx = requestAnimationFrame(step); return; }
    if (cur) dispose(cur.objects); st.leaving = [];
    for (const o of next?.objects ?? []) { const b = o.userData.baseScale as T3.Vector3 | undefined; if (b) { o.scale.copy(b); delete o.userData.baseScale; } }
    setOpacity(inMats, 1); ring.dispose(); st.ring = null; host.render();
  };
  setOpacity(inMats, 0);
  st.fx = requestAnimationFrame(step);
  return id;
}

/** A ring of small blue particles rising around the body during the change (decorative; removed afterwards). */
function sparkle(host: OutfitHost) {
  const T = host.THREE; const n = 48; const pos = new Float32Array(n * 3); const seed: number[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; seed.push(a, 0.75 + (i % 5) * 0.06); pos.set([Math.cos(a) * 0.9, 1.0, Math.sin(a) * 0.9], i * 3); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
  const m = new T.PointsMaterial({ color: 0x5ab4ff, size: 0.045, transparent: true, opacity: 0, depthWrite: false });
  const pts = new T.Points(g, m); pts.name = 'Outfit_Sparkle'; host.scene.add(pts);
  return {
    update(k: number) {
      for (let i = 0; i < n; i++) { const a = seed[i * 2] + k * 1.2; const r = 0.85 + 0.1 * Math.sin(k * 6 + i); pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.6 + k * 2.2 * seed[i * 2 + 1]; pos[i * 3 + 2] = Math.sin(a) * r; }
      g.attributes.position.needsUpdate = true; m.opacity = Math.sin(Math.PI * k) * 0.9;
    },
    dispose() { host.scene.remove(pts); g.dispose(); m.dispose(); },
  };
}

/** what is worn now (tests / diagnostics) */
export const wornOutfit = (scene: T3.Scene): OutfitId => state.get(scene)?.worn?.id ?? 'default';
