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
        <p className="maker" data-testid="maker">Made by Muhammad Farhan Khan</p>
        <p>{PRODUCT_NAME} is an AI companion built around an original robot character, shown in 3D (or as the classic 2D drawing where 3D is
          not available){name !== PRODUCT_NAME ? <> — yours is called <b>{name}</b></> : ''}. It combines a conversation with a language model, a
          character animation engine, consent-based memory and a constrained way to teach the robot new gestures.</p>
        <h2>What is real</h2>
        <ul>
          <li><b>Conversation</b> comes from the model provider the NEXUS server is configured with (Google Gemini, OpenAI-compatible, Anthropic, or a local Ollama model). Without one, a scripted <em>demo brain</em> answers a few commands and is labelled “not an LLM”.</li>
          <li><b>Expressions, states and motions</b> are produced by the app’s animation engine from validated data — the model only suggests which ones fit. The robot shows a state (listening, thinking, speaking, error…) only while that is really happening.</li>
          <li><b>Learning</b> means saving approved memories, preferences and animation skills in your browser. The language model is never trained or fine-tuned by this app.</li>
        </ul>
        <h2>How it is built</h2>
        <p>A React and TypeScript single-page app; a 3D model rendered with three.js and driven by the same animation channels as the 2D robot; and a small
          Express server that keeps API keys away from the browser. On your own computer the server answers only that computer; the public version runs
          it on a hosting service with daily usage limits. Everything the model returns is validated before the app uses it, and generated skills are data — never code.</p>
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
        <p>{PRODUCT_NAME} has no accounts, no cookies, no analytics and no ads. This page describes what the app itself stores and sends. It is a plain
          description of how the code works, not a legal certification.</p>
        <h2>Stored in your browser, on this device</h2>
        <ul>
          <li>Your conversations, memories you approved, the robot’s name and your settings, and approved animation skills with their versions — in this browser’s storage (IndexedDB).</li>
          <li>They are not uploaded anywhere. You can view, export and delete memories in the Memory panel and delete chats in the chat list; clearing this site’s data in your browser removes everything.</li>
        </ul>
        <h2>Sent when you chat</h2>
        <ul>
          <li><b>The NEXUS server</b> receives your message, the recent turns of the current chat, the robot’s name and relevant approved memories, and passes them to the AI provider. It does not save conversations. Its request log records only method, path, status and timing — never message text.</li>
          <li><b>The AI provider</b> (Google Gemini on the public server) receives that same text to write the reply. The public server uses Gemini’s free tier; under Google’s terms for unpaid use, Google may use submitted content to improve its products and people may review it. <b>Please don’t send anything private or sensitive.</b> Deleting something here does not delete copies a provider may keep.</li>
          <li><b>Your IP address</b> is used by the public server only in memory, to apply the daily and per-minute usage limits; the count resets each day and is not written to disk.</li>
        </ul>
        <h2>Voice and research</h2>
        <ul>
          <li><b>Spoken replies:</b> if the server has a voice service configured, the reply text is sent to it (for example Google Gemini or ElevenLabs) to make the audio; otherwise your device’s own voices are used. Audio never plays before you interact with the page.</li>
          <li><b>Speech recognition</b> uses your browser’s engine (in Chrome and Edge audio may be processed by the browser vendor’s online service), or the server’s transcription service if one is configured. The microphone is used only after you press the microphone button and allow access, and only until listening stops.</li>
          <li><b>Research</b> (only if turned on) sends your question to the search service that was configured.</li>
        </ul>
        <h2>Hosting</h2>
        <ul>
          <li>The website is served by GitHub Pages and the public server runs on Render. As with any website, these hosting services can record standard request information such as IP addresses under their own privacy policies.</li>
          <li>When you run {PRODUCT_NAME} on your own computer, the server answers only that computer (localhost), keeps the provider settings and keys you enter in <code>data/runtime-config.json</code>, and never sends keys to the page. With Ollama, conversation text stays on your computer.</li>
        </ul>
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
        <PreviewRobot face="confused" mode="auto" title={`${name} looking confused`} className="nf-robot" />
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
