/** Route "/" — the public landing page. Every claim here matches what the app actually does. */
import { Icon, type IconName } from '../components/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, PATHS, scrollToHash, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import { PreviewRobot, type PreviewHandle } from './PreviewRobot';
import { SitePage, StatusPill, useLiveStatus, useRobotName } from './Site';

const FEATURES: { icon: IconName; title: string; body: string; note?: string }[] = [
  { icon: 'chat', title: 'Conversational intelligence', body: 'Chat with a real language model through the local server — OpenAI-compatible APIs, Anthropic, or a free model on your own computer with Ollama. Replies stream in and can be cancelled.', note: 'Needs a model provider. Without one, a clearly labelled demo brain answers a few commands.' },
  { icon: 'face', title: 'Expressive character', body: `${BUILTIN_EXPRESSIONS.length} facial expressions and ${BUILTIN_MOTIONS.length} built-in motions — waves, nods, claps, celebrations — blended by a real animation engine with priorities and safe interruption.` },
  { icon: 'pen', title: 'Your robot, your name', body: 'Rename your robot and tune its resting face, greeting, idle liveliness and animation intensity. The new name is used in the app and in what the AI calls itself.' },
  { icon: 'spark', title: 'Motion creation', body: 'Ask for “a shy greeting” or “a more casual wave”. The request becomes a structured proposal that is validated, previewed in a sandbox, and saved only when you approve it — with versions you can roll back.', note: 'Saved skills are animation data. The language model itself is never retrained.' },
  { icon: 'memory', title: 'Memory with consent', body: 'Ask it to remember something and it is stored on this computer. Anything the AI merely suggests waits for your OK. Every memory can be viewed, edited, exported or deleted.' },
  { icon: 'mic', title: 'Voice', body: 'Talk using your browser’s speech recognition and hear replies with the voices on your computer, while the robot’s mouth moves with the speech.', note: 'Speech recognition needs Chrome or Edge and microphone permission; it does not work inside the desktop app.' },
];

function FIcon({ name }: { name: IconName }) { return <Icon name={name} size={24} />; }

const PREVIEWS: { label: string; kind: 'face' | 'motion'; id: string }[] = [
  { label: 'Happy', kind: 'face', id: 'happy' },
  { label: 'Curious', kind: 'face', id: 'curious' },
  { label: 'Surprised', kind: 'face', id: 'surprised' },
  { label: 'Sleepy', kind: 'face', id: 'sleepy' },
  { label: 'Wave', kind: 'motion', id: 'wave' },
  { label: 'Greeting', kind: 'motion', id: 'greeting' },
  { label: 'Celebrate', kind: 'motion', id: 'celebrate' },
];

export default function Landing() {
  const name = useRobotName();
  const status = useLiveStatus();
  const renamed = name !== PRODUCT_NAME;
  useTitle(`${PRODUCT_NAME} — meet your new digital companion`);
  const preview = useRef<PreviewHandle>(null);
  const [activity, setActivity] = useState<string | null>(null);
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
              {renamed ? <><b>{name}</b> is your {PRODUCT_NAME} robot</> : <>{PRODUCT_NAME} is a small, curious robot</>} that lives on your screen — it chats through the AI model you choose,
              shows how it feels about the conversation with its face and body, and learns new gestures only when you approve them.
            </p>
            <div className="cta-row">
              <Link to={PATHS.app} className="btn btn-primary btn-lg">Meet {name}</Link>
              <a href="#features" className="btn btn-ghost btn-lg" onClick={(e) => { e.preventDefault(); history.replaceState(null, '', '#features'); scrollToHash('#features'); }}>Explore features</a>
            </div>
            <p className="muted small">Runs on your computer. No account needed. A model provider is required for real conversation.</p>
          </div>
          <div className="hero-art">
            <div className="hero-glow" aria-hidden />
            <PreviewRobot greet title={`${name}, a small blue and black robot, waving hello`} className="hero-robot" />
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

      <section id="personality" className="section section-alt" aria-labelledby="personality-title">
        <div className="site-wrap personality-grid">
          <div>
            <p className="eyebrow">Say hi</p>
            <h2 id="personality-title">Try a few of {name}’s moves</h2>
            <p>These buttons play the same expressions and motions the robot uses in the app — it’s the real animation engine, not a video.</p>
            <div className="chip-row" role="group" aria-label="Preview expressions and motions">
              {PREVIEWS.map((p) => (
                <button key={p.id} className="chip" onClick={() => { if (p.kind === 'face') preview.current?.express(p.id); else void preview.current?.play(p.id); }}>{p.label}</button>
              ))}
              <button className="chip chip-quiet" onClick={() => preview.current?.reset()}>Reset</button>
            </div>
            <p className="small muted" role="status" aria-live="polite">{activity ? `Now showing: ${activity}` : 'Pick an expression or a motion.'}</p>
          </div>
          <div className="personality-stage">
            <PreviewRobot ref={preview} onActivity={onActivity} title={`${name} showing expressions`} className="mini-robot" />
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
