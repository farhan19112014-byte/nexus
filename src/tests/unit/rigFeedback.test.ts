/**
 * The real per-frame path on (mock) model nodes: channel mapping → body layer, frame after frame. The body layer writes
 * full rotations, so the channel mapping must assign every axis it does not drive — otherwise last frame's pose leaks
 * into the next as the base and the presence layer's additive motion accumulates (the hands shook while idle).
 */
import { describe, expect, it } from 'vitest';
import { applyChannels, RIG_NODES, type Rig, type Rest } from '../../character3d/rig3d';
import { applyBody } from '../../character3d/body/apply';
import { BodyController } from '../../character3d/body/controller';
import { Presence } from '../../character3d/body/presence';
import { CHANNEL_NAMES, restOf, type Channel } from '../../../shared/channels';

const v3 = () => { const o = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { o.x = x; o.y = y; o.z = z; return o; } }; return o; };
function mockRig(): { rig: Rig; rest: Rest } {
  const rig = {} as Rig; const rest: Rest = {};
  for (const n of RIG_NODES) { const s = v3(); s.set(1, 1, 1); rig[n] = { position: v3(), rotation: v3(), scale: s, visible: true, morphTargetInfluences: [], morphTargetDictionary: {} } as unknown as Rig[typeof n]; rest[n] = { x: 0, y: 0, z: 0 }; }
  return { rig, rest };
}
const channels = () => Object.fromEntries(CHANNEL_NAMES.map((c) => [c, restOf(c)])) as Record<Channel, number>;

describe('[A147] model nodes: no frame-to-frame accumulation', () => {
  for (const state of ['IDLE', 'LISTENING'] as const) it(`[A147] ${state}: the rendered hands follow the computed pose exactly (no drift, no shake)`, () => {
    const live = mockRig(); const fresh = mockRig();
    const a = new BodyController(); a.presence = new Presence(5); const b = new BodyController(); b.presence = new Presence(5);
    let maxDiff = 0; const dt = 1 / 60;
    for (let i = 0; i < 60 * 30; i++) {
      a.setState(state); b.setState(state);
      const oa = a.update(dt), ob = b.update(dt);
      applyChannels(live.rig, live.rest, channels()); applyBody(live.rig, live.rest, oa);                        // nodes reused every frame (the renderer)
      for (const n of RIG_NODES) fresh.rig[n].rotation.set(0, 0, 0);                                            // a brand-new model each frame (the reference)
      applyChannels(fresh.rig, fresh.rest, channels()); applyBody(fresh.rig, fresh.rest, ob);
      for (const j of ['Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R', 'Body', 'Shin_L', 'Foot_R'] as const)
        for (const ax of ['x', 'y', 'z'] as const) maxDiff = Math.max(maxDiff, Math.abs(live.rig[j].rotation[ax] - fresh.rig[j].rotation[ax]));
    }
    expect(maxDiff).toBeLessThan(1e-9);
  });
});
