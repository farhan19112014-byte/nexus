/**
 * [A144] Full-body motion core: the math matches three.js exactly, the skeleton matches the GLB the browser loads,
 * IK reaches its targets with joints bending the natural way, and the neutral stance is the model's rest pose.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { add, eulerOf, len, qeuler, qmul, rot, slerp, sub, type V3 } from '../../character3d/body/math';
import { twoBoneIK } from '../../character3d/body/ik';
import { fk, SKELETON } from '../../character3d/body/skeleton';
import { ClipSampler } from '../../character3d/body/clip';

const glbNodes = () => { const b = readFileSync('public/models/nexus.glb'); const n = b.readUInt32LE(12); return (JSON.parse(b.subarray(20, 20 + n).toString()) as { nodes: { name: string; translation?: number[] }[] }).nodes; };

describe('[A144] full-body core', () => {
  it('[A144] quaternion/Euler conversions are identical to three.js (XYZ order)', () => {
    for (let i = 0; i < 200; i++) {
      const e: V3 = [Math.sin(i) * 2.5, Math.cos(i * 1.3) * 1.4, Math.sin(i * 0.7) * 3];
      const q = qeuler(...e); const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...e, 'XYZ'));
      expect(Math.abs(q[0] * tq.x + q[1] * tq.y + q[2] * tq.z + q[3] * tq.w)).toBeCloseTo(1, 9);
      const back = eulerOf(q); const te = new THREE.Euler().setFromQuaternion(tq, 'XYZ');
      expect(new THREE.Quaternion().setFromEuler(new THREE.Euler(...back, 'XYZ')).angleTo(new THREE.Quaternion().setFromEuler(te))).toBeLessThan(1e-6);   // acos precision
      const v: V3 = [0.3, -1, 0.2]; const tv = new THREE.Vector3(...v).applyQuaternion(tq);
      expect(len(sub(rot(q, v), [tv.x, tv.y, tv.z]))).toBeLessThan(1e-12);
    }
    const a = qeuler(0.2, 0, 0), b = qeuler(0, 1, 0.3); const s = slerp(a, b, 0.4); const ts = new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), 0.4);
    expect(new THREE.Quaternion(...s).angleTo(ts)).toBeLessThan(1e-6);
  });

  it('[A144] the skeleton constants are the GLB\'s pivots (IK and checks use the model the browser loads)', () => {
    const N = glbNodes(); const t = (n: string) => N.find((x) => x.name === n)!.translation ?? [0, 0, 0];
    expect(t('Body')[1]).toBeCloseTo(SKELETON.hipHeight, 3);
    expect(t('Head')).toEqual(expect.arrayContaining([expect.closeTo(SKELETON.head[1], 3)]));
    expect(t('Arm_L')[0]).toBeCloseTo(SKELETON.shoulder('L')[0], 3); expect(t('Arm_L')[1]).toBeCloseTo(SKELETON.shoulder('L')[1], 3);
    expect(-t('Forearm_L')[1]).toBeCloseTo(SKELETON.upperArm, 3); expect(-t('Hand_L')[1]).toBeCloseTo(SKELETON.forearm, 3);
    expect(t('Leg_R')[0]).toBeCloseTo(SKELETON.hip('R')[0], 3); expect(-t('Shin_L')[1]).toBeCloseTo(SKELETON.thigh, 3); expect(-t('Foot_L')[1]).toBeCloseTo(SKELETON.shin, 3);
    expect(SKELETON.hipHeight - SKELETON.thigh - SKELETON.shin).toBeCloseTo(SKELETON.ankleHeight, 3);
  });

  it('[A144] two-bone IK reaches reachable targets exactly, elbows point out/down and knees forward, fronts face forward', () => {
    const sh = SKELETON.shoulder('R'); const a = SKELETON.upperArm, b = SKELETON.forearm + SKELETON.palm.offset;
    for (const tgt of [[-0.2, 0.6, 0.55], [-0.7, 0.2, 0.3], [-0.4, 0.9, 0.6], [-0.75, 0.9, 0.7]] as V3[]) {   // in front of the body
      const ik = twoBoneIK(sh, tgt, a, b, [-0.5, -1, -0.35], 'x', [0, 0, 0, 1], -1);
      const elbow = add(sh, rot(ik.upper, [0, -a, 0]));
      const end = add(elbow, rot(qmul(ik.upper, ik.lower), [0, -b, 0]));
      expect(len(sub(end, tgt))).toBeLessThan(1e-6);
      expect(elbow[1]).toBeLessThan(Math.max(sh[1], tgt[1]) + 0.05);           // the elbow never pops above the arm line
      const mid = [(sh[0] + tgt[0]) / 2, (sh[1] + tgt[1]) / 2, (sh[2] + tgt[2]) / 2] as V3;
      expect(sub(elbow, mid)[0] * -0.5 + sub(elbow, mid)[1] * -1 + sub(elbow, mid)[2] * -0.35).toBeGreaterThan(0);   // the elbow bends toward its pole (out/down), never inward
    }
    const hip = SKELETON.hip('L'); const knee = twoBoneIK(hip, [0.3, -0.85, 0.05], SKELETON.thigh, SKELETON.shin, [0, -0.2, 1], 'x', [0, 0, 0, 1], 1, 1);
    expect(rot(knee.upper, [0, -SKELETON.thigh, 0])[2]).toBeGreaterThan(0.1);   // knee forward
  });

  it('[A144] the neutral stance is the rest pose: straight legs, soles on the floor, arms at their channel rest angles', () => {
    const p = new ClipSampler({ id: 'n', name: 'n', duration: 1, keys: [{ t: 0 }], mask: 'full', kind: 'state', doc: '' }).sample(0);   // (mid-clip the soft-knee baseline bends the knees on purpose)
    const f = fk(p);
    for (const s of ['L', 'R'] as const) { expect(Math.min(...f.leg[s].soleCorners.map((c) => c[1]))).toBeCloseTo(0, 3); expect(f.leg[s].knee[2]).toBeCloseTo(0, 3); }
    expect(eulerOf(p.joints.Arm_L)[2]).toBeCloseTo((8 * Math.PI) / 180, 6); expect(eulerOf(p.joints.Arm_R)[2]).toBeCloseTo((-8 * Math.PI) / 180, 6);
    expect(len(p.rootPos)).toBeLessThan(1e-9);
  });
});
