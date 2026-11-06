/**
 * [A147] NEXUS presence — the unified motion layer: idle life, attention, meaning-driven gestures, walking and turning
 * on planted feet. Every test drives the REAL controller + presence + composition (the same code the renderer runs)
 * frame by frame and checks the result physically on the real skeleton (forward kinematics, collision shells).
 */
import { describe, expect, it } from 'vitest';
import { BodyController, compose, restBodyPose } from '../../character3d/body/controller';
import { composeFrame } from '../../character3d/body/frame';
import { Presence } from '../../character3d/body/presence';
import { planSentence } from '../../character3d/body/gestures';
import { seeded } from '../../character3d/body/rng';
import { bodyHits, LIMITS, lowestPoint } from '../../character3d/body/checks';
import { fk, JOINTS, type BodyPose } from '../../character3d/body/skeleton';
import { qangle, qeulerDeg, D2R, len, sub, type V3 } from '../../character3d/body/math';
import type { BodyState } from '../../character3d/body/clips';

/** the channel pose of the idle robot (shared/channels defaults: arms hang slightly out, elbows a little bent) */
function channelBase(): BodyPose {
  const p = restBodyPose();
  p.joints.Arm_L = qeulerDeg([0, 0, 8]); p.joints.Arm_R = qeulerDeg([0, 0, -8]);
  p.joints.Forearm_L = qeulerDeg([0, 0, 6]); p.joints.Forearm_R = qeulerDeg([0, 0, -6]);
  return p;
}
interface Frame { t: number; pose: BodyPose; out: ReturnType<BodyController['update']> }
class Sim {
  body = new BodyController(); pres = new Presence(5); t = 0; frames: Frame[] = [];
  speechLevel = 0; speaking = false;
  /** 480 Hz where snapping is measured (a velocity discontinuity does not shrink with the frame time; see checks.ts) */
  constructor(public hz = 60) { this.body.presence = this.pres; }
  run(seconds: number, state: BodyState | ((t: number) => BodyState) = 'IDLE', hz = this.hz, each?: (t: number) => void) {
    const dt = 1 / hz; const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i++) {
      this.t += dt; each?.(this.t);
      this.body.setState(typeof state === 'function' ? state(this.t) : state);
      this.body.setSpeech(this.speaking ? this.speechLevel : 0, this.speaking);
      const out = this.body.update(dt);
      this.frames.push({ t: this.t, pose: compose(channelBase(), out.layers, out.presence), out });
    }
    return this;
  }
  /** a voice: syllables ~5/s, words separated by short dips, a pause between sentences */
  speak(text: string, seconds: number) {
    const start = this.t; this.speaking = true; this.pres.sentence(text, seconds);
    this.run(seconds, 'SPEAKING', this.hz, (t) => { const u = t - start; this.speechLevel = Math.max(0, Math.sin(u * Math.PI * 5)) * (0.5 + 0.3 * Math.sin(u * 1.7)) * (u % 0.9 < 0.75 ? 1 : 0.05); });
    this.speechLevel = 0; this.run(0.35, 'SPEAKING'); return this;
  }
}
const feetW = (p: BodyPose) => { const f = fk(p); return { L: f.leg.L.ankle, R: f.leg.R.ankle, soleL: Math.min(...f.leg.L.soleCorners.map((c) => c[1])), soleR: Math.min(...f.leg.R.soleCorners.map((c) => c[1])) }; };
/** largest joint angular speed (rad/s) and velocity jump (rad/s per frame) over the frames */
function kinematics(fr: Frame[]) {
  let maxV = 0, maxJump = 0; const prev = new Map<string, number>();
  for (let i = 1; i < fr.length; i++) {
    const dt = fr[i].t - fr[i - 1].t;
    for (const j of [...JOINTS, 'root'] as const) {
      const a = j === 'root' ? qangle(fr[i - 1].pose.rootRot, fr[i].pose.rootRot) : qangle(fr[i - 1].pose.joints[j], fr[i].pose.joints[j]);
      const v = a / dt; maxV = Math.max(maxV, v);
      const pv = prev.get(j); if (pv !== undefined) maxJump = Math.max(maxJump, Math.abs(v - pv)); prev.set(j, v);
    }
  }
  return { maxV, maxJump };
}
const hitsIn = (fr: Frame[]) => { const s = new Set<string>(); for (const f of fr) for (const h of bodyHits(f.pose)) s.add(h.replace(/ \(.*/, '')); return [...s]; };

describe('[A147] idle: NEXUS is never frozen, and never moves for no reason', () => {
  const sim = new Sim().run(90, 'IDLE');
  it('[A147] breathing: the shoulders and chest rise and fall at a calm, varying rate (≈ 11–17 breaths a minute)', () => {
    const br = sim.frames.map((f) => f.out.presence!.info.breath);
    let peaks = 0; for (let i = 2; i < br.length; i++) if (br[i - 1] > br[i - 2] && br[i - 1] >= br[i] && br[i - 1] > 0.5) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(15); expect(peaks).toBeLessThanOrEqual(27);   // 90 s
    const shrug = sim.frames.map((f) => f.pose.shrug); expect(Math.max(...shrug) - Math.min(...shrug)).toBeGreaterThan(0.08);
    // the breath cycle is not a fixed loop: its period varies
    const periods: number[] = []; let last = -1; for (let i = 2; i < br.length; i++) if (br[i - 1] > br[i - 2] && br[i - 1] >= br[i] && br[i - 1] > 0.5) { if (last >= 0) periods.push((i - last) / 60); last = i; }
    expect(Math.max(...periods) - Math.min(...periods)).toBeGreaterThan(0.15);
  });
  it('[A147] weight shifts, head repositioning and hand adjustments happen as varied events (no two in a row the same)', () => {
    const ev = sim.pres.log.filter((x) => x.startsWith('idle:')).map((x) => x.slice(5));
    expect(ev.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ev).size).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < ev.length; i++) expect(ev[i]).not.toBe(ev[i - 1]);
    const w = sim.frames.map((f) => f.out.presence!.info.weight); expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.02);
  });
  it('[A147] the head and torso are always slightly alive but never jittery (subtle, smooth, no repeated loop)', () => {
    const head = sim.frames.map((f) => f.pose.joints.Head);
    const moved = head.slice(1).reduce((m, q) => Math.max(m, qangle(q, head[0])), 0);
    expect(moved).toBeGreaterThan(1 * D2R); expect(moved).toBeLessThan(14 * D2R);
    const k = kinematics(sim.frames); expect(k.maxV).toBeLessThan(2.5); expect(k.maxJump).toBeLessThan(0.6);
    // two 10 s windows 30 s apart are not the same motion
    const a = sim.frames.slice(600, 1200).map((f) => f.pose.joints.Head[1]), b = sim.frames.slice(2400, 3000).map((f) => f.pose.joints.Head[1]);
    const diff = a.reduce((m, v, j) => Math.max(m, Math.abs(v - b[j])), 0); expect(diff).toBeGreaterThan(0.005);
  });
  it('[A147] while the hips shift, the boots stay exactly where they stand — flat on the floor, no sliding', () => {
    const f0 = feetW(sim.frames[0].pose); let slide = 0, sole = 0;
    for (const f of sim.frames) { const w = feetW(f.pose); slide = Math.max(slide, len(sub(w.L, f0.L)), len(sub(w.R, f0.R))); sole = Math.max(sole, Math.abs(w.soleL), Math.abs(w.soleR)); }
    expect(slide).toBeLessThan(0.004); expect(sole).toBeLessThan(0.012);
    expect(hitsIn(sim.frames)).toEqual([]);
  });
});

