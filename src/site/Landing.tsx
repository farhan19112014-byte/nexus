/**
 * Route "/" — the MISSION NEXUS landing page, art-directed around the real 3D NEXUS.
 * Every claim matches what the app actually does: capabilities that need configuration say so, the roadmap separates
 * what exists from what is planned, and images are real renders / screenshots of the app.
 */
import { REPO_URL, WEB_DEMO, withBase } from '../webDemo';
import { Icon, type IconName } from '../components/Icon';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Link, PATHS, scrollToHash, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import { SpaceField } from '../space/SpaceField';
import { DEMO_STATES, PreviewRobot, type DemoState, type PreviewHandle } from './PreviewRobot';
import { SitePage, StatusPill, useLiveStatus, useRobotName } from './Site';
import { useReveal } from './reveal';

type Status = 'available' | 'setup' | 'browser';
const STATUS_TEXT: Record<Status, string> = { available: 'Available', setup: 'Needs server setup', browser: 'Depends on your browser' };

const VIEWS = [{ k: 'Front', a: 0 }, { k: '¾', a: 0.65, label: 'Three-quarter' }, { k: 'Side', a: Math.PI / 2 }, { k: 'Rear', a: Math.PI }];

/** Callouts drawn over the front view of the showcase (positions in % of the 16:9 stage, measured from the model). */
const CALLOUTS = [
  { k: 'Antenna', d: 'Glowing tip; it follows the head’s movement.', x: 50, y: 7, side: 'l' },
  { k: 'Face screen', d: 'Eyes, brows and mouth are light on glass.', x: 46, y: 30, side: 'l' },
  { k: 'Ear discs', d: 'Side discs with light rings.', x: 61.5, y: 30, side: 'r' },
  { k: 'Chest core', d: 'Shows the real state: blue, green, amber, red.', x: 50, y: 56, side: 'r' },
  { k: 'Joints', d: 'Shoulders, elbows, hips, knees — each pivots.', x: 47, y: 78, side: 'l' },
] as const;

/** Screen-face expressions shown on the page (all are real presets in src/expressions/presets.ts). */
export const FACES = [
  { id: 'happy', label: 'Happy' }, { id: 'excited', label: 'Excited' }, { id: 'curious', label: 'Curious' },
  { id: 'confused', label: 'Confused' }, { id: 'thinking', label: 'Thinking' }, { id: 'sad', label: 'Sad' },
  { id: 'surprised', label: 'Surprised' }, { id: 'angry', label: 'Angry' }, { id: 'playful', label: 'Winking' },
] as const;

/** One conversation turn, as the robot shows it (faces are real renders of each state). */
const TIMELINE = [
  { img: 's-listening', k: 'You speak', d: 'It turns to you and listens — the microphone is really on.' },
  { img: 's-thinking', k: 'It thinks', d: 'Only while the request is really pending.' },
  { img: 's-speaking', k: 'It answers', d: 'Face and posture match the reply; the mouth follows the audio.' },
  { img: 'happy', k: 'It settles', d: 'Back to a calm idle when it is done — or stops the moment you interrupt.' },
];

const FLOW: { k: string; d: string; icon: IconName }[] = [
  { k: 'You', d: 'Type or speak.', icon: 'mic' },
  { k: 'Interface', d: 'Sets the listening / thinking state and sends the recent conversation.', icon: 'keyboard' },
  { k: 'NEXUS server', d: 'Keeps the API key private, applies limits, asks the AI service.', icon: 'spark' },
  { k: 'AI service', d: 'Google Gemini writes the reply and suggests an expression; it streams back word by word.', icon: 'chat' },
  { k: 'Validation', d: 'The reply is checked against a strict format — gestures are data, never code.', icon: 'eye' },
  { k: 'Voice', d: 'ElevenLabs turns the reply into speech; its character timing and the real audio level drive the mouth.', icon: 'speaker' },
  { k: 'Robot', d: 'Speaks, moves its face and body, returns to idle.', icon: 'face' },
];

const scrollTo = (hash: string) => (e: React.MouseEvent) => { e.preventDefault(); history.replaceState(null, '', hash); scrollToHash(hash); };
const img = (n: string) => withBase(`/images/faces/${n}.jpg`);

