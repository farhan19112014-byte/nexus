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
import { SKIN_3D } from './skins3d';

type Three = typeof import('three');
interface Ctx {
  THREE: Three; renderer: import('three').WebGLRenderer; scene: import('three').Scene; camera: import('three').PerspectiveCamera;
  rig: Rig; rest: Rest; mats: Record<string, import('three').MeshStandardMaterial>; base: Record<string, number>;
  env: import('three').Object3D[]; dirty: boolean; raf: number; ro: ResizeObserver | null; dispose: () => void;
}

export interface Robot3DProps extends RobotProps { onFail?: (reason: string) => void; onReady?: () => void }

export const MODEL_URL = () => withBase('/models/nexus.glb');

export const Robot3D = forwardRef<RigHandle, Robot3DProps>(function Robot3D(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const pending = useRef<{ v: Record<Channel, number> | null; ind: Indicator }>({ v: null, ind: 'idle' });
  const theme = useResolvedTheme();
  const skin = props.skin ?? theme;
  const skinRef = useRef(skin); skinRef.current = skin;
  const env = props.environment ?? 'lab';
  const effects = props.effects ?? true;
  const { onFail, onReady } = props;

  const request = () => { const c = ctx.current; if (!c || c.raf) return; c.raf = requestAnimationFrame(() => { c.raf = 0; c.renderer.render(c.scene, c.camera); }); };
  const glowTo = (g: Glow) => {
    const c = ctx.current; if (!c) return;
    const boost = SKIN_3D[skinRef.current].glow;
    const set = (name: string, k: number) => { const m = c.mats[name]; if (m) m.emissiveIntensity = (c.base[name] ?? 1) * k * (boost[name] ?? 1); };
    for (const n of ['NX_Eye', 'NX_Mouth', 'NX_Brow', 'NX_Spark']) set(n, g.face);
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
    const k = SKIN_3D[skin];
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
    apply(v) { pending.current.v = v; const c = ctx.current; if (!c) return; glowTo(applyChannels(c.rig, c.rest, v)); clipLids(); request(); },
  }), [skin]); // eslint-disable-line react-hooks/exhaustive-deps

  // create the renderer and load the model once
  useEffect(() => {
    let dead = false;
    (async () => {
      const el = host.current; if (!el) return;
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') ?? probe.getContext('webgl'))) { onFail?.('WebGL is not available in this browser'); return; }
      const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([import('three'), import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/environments/RoomEnvironment.js')]);
      if (dead) return;
      let gltf;
      try { gltf = await new GLTFLoader().loadAsync(MODEL_URL()); } catch (e) { onFail?.(`The 3D model could not be loaded (${(e as Error).message})`); return; }
      if (dead) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('role', 'presentation');
      el.append(renderer.domElement);
      const scene = new THREE.Scene();
      const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
      const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-3, 6, 5);
      const rim = new THREE.DirectionalLight(0x6fb6ff, 2.2); rim.position.set(4, 2, -4);
      const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0b1733, 0.5);
      scene.add(key, rim, hemi, gltf.scene);
      const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
      // nodes, rest pivots, materials (cloned where one part must glow independently)
      const rig = {} as Rig; const rest: Rest = {}; const missing: string[] = [];
      for (const n of RIG_NODES) { const o = gltf.scene.getObjectByName(n); if (!o) missing.push(n); else { rig[n] = o as unknown as Rig[typeof n]; rest[n] = { x: o.position.x, y: o.position.y, z: o.position.z }; } }
      if (missing.length) { renderer.dispose(); renderer.domElement.remove(); onFail?.(`The 3D model is missing parts: ${missing.join(', ')}`); return; }
      const mats: Ctx['mats'] = {}; const base: Record<string, number> = {};
      gltf.scene.traverse((o) => { const m = (o as import('three').Mesh).material as import('three').MeshStandardMaterial | undefined; if (m?.name && !mats[m.name]) { mats[m.name] = m; base[m.name] = m.emissiveIntensity ?? 1; } });
      const own = (meshName: string, matName: string) => { const o = gltf.scene.getObjectByName(meshName) as import('three').Mesh | undefined; if (!o) return; const m = (o.material as import('three').MeshStandardMaterial).clone(); m.name = matName; o.material = m; mats[matName] = m; base[matName] = m.emissiveIntensity; };
      own('Antenna_Ball', 'NX_Antenna'); own('Forehead_LED', 'NX_Forehead');
      // eyelids use the screen's own material (so they read as screen) clipped to each eye
      renderer.localClippingEnabled = true;
      for (const s of ['L', 'R'] as const) { const lid = gltf.scene.getObjectByName(`EyeLid_${s}`) as import('three').Mesh; const m = mats.NX_Screen.clone(); m.name = `NX_Lid_${s}`; m.clippingPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]; lid.material = m; mats[m.name] = m; }
      // a soft contact shadow and the stage floor
      const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005; scene.add(shadow);
      const c: Ctx = { THREE, renderer, scene, camera, rig, rest, mats, base, env: [shadow], dirty: true, raf: 0, ro: null, dispose: () => {} };
      ctx.current = c;
      const fit = () => {
        const w = el.clientWidth || 300, h = el.clientHeight || 360;
        renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
        camera.aspect = w / h;
        // keep the whole robot (antenna to boots, arms raised) in view at any aspect ratio
        const tall = 5.0, wide = 3.6; const fov = (camera.fov * Math.PI) / 180;
        const dist = Math.max(tall / 2 / Math.tan(fov / 2), wide / 2 / (Math.tan(fov / 2) * camera.aspect)) * 1.05;
        camera.position.set(0, 2.3 + dist * 0.06, dist); camera.lookAt(0, 2.2, 0); camera.updateProjectionMatrix();
        request();
      };
      c.ro = new ResizeObserver(fit); c.ro.observe(el); fit();
      c.dispose = () => { c.ro?.disconnect(); cancelAnimationFrame(c.raf); renderer.dispose(); gltf.scene.traverse((o) => { const m = o as import('three').Mesh; m.geometry?.dispose(); }); renderer.domElement.remove(); };
      el.dataset.ready = '1';
      if (pending.current.v) glowTo(applyChannels(rig, rest, pending.current.v));
      onReady?.();
      request();
    })().catch((e) => { if (!dead) onFail?.(`The 3D view failed to start (${(e as Error).message})`); });
    return () => { dead = true; ctx.current?.dispose(); ctx.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // colours for the theme (classic dark NEXUS / white and light-blue NEXUS)
  useEffect(() => {
    const id = setInterval(() => {
      const c = ctx.current; if (!c) return; clearInterval(id);
      const k = SKIN_3D[skin];
      for (const [name, col] of Object.entries(k.materials)) { const m = c.mats[name]; if (!m) continue; m.color.set(col.color); if (col.emissive) m.emissive.set(col.emissive); }
      for (const s of ['L', 'R']) c.mats[`NX_Lid_${s}`]?.color.set(k.materials.NX_Screen.color);
      c.renderer.toneMappingExposure = k.exposure;
      indicate(pending.current.ind);
    }, 30);
    return () => clearInterval(id);
  }, [skin]); // eslint-disable-line react-hooks/exhaustive-deps

  // stage environment: floor ring for "lab", grid for "grid", nothing for "transparent"
  useEffect(() => {
    const id = setInterval(() => {
      const c = ctx.current; if (!c) return; clearInterval(id);
      const { THREE } = c;
      for (const o of c.env.slice(1)) c.scene.remove(o);
      c.env = c.env.slice(0, 1);
      const k = SKIN_3D[skin];
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
  }, [env, effects, skin]);  

  return <div ref={host} className={`robot3d ${props.className ?? ''}`} role="img" data-skin={skin} aria-label={props.title ?? (skin === 'light' ? 'NEXUS in 3D, a small white and light-blue robot' : 'NEXUS in 3D, a small blue and black robot')} />;
});
