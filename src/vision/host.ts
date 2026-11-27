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
/** how often the user asked to open / toggle the panel (robot dock button or the chat's Camera button) */
let opens = 0;
/** fired on window when the user asks for the panel, so the app can close a drawer that would cover it */
export const VISION_OPEN_EVENT = 'nexus:vision-open';
export const visionHost = {
  get instance() { return instance; },
  /** the camera is on (or starting / paused) — for the dock button's state */
  get on() { return status === 'live' || status === 'paused' || status === 'starting'; },
  subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  getStatus: () => status,
  getOpens: () => opens,
  /** Show (or, if shown, hide) the Live Vision panel. Never starts the camera: that needs "Activate" in the panel. */
  requestOpen() { opens++; listeners.forEach((f) => f()); if (typeof window !== 'undefined') window.dispatchEvent(new Event(VISION_OPEN_EVENT)); },
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