export default function Landing() {
  const name = useRobotName();
  const status = useLiveStatus();
  const renamed = name !== PRODUCT_NAME;
  useTitle(`${PRODUCT_NAME} — intelligence, with a presence`);
  useReveal();
  const preview = useRef<PreviewHandle>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [shown, setShown] = useState<DemoState | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [orbit, setOrbit] = useState(0);
  const drag = useRef<{ x: number; a: number } | null>(null);
  const note = shown ? DEMO_STATES.find((d) => d.id === shown)?.note : null;
  // angles repeat every full turn: after dragging round once (or more), "Front" is still front and the buttons take the
  // short way round instead of unwinding every turn
  const TAU = Math.PI * 2;
  const sameView = (a: number, b: number) => Math.abs(((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI) < 0.01;
  const nearest = (target: number) => target + Math.round((orbit - target) / TAU) * TAU;
  const front = sameView(orbit, 0);
  const showState = (id: DemoState) => { setShown(id); setFace(null); preview.current?.state(id); };
  const showFace = (id: string) => { setFace(id); setShown(null); preview.current?.state('idle'); preview.current?.express(id, 6); };
  const onActivity = useCallback((l: string | null) => setActivity(l), []);
  // drag to turn around the robot (mouse, pen or touch); the view buttons do the same for keyboard users
  const onDown = (e: RPointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, a: orbit }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onDrag = (e: RPointerEvent) => { if (drag.current) setOrbit(drag.current.a + (e.clientX - drag.current.x) * 0.012); };
  const onUp = () => { drag.current = null; };
  // warm up the robot page in the background once the landing page is idle, so "Meet NEXUS" opens instantly
  useEffect(() => {
    const go = () => { void import('../components/App').catch(() => {}); };
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(go, { timeout: 4000 }) : window.setTimeout(go, 2500);
    return () => { const cic = (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback; if (ric && cic) cic(id); else clearTimeout(id); };
  }, []);
  const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

  return (
    <SitePage className="landing">
      {/* ── hero ─────────────────────────────────────────────────────────────── */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-bg" aria-hidden><SpaceField focus="hero" className="hero-space" /><span className="halo" /><span className="beam" /><span className="grid" /><span className="horizon" /></div>
        <div className="site-wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow enter" style={d(80)}>Mission NEXUS / AI robotics</p>
            <h1 id="hero-title" className="enter" style={d(160)}><span>Intelligence,</span> <span className="accent">with a presence.</span></h1>
            <p className="lead enter" style={d(260)}>
              {renamed ? <><b>{name}</b> is your {PRODUCT_NAME} robot — an</> : 'An'} interactive AI robotics experience bringing conversation, expression and motion together in one curious digital companion.
            </p>
            <div className="cta-row enter" style={d(340)}>
              <Link to={PATHS.app} className="btn btn-primary btn-lg">Meet {name} <Icon name="play" size={16} /></Link>
              <a href="#technology" className="btn btn-link btn-lg" onClick={scrollTo('#technology')}>Explore the technology <span aria-hidden>→</span></a>
            </div>
            <div className="hero-meta enter" style={d(420)}>
              <StatusPill s={status} />
              {WEB_DEMO
                ? <p className="small" data-testid="web-demo-note">Web demo: a scripted demo brain answers here (not an AI). Real AI conversation needs the NEXUS server — <a className="text-link" href={REPO_URL}>source on GitHub</a>.</p>
                : <p className="small">No account needed. The status shows the AI service connected right now.</p>}
            </div>
          </div>
          <div className="hero-art enter enter-robot" style={d(200)}>
            <div className="hero-stage">
              <span className="ring r1" aria-hidden /><span className="ring r2" aria-hidden />
              <div className="stage-light" aria-hidden />
              <div className="stage-floor" aria-hidden />
              <PreviewRobot greet mode="auto" title={`${name}, the 3D NEXUS robot, waving hello`} className="hero-robot" />
              <span className="hud hud-a" aria-hidden><i />Live 3D render</span>
              <span className="hud hud-b" aria-hidden>{BUILTIN_EXPRESSIONS.length} expressions · {BUILTIN_MOTIONS.length} motions</span>
            </div>
          </div>
        </div>
        <a href="#robot" className="scroll-cue" onClick={scrollTo('#robot')} aria-label="Scroll to the robot showcase"><span /></a>
      </section>

      {/* ── 01 meet the machine ──────────────────────────────────────────────── */}
      <section id="robot" className="section showcase reveal" aria-labelledby="robot-title">
        <div className="site-wrap">
          <header className="section-head split">
            <div><p className="eyebrow">01 · Meet the machine</p><h2 id="robot-title">One character, built to be read at a glance.</h2></div>
            <p className="section-lead">Turn {name} around, then switch its state or its face. Live 3D model, same motion engine as the app — not a video.</p>
          </header>
        </div>
        <div className="site-wrap wide">
          <div className={`viewer-stage ${front ? 'is-front' : ''}`} onPointerDown={onDown} onPointerMove={onDrag} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="stage-light" aria-hidden />
            <div className="stage-floor" aria-hidden />
            <span className="tag tag-tl" aria-hidden>NEXUS · live 3D</span>
            <span className="tag tag-tr" aria-hidden>{(activity ?? 'Idle').toUpperCase()}</span>
            <PreviewRobot ref={preview} mode="auto" orbit={orbit} onActivity={onActivity} title={`${name} in 3D, showing its states`} className="hero-robot" />
            <ul className="callouts" aria-hidden={!front}>
              {CALLOUTS.map((c) => <li key={c.k} className={`co co-${c.side}`} style={{ '--x': `${c.x}%`, '--y': `${c.y}%` } as CSSProperties}><i /><span><b>{c.k}</b>{c.d}</span></li>)}
            </ul>
            <div className="stage-bar">
              <div className="seg" role="group" aria-label="Viewing angle">
                {VIEWS.map((v) => <button key={v.k} type="button" aria-label={v.label} aria-pressed={sameView(orbit, v.a)} onClick={() => setOrbit(nearest(v.a))}>{v.k}</button>)}
              </div>
              <span className="drag-hint" aria-hidden>Drag to rotate</span>
            </div>
            <p className="state-note" role="status" aria-live="polite">{activity ? <>Now showing: <b>{activity}</b>{note ? ` — ${note}` : ''}</> : ''}</p>
          </div>
        </div>
        <div className="site-wrap">
          <div className="controls-grid">
            <div>
              <h3 className="mini-title">States</h3>
              <div className="state-cards" role="group" aria-label={`Show ${name}’s states`}>
                {DEMO_STATES.map((s) => (
                  <button key={s.id} type="button" className={`state-card ${shown === s.id ? 'on' : ''}`} aria-pressed={shown === s.id} onClick={() => showState(s.id)}>
                    <span className="sc-name">{s.label}</span><span className="sc-note">{s.note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mini-title">Screen faces</h3>
              <div className="face-tiles" role="group" aria-label={`Show ${name}’s expressions`}>
                {FACES.map((f) => (
                  <button key={f.id} type="button" className={`face-tile ${face === f.id ? 'on' : ''}`} aria-pressed={face === f.id} onClick={() => showFace(f.id)}>
                    <img src={img(f.id)} alt="" loading="lazy" width="96" height="72" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    <span>{f.label}</span>
                  </button>
                ))}
                <button type="button" className="face-tile reset" onClick={() => { setShown(null); setFace(null); setOrbit(nearest(0)); preview.current?.reset(); }}><Icon name="reset" size={18} /><span>Reset</span></button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 more than a text box ──────────────────────────────────────────── */}
      <section id="presence" className="section presence reveal" aria-labelledby="presence-title">
        <div className="site-wrap">
          <header className="section-head">
            <p className="eyebrow">02 · More than a text box</p>
            <h2 id="presence-title">The same answer. Delivered by someone.</h2>
          </header>
          <div className="presence-grid">
            <figure className="textbox" aria-label="A conventional text chat">
              <figcaption className="label">A text box</figcaption>
              <div className="tb-lines" aria-hidden><span className="me" /><span /><span className="short" /><span className="dots"><i /><i /><i /></span></div>
              <p>You type. You wait for a spinner. You read. Nothing tells you how the answer is meant.</p>
            </figure>
            <figure className="timeline" aria-label={`The same turn with ${name}`}>
              <figcaption className="label">With {name}</figcaption>
              <ol>
                {TIMELINE.map((t, i) => (
                  <li key={t.k} style={{ '--i': i } as CSSProperties}>
                    <img src={img(t.img)} alt="" loading="lazy" width="160" height="120" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    <b>{t.k}</b><span>{t.d}</span>
                  </li>
                ))}
              </ol>
            </figure>
          </div>
          <p className="footnote">Both use a language model for the words. {PRODUCT_NAME} adds a body that reflects the real state of the conversation — it does not make the model conscious or smarter. Whether people prefer talking to it over ordinary voice chat has not been tested yet.</p>
        </div>
      </section>

      {/* ── 03 capabilities (bento) ──────────────────────────────────────────── */}
      <section id="capabilities" className="section reveal" aria-labelledby="capabilities-title">
        <div className="site-wrap">
          <header className="section-head split">
            <div><p className="eyebrow">03 · Capabilities</p><h2 id="capabilities-title">What works today.</h2></div>
            <p className="section-lead">Every tile says whether it works everywhere, needs the NEXUS server to be configured, or depends on your browser.</p>
          </header>
          <div className="bento">
            <article className="tile t-ai">
              <span className="cap-status st-setup">{STATUS_TEXT.setup}</span>
              <div className="stream" aria-hidden>
                <div className="stream-row you"><i style={{ width: '46%' }} /></div>
                <div className="stream-row bot"><b /><span><i style={{ width: '92%' }} /><i style={{ width: '78%' }} /><i className="live" style={{ width: '38%' }} /></span></div>
                <div className="stream-stop"><em />Stop</div>
              </div>
              <h3>Conversational AI</h3>
              <p>Real replies from the AI service the NEXUS server is configured with. They stream in, and you can stop them at any time.</p>
              <ul className="chips" aria-label="Supported providers"><li>Google Gemini</li><li>OpenAI-compatible</li><li>Anthropic</li><li>Ollama (local)</li></ul>
            </article>
            <article className="tile t-voice">
              <span className="cap-status st-browser">{STATUS_TEXT.browser}</span>
              <h3>Voice in, voice out</h3>
              <p>Press the microphone and talk; replies can be read aloud while the mouth follows the audio level.</p>
              <div className="bars" aria-hidden>{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 53) % 70)}%` }} />)}</div>
            </article>
            <article className="tile t-face">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>Expressive 3D robot</h3>
              <p>{BUILTIN_EXPRESSIONS.length} faces and a motion engine for listening, thinking, speaking and resting.</p>
              <div className="mini-faces" aria-hidden>{['happy', 'curious', 'surprised', 'playful'].map((f) => <img key={f} src={img(f)} alt="" loading="lazy" width="96" height="72" />)}</div>
            </article>
            <article className="tile t-states">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>Honest states</h3>
              <ul className="state-legend"><li><i className="dot st-idle" />Ready</li><li><i className="dot st-listening" />Listening</li><li><i className="dot st-processing" />Thinking</li><li><i className="dot st-speaking" />Speaking</li><li><i className="dot st-error" />Error, with the reason</li></ul>
            </article>
            <article className="tile t-memory">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>Memory with consent</h3>
              <p>Stored in your browser. Suggestions wait for your OK; everything can be exported or deleted.</p>
            </article>
            <article className="tile t-motion">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>Teachable motions</h3>
              <p>“A shy greeting” becomes validated animation data, previewed in a sandbox and saved only if you approve.</p>
            </article>
            <article className="tile t-research">
              <span className="cap-status st-setup">{STATUS_TEXT.setup}</span>
              <h3>Web research</h3>
              <p>Optional live search for current answers — only when the server has a search service configured.</p>
            </article>
            <article className="tile t-holo">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>HOLOBUILD</h3>
              <p>“Build a combustion engine” — a 3D model with named parts you can explode, edit in plain words, save and export as GLB. Built-in templates work offline; new designs need the AI.</p>
            </article>
            <article className="tile t-learn">
              <span className="cap-status st-setup">{STATUS_TEXT.setup}</span>
              <h3>Learning, out in the open</h3>
              <p>Research with sources, facts marked verified only when two independent sources agree, and skills that change only after their tests pass and you approve.</p>
            </article>
            <article className="tile t-a11y">
              <span className="cap-status st-available">{STATUS_TEXT.available}</span>
              <h3>Accessible</h3>
              <p>Keyboard, captions for every spoken reply, reduced motion and a text-only path for everything.</p>
            </article>
          </div>
        </div>
      </section>

      {/* ── 04 inside NEXUS ──────────────────────────────────────────────────── */}
      <section id="technology" className="section inside reveal" aria-labelledby="technology-title">
        <div className="site-wrap">
          <header className="section-head split">
            <div><p className="eyebrow">04 · Inside NEXUS</p><h2 id="technology-title">From your words to its expression.</h2></div>
            <p className="section-lead">A React and three.js interface, a small Node server that keeps every key private, Gemini for the words and ElevenLabs for the voice.</p>
          </header>
          <p className="chain-line" aria-label="Intelligence, conversation, voice, expression, movement"><span>Intelligence</span><span>Conversation</span><span>Voice</span><span>Expression</span><span>Movement</span></p>
          <ol className="pipeline">
            {FLOW.map((f, i) => (
              <li key={f.k} style={{ '--i': i } as CSSProperties}>
                <span className="node"><Icon name={f.icon} size={20} /></span>
                <span className="step">{String(i + 1).padStart(2, '0')}</span>
                <b>{f.k}</b><span className="desc">{f.d}</span>
              </li>
            ))}
          </ol>
          <p className="footnote">The AI model is never retrained by {PRODUCT_NAME}. “Learning” means memories, motions and knowledge notes you can inspect, stored in your browser.</p>
        </div>
      </section>

      {/* ── 05 philosophy ────────────────────────────────────────────────────── */}
      <section id="philosophy" className="section philosophy reveal" aria-labelledby="philosophy-title">
        <div className="site-wrap">
          <p className="eyebrow">05 · Philosophy</p>
          <h2 id="philosophy-title" className="mega"><span className="outline">Curiosity.</span><span className="outline">Experimentation.</span><span className="fill">Intelligence with a presence.</span></h2>
          <div className="editorial-cols">
            <p>Most AI lives in a chat window. {PRODUCT_NAME} asks what changes when the same intelligence has a face that listens, a posture that thinks and a voice that stops when you interrupt it.</p>
            <p>The rule is honesty: every expression maps to something real — a microphone that is actually on, a request that is actually pending, a failure that is actually explained.</p>
          </div>
        </div>
      </section>

      {/* ── 06 roadmap ───────────────────────────────────────────────────────── */}
      <section id="roadmap" className="section reveal" aria-labelledby="roadmap-title">
        <div className="site-wrap">
          <header className="section-head"><p className="eyebrow">06 · Roadmap</p><h2 id="roadmap-title">Where it stands.</h2></header>
          <div className="track">
            <div className="phase now"><span className="pin" /><p className="label st-available">Available now</p><ul><li>AI conversation through the NEXUS server</li><li>3D robot with a state-driven motion engine</li><li>Voice input and spoken replies</li><li>Consent-based memory, teachable motions, light and dark themes</li></ul></div>
            <div className="phase next"><span className="pin" /><p className="label st-setup">Next — not started</p><ul><li>A custom NEXUS voice (the choice is still open; it needs a paid voice service)</li></ul></div>
            <div className="phase later"><span className="pin" /><p className="label">Planned exploration</p><ul><li>Mouth shapes that follow the actual sounds of speech</li><li>A fuller rig — spine and fingers — for richer gestures</li></ul></div>
          </div>
        </div>
      </section>

      {/* ── final call to action ─────────────────────────────────────────────── */}
      <section className="section final-cta" aria-labelledby="cta-title">
        <div className="site-wrap">
          <div className="cta-card reveal">
            <div className="cta-copy">
              <p className="eyebrow">Launch</p>
              <h2 id="cta-title">Ready to meet {name}?</h2>
              <p>Open the robot page to talk, listen and watch it react.</p>
              <Link to={PATHS.app} className="btn btn-primary btn-lg">Launch {name} <Icon name="play" size={16} /></Link>
            </div>
            <div className="cta-art" aria-hidden><img src={withBase('/images/nexus-render.png')} alt="" loading="lazy" width="520" height="640" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></div>
          </div>
        </div>
      </section>
    </SitePage>
  );
}
