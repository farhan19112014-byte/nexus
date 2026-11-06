/**
 * HOLOBUILD 3D viewport: three.js renderer, orbit controls (rotate / zoom / pan), perspective ↔ orthographic camera,
 * solid / wireframe, grid, axes, click-to-select, part labels, overall dimensions and an animated exploded view.
 * Renders on demand (only while something changes), cleans up every GPU resource on unmount, and falls back to a
 * clear message when WebGL is unavailable or the GPU context is lost.
 */
import { useEffect, useRef, useState } from 'react';
import { attention } from '../character3d/attention';
import type * as THREE_NS from 'three';
import type { OrbitControls as OrbitControlsT } from 'three/examples/jsm/controls/OrbitControls.js';
import { modelBounds, type HoloModel } from '../../shared/holo';
import type { HoloController, HoloSnap } from './controller';
import { webglAvailable } from '../character3d/webgl';

type Three = typeof THREE_NS;
interface Ctx {
  T: Three; renderer: THREE_NS.WebGLRenderer; scene: THREE_NS.Scene; persp: THREE_NS.PerspectiveCamera; ortho: THREE_NS.OrthographicCamera;
  controls: OrbitControlsT; grid: THREE_NS.GridHelper; axes: THREE_NS.AxesHelper; built: import('./scene').Built | null; builtFor: HoloModel | null; builtWire: boolean;
  scene3: typeof import('./scene'); explodeT: number; dirty: boolean; raf: number; ro: ResizeObserver; dispose: () => void;
}
interface Label { id: string; name: string; x: number; y: number; selected: boolean }

