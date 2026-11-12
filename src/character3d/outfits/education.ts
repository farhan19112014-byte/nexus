/** Education outfit: a modern navy vest over a light-blue shirt with full sleeves, grey-navy trousers, a small
 * open-book badge and an optional slim digital pointer in the right hand. Smart, approachable — not childish. */
import type * as T3 from 'three';
import { SHIRT, badgeAt, buttons, cloth, collarBand, glow, metal, sleeves, torsoLayer, trousers, vEdges, vNeck, type Piece } from './kit';

const V = { bottom: 0.56, slope: 0.9 };
export function build(THREE: typeof T3): Piece[] {
  const navy = cloth(THREE, 0x1b2b4c, { roughness: 0.72 }); const shirt = cloth(THREE, 0xa9d4ff, { roughness: 0.6 }); const page = cloth(THREE, 0xf5f8ff, { roughness: 0.5 });
  const pants = cloth(THREE, 0x39465c, { roughness: 0.75 }); const light = glow(THREE, 0x7cc4ff, 0.8); const btn = cloth(THREE, 0x0f1a30, { roughness: 0.4 });
  const torso = new THREE.Group(); torso.name = 'Outfit_Education';
  torso.add(
    torsoLayer(THREE, shirt, { scale: SHIRT, name: 'Outfit_Shirt' }),
    torsoLayer(THREE, navy, { cut: vNeck(V.bottom, V.slope), hem: -0.05 }),
    ...vEdges(THREE, navy, V.bottom, V.slope, 0.05, 'Outfit_VestEdge'), collarBand(THREE, shirt, { points: true }),
    ...buttons(THREE, btn, 0, [0.3, 0.18, 0.06]),
  );
  // open-book badge
  const book = new THREE.Group(); book.name = 'Outfit_Emblem';
  for (const s of [1, -1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.046, 0.005), page); p.position.x = s * 0.019; p.rotation.y = s * -0.35; book.add(p); }
  book.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.048, 0.008), navy));
  // digital pointer: a slim stylus in the right hand with a soft light at the tip
  const pointer = new THREE.Group(); pointer.name = 'Outfit_Pointer';
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.3, 12), metal(THREE, 0xc4ccd8)); rod.rotation.x = Math.PI / 2; rod.position.set(0, -0.04, 0.15); pointer.add(rod);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), light); tip.position.set(0, -0.04, 0.3); pointer.add(tip);
  return [{ attach: 'Torso', object: torso }, { attach: 'Torso', object: badgeAt(book, 0.44, 0.76), accessory: true }, { attach: 'Hand_R', object: pointer, accessory: true }, ...sleeves(THREE, shirt), ...trousers(THREE, pants)];
}
