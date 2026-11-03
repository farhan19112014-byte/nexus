/**
 * Physical checks for full-body clips, by forward kinematics on the real skeleton (skeleton.ts, verified against the
 * GLB). Used by the unit tests and shown live in the motion preview lab — an animation is only called complete when
 * these hold on every frame:
 *   ground   – no part of the robot goes below the floor (soles, helmet, palms, knees)
 *   planted  – feet that a clip plants stay on the floor (no sliding up/down)
 *   bodyHit  – palms and elbows never pass through the torso or the helmet; the two palms never pass through each other
 *   speed    – no joint snaps: angular speed and frame-to-frame change stay under physical limits
 */
import { add, dot, len, qangle, rot, sub, type V3 } from './math';
import { fk, insideShell, JOINTS, lowestPoint, SKELETON, type BodyPose } from './skeleton';
export { lowestPoint };
import { ClipSampler, isPlant, type Clip } from './clip';

export function bodyHits(p: BodyPose): string[] {
  const f = fk(p); const out: string[] = [];
  const torsoQ = f.body.q, helmetQ = f.head.q;
  const T = SKELETON.torso, H = SKELETON.helmet;
  for (const s of ['L', 'R'] as const) {
    const a = f.arm[s];
    // the palm sphere must stay outside the torso and the helmet shells
    if (insideShell(a.palm, f.torsoCenter, T.half, T.e1, T.e2, torsoQ, SKELETON.palm.r * 0.85)) out.push(`palm ${s} in torso`);
    if (insideShell(a.palm, f.helmetCenter, H.half, H.e1, H.e2, helmetQ, SKELETON.palm.r * 0.85)) out.push(`palm ${s} in helmet`);
    // elbow joint and the middle of the forearm (an arm passing straight through would pass both end tests)
    if (insideShell(a.elbow, f.torsoCenter, T.half, T.e1, T.e2, torsoQ, 0.02)) out.push(`elbow ${s} in torso`);
    if (insideShell(a.elbow, f.helmetCenter, H.half, H.e1, H.e2, helmetQ, 0.02)) out.push(`elbow ${s} in helmet`);
    const mid = [(a.elbow[0] + a.wrist[0]) / 2, (a.elbow[1] + a.wrist[1]) / 2, (a.elbow[2] + a.wrist[2]) / 2] as V3;
    if (insideShell(mid, f.torsoCenter, T.half, T.e1, T.e2, torsoQ, 0.03)) out.push(`forearm ${s} in torso`);
    if (insideShell(mid, f.helmetCenter, H.half, H.e1, H.e2, helmetQ, 0.03)) out.push(`forearm ${s} in helmet`);
    // knees never pass into the torso (tucks)
    if (insideShell(f.leg[s].knee, f.torsoCenter, T.half, T.e1, T.e2, torsoQ, 0.05)) out.push(`knee ${s} in torso`);
  }
  const d = len(sub(f.arm.L.palm, f.arm.R.palm));
  if (d < SKELETON.palm.r * 2 - 0.035) out.push(`palms overlap (${d.toFixed(3)})`);
  return out;
}

export interface ClipReport {
  id: string; frames: number;
  minGround: number; lowest: string;
  plantedMaxError: number;
  hits: string[];
  maxSpeed: number; maxSpeedJoint: string;       // rad/s
  maxJerk: number;                               // largest velocity discontinuity (rad/s, 480 Hz frames)
  jerkAt: number;
  palmMin: number; palmContacts: number;         // for claps
  rootPitchTotal: number;                        // for flips / rolls (deg)
  ok: boolean;
}

export const LIMITS = {
  ground: -0.02,          // m below the floor (rounding, sole bevels)
  planted: 0.02,          // m of vertical sole drift on a planted foot
  speed: 26,              // rad/s — the fastest joint motion a clip may use (a backflip tuck); a snap is far above this
  /** a SNAP is a velocity discontinuity: it does not shrink with the frame time. Measured at 480 Hz, where even a
   *  very hard smooth acceleration (1000 rad/s²) changes speed by only ~2 rad/s per frame. */
  snap: 3,
};

