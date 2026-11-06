/**
 * Route "/motions" — the Motion Lab: preview every full-body animation of the 3D NEXUS on its own, every body state,
 * transition sequences, held loops and stop — with live measurements read from the rendered model (palm distance,
 * body up-vector, rotation, foot height) and the physical checks each clip passes (floor, planted feet, no
 * clipping, no snaps). It runs its OWN runtime (engine + expressions + body controller), so it never disturbs the
 * companion. Clips start through the animation engine exactly like a chat command, so this tests the real path.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, PATHS, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { SitePage } from './Site';
import { Icon } from '../components/Icon';
import type { RigHandle } from '../character/Robot';
import { RobotAuto } from '../character3d/RobotAuto';
import { effectiveStyle } from '../character3d/webgl';
import { AnimationEngine, seeded } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import { CharacterRuntime } from '../core/characterRuntime';
import { CLIPS, BODY_STATES, STATE_CLIP, type BodyState } from '../character3d/body/clips';
import { CLIP_FOR_SKILL } from '../character3d/body/controller';
import { analyzeClip, LIMITS, type ClipReport } from '../character3d/body/checks';
import { reducedMotionPreferred } from './PreviewRobot';
import { attention, rectPoint } from '../character3d/attention';
import type { ReactionKind } from '../character3d/body/presence';
import './motionlab.css';

const MOTION = new Map(BUILTIN_MOTIONS.map((m) => [m.id, m]));
/** the engine skill that plays a clip (same id first) — null: the clip is body-only (played on the controller) */
const skillFor = (clip: string) => (MOTION.has(clip) && CLIP_FOR_SKILL[clip] === clip ? clip : Object.entries(CLIP_FOR_SKILL).find(([s, c]) => c === clip && MOTION.has(s))?.[0] ?? null);
const GROUPS = [['basic', 'Basic'], ['expressive', 'Expressive'], ['advanced', 'Advanced']] as const;
const SEQUENCES: { id: string; label: string; steps: [BodyState, number][] }[] = [
  { id: 'a', label: 'Thinking → Excited → Celebrating', steps: [['THINKING', 2.2], ['EXCITED', 2.2], ['CELEBRATING', 2.6], ['IDLE', 0]] },
  { id: 'b', label: 'Idle → Listening → Speaking', steps: [['IDLE', 1], ['LISTENING', 2.2], ['SPEAKING', 2.8], ['IDLE', 0]] },
  { id: 'c', label: 'Speaking → Confused → Thinking', steps: [['SPEAKING', 2.2], ['CONFUSED', 2.4], ['THINKING', 2.4], ['IDLE', 0]] },
];
const SAMPLES = [
  'You might wonder why the sky is blue, but it is actually all about tiny particles scattering sunlight.',
  'Is that not amazing? The whole universe follows the very same rules.',
  'I think this part here is the most important one.',
];
const REACTIONS: ReactionKind[] = ['acknowledge', 'curious', 'surprise', 'discovery', 'correction', 'uncertain'];
interface PresenceInfo { gesture: string | null; attention: string; reaction: string | null; walking: boolean; steps: number; root: number[]; yaw: number; armW: number; breath: number; gaze: number[] }
interface Metrics { action: string | null; state: string; palms: number; up: number; pitch: number; yaw: number; foot: number }
interface Peaks { palmsMin: number; upMin: number; footMin: number; footMax: number }
const freshPeaks = (): Peaks => ({ palmsMin: Infinity, upMin: Infinity, footMin: Infinity, footMax: -Infinity });
const f = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export default function MotionLab() {
  useTitle(`Motion Lab — ${PRODUCT_NAME}`);
  const rig = useRef<RigHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [rt] = useState(() => { const e = new AnimationEngine(seeded(11)); return new CharacterRuntime(e, new ExpressionController(BUILTIN_EXPRESSIONS)); });
  const [is3d, setIs3d] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hold, setHold] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [bodyState, setBodyState] = useState<BodyState | null>(null);
  const [seq, setSeq] = useState<string | null>(null);
  const [m, setM] = useState<Metrics | null>(null);
  const peaks = useRef<Peaks>(freshPeaks());
  const [pk, setPk] = useState<Peaks>(freshPeaks());
  const [report, setReport] = useState<ClipReport | null>(null);
  const [all, setAll] = useState<ClipReport[] | null>(null);
  const seqTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useMemo(() => reducedMotionPreferred(), []);
  const flat = effectiveStyle('auto') === '2d';
  const marker = useRef<HTMLDivElement>(null);
  const [pi, setPi] = useState<PresenceInfo | null>(null);
  const [markerOn, setMarkerOn] = useState(false);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // a real on-page target the robot can look and point at (a marker beside the stage, like the IVES panel)
  useEffect(() => {
    if (!markerOn) { attention.set('visual', null); return; }
    attention.set('visual', { label: 'marker', point: () => rectPoint(marker.current) });
    const id = setTimeout(() => attention.focus('visual'), 80);
    return () => { clearTimeout(id); attention.set('visual', null); };
  }, [markerOn]);
  useEffect(() => {
    const id = setInterval(() => { const raw = box.current?.querySelector<HTMLElement>('[data-presence]')?.dataset.presence; if (!raw) return; try { setPi(JSON.parse(raw) as PresenceInfo); } catch { /* partial */ } }, 120);
    return () => clearInterval(id);
  }, []);
  /** say a line: the speaking mouth runs, the presence plans its gestures from the words (like a real reply) */
  const sayLine = (i: number) => {
    if (speakTimer.current) clearTimeout(speakTimer.current);
    const text = SAMPLES[i]; const sec = Math.max(2.5, text.split(' ').length * 0.36);
    rt.engine.setSpeaking(true); rt.setMotion('speaking'); setSpeaking(true); rt.presence?.sentence(text, sec); rt.kick();
    speakTimer.current = setTimeout(() => { rt.engine.setSpeaking(false); rt.setMotion('idle'); setSpeaking(false); }, sec * 1000 + 300);
  };

  useEffect(() => {
    rt.engine.reducedMotion = reduced; rt.engine.idleEnabled = !reduced;
    if (!rig.current) return;
    const off = rt.attach(rig.current); rt.start();
    return () => { off(); rt.stop(); rt.engine.stopAll(); seqTimers.current.forEach(clearTimeout); };
  }, [rt, reduced]);

  // live readout from the rendered model (Robot3D publishes it on its host element while the body layer is active)
  useEffect(() => {
    const id = setInterval(() => {
      const el = box.current?.querySelector<HTMLElement>('[data-body-metrics]');
      const raw = el?.dataset.bodyMetrics; if (!raw) { setM(null); return; }
      try {
        const x = JSON.parse(raw) as Metrics; setM(x);
        const p = peaks.current; p.palmsMin = Math.min(p.palmsMin, x.palms); p.upMin = Math.min(p.upMin, x.up); p.footMin = Math.min(p.footMin, x.foot); p.footMax = Math.max(p.footMax, x.foot); setPk({ ...p });
      } catch { /* a partial write — next tick */ }
    }, 60);
    return () => clearInterval(id);
  }, []);

  const clearSeq = () => { seqTimers.current.forEach(clearTimeout); seqTimers.current = []; setSeq(null); };
  const play = (clip: string) => {
    clearSeq(); setSel(clip); peaks.current = freshPeaks(); setPk(freshPeaks());
    const c = CLIPS.find((x) => x.id === clip)!;
    const skill = skillFor(clip);
    if (hold && c.loop) { rt.engine.stopAll(); rt.body.stop(); rt.body.play(clip, { hold: true }); }
    else if (skill) { rt.body.stop(); void rt.engine.play(MOTION.get(skill)!, { conflict: 'interrupt' }).done; }
    else { rt.engine.stopAll(); rt.body.play(clip, { hold: false }); }
    rt.kick();
    setTimeout(() => setReport(analyzeClip(c)), 30);     // ~0.1 s of maths, off the click
  };
  const stopAll = () => { clearSeq(); rt.engine.stopAll(); rt.body.stop(); setBodyState(null); rt.bodyState = null; };
  const pickState = (s: BodyState | null) => { clearSeq(); setBodyState(s); rt.bodyState = s; rt.kick(); };
  const runSeq = (id: string) => {
    stopAll(); setSeq(id); let t = 0;
    for (const [s, d] of SEQUENCES.find((x) => x.id === id)!.steps) { seqTimers.current.push(setTimeout(() => { rt.bodyState = s; setBodyState(s); rt.kick(); }, t * 1000)); t += d; }
    seqTimers.current.push(setTimeout(() => { setSeq(null); rt.bodyState = null; setBodyState(null); }, t * 1000 + 50));
  };
  const toggleSpeak = () => { const on = !speaking; setSpeaking(on); rt.engine.setSpeaking(on); if (on) rt.expressions.set('system', 'speaking', 1, null); else rt.expressions.release('system'); rt.setMotion(on ? 'speaking' : 'idle'); rt.kick(); };
  const selClip = sel ? CLIPS.find((c) => c.id === sel) : null;

  return (
    <SitePage className="motionlab-page">
      <div className="site-wrap motionlab" data-testid="motion-lab">
        <header className="ml-head">
          <p className="eyebrow">NEXUS · full-body motion</p>
          <h1>Motion Lab</h1>
          <p className="lede">Every full-body animation of the 3D NEXUS, one at a time, measured live from the rendered model. The same clips play when you ask NEXUS in chat (“do a backflip”, “clap”, “dance”).</p>
          {flat && <p className="ml-note" role="note">This browser shows the 2D robot (no WebGL): the buttons play the 2D version of each move. The full-body clips and live measurements need the 3D robot.</p>}
          {reduced && <p className="ml-note" role="note">Reduced motion is on: body states are not looped; explicit moves still play when you press them.</p>}
        </header>

        <div className="ml-grid">
          <section className="ml-stage" aria-label="Robot">
            {markerOn && <div ref={marker} className="ml-marker" aria-label="A target for NEXUS to look at" data-testid="ml-marker-dot">Look here</div>}
            <div ref={box} className="ml-robot">
              <RobotAuto ref={rig} mode="auto" onReady3d={() => { rt.set3d(true); setIs3d(true); }} environment="transparent" effects accessories={{ antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true }} title={`${PRODUCT_NAME} in 3D, previewing full-body animations`} className="preview-svg" />
            </div>
            <dl className="ml-metrics" data-testid="ml-metrics" aria-live="off">
              <div><dt>Playing</dt><dd>{m?.action ?? (sel && rt.body.busy() ? sel : '—')}</dd></div>
              <div><dt>Body state</dt><dd>{m?.state ?? bodyState ?? 'IDLE'}</dd></div>
              <div><dt>Palm gap</dt><dd>{m ? f(m.palms) : '—'} <small>min {f(pk.palmsMin)}</small></dd></div>
              <div><dt>Body up</dt><dd>{m ? f(m.up) : '—'} <small>min {f(pk.upMin)}</small></dd></div>
              <div><dt>Pitch / yaw</dt><dd>{m ? `${f(m.pitch, 0)}° / ${f(m.yaw, 0)}°` : '—'}</dd></div>
              <div><dt>Lowest foot</dt><dd>{m ? f(m.foot) : '—'} <small>{f(pk.footMin)} to {f(pk.footMax)}</small></dd></div>
            </dl>
            <p className="small muted">{is3d ? 'Measured on the rendered 3D model every frame. Palms touch at ≈ 0.30 (two palm radii); “body up” below 0 means upside down.' : 'Waiting for the 3D model…'}</p>
          </section>

          <section className="ml-controls" aria-label="Animations">
            <div className="ml-bar">
              <label className="ml-check"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} data-testid="ml-hold" /> Hold loops (clap, dance… repeat until Release)</label>
              <button type="button" className="btn" onClick={() => rt.body.release()} data-testid="ml-release">Release</button>
              <button type="button" className="btn" onClick={stopAll} data-testid="ml-stop">Stop</button>
            </div>
            {GROUPS.map(([kind, label]) => (
              <div key={kind}>
                <h2 className="ml-h2">{label}</h2>
                <div className="ml-buttons">
                  {CLIPS.filter((c) => c.kind === kind).map((c) => (
                    <button key={c.id} type="button" className={`ml-btn ${sel === c.id ? 'on' : ''}`} onClick={() => play(c.id)} title={c.doc} data-clip={c.id}>
                      {c.name}{c.loop && <span className="ml-loop" title="loops while held"><Icon name="retry" size={12} /></span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <h2 className="ml-h2">Body states <span className="muted">held while NEXUS is in that state</span></h2>
            <div className="ml-buttons">
              {BODY_STATES.map((s) => <button key={s} type="button" className={`ml-btn ${bodyState === s ? 'on' : ''}`} onClick={() => pickState(s === 'IDLE' ? null : s)} data-state={s} title={STATE_CLIP[s] ? `clip: ${STATE_CLIP[s]}` : 'no body loop — the calm idle'}>{s.charAt(0) + s.slice(1).toLowerCase()}</button>)}
            </div>
            <h2 className="ml-h2">Transitions & lip-sync</h2>
            <div className="ml-buttons">
              {SEQUENCES.map((s) => <button key={s.id} type="button" className={`ml-btn ${seq === s.id ? 'on' : ''}`} onClick={() => runSeq(s.id)} data-seq={s.id}>{s.label}</button>)}
              <button type="button" className={`ml-btn ${speaking ? 'on' : ''}`} onClick={toggleSpeak} aria-pressed={speaking} data-testid="ml-speak">Speaking mouth {speaking ? 'on' : 'off'}</button>
            </div>

            <h2 className="ml-h2">Presence <span className="muted">idle life, attention, gestures from meaning, walking</span></h2>
            <div className="ml-buttons">
              <button type="button" className="ml-btn" onClick={() => { rt.engine.play(MOTION.get('walk_across')!, { conflict: 'interrupt' }); rt.kick(); }} data-testid="ml-walk">Walk across and back</button>
              <button type="button" className="ml-btn" onClick={() => { rt.presence?.walkTo(0.6, 0.3); rt.kick(); }} data-testid="ml-walk-side">Step over to the side</button>
              <button type="button" className="ml-btn" onClick={() => { rt.presence?.walkTo(0, 0, 0); rt.kick(); }}>Back to the centre</button>
              <button type="button" className={`ml-btn ${markerOn ? 'on' : ''}`} onClick={() => setMarkerOn((x) => !x)} aria-pressed={markerOn} data-testid="ml-marker">Show a target to look at</button>
              <button type="button" className="ml-btn" disabled={!markerOn} onClick={() => { rt.engine.setSpeaking(true); setTimeout(() => rt.engine.setSpeaking(false), 2600); rt.presence?.attend('visual', 2.6, true); rt.kick(); }} data-testid="ml-point">Present the target</button>
              {SAMPLES.map((t, i) => <button key={i} type="button" className="ml-btn" onClick={() => sayLine(i)} title={t} data-say={i}>Say: “{t.slice(0, 26)}…”</button>)}
              {REACTIONS.map((r) => <button key={r} type="button" className="ml-btn" onClick={() => { rt.presence?.react(r); rt.kick(); }} data-react={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</button>)}
            </div>
            <p className="small" data-testid="ml-presence">{pi ? `Looking at: ${pi.attention} · gesture: ${pi.gesture ?? '—'} · arms ${Math.round(pi.armW * 100)}% · ${pi.walking ? 'walking' : 'standing'} (${pi.steps} steps) · breath ${pi.breath.toFixed(2)}${pi.reaction ? ` · reacting: ${pi.reaction}` : ''}` : 'The presence layer runs on the 3D robot.'}</p>

            <h2 className="ml-h2">Physical checks {selClip && <span className="muted">{selClip.name}</span>}</h2>
            {report && selClip ? (
              <div className={`ml-report ${report.ok ? 'ok' : 'bad'}`} data-testid="ml-report">
                <p className="ml-doc">{selClip.doc}</p>
                <ul>
                  <li>Floor: lowest point {f(report.minGround, 3)} m (limit {LIMITS.ground})</li>
                  <li>Planted feet drift: {f(report.plantedMaxError, 3)} m (limit {LIMITS.planted})</li>
                  <li>Body intersections: {report.hits.length ? report.hits.slice(0, 3).join(', ') : 'none'}</li>
                  <li>Fastest joint: {f(report.maxSpeed, 1)} rad/s (limit {LIMITS.speed})</li>
                  <li>Snaps (velocity jumps at 480 Hz): {f(report.maxJerk, 2)} rad/s (limit {LIMITS.snap})</li>
                  {report.palmContacts > 0 && <li>Palm contacts: {report.palmContacts} (closest gap {f(report.palmMin, 3)} m)</li>}
                  {Math.abs(report.rootPitchTotal) > 90 && <li>Total rotation: {f(report.rootPitchTotal, 0)}°</li>}
                </ul>
                <p className="ml-verdict">{report.ok ? 'Passes every check' : 'Fails a check'}</p>
              </div>
            ) : <p className="small muted">Play a clip to see its checks.</p>}
            <button type="button" className="btn" onClick={() => setTimeout(() => setAll(CLIPS.map((c) => analyzeClip(c))), 20)} data-testid="ml-check-all">Check all {CLIPS.length} clips</button>
            {all && <p className="small" data-testid="ml-all">{all.filter((r) => r.ok).length} / {all.length} clips pass every check{all.some((r) => !r.ok) && ` — failing: ${all.filter((r) => !r.ok).map((r) => r.id).join(', ')}`}</p>}
          </section>
        </div>
        <p className="small muted ml-foot">Limitations: NEXUS has ball hands with one thumb and no finger joints (pointing, open palms and thumbs up are whole-hand poses; the thumb opens and closes), one torso joint (no spine or clavicles), the face is a screen (mouth shapes follow the voice's loudness and, with ElevenLabs, its letters — not phonemes), and the model is rigid parts on joints (no skin deformation). The 2D robot shows simplified versions. <Link to={PATHS.app}>Back to the robot</Link></p>
      </div>
    </SitePage>
  );
}
