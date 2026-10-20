/** Routes "/about", "/privacy" and the not-found page. */
import { Link, PATHS, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { SitePage, useRobotName } from './Site';
import { PreviewRobot } from './PreviewRobot';

export function About() {
  const name = useRobotName();
  useTitle(`About — ${PRODUCT_NAME}`);
  return (
    <SitePage className="doc-page">
      <article className="site-wrap prose">
        <p className="eyebrow">About</p>
        <h1>About {PRODUCT_NAME}</h1>
        <p>{PRODUCT_NAME} is an AI companion app built around an original 2D robot character{name !== PRODUCT_NAME ? <> — yours is called <b>{name}</b></> : ''}. It combines a conversation with a language model, a
          character animation engine, consent-based memory and a constrained way to teach the robot new gestures.</p>
        <h2>What is real</h2>
        <ul>
          <li><b>Conversation</b> comes from the model provider you configure (OpenAI-compatible, Anthropic, or a local Ollama model). Without one, a scripted <em>demo brain</em> answers a few commands and is labelled “not an LLM”.</li>
          <li><b>Expressions and motions</b> are produced by the app’s animation engine from validated data — the model only suggests which ones fit.</li>
          <li><b>Learning</b> means saving approved memories, preferences and animation skills on this computer. The language model is never trained or fine-tuned by this app.</li>
        </ul>
        <h2>How it is built</h2>
        <p>A React and TypeScript single-page app, a small Express server that keeps API keys away from the browser and binds only to your own computer,
          and an optional desktop app. Everything the model returns is validated before the app uses it, and generated skills are data — never code.</p>
        <p><Link to={PATHS.app} className="btn btn-primary">Open the robot</Link></p>
      </article>
    </SitePage>
  );
}

export function Privacy() {
  useTitle(`Privacy — ${PRODUCT_NAME}`);
  return (
    <SitePage className="doc-page">
      <article className="site-wrap prose">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy notes</h1>
        <p>{PRODUCT_NAME} runs on your computer. There are no accounts and no analytics. This is what is stored and what is sent.</p>
        <h2>Stored on this computer</h2>
        <ul>
          <li>Memories you approved, the robot’s name and your settings, approved animation skills and their versions.</li>
          <li>You can view, edit, export and delete memories in the Memory panel. Clearing NEXUS’s local data (Memory panel → Delete all, or the app’s settings folder) removes everything.</li>
        </ul>
        <h2>Stored by the local server</h2>
        <ul>
          <li>The model provider, model name and API keys you set in Settings → Model, in <code>data/runtime-config.json</code> (desktop app: its settings folder). Keys are never sent back to the page.</li>
          <li>Request logs contain method, path, status and timing — never message text.</li>
        </ul>
        <h2>Sent to other services</h2>
        <ul>
          <li><b>Your AI provider</b> receives the recent conversation, the robot’s name, and relevant approved memories with each message. Hosted providers have their own retention policies; deleting something here does not delete copies they may keep.</li>
          <li><b>Ollama</b> runs on your computer, so with it conversation text stays local.</li>
          <li><b>Research</b> (only if you turn it on) sends your question to the search service you chose.</li>
          <li><b>Speech recognition</b> uses your browser’s engine; in Chrome and Edge audio may be processed by the browser vendor’s online service.</li>
        </ul>
        <p className="muted small">The server only answers requests from this computer (localhost) and refuses pages on other websites.</p>
      </article>
    </SitePage>
  );
}

export function NotFound() {
  const name = useRobotName();
  useTitle(`Page not found — ${PRODUCT_NAME}`);
  return (
    <SitePage className="doc-page">
      <section className="site-wrap notfound">
        <PreviewRobot face="confused" title={`${name} looking confused`} className="nf-robot" />
        <div>
          <p className="eyebrow">404</p>
          <h1>This page doesn’t exist</h1>
          <p>{name} looked everywhere. The address may be mistyped, or the page was moved.</p>
          <div className="cta-row"><Link to={PATHS.home} className="btn btn-ghost">Go home</Link><Link to={PATHS.app} className="btn btn-primary">Open the robot</Link></div>
        </div>
      </section>
    </SitePage>
  );
}
