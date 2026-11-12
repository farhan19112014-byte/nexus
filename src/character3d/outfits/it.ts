/** IT outfit: a closed dark-charcoal technical jacket with a stand-up collar and a centre zip, subtle electric-blue
 * circuit traces, two zipped utility pockets, a developer insignia, matching trousers and an optional wrist interface.
 * Restrained — no heavy cyberpunk styling. */
import type * as T3 from 'three';
import { badgeAt, cloth, collarBand, glow, onJacket, sleeves, surfaceStrip, torsoLayer, trousers, type Piece } from './kit';

export function build(THREE: typeof T3): Piece[] {
  const charcoal = cloth(THREE, 0x23272f, { roughness: 0.62, metalness: 0.06 }); const panel = cloth(THREE, 0x2e333d, { roughness: 0.55 }); const pants = cloth(THREE, 0x1b1e25, { roughness: 0.7 });
  const blue = glow(THREE, 0x2f8cff, 0.9); const screen = glow(THREE, 0x33e1ff, 0.7);
  const torso = new THREE.Group(); torso.name = 'Outfit_IT';
  torso.add(torsoLayer(THREE, charcoal, { hem: -0.05 }), collarBand(THREE, charcoal, { r: 0.25, tube: 0.06, y: 0.97 }));
  // centre zip
  torso.add(surfaceStrip(THREE, panel, [[0, 0.93], [0, -0.04]], 0.028, 0.014, 'Outfit_Zip'));
  torso.add(surfaceStrip(THREE, blue, [[0, 0.93], [0, -0.04]], 0.006, 0.02, 'Outfit_ZipLine'));
  // circuit traces on both sides, ending in small nodes
  const traces: [number, number][][] = [[[0.3, 0.86], [0.3, 0.7], [0.4, 0.6], [0.4, 0.42]], [[0.25, 0.3], [0.33, 0.22], [0.52, 0.22]]];
  for (const s of [1, -1]) for (const t of traces) {
    torso.add(surfaceStrip(THREE, blue, t.map(([x, y]) => [s * x, y] as [number, number]), 0.009, 0.016, 'Outfit_Trace'));
    const [ex, ey] = t[t.length - 1]; const node = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), blue); node.position.set(s * ex, ey, onJacket(s * ex, ey) + 0.018); node.rotation.y = Math.atan2(s * ex, 1.6); torso.add(node);
  }
  // utility pockets with a blue zip line
  for (const s of [1, -1]) torso.add(surfaceStrip(THREE, panel, [[s * 0.38, 0.14], [s * 0.38, 0.0]], 0.16, 0.014, 'Outfit_Pocket'), surfaceStrip(THREE, blue, [[s * 0.3, 0.145], [s * 0.46, 0.145]], 0.008, 0.02, 'Outfit_PocketZip'));
  // developer insignia: a hexagon with a </> glyph
  const ins = new THREE.Group(); ins.name = 'Outfit_Emblem';
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 6), panel); hex.rotation.x = Math.PI / 2; hex.rotation.y = Math.PI / 6; ins.add(hex);
  for (const s of [1, -1]) { const chev = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.004), blue); chev.position.set(s * 0.016, 0, 0.006); chev.rotation.z = s * 0.5; ins.add(chev); }
  // wrist interface over the left cuff
  const wrist = new THREE.Group(); wrist.name = 'Outfit_Wrist';
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.06, 22, 1, true), panel); band.position.y = -0.17; wrist.add(band);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.04), screen); scr.position.set(0, -0.17, 0.144); wrist.add(scr);
  return [{ attach: 'Torso', object: torso }, { attach: 'Torso', object: badgeAt(ins, 0.44, 0.76), accessory: true }, { attach: 'Forearm_L', object: wrist, accessory: true }, ...sleeves(THREE, charcoal, panel), ...trousers(THREE, pants)];
}
