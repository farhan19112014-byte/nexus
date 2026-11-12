/** Legal outfit: a closed dark-navy suit jacket with lapels, a white shirt and a subtle blue tie in the V, matching
 * trousers, and a small silver scales-of-justice pin. Professional and composed. */
import type * as T3 from 'three';
import { SHIRT, badgeAt, buttons, cloth, collarBand, metal, onLayer, sleeves, torsoLayer, trousers, vEdges, vNeck, type Piece } from './kit';

const V = { bottom: 0.62, slope: 0.78 };
export function build(THREE: typeof T3): Piece[] {
  const navy = cloth(THREE, 0x17243f, { roughness: 0.7 }); const lapel = cloth(THREE, 0x1e2e50, { roughness: 0.42, metalness: 0.08 });
  const shirt = cloth(THREE, 0xf2f5fa, { roughness: 0.6 }); const tie = cloth(THREE, 0x2d5fb8, { roughness: 0.5, metalness: 0.05 });
  const silver = metal(THREE, 0xc4ccd8); const dark = cloth(THREE, 0x0c1424, { roughness: 0.5 });
  const torso = new THREE.Group(); torso.name = 'Outfit_Legal';
  torso.add(
    torsoLayer(THREE, shirt, { scale: SHIRT, name: 'Outfit_Shirt' }),
    torsoLayer(THREE, navy, { cut: vNeck(V.bottom, V.slope), hem: -0.05 }),
    ...vEdges(THREE, lapel, V.bottom, V.slope, 0.085), collarBand(THREE, shirt, { points: true }),
    ...buttons(THREE, dark, 0, [0.26, 0.12]),
  );
  // tie in the V: knot at the collar and a blade that stops above the chest light window
  const z = (y: number) => onLayer(0, y, SHIRT) + 0.012;
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.03), tie); knot.position.set(0, 0.915, z(0.915) + 0.01);
  const blade = new THREE.Shape(); blade.moveTo(-0.03, 0); blade.lineTo(0.03, 0); blade.lineTo(0.045, -0.13); blade.lineTo(0, -0.17); blade.lineTo(-0.045, -0.13); blade.lineTo(-0.03, 0);
  const b = new THREE.Mesh(new THREE.ShapeGeometry(blade), tie); b.position.set(0, 0.89, z(0.82) + 0.004); b.rotation.x = -0.12;
  const tieG = new THREE.Group(); tieG.name = 'Outfit_Tie'; tieG.add(knot, b);
  // scales-of-justice pin
  const pin = new THREE.Group(); pin.name = 'Outfit_Emblem';
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 24), silver); disc.rotation.x = Math.PI / 2; pin.add(disc);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.004), dark); post.position.z = 0.006; pin.add(post);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.006, 0.004), dark); beam.position.set(0, 0.018, 0.006); pin.add(beam);
  for (const s of [1, -1]) { const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.006, 12), dark); pan.rotation.x = Math.PI / 2; pan.position.set(s * 0.026, -0.004, 0.006); pin.add(pan); }
  return [{ attach: 'Torso', object: torso }, { attach: 'Torso', object: tieG, accessory: true }, { attach: 'Torso', object: badgeAt(pin, 0.44, 0.76), accessory: true }, ...sleeves(THREE, navy, shirt), ...trousers(THREE, navy, lapel)];
}