describe('[A147] conversational states', () => {
  it('[A147] listening: attentive (eyes on the user), nods on the user\'s pauses — not while they are mid-word', () => {
    const sim = new Sim(); sim.run(1, 'LISTENING');
    // the user talks for 2 s (interim updates), then pauses
    sim.run(2, 'LISTENING', 60, () => sim.pres.userActivity());
    const before = sim.pres.log.filter((x) => x === 'react:acknowledge').length;
    expect(before).toBe(0);
    sim.run(1.5, 'LISTENING');
    expect(sim.pres.log.filter((x) => x === 'react:acknowledge').length).toBe(1);
    const g = sim.frames[sim.frames.length - 1].out.presence!;
    expect(g.info.attention).toBe('user'); expect(Math.abs(g.gaze.x)).toBeLessThan(0.15);
  });
  it('[A147] thinking: the gaze turns away (up, to a side) while the answer forms — restrained, not a cartoon pose', () => {
    const sim = new Sim().run(1, 'IDLE').run(4, 'THINKING');
    const asides = sim.frames.slice(60).filter((f) => f.out.presence!.info.attention === 'aside').length / (sim.frames.length - 60);
    expect(asides).toBeGreaterThan(0.5);
    const up = sim.frames.slice(90).map((f) => f.out.presence!.gaze.y); expect(Math.min(...up)).toBeLessThan(-0.1);   // − = up
    const head = sim.frames.map((f) => f.pose.joints.Head); expect(Math.max(...head.map((q) => qangle(q, head[0])))).toBeLessThan(20 * D2R);
  });
  it('[A147] reactions are short, controlled and distinct: acknowledge, curious, surprise, discovery, correction, uncertain', () => {
    for (const kind of ['acknowledge', 'curious', 'surprise', 'discovery', 'correction', 'uncertain'] as const) {
      const sim = new Sim().run(0.5, 'IDLE'); const h0 = sim.frames[sim.frames.length - 1].pose.joints.Head;
      sim.pres.react(kind); sim.run(3, 'IDLE');
      const peak = Math.max(...sim.frames.slice(30).map((f) => qangle(f.pose.joints.Head, h0)));
      expect(peak, kind).toBeGreaterThan(2.5 * D2R); expect(peak, kind).toBeLessThan(16 * D2R);
      expect(sim.frames[sim.frames.length - 1].out.presence!.info.reaction, kind).toBeNull();     // over within 3 s
      expect(kinematics(sim.frames).maxJump, kind).toBeLessThan(1.6);
    }
  });
  it('[A147] every state → state switch is smooth (no snapping between controllers)', () => {
    const order: BodyState[] = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'EXPLAINING', 'CURIOUS', 'HAPPY', 'CONFUSED', 'SURPRISED', 'IDLE'];
    const sim = new Sim(480); for (const s of order) sim.run(1.6, s);
    // speeds stay within the clip library's own limit; no velocity discontinuity (snap) at 480 Hz — except the few
    // frames where a crossfading hand touches the torso and the collision pass deflects it around (real contact)
    const contact = sim.frames.map((f) => composeFrame(channelBase(), f.out.layers, f.out.presence).cleared).map((c) => c.L > 0 || c.R > 0);
    expect(contact.filter(Boolean).length / contact.length).toBeLessThan(0.02);
    const free = new Set(sim.frames.filter((_, i) => !contact[i] && !contact[i - 1] && !contact[i + 1] && !contact[i - 2]));
    const k = kinematics(sim.frames); expect(k.maxV).toBeLessThan(LIMITS.speed);
    let jump = 0; const pv = new Map<string, number>();
    for (let i = 1; i < sim.frames.length; i++) {
      for (const j of JOINTS) { const v = qangle(sim.frames[i - 1].pose.joints[j], sim.frames[i].pose.joints[j]) * 480; const p = pv.get(j); if (p !== undefined && free.has(sim.frames[i])) jump = Math.max(jump, Math.abs(v - p)); pv.set(j, v); }
    }
    expect(jump).toBeLessThan(LIMITS.snap);
    expect(hitsIn(sim.frames)).toEqual([]);
  });
});

