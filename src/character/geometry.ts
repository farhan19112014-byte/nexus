/**
 * Asset 03 — Character Proportion System.
 * All geometry is in a fixed 400×480 viewBox. Anchor points (joints) are defined once
 * and reused by every pose, expression and animation; renderers never invent coordinates.
 */
export const VIEWBOX = { w: 400, h: 480 } as const;

export const GEOMETRY = {
  groundY: 452,
  head: { w: 196, h: 160, cx: 200, cy: 138, neckAnchorY: 214 },
  screen: { w: 156, h: 108, cx: 200, cy: 142 },
  torso: { w: 118, h: 100, cx: 200, top: 222, neck: { w: 40, h: 14 } },
  shoulder: { dx: 58, y: 240 },            // joint offset from torso center
  upperArm: { len: 38, w: 24 },
  forearm: { len: 32, w: 22 },
  hand: { r: 15 },
  hip: { dx: 30, y: 318 },
  leg: { len: 114, w: 36, knee: 0.5, liftShorten: 0.42 },   // hip→ankle; lift foreshortens the shin
  foot: { w: 50, h: 20 },
  antenna: { baseY: 58, len: 34, ball: 9 },
  eye: { dx: 38, y: 132, w: 34, h: 44, r: 15 },
  pupilTravel: { x: 7, y: 6 },
  brow: { dy: -34, w: 28, h: 6 },
  mouth: { y: 175, w: 40 },
  cheek: { dx: 58, y: 166, rx: 11, ry: 6 },
} as const;

/** Permitted deformation ranges (Asset 03 / 08). The renderer clamps to these. */
export const DEFORMATION = {
  squash: { min: -0.12, max: 0.12 },      // body vertical squash/stretch
  facingCompress: 0.18,                    // max horizontal compression at full 3/4 facing
  headNodScale: 0.06,                       // vertical scale change at full nod
  maxBodyOffset: { x: 70, y: 40 },
} as const;

/** Lengths derived for 2D forward kinematics (validator + consistency checks). */
export function armChain(side: 'L' | 'R') {
  const s = side === 'L' ? 1 : -1; // character's LEFT is viewer's RIGHT (+x)
  return { sign: s, shoulder: { x: GEOMETRY.torso.cx + s * GEOMETRY.shoulder.dx, y: GEOMETRY.shoulder.y } };
}

/** SVG rotation (deg, clockwise) for an arm segment given the side-independent channel value. */
export const armAngle = (side: 'L' | 'R', deg: number) => (side === 'L' ? -deg : deg);

/**
 * 2D forward kinematics for the arms in un-transformed body space (Asset 08 consistency checks).
 * Returns elbow and hand-center positions.
 */
export function armFK(side: 'L' | 'R', raise: number, bend: number) {
  const { shoulder } = armChain(side);
  const rad = (d: number) => (d * Math.PI) / 180;
  const a1 = rad(armAngle(side, raise));
  const dir = (a: number) => ({ x: -Math.sin(a), y: Math.cos(a) }); // segment pointing "down" rotated clockwise by a
  const d1 = dir(a1);
  const elbow = { x: shoulder.x + d1.x * GEOMETRY.upperArm.len, y: shoulder.y + d1.y * GEOMETRY.upperArm.len };
  const a2 = a1 + rad(armAngle(side, bend));
  const d2 = dir(a2);
  const reach = GEOMETRY.forearm.len + GEOMETRY.hand.r * 0.6;
  const hand = { x: elbow.x + d2.x * reach, y: elbow.y + d2.y * reach };
  return { shoulder, elbow, hand };
}
