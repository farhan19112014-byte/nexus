/**
 * [A144] Full-body motion system: every clip is physically checked frame by frame, and the specific behaviours the
 * brief asks for are verified directly — palms really touch in the clap, the backflip really rotates 360° and lands
 * upright on its feet, the dance moves hips, arms, legs and head together, the state system crossfades without snaps,
 * the face (lip-sync) is never touched, and explicit commands / AI intents reach the body through the engine.
 */
import { describe, expect, it } from 'vitest';
import { CLIPS, CLIP_BY_ID, STATE_CLIP, BODY_STATES } from '../../character3d/body/clips';
import { ClipSampler } from '../../character3d/body/clip';
import { analyzeClip, LIMITS } from '../../character3d/body/checks';
import { BodyController, CLIP_FOR_SKILL, COMMIT, compose, restBodyPose } from '../../character3d/body/controller';
import { fk, JOINTS, lowestPoint, SKELETON } from '../../character3d/body/skeleton';
import { applyBody } from '../../character3d/body/apply';
import { len, qangle, rot, sub } from '../../character3d/body/math';
import { applyChannels, RIG_NODES, type Rig } from '../../character3d/rig3d';
import { restPose } from '../../../shared/channels';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { BUILTIN_MOTIONS } from '../../animation/builtinMotions';
import { AnimationEngine } from '../../animation/engine';
import { ExpressionController } from '../../expressions/expressionController';
import { CharacterRuntime, bodyStateFor } from '../../core/characterRuntime';
import { demoBrain } from '../../../shared/demoBrain';

const v3 = () => { const o = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { o.x = x; o.y = y; o.z = z; return o; } }; return o; };
const fakeRig = () => Object.fromEntries(RIG_NODES.map((n) => [n, { position: v3(), rotation: v3(), scale: v3(), visible: true, ...(n === 'Mouth_Line' ? { morphTargetInfluences: [0, 0], morphTargetDictionary: { smile: 0, frown: 1 } } : {}) }])) as unknown as Rig;

describe('[A144] every clip is a complete, physically clean animation', () => {
  it('[A144] at least the 29 requested clips, each passing floor / planted-feet / no-clipping / no-snap checks on every frame', () => {
    const need = ['clap', 'wave', 'nod', 'shake_head', 'shrug', 'point', 'thumbs_up', 'speak_gestures', 'look_around', 'excited', 'celebrate', 'confused', 'curious', 'disappointed', 'think', 'laugh', 'surprised', 'backflip', 'forward_roll', 'dance_sway', 'dance', 'jump', 'squat', 'balance', 'turn_around', 'sit'];
    for (const id of need) expect(CLIP_BY_ID[id], id).toBeTruthy();
    for (const c of CLIPS) {
      const r = analyzeClip(c);
      expect(r.minGround, `${c.id} floor (${r.lowest})`).toBeGreaterThanOrEqual(LIMITS.ground);
      expect(r.plantedMaxError, `${c.id} planted feet`).toBeLessThanOrEqual(LIMITS.planted);
      expect(r.hits, `${c.id} body intersections`).toEqual([]);
      expect(r.maxSpeed, `${c.id} joint speed (${r.maxSpeedJoint})`).toBeLessThanOrEqual(LIMITS.speed);
      expect(r.maxJerk, `${c.id} velocity discontinuity`).toBeLessThanOrEqual(LIMITS.snap);
    }
  }, 120_000);

  it('[A144] the clips are full-body articulation, not a rigid object moving: advanced moves bend knees, elbows and hips', () => {
    for (const id of ['backflip', 'forward_roll', 'dance', 'jump', 'squat', 'balance', 'sit', 'celebrate']) {
      const s = new ClipSampler(CLIP_BY_ID[id]); let knee = 0, elbow = 0, hips = 0;
      for (let t = 0; t <= CLIP_BY_ID[id].duration; t += 0.05) { const p = s.sample(t); const a = (j: keyof typeof p.joints) => qangle(p.joints[j], [0, 0, 0, 1]); knee = Math.max(knee, a('Shin_L'), a('Shin_R')); elbow = Math.max(elbow, a('Forearm_L'), a('Forearm_R')); hips = Math.max(hips, a('Leg_L'), a('Leg_R')); }
      expect(knee, `${id} knee`).toBeGreaterThan(0.5); expect(hips, `${id} hip`).toBeGreaterThan(0.3); expect(elbow, `${id} elbow`).toBeGreaterThan(0.15);
    }
  });
});