describe('[A147] speech-synchronised, meaning-driven gestures', () => {
  const ctx = { state: 'speaking' as const, visual: false, lastHand: 'R' as const, recent: [], visualSide: null };
  it('[A147] the planner reads meaning: question → open palms, "you" → offer, "I" → self, "but" switches hands, size words, negation', () => {
    const r = seeded(1);
    expect(planSentence('Could you show me where it hurts?', ctx, r).map((g) => g.form)).toEqual(expect.arrayContaining(['offer', 'question']));
    expect(planSentence('I think this is the right way.', ctx, r)[0].form).toBe('self');
    const contrast = planSentence('It looks simple at first, but the inside is incredibly complicated.', ctx, r);
    const ci = contrast.findIndex((g) => g.why === 'but'); expect(ci).toBeGreaterThanOrEqual(0); if (ci > 0) expect(contrast[ci].hand).not.toBe(contrast[ci - 1].hand);
    expect(planSentence('The universe is huge.', ctx, r).map((g) => g.form)).toContain('wide');
    expect(planSentence('That is not how magnets work at all.', ctx, r).map((g) => g.form)).toContain('negate');
    expect(planSentence('Sure!', ctx, r)).toEqual([]);                                   // short lines: no hands
    expect(planSentence('Look at this picture of the Eiffel Tower.', { ...ctx, visual: true, visualSide: 'L' }, r).some((g) => g.point && g.hand === 'L')).toBe(true);
  });
  it('[A147] gestures are not on every sentence, and the same sentence is not always the same movement', () => {
    const text = 'Photosynthesis is how plants turn sunlight, water and air into the sugar they live on.';
    const forms = new Set<string>(); let none = 0;
    for (let i = 0; i < 30; i++) { const p = planSentence(text, ctx, seeded(100 + i)); if (!p.length) none++; forms.add(p.map((g) => `${g.form}/${g.hand}`).join(' ')); }
    expect(none).toBeGreaterThan(0); expect(forms.size).toBeGreaterThan(3);
  });
  it('[A147] strokes land on the voice\'s accents, the arms never pass through the body, and nothing snaps', () => {
    const sim = new Sim(480).run(0.5, 'IDLE');
    sim.speak('You might wonder why the sky is blue, but it is actually all about tiny particles scattering light.', 5);
    sim.speak('First, sunlight hits the air. Then, blue light bounces around much more than red light.', 5);
    sim.speak('Is that not amazing?', 2);
    sim.run(2.5, 'IDLE');
    const strokes = sim.pres.log.filter((x) => x.startsWith('sentence:'));
    expect(strokes.length).toBe(3);
    const armW = sim.frames.map((f) => Math.max(f.out.presence!.arms.L.w, f.out.presence!.arms.R.w));
    expect(Math.max(...armW)).toBeGreaterThan(0.95);                    // the arms really gestured
    expect(armW[armW.length - 1]).toBeLessThan(0.05);                    // and relaxed afterwards
    expect(hitsIn(sim.frames)).toEqual([]);
    const k = kinematics(sim.frames); expect(k.maxV).toBeLessThan(9); expect(k.maxJump).toBeLessThan(LIMITS.snap);
    for (const f of sim.frames) expect(lowestPoint(f.pose).y).toBeGreaterThan(-0.02);
  });
  it('[A147] an interruption retracts the hands within a second and turns attention back to the user', () => {
    const sim = new Sim(480).run(0.5, 'IDLE'); sim.speaking = true; sim.speechLevel = 0.5;
    sim.pres.sentence('Everything in the whole universe is made of tiny atoms, and you are too!', 4);
    sim.run(1.6, 'SPEAKING');
    expect(Math.max(sim.frames[sim.frames.length - 1].out.presence!.arms.L.w, sim.frames[sim.frames.length - 1].out.presence!.arms.R.w)).toBeGreaterThan(0.5);
    sim.speaking = false; sim.pres.react('interrupted'); sim.run(1.2, 'IDLE');
    const end = sim.frames[sim.frames.length - 1].out.presence!;
    expect(Math.max(end.arms.L.w, end.arms.R.w)).toBeLessThan(0.15); expect(end.info.attention).toBe('user');
    expect(kinematics(sim.frames.slice(-600)).maxJump).toBeLessThan(LIMITS.snap);
  });
});

