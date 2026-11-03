/**
 * Analytic two-bone inverse kinematics for the NEXUS limbs (arm: shoulder–elbow–palm, leg: hip–knee–ankle).
 * Each bone hangs along its local −y at rest. The elbow is a hinge about the forearm's local z (the axis the existing
 * rig already bends it on), the knee a hinge about the shin's local x. The pole vector chooses which way the joint
 * points (elbows out/down, knees forward), so limbs never flip or twist unnaturally. Unreachable targets are clamped to
 * a slightly bent full reach (never a locked, snapping straight limb).
 */
import { clamp, cross, dot, len, norm, qbasis, qconj, qmul, rot, scale, sub, add, type Q, type V3 } from './math';

export interface IkResult { upper: Q; lower: Q; reached: boolean; bend: number }

/**
 * @param root joint position (parent space), @param target end position (same space), @param a,b bone lengths,
 * @param pole direction (from the root) the middle joint should point toward, @param hinge 'z' (elbow) or 'x' (knee),
 * @param parentQ orientation of the parent frame (so the result is a LOCAL rotation for the upper bone)
 * @param sign hinge-axis sign for the limb type (see below), @param reachK max reach as a fraction of a + b
 * (legs stand fully straight: 1; arms keep a hint of bend: 0.995); @param band width of the smooth reach limit
 */
export function twoBoneIK(root: V3, target: V3, a: number, b: number, pole: V3, hinge: 'x' | 'z', parentQ: Q = [0, 0, 0, 1], sign: 1 | -1 = 1, reachK = 0.995, band = 0.03, sagittalFallback = false): IkResult {
  const to = sub(target, root); let d = len(to);
  const maxR = (a + b) * reachK, minR = Math.abs(a - b) + 0.02;
  const reached = d <= maxR && d >= minR;
  // below full extension the reach limit is a smooth minimum (no kink when a target comes into reach — e.g. feet
  // meeting the floor while landing); at reachK = 1 (standing legs) it stays exact so feet reach the floor
  if (reachK < 1) { const w = band, x = d - (maxR - w); if (x > 0) d = x >= 2 * w ? maxR : maxR - w + x - (x * x) / (4 * w); }   // exact below maxR − w, C1 above
  d = clamp(d, minR, maxR);
  const dir = norm(to);
  // elbow/knee position by the law of cosines, in the plane spanned by the target direction and the pole
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  // bend plane from the pole's component perpendicular to the limb. For legs (`sagittalFallback`), as that component
  // vanishes (a body tipping over its planted feet: the knee pole ends up along the leg) the plane blends smoothly into
  // dir × x — a continuous function of the limb direction that equals the projected forward pole for any rotation in
  // the sagittal plane — so the knee can never flip.
  const pN = norm(pole); const pn = sub(pN, scale(dir, dot(pN, dir))); const pl = len(pn);
  let perp: V3;
  if (sagittalFallback) {
    const fb = norm(cross(dir, Math.abs(dir[0]) < 0.95 ? [1, 0, 0] : [0, 1, 0]));
    // a purely sagittal pole (the default "knee forward"): the sagittal fallback IS the bend direction — exact and
    // continuous for every leg orientation, including a body rotating over its feet
    if (Math.abs(pN[0]) < 1e-6) perp = fb;
    else { const w = pl >= 0.35 ? 0 : (1 - pl / 0.35) ** 2; perp = norm(add(scale(pl > 1e-9 ? scale(pn, 1 / pl) : fb, 1 - w), scale(fb, w))); }
  } else perp = pl > 1e-6 ? scale(pn, 1 / pl) : norm(cross(dir, Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const mid = add(scale(dir, a * cosA), scale(perp, a * Math.sqrt(1 - cosA * cosA)));     // relative to root
  const u = norm(mid);                                      // upper bone direction
  const f = norm(sub(scale(dir, d), mid));                  // lower bone direction
  // hinge axis: normal of the bend plane (fallback: perpendicular to the pole plane when straight)
  // hinge axis = normal of the bend plane. cross(perp, dir) is a continuous function of the target and the pole
  // (also when the limb is straight), so the bone's twist never flips between frames. `sign` fixes which way the
  // local axes face for each limb type (legs +1: knee light and boots forward; arms −1: elbow light forward).
  const h = scale(norm(cross(perp, dir)), sign);
  const y = scale(u, -1);                                   // local +y points from the joint back to the root
  const upperW = hinge === 'z' ? qbasis(norm(cross(y, h)), y, h) : qbasis(h, y, norm(cross(h, y)));
  const fl = rot(qconj(upperW), f);                         // lower direction in upper-local space (hinge comp ≈ 0)
  const ang = hinge === 'z' ? Math.atan2(fl[0], -fl[1]) : Math.atan2(-fl[2], -fl[1]);
  const lower: Q = hinge === 'z' ? [0, 0, Math.sin(ang / 2), Math.cos(ang / 2)] : [Math.sin(ang / 2), 0, 0, Math.cos(ang / 2)];
  const upper = qmul(qconj(parentQ), upperW);
  return { upper, lower, reached, bend: ang };
}