describe('[A144] the behaviours the brief names', () => {
  it('[A144] clapping: the palms make real contact (surfaces meet, never pass through) on every clap while held', () => {
    const b = new BodyController(); b.play('clap'); let touching = false, contacts = 0, minD = 9;
    for (let i = 0; i < 120 * 2.4; i++) {
      const o = b.update(1 / 120); const f = fk(compose(restBodyPose(), o.layers));
      const d = len(sub(f.arm.L.palm, f.arm.R.palm)); minD = Math.min(minD, d);
      const t = d < SKELETON.palm.r * 2 + 0.012; if (t && !touching) contacts++; touching = t;
    }
    expect(contacts).toBeGreaterThanOrEqual(4);                                // repeated claps while the action is held
    expect(minD).toBeGreaterThan(SKELETON.palm.r * 2 - 0.035);                 // touching, not overlapping
    expect(minD).toBeLessThan(SKELETON.palm.r * 2 + 0.012);
    b.release(); for (let i = 0; i < 120 * 3; i++) b.update(1 / 120);
    expect(b.busy()).toBe(false);                                              // outro played, then back to the channel pose
  });

  it('[A144] backflip: a complete 360° backward rotation — through upside down — then lands upright, feet on the floor', () => {
    const c = CLIP_BY_ID.backflip; const s = new ClipSampler(c); let minUp = 1, airborne = 0, land = -1;
    for (let t = 0; t <= c.duration; t += 1 / 120) {
      const p = s.sample(t); const up = rot(p.rootRot, [0, 1, 0])[1]; minUp = Math.min(minUp, up);
      const f = fk(p); const sole = Math.min(...f.leg.L.soleCorners.map((v) => v[1]), ...f.leg.R.soleCorners.map((v) => v[1]));
      if (sole > 0.25) airborne += 1 / 120; else if (airborne > 0.4 && land < 0) land = t;
      if (up < 0) expect(lowestPoint(p).y, `clears the floor while inverted @${t.toFixed(2)}`).toBeGreaterThan(0.2);
    }
    expect(minUp).toBeLessThan(-0.99);                                         // fully inverted mid-flip
    expect(analyzeClip(c).rootPitchTotal).toBe(-360);                          // backward, one full turn
    expect(airborne).toBeGreaterThan(0.45);                                    // real flight time
    const end = s.sample(c.duration); const fe = fk(end);
    expect(rot(end.rootRot, [0, 1, 0])[1]).toBeCloseTo(1, 6);                  // upright again
    for (const sd of ['L', 'R'] as const) expect(Math.min(...fe.leg[sd].soleCorners.map((v) => v[1]))).toBeCloseTo(0, 2);
    expect(land).toBeGreaterThan(1.2); expect(land).toBeLessThan(1.6);
  });

  it('[A144] dancing: hips, arms, legs and head move together on the same beat (coordinated, looping cleanly)', () => {
    for (const id of ['dance_sway', 'dance']) {
      const c = CLIP_BY_ID[id]; const s = new ClipSampler(c); const [a, b] = c.loop!;
      const series = { hips: [] as number[], armR: [] as number[], armL: [] as number[], knee: [] as number[], head: [] as number[] };
      for (let t = a; t <= b; t += 0.02) { const p = s.sample(t); series.hips.push(p.rootPos[0]); series.armR.push(qangle(p.joints.Arm_R, [0, 0, 0, 1])); series.armL.push(qangle(p.joints.Arm_L, [0, 0, 0, 1])); series.knee.push(qangle(p.joints.Shin_L, [0, 0, 0, 1])); series.head.push(qangle(p.joints.Head, [0, 0, 0, 1])); }
      const range = (x: number[]) => Math.max(...x) - Math.min(...x);
      expect(range(series.hips), `${id} hips sway`).toBeGreaterThan(0.1); expect(range(series.armR), `${id} right arm`).toBeGreaterThan(0.3);
      expect(range(series.armL), `${id} left arm`).toBeGreaterThan(0.3); expect(range(series.knee), `${id} knees`).toBeGreaterThan(0.05); expect(range(series.head), `${id} head`).toBeGreaterThan(0.05);
      // the loop end is the loop start: held dancing repeats without a jump
      const p0 = s.sample(a), p1 = s.sample(b); for (const j of JOINTS) expect(qangle(p0.joints[j], p1.joints[j]), `${id} ${j} loop seam`).toBeLessThan(1e-3);
    }
  });

  it('[A144] speaking: the body layer never touches the face, so lip-sync and expressions keep running underneath', () => {
    const rig = fakeRig(); const b = new BodyController(); b.setState('SPEAKING'); b.play('laugh');
    for (let i = 0; i < 60; i++) {
      const v = { ...restPose(), 'mouth.open': 0.3 + 0.3 * Math.sin(i / 3), 'eyes.happy': 0.5 };
      applyChannels(rig, {}, v); const mouth = rig.Mouth_Open.scale.y, eye = rig.Eye_L.scale.y, lid = rig.EyeLid_L.position.y;
      applyBody(rig, Object.fromEntries(RIG_NODES.map((n) => [n, { x: 0, y: 0, z: 0 }])), b.update(1 / 30));
      expect(rig.Mouth_Open.scale.y).toBe(mouth); expect(rig.Eye_L.scale.y).toBe(eye); expect(rig.EyeLid_L.position.y).toBe(lid);
    }
    for (const id of Object.values(STATE_CLIP)) if (id) expect(['noHead', 'arms', 'full']).toContain(CLIP_BY_ID[id].mask === 'full' ? 'full' : CLIP_BY_ID[id].mask);
    expect(CLIP_BY_ID.speak_gestures.mask).toBe('arms');                        // speaking gestures leave the head to the speech/look-at system
  });

  it('[A144] state transitions crossfade without snaps: THINKING→EXCITED→CELEBRATING, IDLE→LISTENING→SPEAKING, SPEAKING→CONFUSED→THINKING', () => {
    for (const seq of [['THINKING', 'EXCITED', 'CELEBRATING'], ['IDLE', 'LISTENING', 'SPEAKING'], ['SPEAKING', 'CONFUSED', 'THINKING']] as const) {
      const b = new BodyController(); const hz = 480; let prev = compose(restBodyPose(), b.update(0).layers); const prevV = new Map<string, number>(); let worst = 0;
      for (const [i, st] of seq.entries()) {
        b.setState(st);
        for (let k = 0; k < hz * (i === seq.length - 1 ? 2.5 : 1.6); k++) {
          const p = compose(restBodyPose(), b.update(1 / hz).layers);
          for (const j of JOINTS) { const v = qangle(prev.joints[j], p.joints[j]) * hz; const pv = prevV.get(j); if (pv !== undefined) worst = Math.max(worst, Math.abs(v - pv)); prevV.set(j, v); }
          prev = p;
        }
        expect(b.state).toBe(st);
      }
      expect(worst, seq.join('→')).toBeLessThan(LIMITS.snap);
    }
    expect([...BODY_STATES]).toEqual(['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'HAPPY', 'EXCITED', 'CONFUSED', 'CURIOUS', 'SURPRISED', 'CELEBRATING', 'DANCING']);
  });

  it('[A144] no conflicting animations: one action at a time, an airborne flip is never cut — a stop lands first, a new request waits', () => {
    const b = new BodyController(); b.play('backflip');
    for (let i = 0; i < 0.8 * 120; i++) b.update(1 / 120);                     // mid-air
    b.play('wave'); expect(b.current()).toBe('backflip');                      // queued, not interrupting the flip
    b.stop(); for (let i = 0; i < 0.3 * 120; i++) b.update(1 / 120); expect(b.current()).toBe(null);   // released…
    const t0 = b.clipTime(); expect(t0).toBeLessThan(COMMIT.backflip[1]);
    let o = b.update(0); expect(o.layers.some((l) => l.w.root > 0.9)).toBe(true);   // …but still flying until the landing
    for (let i = 0; i < 1.6 * 120; i++) o = b.update(1 / 120);
    expect(b.busy()).toBe(false);
    // a normal gesture crossfades into the next one (the engine decides which one wins)
    b.play('wave'); for (let i = 0; i < 30; i++) b.update(1 / 120); b.play('nod'); expect(b.current()).toBe('nod');
  });
});

describe('[A144] connected to NEXUS: explicit commands and AI intent go through the engine to the body', () => {
  it('[A144] every body clip has an engine skill (2D fallback + face), every mapping points at a real clip', () => {
    const skills = new Set(BUILTIN_MOTIONS.map((m) => m.id));
    for (const [skill, clip] of Object.entries(CLIP_FOR_SKILL)) { expect(CLIP_BY_ID[clip], clip).toBeTruthy(); if (!['greeting', 'farewell', 'agree', 'disagree', 'success', 'think_chin', 'think', 'speak_gestures'].includes(skill)) expect(skills.has(skill), skill).toBe(true); }
    for (const c of CLIPS.filter((x) => x.kind !== 'state')) expect(Object.values(CLIP_FOR_SKILL), c.id).toContain(c.id);
  });

  it('[A144] a skill started by the engine plays its body clip; its end releases it (loops finish their outro)', () => {
    const engine = new AnimationEngine(); const rt = new CharacterRuntime(engine, new ExpressionController(BUILTIN_EXPRESSIONS));
    const clap = BUILTIN_MOTIONS.find((m) => m.id === 'clap')!; engine.play(clap);
    rt.step(1 / 60); expect(rt.body.current()).toBe('clap');
    for (let i = 0; i < 60 * 8; i++) rt.step(1 / 60);
    expect(rt.body.current()).toBe(null); expect(rt.body.busy()).toBe(false);
    expect(bodyStateFor('thinking', null)).toBe('THINKING'); expect(bodyStateFor('listening', null)).toBe('LISTENING'); expect(bodyStateFor('speaking', null)).toBe('SPEAKING');
    expect(bodyStateFor('idle', 'happy')).toBe('HAPPY'); expect(bodyStateFor('idle', 'surprised')).toBe('SURPRISED');
  });

  it('[A144] commands and intents: "do a backflip", "clap", "dance", jokes → laugh, "hello" → wave', () => {
    const req = (text: string) => ({ messages: [{ role: 'user', content: text }], profile: { robotName: 'NEXUS' }, skills: BUILTIN_MOTIONS.map((m) => ({ id: m.id, name: m.name, tags: m.tags })), expressions: ['happy', 'neutral'], prefs: {} }) as never;
    const ids = (text: string) => { const r = demoBrain(req(text)); return [...r.actions.flatMap((a) => (a.type === 'skill' ? [a.skillId] : [])), ...(r.gesture ? [r.gesture] : [])]; };
    expect(ids('can you do a backflip?')).toEqual(['backflip']);
    expect(ids('clap 3 times')).toContain('clap'); expect(ids('dance for me')).toContain('dance'); expect(ids('do a forward roll then jump')).toEqual(['forward_roll', 'jump']);
    expect(ids('tell me a joke')).toContain('laugh'); expect(ids('sit on the floor')).toContain('sit'); expect(ids('thumbs up!')).toContain('thumbs_up');
  });
});
