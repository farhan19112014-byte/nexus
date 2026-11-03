# NEXUS — Data protection & memory boundaries

NEXUS runs in two ways, and this document covers both:

- **On your own computer** (`npm start`, the desktop app): the server answers only this computer (`127.0.0.1`).
- **The public deployment**: the website on GitHub Pages and the NEXUS server on Render (`PUBLIC_MODE=true`).

It lists what is stored, where, for how long, and who receives it. It describes how the code works and is not a legal certification. The in-app Privacy page (`src/site/Pages.tsx`) is the short version of this document; keep the two in step.

NEXUS has no accounts, no cookies, no analytics and no ads.

## Stored in your browser, on this device
- **Conversations** are saved in IndexedDB so they survive reloads (on by default). Turn this off in Settings → Privacy
  ("Save chats on this device"), which also offers "Delete all saved chats". The open conversation is also held in memory
  in the tab (max 200 messages).
- **Memories:** short items (facts, preferences, rules, goals), only when you explicitly asked NEXUS to remember them,
  accepted a suggestion, added them manually, or imported them. Each item records why, when, its source and when it was
  last used. Stored in IndexedDB (`nexus-companion-2d` database, `memory` store).
- **Refused:** text that looks like passwords, API keys, card numbers or national ID numbers is never stored, even on request.
- **Off switch:** with memory off, nothing is saved and nothing is retrieved; gesture preferences apply to the session only.
- **Settings, the robot's name, approved animation skills** (with version history and validation reports, animation data
  only), ratings and the failure log.
- **Reminders and timers** are parsed and stored on this device and are never sent to the AI provider.
- **Deletion:** Delete removes a record from IndexedDB; "Delete all" clears memory, summaries and preferences; clearing this
  site's data in the browser removes everything. Browser backups or profile sync are outside NEXUS's control.

Nothing in this section is uploaded, except the parts sent with a chat message as described next.

## Sent when you chat
- **The NEXUS server** receives your message, the recent turns of the current chat (Settings → History, default 16; the
  server also caps by count and characters), the robot's name, relevant approved memories (at most 12 lines, plus rules)
  and, if research is on, the retrieved source snippets. It passes them to the AI provider and **does not save conversations**. Failed, cancelled and system messages are never sent.
- **The AI provider** receives that same text to write the reply:
  - Public deployment: **Google Gemini** (free tier). Under Google's terms for unpaid use, Google may use submitted content
    to improve its products and people may review it. **Don't send anything private or sensitive.**
  - On your own computer: whichever provider you configure: Google Gemini, an OpenAI-compatible endpoint, Anthropic, or a
    local server such as Ollama or LM Studio (conversation text then stays on your computer).
  - The provider's own retention and training policies apply. Deleting something in NEXUS does not delete copies a
    provider may keep.
- **The demo brain** sends nothing to any AI service. It runs on the server, or in the browser when there is no server.

## Voice
- **Spoken replies:** when the server has a speech (text-to-speech) service configured (for example Google Gemini speech or
  ElevenLabs), the text of each spoken reply is sent to it. Otherwise your device's own voices are used. Audio never plays
  before you interact with the page.
- **Voice input:** the microphone is used only after you press the microphone button and allow access, and only until
  listening stops. The recording goes either to your browser's speech recognition (Chrome and Edge may process it with
  the browser vendor's online service), or to the server's transcription service if one is configured. The server forwards
  that audio and does not store it.
- Synthesised audio is not written to disk. The server keeps the last few generated sentences in memory for up to
  10 minutes, per visitor, so that replaying one does not call the voice service again; only you can get your own copy.

## Research (only if turned on)
- The server sends a query derived from your latest message (≤200 characters) to the configured search service
  (Wikipedia, your SearXNG instance, or Tavily). Results are shown with the reply and passed to the model as untrusted
  data. They are **not** saved to memory.

## The server
- **Keys** stay in the server process: from `.env` or the hosting service's environment, or, on your own computer only,
  from `data/runtime-config.json` (created when you save keys in Settings → Model; file mode 0600; git-ignored). The desktop
  app keeps that file in its user-data folder (Windows: `%APPDATA%\NEXUS\runtime-config.json`). Keys are never sent to
  the page. On your own computer the page sees "set" and the last four characters; the public server shows only "set".
- **Configuration changes** are accepted only from this computer (loopback) and are switched off entirely on the public server.
- **Logs:** method, path, status and duration only. No message content, memories, audio or keys are logged.
- **Your IP address (public server):** used only to apply the usage limits (messages, spoken characters and voice inputs per
  visitor per day, and requests per minute). The per-minute count is kept in memory only. For the daily counts, the address is
  turned into a salted hash that changes every UTC day (IPv6 addresses: their /64 network), and only that hash and a number
  are stored: in a file on the server (`data/budget.json`), or in the owner's Upstash Redis database if one is configured.
  Daily counts expire after about two days. The raw address is never stored or logged by NEXUS. `/api/visitor` shows you
  the address the server sees for your own request, so the owner can check the proxy setup.

## Hosting (public deployment)
- The website is served by **GitHub Pages** and the public server runs on **Render**. Like any website, these hosting
  services can record standard request information such as IP addresses under their own privacy policies.

## Diagnostics
- The Status → Diagnostics panel keeps the last 300 events (codes, timings, counts) in memory for the tab. Message text is
  included only if you turn on "Include (redacted) message text"; likely secrets are redacted either way. Export is manual.

## Model training
- Nothing in NEXUS trains or fine-tunes a language model. "Learning" means saving approved skills, memories and
  preferences in your browser. (A hosted AI provider's own policy may differ; see "Sent when you chat".)
