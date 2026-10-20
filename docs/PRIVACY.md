# NEXUS — Data protection & memory boundaries

NEXUS is a **local, single-user** app: a browser front end and a small Node server bound to `127.0.0.1`.
This document lists exactly what is stored, where, for how long, and who receives it (Assets 58 and 92).

## Session context
- **What:** the messages of the current conversation (max 200 in the tab).
- **Where:** in memory, in this browser tab only. Closing or reloading the tab discards it.
- **Sent to the AI provider:** the most recent messages within the history limit (Settings → History, default 16; the server also caps by count and characters). Failed, cancelled and system messages are never sent.

## Persistent memory
- **What:** short items (facts, preferences, rules, goals) — only when you explicitly asked NEXUS to remember them, accepted a suggestion, added them manually, or imported them. Each item records why, when, its source and when it was last used.
- **Where:** IndexedDB in this browser profile (`nexus-companion-2d` database, `memory` store). Nothing is uploaded except as described below.
- **Sent to the AI provider:** only the items relevant to the current message (relevance-ranked, at most 12 lines), plus rules.
- **Deletion:** Delete removes the record from IndexedDB. "Delete all" clears the memory, summary and preference stores. Browser backups or sync of your profile are outside NEXUS's control.
- **Refused:** text that looks like passwords, API keys, card numbers or national ID numbers is never stored, even on request.
- **Off switch:** with memory off, nothing is saved and nothing is retrieved; gesture preferences apply to the session only.

## Provider-side history
- The configured LLM provider (OpenAI-compatible endpoint or Anthropic) receives: the system instructions, the trimmed conversation, relevant memories and, if research is on, the retrieved source snippets. Its retention and training policies are the provider's, not NEXUS's — check them before using a hosted provider. Local servers (e.g. Ollama) keep data on your machine.
- The demo brain sends nothing anywhere: it runs on the server (or in the browser when the server is offline).

## Retrieved information
- When **Research** is on and a research provider is configured, the server sends a query derived from your latest message (≤200 characters) to that provider (Wikipedia, your SearXNG instance, or Tavily). Results are validated, shown with the reply (title, URL, our retrieval time) and passed to the model as untrusted data. They are **not** saved to memory.

## Skill registry
- Approved, proposed, rejected and failed motions/expressions are stored in IndexedDB (`skills` store) with version history and validation reports. They contain animation data only — no conversation content.
- Ratings and refinement notes are stored in the `feedback` store; the failure log in `log`.

## Server
- **Secrets:** API keys come from `.env` or from `data/runtime-config.json` (created only when you save keys in Settings → Model; file mode 0600; git-ignored). The server never returns secrets — only "set" and the last four characters.
- **Configuration changes** are accepted only from loopback (`127.0.0.1`/`::1`).
- **Logs:** method, path, status and duration only. No message content, memories or keys are logged.

## Diagnostics
- The Status → Diagnostics panel keeps the last 300 events (codes, timings, counts) in memory for this tab. Message text is included only if you turn on "Include (redacted) message text"; likely secrets are redacted either way. Export is manual.

## Not stored
- Microphone audio (speech recognition is performed by your browser; some browsers send audio to their vendor's servers — see your browser's policy).
- Synthesised speech, screenshots, analytics or telemetry. NEXUS has no analytics.

## Model training
- Nothing in NEXUS trains or fine-tunes a language model. "Learning" means saving approved skills, memories and preferences in your browser.

## Laptop / offline use

- With Ollama (Settings → Model), conversation text is sent only to the Ollama server on your own computer.
- The desktop app keeps provider settings and keys in its user-data folder (Windows: `%APPDATA%\NEXUS\runtime-config.json`),
  readable by your user account; memories and skills are in the app's own browser storage.

## Robot name

- The name you give the robot is stored with your settings in this browser and is sent to the configured AI provider with each message
  (so the model knows what it is called). Resetting personalization restores the default name.

## Saved chats and reminders

- Conversations are saved in this browser (IndexedDB) so they survive reloads; turn this off in Settings → Privacy (“Save chats on this
  device”), which also offers “Delete all saved chats”. Only the current chat's recent turns are ever sent to the AI provider.
- Reminders and timers are parsed and stored on this device; they are never sent to the AI provider.

## Speech services (optional)

- Off by default. When configured, the text of each spoken reply is sent to the speech (TTS) service, and each recording you make with the microphone is sent to the transcription service — only after you press the microphone. NEXUS forwards the audio and does not store it.
- Keys for these services stay in the NEXUS server process (environment or the runtime config file) and are never sent to the window.
- Without speech services, spoken replies use this computer's voices and voice input uses the browser's recognition (Chrome/Edge may process audio with the vendor's online service).