describe('[A147] IVES and HOLOBUILD: attention and pointing use the real target position', () => {
  it('[A147] presenting a visual: the eyes, head and torso turn toward it, the near arm points at it, then attention returns', () => {
    const sim = new Sim().run(0.5, 'IDLE');
    const target: V3 = [2.4, 2.2, 0.7];                       // beside the robot, on its left (the viewer's right)
    sim.pres.setTarget('visual', target);
    sim.speaking = true; sim.speechLevel = 0.5; sim.pres.attend('visual', 2.6, true); sim.run(1.4, 'EXPLAINING');
    const f = sim.frames[sim.frames.length - 1]; const P = f.out.presence!;
    expect(P.info.attention).toBe('visual'); expect(P.info.aim).toBeLessThan(8 * D2R);   // the eyes are on it
    const k = fk(f.pose); const dir = sub(k.arm.L.palm, k.arm.L.shoulder); const toT = sub(target, k.arm.L.shoulder);
    const cos = (dir[0] * toT[0] + dir[1] * toT[1] + dir[2] * toT[2]) / (len(dir) * len(toT));
    expect(cos).toBeGreaterThan(0.8);                          // the left arm points toward the panel
    expect(P.arms.L.w).toBeGreaterThan(0.9); expect(P.arms.R.w).toBeLessThan(0.1);
    // head + torso + feet turned toward it (the robot's left): the face points much closer to the target than before
    const k2 = fk(f.pose); const face = [0, 0, 1] as V3; const fq = k2.head.q; const fw: V3 = [2 * (fq[0] * fq[2] + fq[3] * fq[1]), 0, 1 - 2 * (fq[0] * fq[0] + fq[1] * fq[1])]; void face;
    expect(Math.atan2(fw[0], fw[2])).toBeGreaterThan(30 * D2R);
    sim.speaking = false; sim.run(4, 'IDLE');
    expect(sim.frames[sim.frames.length - 1].out.presence!.info.attention).not.toBe('visual');
    expect(hitsIn(sim.frames)).toEqual([]);
  });
  it('[A147] a HOLOBUILD part on the other side: the other arm points; no target known → no pointing, no invented position', () => {
    const sim = new Sim().run(0.3, 'IDLE');
    expect(sim.pres.attend('holo', 2, true)).toBe(false);      // nothing on screen: nothing to point at
    sim.pres.setTarget('holo', [-2.2, 1.6, 0.7]); sim.speaking = true; sim.pres.attend('holo', 3, true); sim.run(2.2, 'SPEAKING');
    const P = sim.frames[sim.frames.length - 1].out.presence!; expect(P.info.attention).toBe('holo'); expect(P.arms.R.w).toBeGreaterThan(0.9); expect(P.info.aim).toBeLessThan(8 * D2R);
    expect(hitsIn(sim.frames)).toEqual([]);
  });
});

