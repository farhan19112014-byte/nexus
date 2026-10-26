/**
 * [A125] NEXUS 3D: the GLB contains every named, pivoted part the driver needs; the same channels that drive the 2D
 * robot move the 3D one in the same directions (character's left = +x, raise = away from the body).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { applyChannels, RIG_NODES, type Rig } from '../../character3d/rig3d';
import { restPose } from '../../../shared/channels';
import { SKIN_3D } from '../../character3d/skins3d';

const glb = () => { const b = readFileSync('public/models/nexus.glb'); expect(b.readUInt32LE(0)).toBe(0x46546c67); const len = b.readUInt32LE(12); return { json: JSON.parse(b.subarray(20, 20 + len).toString()) as { nodes: { name: string; translation?: number[]; children?: number[]; mesh?: number }[]; meshes: { primitives: { targets?: unknown[]; material?: number }[]; extras?: { targetNames?: string[] } }[]; materials: { name: string }[] }, bytes: b.length }; };

const v3 = () => { const o = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { o.x = x; o.y = y; o.z = z; return o; } }; return o; };
const fakeRig = () => Object.fromEntries(RIG_NODES.map((n) => [n, { position: v3(), rotation: v3(), scale: v3(), visible: true, ...(n === 'Mouth_Line' ? { morphTargetInfluences: [0, 0], morphTargetDictionary: { smile: 0, frown: 1 } } : {}) }])) as unknown as Rig;

describe('[A125] 3D model file', () => {
  it('[A125] nexus.glb exists, is browser-sized, and has every driven part, the mouth morphs and the NX_* materials', () => {
    expect(existsSync('public/models/nexus.glb')).toBe(true);
    const { json, bytes } = glb();
    expect(bytes).toBeLessThan(2.5 * 1024 * 1024);
    const names = new Set(json.nodes.map((n) => n.name));
    for (const n of [...RIG_NODES, 'NEXUS', 'Torso', 'Face_Screen', 'Chest_Light', 'Antenna_Ball', 'Forehead_LED', 'Ear_L', 'Ear_R']) expect(names.has(n), n).toBe(true);
    const line = json.nodes.find((n) => n.name === 'Mouth_Line')!; const m = json.meshes[line.mesh!];
    expect(m.primitives[0].targets).toHaveLength(2); expect(m.extras?.targetNames).toEqual(['smile', 'frown']);
    const mats = new Set(json.materials.map((x) => x.name));
    for (const n of ['NX_Shell', 'NX_Screen', 'NX_Eye', 'NX_Mouth', 'NX_Core', 'NX_LED_Blue', 'NX_Pupil', 'NX_Cheek']) expect(mats.has(n), n).toBe(true);
    for (const n of Object.keys(SKIN_3D.light.materials).filter((k) => !['NX_Antenna'].includes(k) && k !== 'NX_Lid')) expect(mats.has(n), n).toBe(true);
    // pivots sit at the joints: arms at the shoulders (±0.58), legs at the hips (±0.30), head at the neck, character's left = +x
    const t = (n: string) => json.nodes.find((x) => x.name === n)!.translation ?? [0, 0, 0];
    expect(t('Arm_L')[0]).toBeCloseTo(0.58); expect(t('Arm_R')[0]).toBeCloseTo(-0.58); expect(t('Leg_L')[0]).toBeCloseTo(0.3);
    expect(t('Head')[1]).toBeCloseTo(1.04, 2); expect(t('Body')[1]).toBeCloseTo(1.34, 2);
  });
});

describe('[A125] channel → 3D mapping', () => {
  it('[A125] rest pose is neutral; raising the left arm rotates it outward (+z), the right one mirrored; knee lift bends forward', () => {
    const rig = fakeRig(); const rest = {};
    applyChannels(rig, rest, restPose());
    expect(Math.abs(rig.Body.rotation.y)).toBe(0); expect(rig.Mouth_Line.morphTargetInfluences![0]).toBeCloseTo(0.2);
    const v = { ...restPose(), 'armL.raise': 90, 'armR.raise': 90, 'legL.lift': 1, 'head.nod': 1, 'head.rot': 10, 'body.facing': 1 };
    applyChannels(rig, rest, v);
    expect(rig.Arm_L.rotation.z).toBeCloseTo(Math.PI / 2); expect(rig.Arm_R.rotation.z).toBeCloseTo(-Math.PI / 2);
    expect(rig.Leg_L.rotation.x).toBeLessThan(0); expect(rig.Shin_L.rotation.x).toBeGreaterThan(0);
    expect(rig.Head.rotation.x).toBeGreaterThan(0); expect(rig.Head.rotation.z).toBeLessThan(0);
    expect(rig.Body.rotation.y).toBeCloseTo(0.6);                               // a real three-quarter turn
  });
  it('[A125] blink, happy eyes, speech mouth and glow follow the face channels', () => {
    const rig = fakeRig();
    let g = applyChannels(rig, {}, { ...restPose(), 'eyeL.open': 0, 'eyes.happy': 1, 'mouth.open': 0.8, 'mouth.curve': -1, 'chest.glow': 0, cheeks: 1 });
    expect(rig.Eye_L.scale.y).toBeCloseTo(0.06); expect(rig.EyeLid_L.visible).toBe(true); expect(rig.Pupil_L.visible).toBe(false);
    expect(rig.Mouth_Open.visible).toBe(true); expect(rig.Mouth_Open.scale.y).toBeCloseTo(0.8); expect(rig.Mouth_Line.morphTargetInfluences).toEqual([0, 1]);
    expect(g.chest).toBeCloseTo(0.35); expect(g.cheeks).toBeCloseTo(0.75);
    g = applyChannels(rig, {}, { ...restPose(), 'mouth.round': 1 });
    expect(rig.Mouth_O.visible).toBe(true); expect(rig.Mouth_Line.visible).toBe(false); expect(g.face).toBeCloseTo(restPose()['face.glow']);
  });
});
