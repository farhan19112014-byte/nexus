/** Asset 28 — keyframe timeline math: easing, interpolation, loop mapping, mirroring. Pure & deterministic. */
import type { Easing, Keyframe, SkillDef, Track } from '../../shared/schema';
import { MIRROR_NEGATE, mirrorChannel, restOf, type Channel } from '../../shared/channels';

export function ease(kind: Easing | undefined, u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  switch (kind) {
    case 'linear': return x;
    case 'easeIn': return x * x * x;
    case 'easeOut': return 1 - (1 - x) ** 3;
    case 'step': return x < 1 ? 0 : 1;
    case 'backOut': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; }
    case 'easeInOut':
    default: return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/** Value of a track at time t. Before the first key it blends from `from` (normally the channel rest). */
export function sampleKeys(keys: Keyframe[], t: number, from: number): number {
  let pt = 0, pv = from;
  for (const k of keys) {
    if (t <= k.t) {
      const span = k.t - pt;
      return span <= 1e-6 ? k.v : pv + (k.v - pv) * ease(k.ease, (t - pt) / span);
    }
    pt = k.t; pv = k.v;
  }
  return pv;
}

export function totalDuration(s: Pick<SkillDef, 'duration' | 'loop'>, reps: number): number {
  const r = Math.max(1, reps);
  if (!s.loop) return s.duration * r;
  return s.duration + (r - 1) * Math.max(0, s.loop.end - s.loop.start);
}

/** Map playback time → clip-local time (handles loop segment repetition). */
export function localTime(s: Pick<SkillDef, 'duration' | 'loop'>, reps: number, tt: number): number {
  const r = Math.max(1, reps);
  if (!s.loop) { const k = Math.min(r - 1, Math.floor(tt / s.duration)); return Math.min(s.duration, tt - k * s.duration); }
  const { start, end } = s.loop; const L = Math.max(1e-6, end - start);
  if (tt < start) return tt;
  if (tt < start + r * L) return start + ((tt - start) % L);
  return Math.min(s.duration, tt - (r - 1) * L);
}

/** Scale a track's deviation from rest (amplitude) and optionally mirror it. */
export function prepareTracks(tracks: Track[], amplitude: number, mirrored: boolean): { channel: Channel; keys: Keyframe[] }[] {
  return tracks.map((t) => {
    const ch = (mirrored ? mirrorChannel(t.channel) : t.channel) as Channel;
    const neg = mirrored && MIRROR_NEGATE.has(t.channel as Channel);
    const rest = restOf(ch);
    return {
      channel: ch,
      keys: t.keys.map((k) => {
        const v = neg ? -k.v : k.v;
        return { ...k, v: rest + (v - rest) * amplitude };
      }),
    };
  });
}
