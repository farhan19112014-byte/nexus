/**
 * NEXUS 3D — the editable source of the 3D character (procedural, built with three.js).
 *
 *   node tools/nexus3d/build-model.mjs            → public/models/nexus.glb
 *
 * The 3D design is derived from the 2D rig's proportions (src/character/geometry.ts: 1 unit = 100 px of the 400×480
 * viewBox, ground at y = 0, facing +z) so the two versions stay the same character: big rounded helmet, inset LED face
 * screen, side "ear" discs with light rings, antenna with a glowing ball, compact torso with a recessed chest core,
 * short capsule limbs with glowing joints, and boots with a blue light strip.
 * Change a number here, run the script, and the website picks up the new nexus.glb.
 *
 * Every moving part is its own named node with its pivot at the joint (see docs/NEXUS_3D.md for the full list).
 * Materials are named NX_* so the app can recolour them for the light theme.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// GLTFExporter uses FileReader to pack the binary; Node has Blob but no FileReader
globalThis.FileReader ??= class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); this.onload?.({ target: this }); }); } readAsDataURL(b) { b.arrayBuffer().then((r) => { this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`; this.onloadend?.(); this.onload?.({ target: this }); }); } };

const OUT = process.argv[2] ?? 'public/models/nexus.glb';
const Y = (px) => (452 - px) / 100;            // 2D viewBox y → 3D height

/* ---------- materials (classic dark NEXUS; the app swaps colours for the light skin) ---------- */
const std = (name, color, o = {}) => Object.assign(new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.15, ...o }), { name });
const phys = (name, color, o = {}) => Object.assign(new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.25, ...o }), { name });
const led = (name, color, intensity = 2.2) => Object.assign(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.25, metalness: 0 }), { name });
const M = {
  shell: phys('NX_Shell', 0x2a3446),          // graphite helmet + torso
  limb: std('NX_Limb', 0x1b2230, { roughness: 0.38, metalness: 0.3 }),
  joint: std('NX_Joint', 0x0b0f17, { roughness: 0.5, metalness: 0.4 }),
  bezel: std('NX_Bezel', 0x05070b, { roughness: 0.55, metalness: 0.2 }),
  screen: phys('NX_Screen', 0x07101f, { roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
  eye: led('NX_Eye', 0x22c6f0, 0.55),
  pupil: std('NX_Pupil', 0x1f6bff, { roughness: 0.3, emissive: 0x0a2a80, emissiveIntensity: 0.6 }),
  spark: led('NX_Spark', 0xffffff, 1.5),
  lid: std('NX_Lid', 0x081120, { roughness: 0.2 }),
  brow: led('NX_Brow', 0xa9d8ff, 0.7),
  mouth: led('NX_Mouth', 0x22c6f0, 0.8),
  cheek: Object.assign(new THREE.MeshStandardMaterial({ color: 0xa9d8ff, emissive: 0xa9d8ff, emissiveIntensity: 0.8, transparent: true, opacity: 0 }), { name: 'NX_Cheek' }),
  ledBlue: led('NX_LED_Blue', 0x2f8cff, 1.3),
  trim: led('NX_Trim', 0x2f8cff, 0.9),
  core: led('NX_Core', 0x33e1ff, 1.4),
  accent: led('NX_Accent', 0x1f6bff, 1.6),
  chest: phys('NX_ChestPanel', 0x07090d, { roughness: 0.25 }),
  boot: std('NX_Boot', 0x232c3d, { roughness: 0.45, metalness: 0.25 }),
};

/* ---------- helpers ---------- */
const node = (name, parent, pos = [0, 0, 0]) => { const g = new THREE.Group(); g.name = name; g.position.set(...pos); parent?.add(g); return g; };
const mesh = (name, geo, mat, parent, pos = [0, 0, 0], rot = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(...pos); m.rotation.set(...rot); parent.add(m); return m; };
const rbox = (w, h, d, r, seg = 6) => new RoundedBoxGeometry(w, h, d, seg, r);
function roundedRect(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
const plate = (w, h, r, depth = 0.016, bevel = 0.008) => { const g = new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 }); g.translate(0, 0, -depth / 2); return g; };
const ellipse = (rx, ry, depth = 0.01) => { const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2); const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, -depth / 2); return g; };
/**
 * Superellipsoid "squircle" volume: a rounded-cube helmet / torso with a flat-ish front that a display can hug.
 * e1 (vertical) and e2 (horizontal) < 1 make it boxier; 1 is an ellipsoid.
 */
