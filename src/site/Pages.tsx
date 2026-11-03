/** Routes "/about", "/creator", "/privacy" and the not-found page. */
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
        <p><Link to={PATHS.creator}>Meet the creator →</Link></p>
        <p className="lead">{PRODUCT_NAME} is an interactive AI robotics experience: a conversation with a language model, delivered by an original 3D robot
          character{name !== PRODUCT_NAME ? <> — yours is called <b>{name}</b></> : ''} that listens, thinks and speaks with its face and body.</p>
        <h2>Why give AI a body?</h2>
        <p>Most AI lives in a text box. You type, you wait, you read. {PRODUCT_NAME} explores what changes when the same answers come from a character
          you can watch: one that turns toward you while you type, visibly thinks while a request is pending, and stops talking the moment you interrupt.
          The aim is not to make the AI seem alive — it is to make the conversation easier to follow and more pleasant to have.</p>
        <h2>Robot, interface, server</h2>
        <ul>
          <li><b>The robot</b> is a 3D model rendered in your browser with three.js (the classic 2D drawing appears only where 3D cannot run). An animation engine and a motion engine move it.</li>
          <li><b>The interface</b> runs the conversation, the microphone and speech, and decides which state the robot is in from what is really happening.</li>
          <li><b>The server</b> keeps API keys private, applies usage limits and asks the configured AI service for each reply.</li>
        </ul>
        <h2>An experiment</h2>
        <p>{PRODUCT_NAME} is an independent, experimental project. Features change, some need configuration, and the roadmap on the home page separates what works today from what is only planned.</p>
        <h2>What is real</h2>
        <ul>
          <li><b>Conversation</b> comes from the model provider the NEXUS server is configured with (Google Gemini, OpenAI-compatible, Anthropic, or a local Ollama model). Without one, a scripted <em>demo brain</em> answers a few commands and is labelled “not an LLM”.</li>
          <li><b>Expressions, states and motions</b> are produced by the app’s animation engine from validated data — the model only suggests which ones fit. The robot shows a state (listening, thinking, speaking, error…) only while that is really happening.</li>
          <li><b>Learning</b> means saving approved memories, preferences, animation skills, and — in the learning engine — knowledge notes checked against sources, reflections and tested workflow skills, all in your browser. The language model is never trained or fine-tuned by this app.</li>
          <li><b>HOLOBUILD</b> builds 3D learning models from basic shapes: built-in templates offline, or designs from the connected AI model (labelled as such). It is not a mesh-generation service.</li>
        </ul>
        <h2>How it is built</h2>
        <p>A React and TypeScript single-page app; a procedurally built 3D model rendered with three.js; and a small
          Express server that keeps API keys away from the browser. On your own computer the server answers only that computer; the public version runs
          it on a hosting service with daily usage limits. Everything the model returns is validated before the app uses it, and generated skills are data — never code.</p>
        <p><Link to={PATHS.app} className="btn btn-primary">Meet NEXUS</Link></p>
      </article>
    </SitePage>
  );
}

export function Creator() {
  useTitle(`Meet the Creator — ${PRODUCT_NAME}`);
  return (
    <SitePage className="doc-page creator-page">
      <article className="site-wrap prose" data-testid="creator">
        <p className="eyebrow">The creator</p>
        <h1>Meet the Creator</h1>
        <p className="maker">Mohammad Farhan Khan · Creator of {PRODUCT_NAME}</p>
        <p className="lead">Mohammad Farhan Khan is the young innovator and creator behind {PRODUCT_NAME}. Driven by a strong interest in artificial
          intelligence, robotics, and emerging technologies, he is passionate about turning ambitious ideas into practical experiments.</p>
        <p>His journey is built on curiosity, hands-on development, and a belief that innovation begins with asking questions others might overlook.</p>
        <p>With {PRODUCT_NAME}, he aims to explore a new way of experiencing artificial intelligence — one that goes beyond text on a screen and brings
          intelligence closer to people through voice, expressions, movement, and interaction.</p>
        <p>For Farhan, {PRODUCT_NAME} is more than a project. It represents his vision of what human-centred technology could become.</p>
        <blockquote className="creator-quote"><p>Curiosity sparked the idea. Experimentation brought it to life.</p></blockquote>
        <p><Link to={PATHS.app} className="btn btn-primary">Meet NEXUS</Link> <Link to={PATHS.about} className="btn">About NEXUS</Link></p>
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
          <li><b>HOLOBUILD models</b> you save (and GLB/GLTF files you import) and the <b>learning engine</b>’s data — knowledge notes with their sources, research reports, reflections, workflow skills and short experience notes (a rating, a correction, a failure, a question asked twice; never whole conversations, and nothing that looks sensitive) — are kept in the same browser storage. You can inspect, correct and delete all of it on the Learning page; experience notes expire after 90 days.</li>
        </ul>
        <h2>Sent when you chat</h2>
        <ul>
          <li><b>The NEXUS server</b> receives your message, the recent turns of the current chat, the robot’s name and relevant approved memories, and passes them to the AI provider. It does not save conversations. Its request log records only method, path, status and timing — never message text.</li>
          <li><b>The AI provider</b> (Google Gemini on the public server) receives that same text to write the reply. The public server uses Gemini’s free tier; under Google’s terms for unpaid use, Google may use submitted content to improve its products and people may review it. <b>Please don’t send anything private or sensitive.</b> Deleting something here does not delete copies a provider may keep.</li>
          <li><b>Your IP address</b> is used by the public server only to apply the daily and per-minute usage limits. The daily counts store a salted hash of it that changes every day (never the address itself), with a number, and expire after about two days. Recently generated speech is kept in memory for up to 10 minutes so a replay doesn’t call the voice service again.</li>
        </ul>
        <h2>Voice and research</h2>
        <ul>
          <li><b>Spoken replies:</b> if the server has a voice service configured, the reply text is sent to it (for example Google Gemini or ElevenLabs) to make the audio; otherwise your device’s own voices are used. Audio never plays before you interact with the page.</li>
          <li><b>Speech recognition</b> uses your browser’s engine (in Chrome and Edge audio may be processed by the browser vendor’s online service), or the server’s transcription service if one is configured. The microphone is used only after you press the microphone button and allow access, and only until listening stops.</li>
          <li><b>Research</b> (only if turned on) sends your question to the search service that was configured.</li>
          <li><b>HOLOBUILD and learning:</b> when you ask NEXUS to design a model, edit it with words it does not understand by itself, research a question, reflect or run a skill, that text (and, for research, the retrieved web text) goes to the NEXUS server and its AI provider, and research questions to the configured search service. Background learning is off unless you turn it on, and only runs while NEXUS is open.</li>
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
