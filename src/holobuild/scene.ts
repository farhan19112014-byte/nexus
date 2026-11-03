/**
 * HOLOBUILD: turns a validated HoloModel into three.js objects (no rendering here — HoloViewport owns the renderer).
 *
 * Shape conventions (local space, before rotation): every shape's axis is local Y. Box = width × height × depth;
 * cylinder / cone / tube / gear = diameter × height × diameter; sphere = an ellipsoid fitting the size; torus = a ring
 * lying flat in XZ (outer diameter × tube thickness × outer diameter); capsule = diameter × total length × diameter.
 */
import type * as THREE_NS from 'three';
import { MATERIALS, modelBounds, type HoloModel, type HoloPart } from '../../shared/holo';

type Three = typeof THREE_NS;
export interface Built { root: THREE_NS.Group; meshes: Map<string, THREE_NS.Mesh>; dispose: () => void }
/** imported files: geometry per mesh index, centred on its own bounding box, plus that box's size */
export interface ImportedGeometry { geometries: THREE_NS.BufferGeometry[]; sizes: [number, number, number][] }

/** Geometry for one part, in metres. `unit` = true when the geometry is unit-sized and the mesh must be scaled by `size`. */
export function partGeometry(T: Three, p: HoloPart, imported?: ImportedGeometry): { geo: THREE_NS.BufferGeometry; unit: boolean; scale?: [number, number, number] } {
  const [w, h, d] = p.size; const seg = 40;
  switch (p.shape) {
    case 'box': return { geo: new T.BoxGeometry(1, 1, 1), unit: true };
    case 'sphere': return { geo: new T.SphereGeometry(0.5, seg, Math.round(seg * 0.6)), unit: true };
    case 'cylinder': { const tp = p.taper ?? 1; return { geo: new T.CylinderGeometry(0.5 * tp, 0.5, 1, seg, 1), unit: true }; }
    case 'cone': return { geo: new T.ConeGeometry(0.5, 1, seg, 1), unit: true };
    case 'capsule': {
      const r = w / 2; const len = Math.max(0, h - w);
      return { geo: new T.CapsuleGeometry(r, len, 8, seg), unit: false, scale: [1, 1, d / w] };
    }
    case 'torus': {
      const tube = Math.min(h, w / 2) / 2; const R = Math.max(tube, w / 2 - tube);
      const g = new T.TorusGeometry(R, tube, 18, Math.max(24, seg * 1.5)); g.rotateX(-Math.PI / 2);
      return { geo: g, unit: false, scale: [1, 1, d / w] };
    }
    case 'tube': case 'gear': {
      const r = w / 2; const hole = (p.hole ?? (p.shape === 'tube' ? 0.6 : 0.18)) * r;
      const shape = new T.Shape();
      if (p.shape === 'tube') shape.absarc(0, 0, r, 0, Math.PI * 2, false);
      else {
        const n = p.teeth ?? 20; const depth = Math.min(r * 0.18, (Math.PI * 2 * r) / n / 1.6); const root = r - depth;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2, step = (Math.PI * 2) / n;
          const pts: [number, number][] = [[root, a0], [r, a0 + step * 0.25], [r, a0 + step * 0.5], [root, a0 + step * 0.75]];
          pts.forEach(([rr, a], k) => { const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0 && k === 0) shape.moveTo(x, y); else shape.lineTo(x, y); });
        }
        shape.closePath();
      }
      if (hole > 0.0001) { const hp = new T.Path(); hp.absarc(0, 0, hole, 0, Math.PI * 2, true); shape.holes.push(hp); }
      const g = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: p.shape === 'tube' ? seg : 4 });
      g.translate(0, 0, -h / 2); g.rotateX(-Math.PI / 2);
      return { geo: g, unit: false, scale: [1, 1, d / w] };
    }
    case 'mesh': {
      const i = p.mesh ?? -1; const g = imported?.geometries[i]; const s = imported?.sizes[i];
      if (!g || !s) return { geo: new T.BoxGeometry(1, 1, 1), unit: true };          // file missing → honest placeholder box
      return { geo: g.clone(), unit: false, scale: [p.size[0] / (s[0] || 1), p.size[1] / (s[1] || 1), p.size[2] / (s[2] || 1)] };
    }
  }
}