export function HoloViewport({ ctl, snap, reducedMotion }: { ctl: HoloController; snap: HoloSnap; reducedMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const snapRef = useRef(snap); snapRef.current = snap;
  const rmRef = useRef(reducedMotion); rmRef.current = reducedMotion;
  const [failed, setFailed] = useState<string | null>(() => (webglAvailable() ? null : 'This browser cannot show 3D (WebGL is unavailable). The parts list, properties and editing still work.'));
  const [labels, setLabels] = useState<Label[]>([]);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);

  // set up the renderer once
  useEffect(() => {
    if (failed || !host.current) return;
    let cancelled = false;
    (async () => {
      const [T, { OrbitControls }, { RoomEnvironment }, scene3] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('three/examples/jsm/environments/RoomEnvironment.js'), import('./scene')]);
      if (cancelled || !host.current) return;
      let renderer: THREE_NS.WebGLRenderer;
      try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
      catch { setFailed('The 3D view could not start (WebGL error). The parts list, properties and editing still work.'); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.domElement.className = 'holo-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
      host.current.prepend(renderer.domElement);
      const scene = new T.Scene();
      const pm = new T.PMREMGenerator(renderer); const envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envTex; pm.dispose();
      scene.add(new T.HemisphereLight(0xdfeaff, 0x0b1424, 0.7));
      const key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(4, 8, 6); scene.add(key);
      const rim = new T.DirectionalLight(0x38d9ff, 0.6); rim.position.set(-6, 3, -5); scene.add(rim);
      const persp = new T.PerspectiveCamera(40, 1, 0.005, 2000); persp.position.set(3, 2.4, 4);
      const ortho = new T.OrthographicCamera(-2, 2, 2, -2, -1000, 1000); ortho.position.copy(persp.position);
      const grid = new T.GridHelper(10, 20, 0x3b8bff, 0x1c2a44); (grid.material as THREE_NS.Material).transparent = true; (grid.material as THREE_NS.Material).opacity = 0.55; scene.add(grid);
      const axes = new T.AxesHelper(1); axes.visible = false; scene.add(axes);
      const controls = new OrbitControls(persp, renderer.domElement); controls.enableDamping = !rmRef.current; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
      const c: Ctx = { T, renderer, scene, persp, ortho, controls, grid, axes, built: null, builtFor: null, builtWire: false, scene3, explodeT: 0, dirty: true, raf: 0, ro: new ResizeObserver(() => resize()), dispose: () => {} };
      ctx.current = c;
      const resize = () => {
        const el = host.current; if (!el) return; const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
        renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix();
        const half = (ortho.top - ortho.bottom) / 2; ortho.left = -half * (w / h); ortho.right = half * (w / h); ortho.updateProjectionMatrix(); c.dirty = true;
      };
      c.ro.observe(host.current); resize();
      controls.addEventListener('change', () => { c.dirty = true; });
      // click (not drag) selects the part under the pointer; clicking empty space deselects
      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
      const onUp = (e: PointerEvent) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !c.built) { down = null; return; } down = null;
        const r = renderer.domElement.getBoundingClientRect(); const ray = new T.Raycaster();
        ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam());
        const hit = ray.intersectObjects([...c.built.meshes.values()].filter((m) => m.visible), false)[0];
        ctl.select(hit ? (hit.object.userData.partId as string) : null);
      };
      renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp);
      const onLost = (e: Event) => { e.preventDefault(); setFailed('The graphics context was lost (the GPU reset or too many 3D views are open).'); };
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      const cam = () => (snapRef.current.view.projection === 'orthographic' ? ortho : persp);
      let last = performance.now(); let labelAt = 0;
      const loop = (now: number) => {
        c.raf = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const s = snapRef.current; const target = s.view.exploded ? 1 : 0;
        if (c.built && s.model && c.explodeT !== target) {
          c.explodeT = rmRef.current ? target : target > c.explodeT ? Math.min(target, c.explodeT + dt * 1.6) : Math.max(target, c.explodeT - dt * 1.6);
          const e = c.explodeT * c.explodeT * (3 - 2 * c.explodeT);
          scene3.applyExplode(c.built, s.model, e, s.view.explodeDistance); c.dirty = true;
        }
        if (controls.enableDamping && controls.update()) c.dirty = true;
        if (!c.dirty) return;
        c.dirty = false;
        renderer.render(scene, cam());
        if (s.view.labels && c.built && now - labelAt > 40) { labelAt = now; setLabels(project(c, cam(), s)); }
        else if (s.view.labels && c.built) c.dirty = true;   // catch up on the next frame
      };
      c.raf = requestAnimationFrame(loop);
      c.dispose = () => {
        cancelAnimationFrame(c.raf); c.ro.disconnect(); controls.dispose();
        renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('webglcontextlost', onLost);
        c.built?.dispose(); grid.geometry.dispose(); (grid.material as THREE_NS.Material).dispose(); axes.geometry.dispose(); (axes.material as THREE_NS.Material).dispose(); envTex.dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); ctx.current = null;
      };
      setReady(true);
    })().catch((e) => setFailed(`The 3D view could not start: ${(e as Error).message}`));
    return () => { cancelled = true; ctx.current?.dispose(); setReady(false); };
  }, [failed, retry, ctl]);

  // rebuild when the model or the wireframe setting changes; frame the camera when a different model opens
  useEffect(() => {
    const c = ctx.current; if (!c || !ready) return;
    const m = snap.model;
    if (c.builtFor === m && c.builtWire === snap.view.wireframe) return;
    const newModel = !c.builtFor || !m || c.builtFor.id !== m.id;
    if (c.built) { c.scene.remove(c.built.root); c.built.dispose(); c.built = null; }
    c.builtFor = m; c.builtWire = snap.view.wireframe;
    if (m) {
      c.built = c.scene3.buildModel(c.T, m, { wireframe: snap.view.wireframe, imported: ctl.imported.get(m.id) });
      c.scene.add(c.built.root);
      c.scene3.applySelection(c.T, c.built, snap.selected);
      if (c.explodeT > 0) { const e = c.explodeT * c.explodeT * (3 - 2 * c.explodeT); c.scene3.applyExplode(c.built, m, e, snap.view.explodeDistance); }
      if (newModel) frame(c, m);
    }
    c.dirty = true;
  }, [snap.model, snap.view.wireframe, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const c = ctx.current; if (c?.built) { c.scene3.applySelection(c.T, c.built, snap.selected); c.dirty = true; } }, [snap.selected, ready]);
  // NEXUS can look and point at the model: the selected part's real screen position (projected by this camera), or the
  // model's centre — and turns to it when the user selects a part
  useEffect(() => {
    attention.set('holo', {
      label: 'HOLOBUILD',
      point: () => {
        const c = ctx.current; const s = snapRef.current; if (!c?.built || !s.model) return null;
        const el = c.renderer.domElement; const r = el.getBoundingClientRect(); if (r.width < 10) return null;
        const cam = s.view.projection === 'orthographic' ? c.ortho : c.persp; const v = new c.T.Vector3();
        const mesh = s.selected ? c.built.meshes.get(s.selected) : null;
        if (mesh && mesh.visible) mesh.getWorldPosition(v); else new c.T.Box3().setFromObject(c.built.root).getCenter(v);
        v.project(cam); if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
    });
    return () => attention.set('holo', null);
  }, []);
  useEffect(() => { if (snap.selected) attention.focus('holo'); }, [snap.selected]);
  useEffect(() => { if (snap.model) attention.focus('holo'); }, [snap.model?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = ctx.current; if (!c) return; c.grid.visible = snap.view.grid; c.axes.visible = snap.view.axes; c.dirty = true; if (!snap.view.labels) setLabels([]); }, [snap.view.grid, snap.view.axes, snap.view.labels, ready]);
  useEffect(() => {
    const c = ctx.current; if (!c) return;
    const from = snap.view.projection === 'orthographic' ? c.persp : c.ortho; const to = snap.view.projection === 'orthographic' ? c.ortho : c.persp;
    to.position.copy(from.position); to.quaternion.copy(from.quaternion);
    if (to === c.ortho) { const d = c.persp.position.distanceTo(c.controls.target); const half = Math.tan((c.persp.fov * Math.PI) / 360) * d; const a = c.persp.aspect; c.ortho.top = half; c.ortho.bottom = -half; c.ortho.left = -half * a; c.ortho.right = half * a; c.ortho.zoom = 1; c.ortho.updateProjectionMatrix(); }
    c.controls.object = to; c.controls.update(); c.dirty = true;
  }, [snap.view.projection, ready]);
  useEffect(() => { const c = ctx.current; if (c?.built && snap.model) { c.scene3.applyExplode(c.built, snap.model, c.explodeT * c.explodeT * (3 - 2 * c.explodeT), snap.view.explodeDistance); c.dirty = true; } }, [snap.view.explodeDistance]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = ctx.current; if (c && snap.model) frame(c, snap.model); }, [ctl.resetRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = snap.model ? modelBounds(snap.model) : null;
  return (
    <div className="holo-viewport" ref={host} data-testid="holo-viewport" data-ready={ready ? '1' : '0'}>
      {failed && <div className="holo-fallback" role="alert"><p>{failed}</p>{webglAvailable() && <button className="btn" onClick={() => { setFailed(null); setRetry((n) => n + 1); }}>Retry 3D</button>}</div>}
      {!snap.model && !failed && <div className="holo-empty"><p>Nothing built yet.</p><p className="muted">Type “build a combustion engine”, or pick an example on the left.</p></div>}
      {snap.view.labels && labels.map((l) => <button key={l.id} className={`holo-label${l.selected ? ' on' : ''}`} style={{ transform: `translate(${l.x}px, ${l.y}px)` }} onClick={() => ctl.select(l.id)}>{l.name}</button>)}
      {snap.view.measure && b && <div className="holo-measure" data-testid="holo-measure">W {fmtLen(b.size[0])} · H {fmtLen(b.size[1])} · D {fmtLen(b.size[2])}</div>}
      {snap.status.kind === 'working' && <div className="holo-working" role="status"><span className="spinner" aria-hidden /> {snap.status.text}</div>}
    </div>
  );
}

export const fmtLen = (m: number) => (m >= 1 ? `${m.toFixed(2)} m` : m >= 0.01 ? `${(m * 100).toFixed(1)} cm` : `${(m * 1000).toFixed(1)} mm`);

function frame(c: Ctx, m: HoloModel) {
  const b = modelBounds(m); const span = Math.max(...b.size, 0.01); const center = new c.T.Vector3(...b.center);
  const d = span / (2 * Math.tan((c.persp.fov * Math.PI) / 360)) * 1.35 + span * 0.5;
  const dir = new c.T.Vector3(0.62, 0.42, 1).normalize();
  for (const cam of [c.persp, c.ortho]) { cam.position.copy(center.clone().add(dir.clone().multiplyScalar(d))); cam.lookAt(center); }
  c.persp.near = Math.max(0.001, d / 500); c.persp.far = d * 50; c.persp.updateProjectionMatrix();
  const a = c.persp.aspect; const half = span * 0.75; c.ortho.top = half; c.ortho.bottom = -half; c.ortho.left = -half * a; c.ortho.right = half * a; c.ortho.zoom = 1; c.ortho.updateProjectionMatrix();
  c.controls.target.copy(center); c.controls.minDistance = span * 0.05; c.controls.maxDistance = span * 20; c.controls.update();
  const g = Math.pow(10, Math.ceil(Math.log10(span * 3))); c.grid.scale.setScalar(g / 10); c.axes.scale.setScalar(span * 0.6);
  c.dirty = true;
}

function project(c: Ctx, cam: THREE_NS.Camera, s: HoloSnap): Label[] {
  if (!c.built || !s.model) return [];
  const el = c.renderer.domElement; const w = el.clientWidth, h = el.clientHeight; const out: Label[] = []; const v = new c.T.Vector3();
  // at most 40 labels: the selected part, then the largest visible parts
  const parts = [...s.model.parts].filter((p) => p.visible).sort((a, b) => (b.id === s.selected ? 1 : 0) - (a.id === s.selected ? 1 : 0) || b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]).slice(0, 40);
  for (const p of parts) {
    const mesh = c.built.meshes.get(p.id); if (!mesh) continue;
    mesh.getWorldPosition(v); v.project(cam); if (v.z > 1) continue;
    out.push({ id: p.id, name: p.name, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, selected: p.id === s.selected });
  }
  return out;
}