describe('[A147] walking and turning on planted feet', () => {
  it('[A147] walk across and back: alternating steps, planted feet never slide, smooth start and stop, back home', () => {
    const sim = new Sim(480).run(0.5, 'IDLE'); sim.pres.startWalkSkill();
    const planted: Record<'L' | 'R', V3 | null> = { L: null, R: null }; let slide = 0, minX = 0; const order: string[] = [];
    let was = { L: false, R: false };
    sim.run(13, 'IDLE');
    for (const f of sim.frames) {
      const P = f.out.presence!; const w = feetW(f.pose); minX = Math.min(minX, P.root.pos[0]);
      for (const s of ['L', 'R'] as const) {
        const sw = P.feet[s].swinging;
        if (sw && !was[s]) order.push(s);
        if (!sw) { const p = w[s]; if (planted[s] && !was[s]) slide = Math.max(slide, len(sub(p, planted[s]!))); if (!planted[s] || was[s]) planted[s] = p; } else planted[s] = null;
        was = { ...was, [s]: sw };
        const sole = s === 'L' ? w.soleL : w.soleR; expect(sole).toBeGreaterThan(-0.02);
      }
    }
    expect(minX).toBeLessThan(-0.6);                                     // it really went over to the side
    expect(order.length).toBeGreaterThanOrEqual(6);
    let alternations = 0; for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) alternations++;
    expect(alternations / (order.length - 1)).toBeGreaterThan(0.75);
    expect(slide).toBeLessThan(0.006);
    const end = sim.frames[sim.frames.length - 1].out.presence!;
    expect(Math.abs(end.root.pos[0])).toBeLessThan(0.05); expect(Math.abs(end.root.yaw)).toBeLessThan(0.08); expect(end.info.walking).toBe(false);
    // the swing knee peaks below 10 rad/s (~570°/s, a brisk human step); no velocity discontinuity anywhere
    const k = kinematics(sim.frames); expect(k.maxV).toBeLessThan(10); expect(k.maxJump).toBeLessThan(LIMITS.snap);
    expect(hitsIn(sim.frames)).toEqual([]);
  });
  it('[A147] turning toward a target behind the shoulder: head first, then torso, then the feet step round — no instant spin', () => {
    const sim = new Sim().run(0.4, 'IDLE');
    sim.pres.setTarget('holo', [2.4, 2.0, -0.6]); sim.pres.attend('holo', 6);
    sim.run(4, 'IDLE');
    const ys = sim.frames.map((f) => f.out.presence!.root.yaw);
    const firstMove = ys.findIndex((y) => Math.abs(y) > 0.02);
    const heads = sim.frames.map((f) => qangle(f.pose.joints.Head, sim.frames[0].pose.joints.Head));
    const headFirst = heads.findIndex((a) => a > 5 * D2R);
    expect(headFirst).toBeGreaterThan(0); expect(firstMove).toBeGreaterThan(headFirst);   // the head leads
    expect(Math.max(...ys)).toBeGreaterThan(0.4);                                        // it turned toward its left
    for (let i = 1; i < ys.length; i++) expect(Math.abs(ys[i] - ys[i - 1]) * 60).toBeLessThan(2.3);   // ≤ ~130°/s
    expect(sim.pres.log.length).toBeGreaterThan(0); expect(sim.frames[sim.frames.length - 1].out.presence!.info.steps).toBeGreaterThanOrEqual(2);
    expect(hitsIn(sim.frames)).toEqual([]);
  });
  it('[A147] reduced motion: no idle drift, no gestures, no walking (explicit clips still play, gently)', () => {
    const sim = new Sim(); sim.body.reduced = true; sim.pres.startWalkSkill(); sim.run(3, 'SPEAKING');
    const P = sim.frames[sim.frames.length - 1].out.presence!; expect(P.info.walking).toBe(false); expect(Math.max(P.arms.L.w, P.arms.R.w)).toBe(0);
    expect(P.info.breath).toBe(0);
  });
});