export function partMaterial(T: Three, p: HoloPart, o: { wireframe: boolean }): THREE_NS.MeshStandardMaterial {
  const def = MATERIALS[p.material];
  const m = new T.MeshStandardMaterial({ color: new T.Color(p.color ?? def.color), metalness: def.metalness, roughness: def.roughness, wireframe: o.wireframe });
  const opacity = p.material === 'glass' ? Math.min(p.opacity, MATERIALS.glass.opacity) : p.opacity;
  if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
  if (p.material === 'emissive') { m.emissive = new T.Color(p.color ?? def.color); m.emissiveIntensity = 0.9; }
  m.userData.baseEmissive = m.emissive.getHex(); m.userData.baseEmissiveIntensity = m.emissiveIntensity;
  return m;
}

/** Normalised exploded-view direction for a part: its own, or away from the model's centre (never zero). */
export function explodeDir(p: HoloPart, center: readonly number[]): [number, number, number] {
  let v = p.explode ?? [p.position[0] - center[0], p.position[1] - center[1], p.position[2] - center[2]];
  let n = Math.hypot(...v);
  if (n < 1e-6) { v = [0, 1, 0]; n = 1; }
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Builds every part (hidden parts are built but invisible, so showing them again is instant). */
export function buildModel(T: Three, m: HoloModel, o: { wireframe: boolean; imported?: ImportedGeometry }): Built {
  const root = new T.Group(); root.name = m.name; root.scale.setScalar(m.scale);
  const meshes = new Map<string, THREE_NS.Mesh>(); const b = modelBounds(m); const c = b.center.map((v) => v / m.scale);
  for (const p of m.parts) {
    const { geo, unit, scale } = partGeometry(T, p, o.imported);
    const mesh = new T.Mesh(geo, partMaterial(T, p, o));
    mesh.name = p.name;
    // `holo` survives GLB export as glTF "extras", so a re-imported HOLOBUILD file keeps names, groups and descriptions
    mesh.userData = { partId: p.id, base: [...p.position], dir: explodeDir(p, c), holo: { id: p.id, name: p.name, group: p.group, description: p.description, material: p.material } };
    mesh.position.set(...p.position);
    mesh.rotation.set(...(p.rotation.map((r) => (r * Math.PI) / 180) as [number, number, number]), 'XYZ');
    if (unit) mesh.scale.set(...p.size); else if (scale) mesh.scale.set(...scale);
    mesh.visible = p.visible; mesh.castShadow = false; mesh.receiveShadow = false;
    if ((mesh.material as THREE_NS.MeshStandardMaterial).transparent) mesh.renderOrder = 2;
    root.add(mesh); meshes.set(p.id, mesh);
  }
  return {
    root, meshes,
    dispose: () => { for (const mesh of meshes.values()) { mesh.geometry.dispose(); (mesh.material as THREE_NS.Material).dispose(); } root.clear(); },
  };
}

/** Moves parts along their exploded directions. `t` 0…1 (animated), `distance` 0…1 of the model's span. */
export function applyExplode(built: Built, m: HoloModel, t: number, distance: number): void {
  const span = Math.max(...modelBounds(m).size) / m.scale || 1;
  const k = t * distance * span * 0.45;
  for (const mesh of built.meshes.values()) {
    const base = mesh.userData.base as number[]; const dir = mesh.userData.dir as number[];
    mesh.position.set(base[0] + dir[0] * k, base[1] + dir[1] * k, base[2] + dir[2] * k);
  }
}

/** Highlights the selected part (emissive tint); restores the others. */
export function applySelection(T: Three, built: Built, selected: string | null): void {
  for (const [id, mesh] of built.meshes) {
    const mat = mesh.material as THREE_NS.MeshStandardMaterial;
    if (id === selected) { mat.emissive = new T.Color('#38d9ff'); mat.emissiveIntensity = 0.45; }
    else { mat.emissive = new T.Color(mat.userData.baseEmissive as number); mat.emissiveIntensity = mat.userData.baseEmissiveIntensity as number; }
  }
}

/** Imported GLB/GLTF → validated part list + per-mesh geometry (world transforms baked in, centred per mesh). */
export function partsFromScene(T: Three, scene: THREE_NS.Object3D, maxMeshes: number): { parts: HoloPart[]; geometry: ImportedGeometry; truncated: boolean } {
  scene.updateMatrixWorld(true);
  const meshes: THREE_NS.Mesh[] = []; scene.traverse((o) => { if ((o as THREE_NS.Mesh).isMesh) meshes.push(o as THREE_NS.Mesh); });
  const truncated = meshes.length > maxMeshes;
  const geometries: THREE_NS.BufferGeometry[] = []; const sizes: [number, number, number][] = []; const parts: HoloPart[] = [];
  const box = new T.Box3(); const all = new T.Box3();
  for (const mesh of meshes.slice(0, maxMeshes)) { const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld); g.computeBoundingBox(); all.union(g.boundingBox!); geometries.push(g); }
  // normalise: the largest dimension becomes ≤ 2 m and the object stands on y = 0, centred on x/z
  const allSize = all.getSize(new T.Vector3()); const k = allSize.length() > 0 ? Math.min(1, 2 / Math.max(allSize.x, allSize.y, allSize.z)) : 1;
  const shift = new T.Vector3(-(all.min.x + all.max.x) / 2, -all.min.y, -(all.min.z + all.max.z) / 2);
  const used = new Set<string>();
  geometries.forEach((g, i) => {
    g.translate(shift.x, shift.y, shift.z); g.scale(k, k, k); g.computeBoundingBox(); box.copy(g.boundingBox!);
    const c = box.getCenter(new T.Vector3()); const s = box.getSize(new T.Vector3()); g.translate(-c.x, -c.y, -c.z);
    const size: [number, number, number] = [Math.max(0.0005, s.x), Math.max(0.0005, s.y), Math.max(0.0005, s.z)]; sizes.push(size);
    const src = meshes[i]; const meta = (src.userData?.holo ?? {}) as { id?: unknown; name?: unknown; group?: unknown; description?: unknown; material?: unknown };
    const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
    // three.js replaces spaces in node names with "_" — undo that for display
    const nm = str(meta.name, 60) || (src.name || src.parent?.name || '').replace(/_/g, ' ').trim().slice(0, 60) || `Mesh ${i + 1}`;
    let id = (str(meta.id, 32) || nm).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || `mesh-${i + 1}`; if (!/^[a-z0-9]/.test(id)) id = `m-${id}`.slice(0, 32);
    while (used.has(id)) id = `${id.slice(0, 30)}-${i + 1}`; used.add(id);
    const mat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE_NS.MeshStandardMaterial | undefined;
    const color = mat?.color ? `#${mat.color.getHexString()}` : undefined;
    const material = typeof meta.material === 'string' && meta.material in MATERIALS ? (meta.material as HoloPart['material']) : (mat?.metalness ?? 0) > 0.5 ? 'steel' : 'plastic';
    parts.push({ id, name: nm, description: str(meta.description, 400), shape: 'mesh', size, position: [c.x, c.y, c.z], rotation: [0, 0, 0], material, ...(color ? { color } : {}), opacity: Math.max(0.05, Math.min(1, mat?.opacity ?? 1)), visible: true, group: str(meta.group, 40), shell: false, mesh: i });
  });
  return { parts, geometry: { geometries, sizes }, truncated };
}
