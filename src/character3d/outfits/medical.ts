/**
 * Medical outfit: a clean white coat buttoned over a light-blue scrub top, with cyan piping, scrub trousers, a small
 * cyan cross badge and an optional compact stethoscope. (A costume: it gives NEXUS no medical credentials — the app
 * says so in Medical mode.)
 */
import type * as T3 from 'three';
import { SHIRT, badgeAt, buttons, cloth, glow, metal, onJacket, sleeves, surfaceStrip, torsoLayer, trousers, vEdges, vHalf, vNeck, type Piece } from './kit';

const V = { bottom: 0.6, slope: 0.95 };
export function build(THREE: typeof T3): Piece[] {
  const coat = cloth(THREE, 0xf4f7fb, { roughness: 0.65 }); const scrub = cloth(THREE, 0x8fc4e8, { roughness: 0.7 }); const scrubDark = cloth(THREE, 0x1d3f63, { roughness: 0.75 });
  const cyan = glow(THREE, 0x22c6f0, 0.6); const steel = metal(THREE, 0xb7c3d1); const tube = cloth(THREE, 0x1b2a3f, { roughness: 0.4 }); const btn = cloth(THREE, 0xdfe6ee, { roughness: 0.35 });
  const torso = new THREE.Group(); torso.name = 'Outfit_Medical';
  torso.add(
    torsoLayer(THREE, scrub, { scale: SHIRT, name: 'Outfit_Shirt' }),
    torsoLayer(THREE, coat, { cut: vNeck(V.bottom, V.slope), hem: -0.06 }),
    ...vEdges(THREE, coat, V.bottom, V.slope, 0.075),
    ...buttons(THREE, btn, 0, [0.3, 0.16, 0.03]),
  );
  // cyan piping along the V and down the front placket
  for (const s of [1, -1]) { const pts: [number, number][] = []; for (let k = 0; k <= 10; k++) { const y = V.bottom + (0.95 - V.bottom) * (k / 10); pts.push([s * (vHalf(V.bottom, V.slope, y) + 0.004), y]); } torso.add(surfaceStrip(THREE, cyan, pts, 0.012, 0.018, `Outfit_Piping_${s > 0 ? 'L' : 'R'}`)); }
  torso.add(surfaceStrip(THREE, cyan, [[0.035, 0.33], [0.035, -0.04]], 0.008, 0.016, 'Outfit_Placket'));
  // chest pocket with a cyan edge (right side)
  torso.add(surfaceStrip(THREE, coat, [[-0.42, 0.66], [-0.42, 0.56]], 0.15, 0.012, 'Outfit_Pocket'), surfaceStrip(THREE, cyan, [[-0.495, 0.665], [-0.345, 0.665]], 0.01, 0.02, 'Outfit_PocketEdge'));
  // cross badge (cyan, not the protected red cross emblem)
  const cross = new THREE.Group(); cross.name = 'Outfit_Emblem';
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 24), cloth(THREE, 0xffffff, { roughness: 0.4 })); plate.rotation.x = Math.PI / 2; cross.add(plate);
  for (const [w, h] of [[0.052, 0.016], [0.016, 0.052]]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.006), cyan); bar.position.z = 0.006; cross.add(bar); }
  // stethoscope: tubing around the back of the neck (below the head), both ends resting on the coat
  const zf = (x: number, y: number) => onJacket(x, y) + 0.035;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.27, 0.66, zf(0.27, 0.66)), new THREE.Vector3(0.27, 0.84, zf(0.27, 0.84)), new THREE.Vector3(0.25, 0.99, 0.13), new THREE.Vector3(0.17, 1.03, -0.12),
    new THREE.Vector3(0, 1.05, -0.24), new THREE.Vector3(-0.17, 1.03, -0.12), new THREE.Vector3(-0.25, 0.99, 0.13), new THREE.Vector3(-0.27, 0.84, zf(-0.27, 0.84)), new THREE.Vector3(-0.25, 0.7, zf(-0.25, 0.7)),
  ]);
  const steth = new THREE.Group(); steth.name = 'Outfit_Stethoscope';
  steth.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.012, 8, false), tube));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.016, 20), steel); head.rotation.x = Math.PI / 2; head.position.set(-0.25, 0.67, zf(-0.25, 0.67) + 0.008); steth.add(head);
  return [{ attach: 'Torso', object: torso }, { attach: 'Torso', object: badgeAt(cross, 0.44, 0.76), accessory: true }, { attach: 'Torso', object: steth, accessory: true }, ...sleeves(THREE, coat, cyan), ...trousers(THREE, scrubDark)];
}
