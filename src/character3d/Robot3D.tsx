/**
 * NEXUS in 3D: renders public/models/nexus.glb with three.js and drives it with the SAME animation channels as the
 * 2D robot, through the same RigHandle — so expressions, gestures, gaze, lip movement and states work unchanged.
 * three.js is loaded only when this view is used. If WebGL or the model is unavailable, `onFail` is called and the
 * caller shows the 2D robot instead (never a blank stage).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Channel } from '../../shared/channels';
import type { Indicator, RigHandle, RobotProps } from '../character/Robot';
import { COLORS } from '../character/tokens';
import { useResolvedTheme } from '../themeHook';
import { withBase } from '../webDemo';
import { applyChannels, RIG_NODES, type Glow, type Rig, type Rest } from './rig3d';
import { skin3d } from './skins3d';
import { applyBody } from './body/apply';
import type { BodyOutput } from './body/controller';
import { usePalette } from '../theme/usePalette';
import { applyMotion, gesturingFrom, Motion3D, type MotionState } from './motion3d';
import { softwareRenderer, webglAvailable } from './webgl';

type Three = typeof import('three');
interface Ctx {
  THREE: Three; renderer: import('three').WebGLRenderer; scene: import('three').Scene; camera: import('three').PerspectiveCamera;
  rig: Rig; rest: Rest; mats: Record<string, import('three').MeshStandardMaterial>; base: Record<string, number>;
  env: import('three').Object3D[]; dirty: boolean; raf: number; ro: ResizeObserver | null; dispose: () => void; lastT: number; dist: number; yaw: number; orbitRaf: number; place?: () => void;
}

export interface Robot3DProps extends RobotProps { onFail?: (reason: string) => void; onReady?: () => void; /** viewing angle around the robot, radians (0 = front) */ orbit?: number }

/**
 * The model file is downloaded ONCE per page (shared by every 3D robot on it), with real byte progress for the loading
 * indicator. A failed download is not cached, so "Retry" really retries.
 */
let modelBytes: Promise<ArrayBuffer> | null = null;
const progressListeners = new Set<(f: number | null) => void>();
export function loadModelBytes(): Promise<ArrayBuffer> {
  modelBytes ??= (async () => {
    const r = await fetch(MODEL_URL());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    if (!r.body || !total) { progressListeners.forEach((f) => f(null)); return r.arrayBuffer(); }   // size unknown: indeterminate
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; const f = Math.min(1, got / total); progressListeners.forEach((l) => l(f)); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  })().catch((e) => { modelBytes = null; throw e; });
  return modelBytes;
}

// VITE_MODEL_PATH lets a static host that refuses .glb serve the same bytes under another name (used by the hosted preview build)
export const MODEL_URL = () => withBase(import.meta.env.VITE_MODEL_PATH || '/models/nexus.glb');
const sameChannels = (a: Record<string, number>, b: Record<string, number>) => { for (const k in b) if (Math.abs((a[k] ?? 0) - b[k]) > 1e-4) return false; return true; };

