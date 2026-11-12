/**
 * Outfit kit: procedural clothing fitted to the NEXUS model's own proportions (tools/nexus3d/build-model.mjs —
 * torso superellipsoid 0.59 × 0.5 × 0.43 around y 0.46 in the Torso node; arms pivot at the shoulders, legs at the
 * hips). A proper outfit covers the BODY — a closed top with full sleeves, and trousers down to the boots — and never
 * the head, face, antenna, hands or boots. While clothed, the chest and back parts the clothes cover are hidden
 * (COVERED_PARTS) so nothing pokes through; the forehead light keeps showing NEXUS's state.
 * No textures, no downloaded assets; clothing is added as extra meshes on the model's existing nodes and removed again.
 */
import type * as T3 from 'three';
type THREE = typeof T3;

/** the torso shell's shape (must match build-model.mjs) */
export const TORSO = { cy: 0.46, a: 0.59, b: 0.5, c: 0.43, e1: 0.55, e2: 0.5 };
/** the robot's own parts under the clothes, hidden while an outfit is worn (they would poke through) and shown again after */
export const COVERED_PARTS = ['Chest_Panel', 'Chest_Ring', 'Chest_Light', 'Chest_Bar', 'Torso_Trim', 'Back_Panel', 'Back_Vent_1', 'Back_Vent_2', 'Back_Vent_3'];
const sp = (w: number, m: number) => Math.sign(w) * Math.abs(w) ** m;

export type Node = 'Torso' | 'Arm_L' | 'Arm_R' | 'Forearm_L' | 'Forearm_R' | 'Hand_R' | 'Leg_L' | 'Leg_R' | 'Shin_L' | 'Shin_R';
export interface Piece { attach: Node; object: T3.Object3D; accessory?: boolean }
type Scale = [number, number, number];
/** outer layer (jacket, coat, vest) and inner layer (shirt / scrub top) scales of the torso shape */
export const JACKET: Scale = [1.07, 1.025, 1.075];
export const SHIRT: Scale = [1.035, 1.012, 1.04];

/** Front surface depth z of a superellipsoid at (x, y) (y from its centre), or 0 outside it. */
export function surfaceZ(x: number, y: number, a: number, b: number, c: number, e1: number, e2: number): number {
  const Y = Math.abs(y / b) ** (2 / e1); if (Y >= 1) return 0;
  const R = (1 - Y) ** (e1 / e2) - Math.abs(x / a) ** (2 / e2); if (R <= 0) return 0;
  return c * R ** (e2 / 2);
}
/** z on a layer's outer surface at (x, y) — where badges, trims and ties sit */
export const onLayer = (x: number, y: number, s: Scale = JACKET) => surfaceZ(x, y - TORSO.cy, TORSO.a * s[0], TORSO.b * s[1], TORSO.c * s[2], TORSO.e1, TORSO.e2);
export const onJacket = (x: number, y: number) => onLayer(x, y, JACKET);

/** a V neckline: open where y > bottom and |x| < (y - bottom) × slope */
export const vNeck = (bottom: number, slope: number) => (x: number, y: number) => y > bottom && Math.abs(x) < (y - bottom) * slope;
/** half-width of a V neckline at height y (for lapels and trims) */
export const vHalf = (bottom: number, slope: number, y: number) => Math.max(0, (y - bottom) * slope);

/**
 * A torso layer (jacket / coat / vest / shirt): the torso shape at `scale`, cut at the neck and at `hem`, with front
 * openings where `cut(x, y)` is true (on the front half only). The torso's own hips stay covered by the trouser seat.
 */
export function torsoLayer(THREE: THREE, mat: T3.Material, o: { scale?: Scale; cut?: (x: number, y: number) => boolean; hem?: number; name?: string } = {}): T3.Mesh {
  const [sx, sy, sz] = o.scale ?? JACKET; const a = TORSO.a * sx, b = TORSO.b * sy, c = TORSO.c * sz; const seg = 40;
  const pos: number[] = []; const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const v = -Math.PI / 2 + (Math.PI * i) / seg;
    for (let j = 0; j <= seg * 2; j++) {
      const u = -Math.PI + (Math.PI * j) / seg;
      pos.push(a * sp(Math.cos(v), TORSO.e1) * sp(Math.sin(u), TORSO.e2), TORSO.cy + b * sp(Math.sin(v), TORSO.e1), c * sp(Math.cos(v), TORSO.e1) * sp(Math.cos(u), TORSO.e2));
    }
  }
  const row = seg * 2 + 1; const hem = o.hem ?? -0.02; const P = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg * 2; j++) {
    const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
    const q = [P(p0), P(p3)]; const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[1][1]) / 2, cz = (q[0][2] + q[1][2]) / 2;
    if (cy < hem || cy > TORSO.cy + b * 0.93) continue;                          // hem; the neck (and head) stay clear
    if (cz > 0 && o.cut?.(cx, cy)) continue;                                     // neckline
    idx.push(p0, p1, p2, p1, p3, p2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.name = o.name ?? 'Outfit_Shell'; return m;
}

/** A strip lying on a layer's surface (lapels, piping, zips, circuit traces) through `pts`, `w` wide. */
export function surfaceStrip(THREE: THREE, mat: T3.Material, pts: [number, number][], w: number, lift = 0.012, name = 'Outfit_Strip', layer: Scale = JACKET): T3.Mesh {
  const pos: number[] = []; const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]; const [nx, ny] = pts[Math.min(i + 1, pts.length - 1)]; const [px, py] = pts[Math.max(i - 1, 0)];
    let dx = nx - px, dy = ny - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const ox = -dy * w / 2, oy = dx * w / 2;
    for (const [qx, qy] of [[x + ox, y + oy], [x - ox, y - oy]]) pos.push(qx, qy, onLayer(qx, qy, layer) + lift);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.name = name; return m;
}