export function analyzeClip(clip: Clip, hz = 120): ClipReport {
  const snapRes = snapScan(clip);
  const s = new ClipSampler(clip); const dt = 1 / hz; const n = Math.ceil(clip.duration * hz);
  let minG = Infinity, lowest = '', plantErr = 0, maxSpeed = 0, maxJ = '', maxJerk = 0, palmMin = Infinity, contacts = 0, touching = false;
  const hits = new Map<string, number>(); const prevSpeed = new Map<string, number>(); let jerkAt = 0, speedAt = 0, lowAt = 0;
  let prev = s.sample(0);
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  for (let i = 0; i <= n; i++) {
    const t = Math.min(clip.duration, i * dt); const p = s.sample(t);
    const lo = lowestPoint(p); if (lo.y < minG) { minG = lo.y; lowest = lo.what; lowAt = t; }
    for (const h of bodyHits(p)) if (!hits.has(h.replace(/ \(.*/, ''))) hits.set(h.replace(/ \(.*/, ''), t);
    const f = fk(p);
    // planted feet: both surrounding keys plant that foot with no lift → its sole must be on the floor
    const k1 = keys.findIndex((k) => k.t >= t); const ka = keys[Math.max(0, k1 - 1)], kb = keys[Math.max(0, k1)];
    for (const side of ['L', 'R'] as const) {
      const la = (side === 'L' ? ka?.legL : ka?.legR) ?? { plant: true }, lb = (side === 'L' ? kb?.legL : kb?.legR) ?? { plant: true };
      if (isPlant(la) && isPlant(lb) && !la.lift && !lb.lift) { const sole = Math.min(...f.leg[side].soleCorners.map((c) => c[1])); plantErr = Math.max(plantErr, Math.abs(sole)); }
    }
    const d = len(sub(f.arm.L.palm, f.arm.R.palm)); palmMin = Math.min(palmMin, d);
    const touch = d < SKELETON.palm.r * 2 + 0.012; if (touch && !touching) contacts++; touching = touch;
    if (i > 0) {
      const mv = [['root', qangle(prev.rootRot, p.rootRot)] as const, ...JOINTS.map((j) => [j, qangle(prev.joints[j], p.joints[j])] as const)];
      for (const [j, a] of mv) {
        const sp = a / dt; if (sp > maxSpeed) { maxSpeed = sp; maxJ = j; speedAt = t; }
        const ps = prevSpeed.get(j); if (ps !== undefined && Math.abs(sp - ps) > maxJerk) { maxJerk = Math.abs(sp - ps); jerkAt = t; } prevSpeed.set(j, sp);
      }
    }
    prev = p;
  }
  maxJerk = snapRes.v; jerkAt = snapRes.at;
  const pitch = (k: number) => clip.keys.reduce((m, x) => (x.t <= k ? x.root?.pitch ?? m : m), 0);
  const r: ClipReport = {
    id: clip.id, frames: n + 1, minGround: minG, lowest: `${lowest}@${lowAt.toFixed(2)}`, plantedMaxError: plantErr, hits: [...hits].map(([h, at]) => `${h}@${at.toFixed(2)}`), maxSpeed, maxSpeedJoint: `${maxJ}@${speedAt.toFixed(2)}`, maxJerk, jerkAt,
    palmMin, palmContacts: contacts, rootPitchTotal: pitch(clip.duration) - pitch(0), ok: false,
  };
  r.ok = r.minGround >= LIMITS.ground && r.plantedMaxError <= LIMITS.planted && !r.hits.length && r.maxSpeed <= LIMITS.speed && r.maxJerk <= LIMITS.snap;
  return r;
}

/** helper for checks: forward direction of a palm relative to the chest (used by the clap test) */
export const inFrontOfChest = (p: BodyPose, s: 'L' | 'R') => { const f = fk(p); return dot(sub(f.arm[s].palm, add(f.body.o, rot(f.body.q, [0, 0.5, 0]))), rot(f.body.q, [0, 0, 1])); };

/** largest frame-to-frame change of any joint's angular speed at 480 Hz (rad/s) — a velocity discontinuity */
export function snapScan(clip: Clip, hz = 480) {
  const s = new ClipSampler(clip); const dt = 1 / hz; let v = 0, at = 0, joint = '';
  let p0 = s.sample(0), p1 = s.sample(dt);
  for (let t = 2 * dt; t <= clip.duration + 1e-9; t += dt) {
    const p = s.sample(t);
    for (const j of JOINTS) { const d = Math.abs(qangle(p1.joints[j], p.joints[j]) - qangle(p0.joints[j], p1.joints[j])) / dt; if (d > v) { v = d; at = t; joint = j; } }
    const r = Math.abs(qangle(p1.rootRot, p.rootRot) - qangle(p0.rootRot, p1.rootRot)) / dt; if (r > v) { v = r; at = t; joint = 'root'; }
    p0 = p1; p1 = p;
  }
  return { v, at, joint };
}