function superellipsoid(a, b, c, e1, e2, seg = 48) {
  const sp = (w, m) => Math.sign(w) * Math.abs(w) ** m;
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const v = -Math.PI / 2 + (Math.PI * i) / seg;
    for (let j = 0; j <= seg * 2; j++) {
      const u = -Math.PI + (Math.PI * j) / seg;
      const cv = Math.cos(v), sv = Math.sin(v);
      pos.push(a * sp(cv, e1) * sp(Math.sin(u), e2), b * sp(sv, e1), c * sp(cv, e1) * sp(Math.cos(u), e2));
    }
  }
  const row = seg * 2 + 1;
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg * 2; j++) { const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1; idx.push(p0, p1, p2, p1, p3, p2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = mergeVertices(g, 1e-5); m.computeVertexNormals(); return m;
}
/** front surface depth z(x, y) of that superellipsoid (for parts that sit on it) */
const surfaceZ = (a, b, c, e1, e2) => (x, y) => { const ty = 1 - Math.abs(y / b) ** (2 / e1); if (ty <= 0) return 0; const t = ty ** (e1 / e2) - Math.abs(x / a) ** (2 / e2); return t <= 0 ? 0 : c * t ** (e2 / 2); };
/** a rounded-rect panel whose surface follows z(x, y) + lift: a display or plate that hugs a curved body */
function conformPanel(w, h, r, zf, lift, thick = 0.02, n = 20) {
  const pos = [], idx = []; const hw = w / 2, hh = h / 2;
  const clampRR = (x, y) => { const cx = Math.max(Math.abs(x) - (hw - r), 0), cy = Math.max(Math.abs(y) - (hh - r), 0); const d = Math.hypot(cx, cy); if (d <= r || d === 0) return [x, y]; const k = r / d; return [Math.sign(x) * (hw - r + cx * k), Math.sign(y) * (hh - r + cy * k)]; };
  for (const side of [0, 1]) for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const [x, y] = clampRR(-hw + (w * j) / n, -hh + (h * i) / n);
    pos.push(x, y, zf(x, y) + lift - side * thick);
  }
  const row = n + 1, off = row * row;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1; idx.push(p0, p1, p2, p1, p3, p2); idx.push(off + p0, off + p2, off + p1, off + p1, off + p2, off + p3); }
  for (let k = 0; k < n; k++) for (const [a, b] of [[k, k + 1], [n * row + k + 1, n * row + k], [(k + 1) * row, k * row], [k * row + n, (k + 1) * row + n]]) idx.push(a, b, off + a, b, off + b, off + a);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = mergeVertices(g, 1e-6); m.computeVertexNormals(); return m;
}
const capsule = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 5, 14);
const cyl = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Mouth ribbon along a quadratic curve; morph targets "smile" and "frown" bend it, x-scale makes it wider. */
function mouthGeometry() {
  const N = 24, W = 0.40, T = 0.05, D = 0.02, bend = 0.105;
  const mk = (k) => {                                       // k: +1 smile (middle down), −1 frown, 0 straight
    const pos = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = -W / 2 + W * t, y = -k * bend * (1 - (2 * t - 1) ** 2);
      for (const [dy, dz] of [[T / 2, D], [-T / 2, D], [T / 2, -D], [-T / 2, -D]]) pos.push(x, y + dy, dz);
    }
    return new Float32Array(pos);
  };
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mk(0), 3));
  const idx = [];
  for (let i = 0; i < N; i++) { const a = i * 4, b = (i + 1) * 4; idx.push(a, a + 1, b, a + 1, b + 1, b); idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); idx.push(a, b, a + 2, a + 2, b, b + 2); idx.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1); }
  const e = N * 4; idx.push(0, 2, 1, 1, 2, 3, e, e + 1, e + 2, e + 1, e + 3, e + 2);
  g.setIndex(idx);
  g.morphAttributes.position = [new THREE.BufferAttribute(mk(1).map((v, i) => v - mk(0)[i]), 3), new THREE.BufferAttribute(mk(-1).map((v, i) => v - mk(0)[i]), 3)];
  g.morphTargetsRelative = true;
  g.computeVertexNormals(); return g;
}