export const Robot3D = forwardRef<RigHandle, Robot3DProps>(function Robot3D(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const pending = useRef<{ v: Record<Channel, number> | null; ind: Indicator }>({ v: null, ind: 'idle' });
  // the 3D robot's own body language (src/character3d/motion3d.ts) — one per renderer, created once
  const motion = useRef(new Motion3D());
  // full-body layers for the current frame (from the shared BodyController in the character runtime)
  const body = useRef<{ out: BodyOutput | null; was: boolean }>({ out: null, was: false });
  const scratch = useRef<Record<string, number>>({});
  const theme = useResolvedTheme();
  const skin = props.skin ?? theme;
  const pal = usePalette(); const palKey = pal ? `${pal.a}${pal.b}` : '';
  const skinRef = useRef(skin); skinRef.current = skin;
  const palRef = useRef(pal); palRef.current = pal;
  const env = props.environment ?? 'lab';
  const effects = props.effects ?? true;
  const { onFail, onReady } = props;
  const orbitRef = useRef(props.orbit ?? 0); orbitRef.current = props.orbit ?? 0;

  const request = () => { const c = ctx.current; if (!c || c.raf) return; c.raf = requestAnimationFrame(() => { c.raf = 0; c.renderer.render(c.scene, c.camera); }); };
  const glowTo = (g: Glow) => {
    const c = ctx.current; if (!c) return;
    const boost = skin3d(skinRef.current, palRef.current).glow;
    const set = (name: string, k: number) => { const m = c.mats[name]; if (m) m.emissiveIntensity = (c.base[name] ?? 1) * k * (boost[name] ?? 1); };
    for (const n of ['NX_Eye', 'NX_Pupil', 'NX_Mouth', 'NX_Brow', 'NX_Spark']) set(n, g.face);
    set('NX_Core', g.chest); set('NX_Antenna', g.antenna);
    const ch = c.mats.NX_Cheek; if (ch) ch.opacity = g.cheeks;
  };
  /** "happy" eyes: a screen-coloured lid rises over the lower part of each eye, clipped to the eye so it never spills */
  const clipLids = () => {
    const c = ctx.current; if (!c) return;
    for (const s of ['L', 'R'] as const) {
      const eye = c.rig[`Eye_${s}`] as unknown as import('three').Object3D; const lid = c.rig[`EyeLid_${s}`] as unknown as import('three').Mesh;
      if (!lid.visible) continue;
      eye.updateWorldMatrix(true, false);
      const planes = (lid.material as import('three').Material).clippingPlanes ?? [];
      const up = new c.THREE.Vector3(0, 1, 0).transformDirection(eye.matrixWorld), side = new c.THREE.Vector3(1, 0, 0).transformDirection(eye.matrixWorld);
      const at = (x: number, y: number) => new c.THREE.Vector3(x, y, 0).applyMatrix4(eye.matrixWorld);
      planes[0]?.setFromNormalAndCoplanarPoint(up, at(0, -0.215));                    // nothing below the eye
      planes[1]?.setFromNormalAndCoplanarPoint(side, at(-0.165, 0));                  // nor left of it
      planes[2]?.setFromNormalAndCoplanarPoint(side.clone().negate(), at(0.165, 0));  // nor right of it
    }
  };
  const indicate = (i: Indicator) => {
    const c = ctx.current; if (!c) return;
    const k = skin3d(skin, pal);
    const col: Record<Indicator, string> = { idle: k.indicator, listening: COLORS.success, processing: COLORS.warning, responding: k.indicator, speaking: k.core, acting: k.brow, success: COLORS.success, error: COLORS.danger, offline: '#9fb3cc' };
    c.mats.NX_Forehead?.color.set(col[i]); c.mats.NX_Forehead?.emissive.set(col[i]);
    const core = i === 'idle' || i === 'responding' ? k.core : col[i];
    c.mats.NX_Core?.color.set(core); c.mats.NX_Core?.emissive.set(core);
    host.current?.setAttribute('data-core', i);
    request();
  };

  useImperativeHandle(ref, () => ({
    svg: () => null,
    setSeat() { /* the 3D robot has no stool yet; sitting poses still bend the legs */ },
    setIndicator(i) { pending.current.ind = i; indicate(i); },
    setMotion(state: MotionState, reduced: boolean) { motion.current.amplitude = reduced ? 0 : 1; motion.current.setState(state); host.current?.setAttribute('data-motion', state); },
    busy: () => motion.current.busy() || !!body.current.out?.active,
    setBody(o) { body.current.out = o; },
    apply(v) {
      const prev = pending.current.v; pending.current.v = { ...v };
      const c = ctx.current; if (!c) return;
      const now = performance.now(); const dt = c.lastT ? (now - c.lastT) / 1000 : 0; c.lastT = now;
      const M = motion.current;
      const B = body.current; const bodyOn = !!B.out?.active;
      if (prev && !c.dirty && !M.busy() && !bodyOn && !B.was && sameChannels(prev, v) && M.active() === null && dt < 0.5) { M.update(dt, false); return; } // nothing moved: no GPU work
      c.dirty = false;
      const m = M.update(dt, gesturingFrom(v));
      const s = Object.assign(scratch.current, v); s['pupil.x'] = v['pupil.x'] + m.gazeX; s['pupil.y'] = v['pupil.y'] + m.gazeY;
      glowTo(applyChannels(c.rig, c.rest, s as Record<Channel, number>)); applyMotion(c.rig as unknown as Parameters<typeof applyMotion>[0], m);
      applyBody(c.rig, c.rest, B.out); B.was = bodyOn;
      clipLids(); request();
      // live measurements of the real scene for tests and the motion lab: palm distance, root rotation, lowest sole
      if (bodyOn && host.current) {
        const T = c.THREE; const w = (n: string) => (c.rig[n as keyof typeof c.rig] as unknown as import('three').Object3D).getWorldPosition(new T.Vector3());
        const hl = w('Hand_L'), hr = w('Hand_R'); const fl = w('Foot_L'), fr = w('Foot_R');
        const palm = (h: import('three').Vector3, n: string) => h.add(new T.Vector3(0, -0.03, 0).applyQuaternion((c.rig[n as keyof typeof c.rig] as unknown as import('three').Object3D).getWorldQuaternion(new T.Quaternion())));
        const e = c.rig.Body_Root.rotation;
        host.current.dataset.bodyMetrics = JSON.stringify({ action: B.out!.action, state: B.out!.state, palms: +palm(hl, 'Hand_L').distanceTo(palm(hr, 'Hand_R')).toFixed(3), up: +new T.Vector3(0, 1, 0).applyQuaternion((c.rig.Body_Root as unknown as import('three').Object3D).getWorldQuaternion(new T.Quaternion())).y.toFixed(2), pitch: +((e.x * 180) / Math.PI).toFixed(1), yaw: +((e.y * 180) / Math.PI).toFixed(1), foot: +Math.min(fl.y, fr.y).toFixed(3) });
      } else if (host.current?.dataset.bodyMetrics) delete host.current.dataset.bodyMetrics;
      const pose = `${c.rig.Arm_R.rotation.z.toFixed(3)} ${c.rig.Head.rotation.z.toFixed(3)} ${c.rig.Body.rotation.y.toFixed(3)}`;
      if (host.current && host.current.dataset.pose !== pose) host.current.dataset.pose = pose;   // for tests / debugging
    },
  }), [skin, palKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // create the renderer and load the model once
  useEffect(() => {
    let dead = false;
    (async () => {
      const el = host.current; if (!el) return;
      // the cached probe (webgl.ts) gives its test context back; creating a new one on every mount would use up the
      // browser's limited number of WebGL contexts and get the live robot's context taken away
      if (!webglAvailable()) { onFail?.('WebGL is not available in this browser'); return; }
      const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/environments/RoomEnvironment.js')]);
      if (dead) return;
      let gltf;
      const onProg = (f: number | null) => { if (!dead) el.dataset.progress = f === null ? '' : `${Math.round(f * 100)}%`; };
      progressListeners.add(onProg);
      try { const buf = await loadModelBytes(); gltf = await new GLTFLoader().parseAsync(buf.slice(0), withBase('/models/')); }
      catch (e) { onFail?.(`The 3D model could not be loaded (${(e as Error).message})`); return; }
      finally { progressListeners.delete(onProg); }
      if (dead) return;
      // without graphics hardware (software WebGL) draw fewer pixels so the page stays responsive
      const soft = softwareRenderer();
      const renderer = new THREE.WebGLRenderer({ antialias: !soft, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(soft ? Math.min(0.8, (window.devicePixelRatio || 1) * 0.65) : Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('role', 'presentation');
      el.append(renderer.domElement);
      const scene = new THREE.Scene();
      const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
      const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-3, 6, 5);
      // strong neon-blue rim lights from behind on both sides: the glowing blue edges of the NEXUS look
      const rim = new THREE.DirectionalLight(0x2a9dff, 3.2); rim.position.set(4, 2.5, -4);
      const rim2 = new THREE.DirectionalLight(0x00c8ff, 2.2); rim2.position.set(-4.5, 1.5, -3);
      const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0a1f44, 0.45);
      scene.add(key, rim, hemi, gltf.scene); if (!soft) scene.add(rim2);   // one light fewer without graphics hardware
      const camera = new THREE.PerspectiveCamera(26, 1, 2, 60);
      // nodes, rest pivots, materials (cloned where one part must glow independently)
      const rig = {} as Rig; const rest: Rest = {}; const missing: string[] = [];
      for (const n of RIG_NODES) { const o = gltf.scene.getObjectByName(n); if (!o) missing.push(n); else { rig[n] = o as unknown as Rig[typeof n]; rest[n] = { x: o.position.x, y: o.position.y, z: o.position.z }; } }
      if (missing.length) { renderer.dispose(); renderer.domElement.remove(); onFail?.(`The 3D model is missing parts: ${missing.join(', ')}`); return; }
      // no graphics hardware: swap the clear-coated materials for plain ones (same colours) — far cheaper to draw in software
      if (soft) { const swap = new Map<import('three').Material, import('three').MeshStandardMaterial>(); gltf.scene.traverse((o) => { const m = o as import('three').Mesh; const mat = m.material as import('three').MeshPhysicalMaterial | undefined; if (!mat?.isMeshPhysicalMaterial) return; let n = swap.get(mat); if (!n) { n = new THREE.MeshStandardMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(n, mat); n.name = mat.name; swap.set(mat, n); } m.material = n; }); }
      const mats: Ctx['mats'] = {}; const base: Record<string, number> = {};
      gltf.scene.traverse((o) => { const m = (o as import('three').Mesh).material as import('three').MeshStandardMaterial | undefined; if (m?.name && !mats[m.name]) { mats[m.name] = m; base[m.name] = m.emissiveIntensity ?? 1; } });
      const own = (meshName: string, matName: string) => { const o = gltf.scene.getObjectByName(meshName) as import('three').Mesh | undefined; if (!o) return; const m = (o.material as import('three').MeshStandardMaterial).clone(); m.name = matName; o.material = m; mats[matName] = m; base[matName] = m.emissiveIntensity; };
      own('Antenna_Ball', 'NX_Antenna'); own('Forehead_LED', 'NX_Forehead');
      // the face screen: a faint reflection only (a full-strength room reflection washes the whole flat screen white when the head tilts up)
      { const sc = mats.NX_Screen as import('three').MeshPhysicalMaterial; sc.envMap = scene.environment; sc.envMapIntensity = 0.08; sc.needsUpdate = true; }
      // eyelids use the screen's own material (so they read as screen) clipped to each eye
      renderer.localClippingEnabled = true;
      for (const s of ['L', 'R'] as const) { const lid = gltf.scene.getObjectByName(`EyeLid_${s}`) as import('three').Mesh; const m = mats.NX_Screen.clone(); m.name = `NX_Lid_${s}`; m.clippingPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]; lid.material = m; mats[m.name] = m; }
      // a soft contact shadow and the stage floor
      const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005; scene.add(shadow);
      const c: Ctx = { THREE, renderer, scene, camera, rig, rest, mats, base, env: [shadow], dirty: true, raf: 0, ro: null, dispose: () => {}, lastT: 0, dist: 11, yaw: orbitRef.current, orbitRaf: 0 };
      const placeCamera = () => { const y = c.yaw, d = c.dist; camera.position.set(Math.sin(y) * d, 2.25 + d * 0.05, Math.cos(y) * d); camera.lookAt(0, 2.2, 0); };
      c.place = placeCamera;
      ctx.current = c;
      const fit = () => {
        const w = el.clientWidth || 300, h = el.clientHeight || 360;
        renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        // keep the whole robot (antenna to boots, arms raised) in view at any aspect ratio
        // antenna to boots (~4.4) with room for a raised arm
        const tall = 4.9, wide = 3.5; const fov = (camera.fov * Math.PI) / 180;
        const dist = Math.max(tall / 2 / Math.tan(fov / 2), wide / 2 / (Math.tan(fov / 2) * camera.aspect)) * 1.05;
        c.dist = dist; placeCamera(); camera.updateProjectionMatrix();
        request();
      };
      c.ro = new ResizeObserver(fit); c.ro.observe(el); fit();
      // the graphics driver can drop the context (GPU reset, too many contexts): show the 2D robot with "Retry 3D"
      // instead of a frozen, empty stage
      const onLost = (e: Event) => { e.preventDefault(); if (!dead) onFail?.('The 3D view failed to start again after the graphics context was lost'); };
      renderer.domElement.addEventListener('webglcontextlost', onLost);
      c.dispose = () => {
        c.ro?.disconnect(); cancelAnimationFrame(c.raf); cancelAnimationFrame(c.orbitRaf);
        renderer.domElement.removeEventListener('webglcontextlost', onLost);
        const seen = new Set<unknown>();
        scene.traverse((o) => {
          const m = o as import('three').Mesh; m.geometry?.dispose();
          for (const mat of ([] as (import('three').Material | undefined)[]).concat(m.material as never)) {
            if (!mat || seen.has(mat)) continue; seen.add(mat);
            for (const v of Object.values(mat)) if ((v as import('three').Texture | null)?.isTexture) (v as import('three').Texture).dispose();
            mat.dispose();
          }
        });
        scene.environment?.dispose();
        renderer.dispose(); renderer.forceContextLoss();   // give the WebGL context back now, not whenever garbage collection runs
        renderer.domElement.remove();
      };
      el.dataset.ready = '1'; delete el.dataset.progress;
      if (import.meta.env.DEV) (el as unknown as { __nx?: Ctx }).__nx = c;   // dev-only handle for debugging
      if (pending.current.v) glowTo(applyChannels(rig, rest, pending.current.v));
      onReady?.();
      request();
    })().catch((e) => { if (!dead) onFail?.(`The 3D view failed to start (${(e as Error).message})`); });
    return () => { dead = true; ctx.current?.dispose(); ctx.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // viewing angle: eases to the requested yaw (instantly under reduced motion)
  useEffect(() => {
    const target = props.orbit ?? 0;
    const id = setInterval(() => {
      const c = ctx.current; if (!c?.place) return; clearInterval(id);
      cancelAnimationFrame(c.orbitRaf);
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const step = () => { const d = target - c.yaw; c.yaw = reduce || Math.abs(d) < 0.002 ? target : c.yaw + d * 0.16; c.place!(); request(); if (c.yaw !== target) c.orbitRaf = requestAnimationFrame(step); };
      step();
    }, 30);
    return () => clearInterval(id);
  }, [props.orbit]);  

  // colours for the theme (classic dark NEXUS / white and light-blue NEXUS)
  useEffect(() => {
    const id = setInterval(() => {
      const c = ctx.current; if (!c) return; clearInterval(id);
      const k = skin3d(skin, pal);
      for (const [name, col] of Object.entries(k.materials)) { const m = c.mats[name]; if (!m) continue; m.color.set(col.color); if (col.emissive) m.emissive.set(col.emissive); }
      for (const s of ['L', 'R']) c.mats[`NX_Lid_${s}`]?.color.set(k.materials.NX_Screen.color);
      c.renderer.toneMappingExposure = k.exposure;
      // dark theme: the face and light strips are screens — keep their colour instead of letting tone mapping wash it out
      for (const n of ['NX_Eye', 'NX_Pupil', 'NX_Mouth', 'NX_Brow', 'NX_Trim', 'NX_Core', 'NX_LED_Blue', 'NX_Spark', 'NX_Forehead', 'NX_Cheek']) { const m = c.mats[n]; if (!m) continue; m.roughness = 1; if (m.toneMapped !== (skin === 'light')) { m.toneMapped = skin === 'light'; m.needsUpdate = true; } }   // matte: no white glare on the LEDs
      c.dirty = true; if (pending.current.v) { glowTo(applyChannels(c.rig, c.rest, pending.current.v)); clipLids(); }
      indicate(pending.current.ind);
    }, 30);
    return () => clearInterval(id);
  }, [skin, palKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // stage environment: floor ring for "lab", grid for "grid", nothing for "transparent"
  useEffect(() => {
    const id = setInterval(() => {
      const c = ctx.current; if (!c) return; clearInterval(id);
      const { THREE } = c;
      for (const o of c.env.slice(1)) { c.scene.remove(o); const m = o as import('three').Mesh; m.geometry?.dispose(); (m.material as import('three').Material | undefined)?.dispose(); }
      c.env = c.env.slice(0, 1);
      const k = skin3d(skin, pal);
      if (env === 'lab' && effects) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.1, 64), new THREE.MeshBasicMaterial({ color: k.floor, transparent: true, opacity: 0.35 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; c.scene.add(ring); c.env.push(ring);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ color: k.floor, transparent: true, opacity: 0.1 }));
        disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001; c.scene.add(disc); c.env.push(disc);
      } else if (env === 'grid') {
        const grid = new THREE.GridHelper(8, 32, k.floor, k.floor); (grid.material as import('three').Material).opacity = 0.18; (grid.material as import('three').Material).transparent = true; c.scene.add(grid); c.env.push(grid);
      }
      request();
    }, 30);
    return () => clearInterval(id);
  }, [env, effects, skin, palKey]); // eslint-disable-line react-hooks/exhaustive-deps  

  return <div ref={host} className={`robot3d ${props.className ?? ''}`} role="img" data-skin={skin} aria-label={props.title ?? (skin === 'light' ? 'NEXUS in 3D, a small white and light-blue robot' : 'NEXUS in 3D, a small blue and black robot')} />;
});
