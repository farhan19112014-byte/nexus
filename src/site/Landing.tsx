/** Route "/" — the public landing page. Every claim here matches what the app actually does. */
import { REPO_URL, WEB_DEMO } from '../webDemo';
import { Icon, type IconName } from '../components/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, PATHS, scrollToHash, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import { DEMO_STATES, PreviewRobot, type DemoState, type PreviewHandle } from './PreviewRobot';
import { SitePage, StatusPill, useLiveStatus, useRobotName } from './Site';

const FEATURES: { icon: IconName; title: string; body: string; note?: string }[] = [
  { icon: 'chat', title: 'Real AI conversation', body: 'Chat with a real language model through the NEXUS server — Google Gemini, OpenAI-compatible APIs, Anthropic, or a free model on your own computer with Ollama. Replies stream in and can be stopped.', note: 'Needs a model provider. Without one, a clearly labelled demo brain answers a few commands.' },
  { icon: 'face', title: 'A 3D character with feelings', body: `The 3D NEXUS (or the classic 2D one) has ${BUILTIN_EXPRESSIONS.length} facial expressions and ${BUILTIN_MOTIONS.length} built-in motions — waves, nods, claps, celebrations — blended by a real animation engine with priorities and safe interruption.`, note: 'The 3D robot needs WebGL; without it the 2D robot is shown automatically.' },
  { icon: 'pen', title: 'Your robot, your name', body: 'Rename your robot and tune its resting face, greeting, idle liveliness and animation intensity. The new name is used in the app and in what the AI calls itself.' },
  { icon: 'spark', title: 'Motion creation', body: 'Ask for “a shy greeting” or “a more casual wave”. The request becomes a structured proposal that is validated, previewed in a sandbox, and saved only when you approve it — with versions you can roll back.', note: 'Saved skills are animation data. The language model itself is never retrained.' },
  { icon: 'memory', title: 'Memory with consent', body: 'Ask it to remember something and it is stored in your browser on this device. Anything the AI merely suggests waits for your OK. Every memory can be viewed, edited, exported or deleted.' },
  { icon: 'mic', title: 'Voice', body: 'Talk using your browser’s speech recognition. Replies are spoken by the server’s voice service when one is set up, or by the voices on your device, and the mouth moves with the speech.', note: 'Speech recognition needs Chrome or Edge and microphone permission. Nothing plays until you turn speech on.' },
];

function FIcon({ name }: { name: IconName }) { return <Icon name={name} size={24} />; }