/* ---------- the character ---------- */
const root = node('NEXUS', null);
const bodyRoot = node('Body_Root', root);                  // stage offset + squash (about the ground)
const body = node('Body', bodyRoot, [0, Y(318), 0]);       // pivot at the hips: lean + three-quarter turn
const B = (px) => Y(px) - Y(318);                          // height relative to the hips

// torso
const torso = node('Torso', body);
const TA = 0.59, TB = 0.5, TC = 0.43, TE1 = 0.55, TE2 = 0.5;
mesh('Torso_Shell', superellipsoid(TA, TB, TC, TE1, TE2, 32), M.shell, torso, [0, B(272), 0]);
const tz = surfaceZ(TA, TB, TC, TE1, TE2); const tcy = B(266) - B(272);
mesh('Torso_Waist', rbox(1.06, 0.12, 0.78, 0.06), M.joint, torso, [0, B(318) + 0.06, 0]);
mesh('Neck', cyl(0.19, 0.22, 0.2), M.joint, torso, [0, B(222) + 0.06, 0]);
mesh('Chest_Panel', conformPanel(0.62, 0.46, 0.14, (x, y) => tz(x, y + tcy), 0.016, 0.03, 24), M.chest, torso, [0, B(266), 0]);
mesh('Torso_Trim', conformPanel(0.98, 0.8, 0.3, (x, y) => tz(x, y), 0.006, 0.004, 32), M.trim, torso, [0, B(272), 0]);
mesh('Torso_Inset', conformPanel(0.95, 0.77, 0.28, (x, y) => tz(x, y), 0.009, 0.003, 32), M.shell, torso, [0, B(272), 0]);
const cz = tz(0, tcy) + 0.016;
mesh('Chest_Ring', new THREE.TorusGeometry(0.155, 0.018, 12, 40), M.ledBlue, torso, [0, B(266), cz + 0.01]);
mesh('Chest_Light', new THREE.SphereGeometry(0.11, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.core, torso, [0, B(266), cz], [Math.PI / 2, 0, 0]);
mesh('Chest_Bar', plate(0.28, 0.04, 0.02, 0.01, 0.004), M.ledBlue, torso, [0, B(300), tz(0, B(300) - B(272)) + 0.01]);
for (const s of [1, -1]) for (let i = 0; i < 3; i++) mesh(`Torso_Vent_${s > 0 ? 'L' : 'R'}${i + 1}`, plate(0.16, 0.045, 0.02, 0.01, 0.004), M.accent, torso, [s * 0.592, B(252 + i * 12), 0.05], [0, s * Math.PI / 2, 0]);

// back: a small service panel with three blue vents
mesh('Back_Panel', conformPanel(0.46, 0.34, 0.1, (x, y) => -tz(x, y + (B(266) - B(272))) , 0.0, 0.02, 20), M.chest, torso, [0, B(266), 0]).scale.z = -1;
for (let i = 0; i < 3; i++) mesh(`Back_Vent_${i + 1}`, plate(0.26, 0.035, 0.015, 0.008, 0.004), M.accent, torso, [0, B(256 + i * 10), -tz(0, B(256 + i * 10) - B(272)) - 0.035], [0, Math.PI, 0]);

// head (pivot at the neck)
const head = node('Head', body, [0, B(214), 0]);
const H = (px) => Y(px) - Y(214);
const HA = 0.98, HB = 0.8, HC = 0.72, HE1 = 0.5, HE2 = 0.44;          // helmet half-sizes and squareness
mesh('Head_Shell', superellipsoid(HA, HB, HC, HE1, HE2, 44), M.shell, head, [0, H(138), 0]);
const hz = surfaceZ(HA, HB, HC, HE1, HE2);
const sy = H(142) - H(138);                                          // screen centre relative to the helmet centre
const fz = (x, y) => hz(x, y + sy);                                  // helmet front, in screen-centred coordinates
mesh('Face_Bezel', conformPanel(1.66, 1.18, 0.26, fz, 0.012, 0.05), M.bezel, head, [0, H(142), 0]);
mesh('Face_Trim', conformPanel(1.6, 1.12, 0.23, fz, 0.018, 0.004), M.trim, head, [0, H(142), 0]);
mesh('Face_Screen', conformPanel(1.56, 1.08, 0.21, fz, 0.024, 0.01), M.screen, head, [0, H(142), 0]);
mesh('Forehead_LED', plate(0.18, 0.035, 0.015, 0.01, 0.004), M.ledBlue, head, [0, H(80), hz(0, H(80) - H(138)) + 0.004]);
const antenna = node('Antenna', head, [0, H(58) - 0.04, 0]);
mesh('Antenna_Stalk', cyl(0.028, 0.034, 0.36), M.limb, antenna, [0, 0.18, 0]);
mesh('Antenna_Ball', new THREE.SphereGeometry(0.09, 24, 16), M.core, antenna, [0, 0.38, 0]);
for (const s of [1, -1]) {
  const side = s > 0 ? 'L' : 'R';
  const ear = node(`Ear_${side}`, head, [s * 0.95, H(134), 0]);
  mesh(`Ear_${side}_Disc`, cyl(0.24, 0.27, 0.16, 36), M.limb, ear, [s * 0.05, 0, 0], [0, 0, Math.PI / 2]);
  mesh(`Ear_${side}_Cap`, cyl(0.15, 0.17, 0.04, 32), M.joint, ear, [s * 0.14, 0, 0], [0, 0, Math.PI / 2]);
  mesh(`Ear_${side}_Ring`, new THREE.TorusGeometry(0.11, 0.024, 12, 32), M.ledBlue, ear, [s * 0.16, 0, 0], [0, Math.PI / 2, 0]);
}
// face (on the screen, z ≈ 0.745); FACE node moves as one for gaze/parallax
const face = node('Face', head, [0, 0, fz(0, 0) + 0.03]);          // just in front of the screen
for (const s of [1, -1]) {
  const side = s > 0 ? 'L' : 'R';
  const eye = node(`Eye_${side}`, face, [s * 0.38, H(132), 0]);       // scale.y = blink, whole eye scale = eyes.size
  mesh(`Eye_${side}_LED`, plate(0.34, 0.44, 0.15, 0.012, 0.006), M.eye, eye);
  mesh(`Pupil_${side}`, new THREE.CircleGeometry(0.09, 28), M.pupil, eye, [0, 0, 0.016]);
  mesh(`EyeSpark_${side}`, new THREE.CircleGeometry(0.032, 16), M.spark, eye, [0.04, 0.05, 0.018]);
  mesh(`EyeLid_${side}`, ellipse(0.175, 0.17, 0.006), M.lid, eye, [0, -0.34, 0.022]).scale.set(0.001, 0.001, 1);  // rises for "happy" crescent eyes
  mesh(`Brow_${side}`, plate(0.28, 0.06, 0.03, 0.01, 0.004), M.brow, face, [s * 0.38, H(132) + 0.34, 0.004]);
  mesh(`Cheek_${side}`, ellipse(0.11, 0.06), M.cheek, face, [s * 0.58, H(166), 0.002]);
}
const mouth = node('Mouth', face, [0, H(175), 0.006]);
const line = mesh('Mouth_Line', mouthGeometry(), M.mouth, mouth); line.updateMorphTargets(); line.morphTargetDictionary = { smile: 0, frown: 1 }; line.morphTargetInfluences = [0.2, 0];
mesh('Mouth_Open', ellipse(0.17, 0.11, 0.008), M.mouth, mouth, [0, -0.02, 0.002]).scale.set(1, 0.001, 1);
mesh('Mouth_O', new THREE.TorusGeometry(0.065, 0.022, 10, 28), M.mouth, mouth).scale.set(0.001, 0.001, 0.001);

// arms (pivot at the shoulder; raise = rotation about z, bend at the elbow, spin at the wrist)
for (const s of [1, -1]) {
  const side = s > 0 ? 'L' : 'R';
  const arm = node(`Arm_${side}`, body, [s * 0.58, B(240), 0]);
  mesh(`Shoulder_${side}`, new THREE.SphereGeometry(0.14, 20, 14), M.shell, arm);
  mesh(`UpperArm_${side}`, capsule(0.115, 0.42), M.limb, arm, [0, -0.2, 0]);
  const fore = node(`Forearm_${side}`, arm, [0, -0.38, 0]);
  mesh(`Elbow_${side}`, new THREE.SphereGeometry(0.1, 20, 14), M.joint, fore);
  mesh(`Elbow_${side}_LED`, new THREE.SphereGeometry(0.055, 16, 12), M.ledBlue, fore, [0, 0, 0.075]);
  mesh(`LowerArm_${side}`, capsule(0.105, 0.36), M.limb, fore, [0, -0.17, 0]);
  const hand = node(`Hand_${side}`, fore, [0, -0.36, 0]);
  mesh(`Hand_${side}_Palm`, new THREE.SphereGeometry(0.15, 20, 14), M.shell, hand, [0, -0.03, 0]);
  mesh(`Hand_${side}_Thumb`, capsule(0.04, 0.14), M.shell, hand, [s * 0.1, 0.06, 0.05], [0, 0, s * 0.6]);
}
// legs (pivot at the hip; spread = rotation about z, lift = real knee bend)
for (const s of [1, -1]) {
  const side = s > 0 ? 'L' : 'R';
  const leg = node(`Leg_${side}`, body, [s * 0.3, 0, 0]);
  mesh(`Thigh_${side}`, capsule(0.17, 0.6), M.limb, leg, [0, -0.28, 0]);
  const shin = node(`Shin_${side}`, leg, [0, -0.57, 0]);
  mesh(`Knee_${side}`, new THREE.SphereGeometry(0.135, 20, 14), M.joint, shin);
  mesh(`Knee_${side}_LED`, new THREE.SphereGeometry(0.06, 16, 12), M.ledBlue, shin, [0, 0, 0.11]);
  mesh(`Shin_${side}_Mesh`, capsule(0.155, 0.56), M.limb, shin, [0, -0.27, 0]);
  const foot = node(`Foot_${side}`, shin, [0, -0.57, 0]);
  mesh(`Boot_${side}`, rbox(0.46, 0.22, 0.64, 0.09), M.boot, foot, [s * 0.03, -0.09, 0.07]);
  mesh(`Boot_${side}_Strip`, plate(0.34, 0.035, 0.015, 0.01, 0.004), M.accent, foot, [s * 0.03, -0.15, 0.395]);
}

/* ---------- export ---------- */
// smaller file: no texture coordinates needed, shared vertices indexed
root.traverse((o) => { if (o.isMesh) { const g = o.geometry; g.deleteAttribute('uv'); g.deleteAttribute('uv1'); if (!g.morphAttributes.position) { const m = mergeVertices(g, 1e-4); m.computeVertexNormals(); o.geometry = m; } } });
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root);
const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, trs: true });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(glb));
let meshes = 0, tris = 0; root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
console.log(`wrote ${OUT}: ${(glb.byteLength / 1024).toFixed(0)} KB, ${meshes} meshes, ${Math.round(tris)} triangles, size ${box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(' × ')}`);
