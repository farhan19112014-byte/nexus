/**
 * Small, allocation-light 3D math for the full-body animation system (no three.js dependency, so it runs in unit
 * tests and in the frame loop alike). Quaternions are [x, y, z, w]; Euler angles use three.js's default 'XYZ' order
 * (matrix = Rx·Ry·Rz), which is what the rig's nodes use.
 */
export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export const D2R = Math.PI / 180;
export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export const QI = (): Q => [0, 0, 0, 1];
export function qmul(a: Q, b: Q): Q {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export function qnorm(q: Q): Q { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
export function qaxis(axis: V3, rad: number): Q { const a = norm(axis), s = Math.sin(rad / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(rad / 2)]; }
export function rot(q: Q, v: V3): V3 {
  // v + 2w(u×v) + 2u×(u×v)
  const u: V3 = [q[0], q[1], q[2]]; const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}
/** XYZ Euler (radians) → quaternion, identical to three.js Quaternion.setFromEuler with order 'XYZ' */
export function qeuler(x: number, y: number, z: number): Q {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
export const qeulerDeg = (e: V3) => qeuler(e[0] * D2R, e[1] * D2R, e[2] * D2R);
/** quaternion → XYZ Euler (radians), identical to three.js Euler.setFromQuaternion(q, 'XYZ') */
export function eulerOf(q: Q): V3 {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ey, 0];
}
export function slerp(a: Q, b: Q, t: number): Q {
  let [bx, by, bz, bw] = b; let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; c = -c; }
  if (c > 0.9995) return qnorm([lerp(a[0], bx, t), lerp(a[1], by, t), lerp(a[2], bz, t), lerp(a[3], bw, t)]);
  const th = Math.acos(c), s = Math.sin(th), k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
}
/** angle between two orientations (radians, 0..π) */
export function qangle(a: Q, b: Q) { const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, c)); }
/** rotation whose local x/y/z axes map to the given orthonormal (right-handed) columns */
export function qbasis(x: V3, y: V3, z: V3): Q {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return qnorm([(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]); }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return qnorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]); }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return qnorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]); }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return qnorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}
/** rotation vector (axis × angle) ⇄ quaternion: a smooth space to interpolate joint rotations in (|angle| < π) */
export function qlog(q: Q): V3 {
  const p = q[3] < 0 ? ([-q[0], -q[1], -q[2], -q[3]] as Q) : q; const s = Math.hypot(p[0], p[1], p[2]);
  if (s < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, p[3]); return [p[0] / s * ang, p[1] / s * ang, p[2] / s * ang];
}
export function qexp(r: V3): Q { const a = len(r); if (a < 1e-9) return QI(); return qaxis(r, a); }