export default function Landing() {
  const name = useRobotName();
  const status = useLiveStatus();
  const renamed = name !== PRODUCT_NAME;
  useTitle(`${PRODUCT_NAME} — meet your new digital companion`);
  const preview = useRef<PreviewHandle>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [shown, setShown] = useState<DemoState | null>(null);
  const note = shown ? DEMO_STATES.find((d) => d.id === shown)?.note : null;
  const showState = (id: DemoState) => { setShown(id); preview.current?.state(id); };
  const onActivity = useCallback((l: string | null) => setActivity(l), []);
  // Warm up the workspace in the background once the page is idle, so "Meet …" opens instantly.
  useEffect(() => {
    const go = () => { void import('../components/App').catch(() => {}); };
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(go, { timeout: 4000 }) : window.setTimeout(go, 2500);
    return () => { const cic = (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback; if (ric && cic) cic(id); else clearTimeout(id); };
  }, []);

  return (
    <SitePage className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="site-wrap hero-grid">
          <div className="hero-copy">
            <StatusPill s={status} />
            <h1 id="hero-title">Meet your new <span className="accent">digital companion</span>.</h1>
            <p className="lead">
              {renamed ? <><b>{name}</b> is your {PRODUCT_NAME} robot</> : <>{PRODUCT_NAME} is a small, curious 3D robot</>} that lives on your screen — it talks through a real AI model,
              shows how it feels about the conversation with its face and body, and learns new gestures only when you approve them.
            </p>
            <div className="cta-row">
              <Link to={PATHS.app} className="btn btn-primary btn-lg">Meet {name}</Link>
              <a href="#features" className="btn btn-ghost btn-lg" onClick={(e) => { e.preventDefault(); history.replaceState(null, '', '#features'); scrollToHash('#features'); }}>Explore features</a>
            </div>
            {WEB_DEMO
              ? <p className="muted small" data-testid="web-demo-note">This is the <b>web demo</b>: the robot, its movements, skills and memory run in your browser and a scripted demo brain answers (not an AI). For real AI conversation, run NEXUS on your computer — <a className="text-link" href={REPO_URL}>get it on GitHub</a>.</p>
              : <p className="muted small">No account needed. Conversation needs the NEXUS server and an AI provider — the status above shows what is connected right now.</p>}
          </div>
          <div className="hero-art">
            <div className="hero-stage">
              <div className="hero-glow" aria-hidden />
              <div className="hud hud-tl" aria-hidden><span className="hud-dot" />NEXUS · 3D</div>
              <div className="hud hud-tr" aria-hidden>STATE · {(shown ?? 'idle').toUpperCase()}</div>
              <span className="hud-corner c1" aria-hidden /><span className="hud-corner c2" aria-hidden /><span className="hud-corner c3" aria-hidden /><span className="hud-corner c4" aria-hidden />
              <div className="hero-floor" aria-hidden />
              <PreviewRobot ref={preview} greet mode="auto" onActivity={onActivity} title={`${name}, the 3D NEXUS robot`} className="hero-robot" />
            </div>
            <div className="state-panel">
              <div className="chip-row" role="group" aria-label={`Show ${name}’s states`}>
                {DEMO_STATES.map((d) => <button key={d.id} className={`chip ${shown === d.id ? 'chip-on' : ''}`} aria-pressed={shown === d.id} onClick={() => showState(d.id)}>{d.label}</button>)}
                <button className="chip chip-quiet" onClick={() => { setShown(null); preview.current?.reset(); }}>Reset</button>
              </div>
              <p className="small muted state-note" role="status" aria-live="polite">{activity ? <>Now showing: <b>{activity}</b>{note ? ` — ${note}` : ''}</> : 'Live 3D render driven by the real motion engine — not a video. Pick a state.'}</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="section" aria-labelledby="features-title">
        <div className="site-wrap">
          <p className="eyebrow">What it can do</p>
          <h2 id="features-title">A companion with a personality — and honest limits</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="feature-card">
                <span className="feature-icon" aria-hidden><FIcon name={f.icon} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                {f.note && <p className="feature-note">{f.note}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="section" aria-labelledby="how-title">
        <div className="site-wrap">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">Three steps</h2>
          <ol className="steps">
            <li><span className="step-n" aria-hidden>1</span><h3>Meet the robot</h3><p>Open the app and say hello. Everything you see — face, gestures, status — reflects what is really happening.</p></li>
            <li><span className="step-n" aria-hidden>2</span><h3>Connect an AI and personalize</h3><p>Pick a provider in Settings → Model (or the free offline option), then give your robot a name and a resting face.</p></li>
            <li><span className="step-n" aria-hidden>3</span><h3>Chat, explore and teach</h3><p>Ask questions, try expressions, and approve new animation skills you like. Undo any version you don’t.</p></li>
          </ol>
        </div>
      </section>

      <section id="trust" className="section section-alt" aria-labelledby="trust-title">
        <div className="site-wrap trust">
          <h2 id="trust-title">Straight answers</h2>
          <ul className="trust-list">
            <li><b>Demo mode is not an AI.</b> Until you configure a model, a scripted demo brain answers a small set of commands — and the app says so.</li>
            <li><b>Your AI provider sees your messages.</b> With a hosted provider, conversation text is sent to it; with Ollama it stays on your computer.</li>
            <li><b>Keys stay on the server.</b> API keys are kept by the local server and are never sent to the page.</li>
            <li><b>Memory is yours.</b> Memories and skills are stored on this computer, and only what you approve is kept.</li>
            <li><b>Some features need permission.</b> The microphone, speech voices and live research depend on your computer, network and settings.</li>
          </ul>
          <Link to={PATHS.privacy} className="text-link">Read the privacy notes →</Link>
        </div>
      </section>

      <section className="section final-cta" aria-labelledby="cta-title">
        <div className="site-wrap cta-card">
          <h2 id="cta-title">{name} is ready when you are.</h2>
          <p>Open the robot workspace to start chatting, personalizing and teaching new moves.</p>
          <Link to={PATHS.app} className="btn btn-primary btn-lg">Open the robot</Link>
        </div>
      </section>
    </SitePage>
  );
}
