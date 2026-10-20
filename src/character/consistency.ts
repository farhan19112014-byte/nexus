/**
 * Asset 08 — visual consistency rules. Pure checks over channel values, used by the skill
 * validator/sandbox and by tests. Rules prevent misplaced features and broken-looking poses.
 */
import { CHANNELS, restOf, type Channel } from '../../shared/channels';
import { GEOMETRY as G, armFK } from './geometry';

export interface Violation { code: string; message: string; severity: 'error' | 'warning' }
const val = (v: Partial<Record<Channel, number>>, ch: Channel) => v[ch] ?? restOf(ch);

const SCREEN = { x0: G.screen.cx - G.screen.w / 2, x1: G.screen.cx + G.screen.w / 2, y0: G.screen.cy - G.screen.h / 2, y1: G.screen.cy + G.screen.h / 2 };
const EYE_BAND = { x0: 200 - G.eye.dx - G.eye.w, x1: 200 + G.eye.dx + G.eye.w, y0: G.eye.y - G.eye.h / 2, y1: G.eye.y + G.eye.h / 2 };
const inside = (p: { x: number; y: number }, r: { x0: number; x1: number; y0: number; y1: number }) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

export function checkConsistency(v: Partial<Record<Channel, number>>): Violation[] {
  const out: Violation[] = [];
  for (const s of ['L', 'R'] as const) {
    if (v[`arm${s}.raise` as Channel] === undefined && v[`arm${s}.bend` as Channel] === undefined) continue;
    const { hand } = armFK(s, val(v, `arm${s}.raise` as Channel), val(v, `arm${s}.bend` as Channel));
    // compare in body space; the face moves with head.x/head.y/head.nod (see Robot.apply)
    const dy = val(v, 'head.y') + val(v, 'head.nod') * 12, dx = val(v, 'head.x');
    const shift = (r: typeof SCREEN) => ({ x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy });
    const p = { x: hand.x, y: hand.y };
    if (inside(p, shift(EYE_BAND))) out.push({ code: 'hand_covers_eyes', message: `${s === 'L' ? 'Left' : 'Right'} hand covers the eyes`, severity: 'error' });
    else if (inside(p, shift(SCREEN))) out.push({ code: 'hand_on_face', message: `${s === 'L' ? 'Left' : 'Right'} hand overlaps the face screen`, severity: 'warning' });
  }
  const airborne = val(v, 'body.y') < -6;
  if (val(v, 'legL.lift') > 0.5 && val(v, 'legR.lift') > 0.5 && !airborne && v['legL.lift'] !== undefined)
    out.push({ code: 'no_support', message: 'Both feet lifted while standing on the ground', severity: 'warning' });
  if (Math.abs(val(v, 'pupil.x')) > 0.98 && Math.abs(val(v, 'head.rot')) > 22)
    out.push({ code: 'extreme_gaze', message: 'Extreme gaze combined with a strong head tilt', severity: 'warning' });
  for (const ch of Object.keys(v) as Channel[]) {
    const d = CHANNELS[ch]; const x = v[ch]!;
    if (!Number.isFinite(x)) out.push({ code: 'nan', message: `${ch} is not a finite number`, severity: 'error' });
    else if (x < d.min - (d.max - d.min) * 0.02 || x > d.max + (d.max - d.min) * 0.02) out.push({ code: 'range', message: `${ch} outside its permitted deformation range`, severity: 'error' });
  }
  return out;
}