describe('[A147] the clip library still wins when it should', () => {
  it('[A147] an explicit action (wave, clap) takes the arms from the presence gestures and gives them back smoothly', () => {
    const sim = new Sim().run(0.4, 'IDLE'); sim.speaking = true; sim.speechLevel = 0.5;
    sim.pres.sentence('You are going to love this, I promise you that.', 4); sim.run(1.2, 'SPEAKING');
    sim.body.play('wave'); sim.run(2.6, 'SPEAKING');
    const mid = sim.frames[sim.frames.length - 60].out;
    expect(mid.action).toBe('wave');
    sim.run(1.5, 'SPEAKING');
    expect(kinematics(sim.frames).maxJump).toBeLessThan(2.5);
    expect(hitsIn(sim.frames.slice(-60))).toEqual([]);
  });
  it('[A147] a backflip still flips and lands on the planted feet (the foot lock yields to clips that move the legs)', () => {
    const sim = new Sim().run(0.4, 'IDLE'); sim.body.play('backflip'); sim.run(3.4, 'IDLE');
    const lowest = Math.min(...sim.frames.map((f) => lowestPoint(f.pose).y)); expect(lowest).toBeGreaterThan(-0.03);
    const end = feetW(sim.frames[sim.frames.length - 1].pose); expect(Math.abs(end.soleL)).toBeLessThan(0.015);
  });
});
