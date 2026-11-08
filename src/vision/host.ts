/**
 * Live Vision host (always loaded, tiny): the camera code and its panel are a separate chunk that is downloaded only when
 * the user opens Live Vision. Until then nothing camera-related exists in the page at all.
 */
import type { LiveVision, VisionStatus } from './liveVision';
import type { ApiClient } from '../ai/apiClient';
import type { Companion } from '../core/companion';

let instance: LiveVision | null = null;
let loading: Promise<LiveVision> | null = null;
const listeners = new Set<() => void>();
let status: VisionStatus = 'off';
export const visionHost = {
  get instance() { return instance; },
  /** the camera is on (or starting / paused) — for the dock button's state */
  get on() { return status === 'live' || status === 'paused' || status === 'starting'; },
  subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  getStatus: () => status,
  load(api: ApiClient, companion: Companion): Promise<LiveVision> {
    return (loading ??= import('./liveVision').then(({ LiveVision: LV }) => {
      const v = new LV({
        analyze: (b, s) => api.task('/api/vision/analyze', b, s, 35000),
        busy: () => companion.getSnapshot().busy,
        available: () => companion.getSnapshot().caps?.vision?.available ?? null,
      });
      v.subscribe(() => { const s = v.getSnapshot().status; if (s !== status) { status = s; listeners.forEach((f) => f()); } });
      instance = v;
      const dbg = (globalThis as unknown as { nexus?: Record<string, unknown> }).nexus; if (dbg) dbg.vision = v;   // the debug/test handle
      return v;
    }).catch((e) => { loading = null; throw e; }));
  },
};
