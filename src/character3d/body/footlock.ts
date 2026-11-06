/**
 * Foot lock: the last step of every frame. Whatever the hips do (breathing, weight shifts, a lean from the expression
 * layer, a 2D-style sway, walking), the legs are solved with two-bone IK so each boot stays exactly where the
 * locomotion system planted it — flat on the floor, knees pointing along the foot. A foot the leg cannot reach makes
 * the pelvis drop a little (knees bend) instead of the boot leaving the floor.
 */
import { add, D2R, QI, qconj, qeuler, qmul, rot, sub, type Q, type V3 } from './math';
import { twoBoneIK } from './ik';
import { SKELETON, sgn, type Side } from './skeleton';
import type { FootState } from './locomotion';

// a tilted boot pivots on its toe tip (toes down, push-off: toe > 0) or its heel (toes up, heel strike: toe < 0):
// the ankle rises by the lever of the far end, so no corner of the sole ever dips into the floor
const heel = (toe: number) => 0.4 * Math.sin(Math.abs(toe) * D2R) + 0.11 * (1 - Math.cos(toe * D2R));
const smax = (a: number, b: number, k = 0.03) => (a + b + Math.sqrt((a - b) ** 2 + k * k)) / 2 - k / 2;

export interface LegSolution { leg: Q; shin: Q; foot: Q; reach: number }
/** ankle target for a foot (world) */
export const ankleOf = (f: FootState): V3 => [f.x, SKELETON.ankleHeight + smax(f.lift, heel(f.toe)), f.z];

/**
 * @param rootPos/rootRot Body_Root transform (world), @param bodyQ Body's local rotation
 * @returns per-leg local rotations, and how far (m) the pelvis must drop so both planted feet are reachable
 */
export function solveFeet(rootPos: V3, rootRot: Q, bodyQ: Q, feet: Record<Side, FootState>): { legs: Record<Side, LegSolution>; drop: number } {
  let drop = 0;
  const solve = (): Record<Side, LegSolution> => {
    const pos: V3 = [rootPos[0], rootPos[1] - drop, rootPos[2]];
    const bodyW = qmul(rootRot, bodyQ); const bodyO = add(pos, rot(rootRot, [0, SKELETON.hipHeight, 0]));
    const out = {} as Record<Side, LegSolution>;
    for (const s of ['L', 'R'] as const) {
      const f = feet[s];
      const tb = rot(qconj(bodyW), sub(ankleOf(f), bodyO));                       // ankle target in Body space
      const footW = qmul(qeuler(0, f.yaw, 0), qeuler(f.toe * D2R, 0, 0));
      const pole = rot(qconj(bodyW), rot(qeuler(0, f.yaw, 0), [0, -0.2, 1]));      // knee along the boot
      const ik = twoBoneIK(SKELETON.hip(s), tb, SKELETON.thigh, SKELETON.shin, pole, 'x', QI(), 1, 1, 0.08, true);
      const legW = qmul(bodyW, ik.upper), shinW = qmul(legW, ik.lower);
      out[s] = { leg: ik.upper, shin: ik.lower, foot: qmul(qconj(shinW), footW), reach: Math.hypot(tb[0] - sgn(s) * 0.3, tb[1], tb[2]) - (SKELETON.thigh + SKELETON.shin) };
    }
    return out;
  };
  let legs = solve();
  // keep every leg 1.5 cm short of full extension (planted or stepping): a straight knee is a singularity where a
  // millimetre of hip motion flicks the knee — real legs stay softly bent
  // the drop starts on a smooth (C1) ramp 1 cm before it is needed, so the hips never change speed abruptly
  const B = 0.01; const ramp = (e: number) => (e <= -B ? 0 : e >= B ? e : (e + B) * (e + B) / (4 * B));
  for (let i = 0; i < 4; i++) {
    const need = ramp(Math.max(...(['L', 'R'] as const).map((s) => legs[s].reach + 0.015)));
    if (need <= 1e-6) break;
    drop += need; legs = solve();
  }
  return { legs, drop };
}