/** Lapels / trims along both edges of a V neckline. */
export function vEdges(THREE: THREE, mat: T3.Material, bottom: number, slope: number, w: number, name = 'Outfit_Lapel', top = 0.95): T3.Mesh[] {
  return [1, -1].map((s) => {
    const pts: [number, number][] = []; for (let k = 0; k <= 12; k++) { const y = bottom + (top - bottom) * (k / 12); pts.push([s * (vHalf(bottom, slope, y) + w * 0.45), y]); }
    return surfaceStrip(THREE, mat, pts, w, 0.014, `${name}_${s > 0 ? 'L' : 'R'}`);
  });
}

/** Full sleeves: shoulder cap, upper sleeve, elbow, forearm sleeve with a cuff — the hands stay free. */
export function sleeves(THREE: THREE, mat: T3.Material, cuff?: T3.Material): Piece[] {
  const out: Piece[] = [];
  for (const s of ['L', 'R'] as const) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 20, 14), mat); cap.name = `Outfit_Shoulder_${s}`;
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.142, 0.26, 6, 18), mat); up.position.y = -0.19; up.name = `Outfit_Sleeve_${s}`;
    out.push({ attach: `Arm_${s}`, object: cap }, { attach: `Arm_${s}`, object: up });
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.142, 18, 12), mat); elbow.name = `Outfit_Elbow_${s}`;
    const lo = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.14, 6, 18), mat); lo.position.y = -0.12; lo.name = `Outfit_Forearm_${s}`;
    out.push({ attach: `Forearm_${s}`, object: elbow }, { attach: `Forearm_${s}`, object: lo });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.133, 0.018, 8, 26), cuff ?? mat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.215; ring.name = `Outfit_Cuff_${s}`;
    out.push({ attach: `Forearm_${s}`, object: ring });
  }
  return out;
}

/** Trousers: a seat over the hips and both legs from hip to boot top (tucked into the boots). */
export function trousers(THREE: THREE, mat: T3.Material, crease?: T3.Material): Piece[] {
  const seat = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat); seat.scale.set(0.52, 0.11, 0.4); seat.position.y = 0.02; seat.name = 'Outfit_Seat';
  const out: Piece[] = [{ attach: 'Torso', object: seat }];
  for (const s of ['L', 'R'] as const) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.198, 0.42, 6, 20), mat); thigh.position.y = -0.27; thigh.name = `Outfit_Thigh_${s}`;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.188, 20, 14), mat); knee.name = `Outfit_Knee_${s}`;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.182, 0.3, 6, 20), mat); shin.position.y = -0.25; shin.name = `Outfit_Shin_${s}`;
    out.push({ attach: `Leg_${s}`, object: thigh }, { attach: `Shin_${s}`, object: knee }, { attach: `Shin_${s}`, object: shin });
    if (crease) for (const [node, y, h, r] of [[`Leg_${s}`, -0.27, 0.5, 0.199], [`Shin_${s}`, -0.25, 0.36, 0.183]] as const) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, 0.006), crease); c.position.set(0, y, r); c.name = 'Outfit_Crease'; out.push({ attach: node as Node, object: c });
    }
  }
  return out;
}

/** A collar band around the base of the neck (the neck itself and the head stay uncovered). */
export function collarBand(THREE: THREE, mat: T3.Material, o: { r?: number; tube?: number; y?: number; points?: boolean } = {}): T3.Object3D {
  const g = new THREE.Group(); g.name = 'Outfit_Collar';
  const band = new THREE.Mesh(new THREE.TorusGeometry(o.r ?? 0.24, o.tube ?? 0.04, 10, 36), mat); band.rotation.x = Math.PI / 2; band.scale.set(1.12, 1, 0.92); band.position.y = o.y ?? 0.955; g.add(band);
  if (o.points) for (const s of [1, -1]) {
    const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(s * 0.12, 0.012); tri.lineTo(s * 0.035, -0.11); tri.lineTo(0, 0);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), mat); m.position.set(s * 0.025, 0.955, onLayer(s * 0.07, 0.9, SHIRT) + 0.03); m.rotation.x = -0.35; g.add(m);
  }
  return g;
}

/** A small badge on the left chest (character's left = +x), facing out from the jacket surface. */
export function badgeAt(obj: T3.Object3D, x = 0.43, y = 0.74): T3.Object3D {
  obj.position.set(x, y, onJacket(x, y) + 0.018); obj.rotation.y = Math.atan2(x, 1.6); obj.rotation.x = -0.12; return obj;
}
/** small round buttons down the front */
export function buttons(THREE: THREE, mat: T3.Material, x: number, ys: number[]): T3.Object3D[] {
  return ys.map((y) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14), mat); b.rotation.x = Math.PI / 2; b.position.set(x, y, onJacket(x, y) + 0.012); b.name = 'Outfit_Button'; return b; });
}

export const cloth = (THREE: THREE, color: number, o: Partial<T3.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, side: THREE.DoubleSide, ...o });
export const glow = (THREE: THREE, color: number, k = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.35, metalness: 0 });
export const metal = (THREE: THREE, color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.85 });
