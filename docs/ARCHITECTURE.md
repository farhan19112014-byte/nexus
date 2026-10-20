# Architecture

```
            ┌──────────────────────────── browser ─────────────────────────────┐
 user ─────►│ components/ (React UI) ──► core/companion.ts (orchestrator)       │
 text/voice │    ▲                         │  state machine (core/stateMachine)  │
            │    │ snapshots               │  context (ai/context) → ai/apiClient├──► server /api/chat (SSE)
            │    │                         │  ◄── head · deltas · final ─────────┤
            │    │                         ▼                                     │
            │    │      planner (ai/planner) → skillRunner → animation/engine ───┼─► character/Robot.tsx (SVG rig)
            │    │      skills/learning ↔ skills/registry (IndexedDB)            │        ▲
            │    │      memory/store (IndexedDB, consent, retrieval)             │        │ expressions/controller
            │    │      voice/ (mic, recognition, tts) · core/notifications      │
            └──────────────────────────────────────────────────────────────────┘
 server/:  app.ts (routes, limits, loopback config) → brainService.ts (research → prompt → provider → parse/validate)
           providers/ (demo | OpenAI-compatible | Anthropic; streaming)  research/ (wikipedia | searxng | tavily)
 shared/:  channels.ts (the rig) · schema.ts (every boundary) · streamParser.ts · demoBrain.ts
```

## Character (Assets 01–10)
An original chibi robot drawn as one SVG (`character/Robot.tsx`) from a single geometry file (`geometry.ts`) and token file (`tokens.ts`). Everything that moves is a **channel** in `shared/channels.ts` (range, rest, max speed, exclusive group). React renders the structure once; `RigHandle.apply(values)` updates attributes via refs each frame, so animation causes no React re-renders. `character/consistency.ts` encodes visual rules used by the validator; `/?sheet=1` renders all states for visual review.

## Animation (21–30)
`animation/engine.ts` is the only writer of channel values. Per frame: pose base → expression face targets → idle breathing → skill actions (arbitrated per channel *group* and priority: interrupt / queue / reject, never silent overwrite) → gaze → blink (single state machine) → speech mouth → clamp → per-channel speed limit. Recovery: watchdog budget fixed at start, `stopAll`, `reset`, queue/active limits. `animation/timeline.ts` holds pure keyframe math; everything is deterministic for a given dt sequence (seeded RNG).

## Expressions (11–20)
`expressions/presets.ts` defines versioned presets; `expressionController.ts` resolves requests from several sources (system state, AI response, skill, user, reaction) by priority then recency, with eased transitions. Error (5) cannot be overridden by low-priority reactions.

## Brain (41–50)
The model only proposes intentions. Streaming output contract: `HEAD {json}` line, reply text, optional `<<<META>>>` + JSON (parsed incrementally by `shared/streamParser.ts`; the marker never leaks). Non-streaming uses one JSON object with a single repair attempt. Every response is validated with `BrainResponseSchema` on the server **and** the client; invalid fields are dropped and listed. Errors are typed (`ErrorCode`) with retryable flags; retries happen only before any text reached the user. System instructions are versioned (`server/prompts/system.ts`).

## Memory (51–60)
`memory/store.ts`: explicit "remember…" requests are consent; model-suggested items wait for the user's click. Each item records source, reason, timestamps and last use. Conflicts resolve by key + source priority + recency (older items are kept as *superseded*). Retrieval is relevance-ranked (`memory/retrieval.ts`). Writes are verified by reading back. See `docs/PRIVACY.md`.

## Skill learning (61–70)
Proposal (generator motifs, raw keyframes, composition, or expression preset) → schema → structural checks → 60 Hz simulation at default and max speed/amplitude (speed limits, consistency rules, durations, end state) with automatic slow-down repair → stored as **proposed** → previewed on an isolated engine (`skills/sandbox.ts`) → **approved** or **rejected**. Approved skills join the catalog sent to the model. All versions are kept; revert/activate/deprecate/restore. Refinements change only speed/amplitude/repetitions and follow the configured policy. Nothing here trains a model.

## Research (71–80)
Optional, server-side, per message. Results are validated, HTML-stripped, timestamped with the real retrieval time and inserted into the prompt inside `<untrusted_sources>` with instructions to ignore embedded commands. The UI shows sources, citations and freshness labels. `security/toolPermissions.ts` lists each tool's permissions, consent model and enforcement point. Every reply has a "What changed?" disclosure (conversation / memory / preference / skill registry), always noting the model was not trained.

## Voice & UI (81–90)
`voice/mic.ts` queries permission without requesting it; `recognition.ts` delivers interim text and one final transcript (optionally reviewed before sending); `tts.ts` speaks sentence-by-sentence as text streams in, with word boundaries driving approximate mouth shapes. Saying "stop" while listening cancels. Quiet mode suppresses optional sounds/reactions/desktop notifications but never errors or status.

## Reliability (91–100)
Local-only server (127.0.0.1), loopback-only config writes, body/rate/timeout/retry limits, content-free logs, privacy-preserving diagnostics, and a test suite whose results drive the asset registry (`scripts/report.mjs`).

## Running on a laptop / desktop app

- `server/start.ts` starts the API + built app on 127.0.0.1 (port fallback, reuse of an already-running NEXUS). It is bundled
  by esbuild into `dist-server/` so the start scripts and the desktop app need only Node/Electron, not TypeScript tooling.
- `server/app.ts` refuses API requests whose `Host` is not localhost/127.0.0.1/[::1] and state-changing requests from foreign
  `Origin`s (DNS-rebinding / cross-site protection), and exposes `GET /api/local-models` (loopback only) to detect Ollama.
- `desktop/main.cjs` (Electron) imports `dist-server/start.js` in the main process, loads `http://localhost:18787` in a
  sandboxed, context-isolated window with no preload, denies navigation to other origins, opens external links in the system
  browser and allows only the microphone permission for its own origin. Runtime config lives in Electron's `userData` folder.
- Layout: ≥1280 px three columns; 761–1279 px the side panel becomes a drawer (App `drawerMode`); ≤760 px stacked mobile layout;
  `max-height: 820px` compacts chrome for laptop screens.

## Website, routing and identity (v3)

- `src/main.tsx` + `src/router.tsx`: `/` landing (`src/site/Landing.tsx`), `/app` (and `/settings`) workspace, `/about`, `/privacy`, not-found.
  Each destination is a lazy chunk; the landing page does not start the companion runtime.
- `src/site/PreviewRobot.tsx` renders the same SVG rig with its own engine + expression controller (so the homepage never changes the
  companion's state); it pauses off-screen / in hidden tabs and plays nothing automatically under reduced motion.
- Identity (`shared/identity.ts`): `PRODUCT_NAME` ("NEXUS", fixed), `CHARACTER_ID` (internal), and the robot's display name — stored once in
  settings (`robotName`), validated by `validateRobotName` (trim, NFC, ≤32 graphemes, no control/bidi/invisible chars, no markup).
  `Companion.renameRobot()` validates → saves → reads back → reports; it touches no conversation, memory, skill or provider state.
  The name travels in `ChatRequest.profile.robotName` (validated again on the server) and the persona is rebuilt per request.
- Personalization settings (`defaultExpression`, `greetingStyle`, `greetEverySession`, `idleLevel`, `speakingMouth`) map to
  `ExpressionController.baseline`, the greeting skill, `AnimationEngine.idleScale` and `AnimationEngine.speechMouth`.
- Design tokens: `PALETTE` in `src/character/tokens.ts` → `--nexus-*` CSS variables (blue, dark blue, white, black, grey).

## Companion features (v4)

- `src/components/Markdown.tsx`: tiny Markdown → React elements parser (never HTML strings); http(s)-only links.
- `src/core/chats.ts` (`ChatStore`, IndexedDB store `chats`): the current chat is saved ~0.4 s after each settled change (in-flight
  messages are stored as cancelled), restored on start, listed/searched/renamed/exported/deleted in the Chats tab; `saveChats` turns it off.
- `src/core/reminders.ts` (`parseReminder`, `ReminderStore`, IndexedDB store `reminders`): `Companion.send` checks for a reminder/timer
  phrase first and handles it on device (reply meta `provider: on-device`); the store arms one timeout (re-checked every minute), fires
  into the chat + a toast + chime + the robot, and flags reminders that came due while the app was closed as late.
- Liveliness: `Companion.noteTyping` (attention face + gaze toward the chat), `Companion.ambient` (look_around / stretch / antenna_wiggle /
  head_tilt every 25–50 s while idle; off in quiet mode, reduced motion, idle "still"), `Companion.dailyGreeting` (once per calendar day).
- Theme: `src/theme.ts` resolves dark / light / system and sets `<html data-theme>`; all colors come from semantic CSS variables.
- Compact prompt: `BrainService.compact` (auto for OpenAI-compatible endpoints on localhost; `PROMPT_MODE=full|compact` to force) uses
  `compactContract` and a shorter history window.

## Robot-first voice experience (v4.4)

**Layout.** `components/RobotView.tsx` is the default `/app` view: the robot fills the window; the current exchange is
shown as captions under it (so NEXUS is usable without sound and by screen readers); a dock holds the microphone, mute,
pause/resume, stop and a "type instead" toggle. Conversation history, chats, skills, memory, reminders, settings and
status open from **Menu** (a drawer). Settings → Personalization → Layout switches to the classic workspace.

**Interaction lifecycle.** `core/stateMachine.ts` now has explicit **PAUSED** (speech held mid-reply, mouth closed) and
**RECOVERING** (after an error: reassuring face, limbs settle with `return_to_idle`, then IDLE) states:

```
IDLE → LISTENING → PROCESSING → (RESPONDING) → SPEAKING ⇄ PAUSED → IDLE
any → INTERRUPTED → IDLE/LISTENING      ERROR → RECOVERING → IDLE
```

Every request carries a token; a newer request, Stop or Esc cancels the network request (AbortController), the speech
queue (generation counter), lip-sync and running gestures, so a stale reply can never resume.

**Voice engines** (`voice/router.ts`). Output: `ServerSpeechOutput` when the server has a speech service configured,
otherwise the browser's `speechSynthesis`. Input: `ServerSpeechInput` (MediaRecorder → `/api/transcribe`; end of speech =
~1.2 s of quiet after speech, 30 s max, 8 s with no speech) when a transcription service is configured — this also gives
voice input in the desktop app — otherwise browser `SpeechRecognition`. A sentence the server voice fails to produce is
spoken by the browser voice instead, with one notice.

**Lip-sync, in priority order and honestly labelled:**
1. Provider phoneme/viseme timestamps — *not available*: the OpenAI-compatible speech API returns audio only.
2. **Audio level of the audio that is actually playing** (server voice): an `AnalyserNode` measures loudness every frame;
   `engine.speechLevel()` drives mouth openness/width with smoothing, so pauses close the mouth. This is an amplitude
   approximation, not phoneme lip-sync.
3. Browser voices: word-boundary events give an approximate vowel shape (`visemeFor`); without them the mouth moves on a
   timer while speech is active. Status → Settings → Voice shows which method is in use.

**Server speech adapters** (`server/speech.ts`): `POST /api/tts` (≤ 1200 chars → audio bytes) and `POST /api/transcribe`
(raw audio ≤ 8 MB → `{text}`), both behind the Host/Origin guard and a rate limit, with timeouts and typed errors
(`not_configured`, `auth`, `rate_limited`, `malformed`, `network`). Keys are write-only; the chat key is reused only for the
same host. Audio is forwarded, never stored.

**Expressions & gestures.** 19 presets incl. *excited, interested, sympathetic, reassuring*; motions incl. *explain*
(open hand), *speak_beat* (one restrained beat during longer spoken replies when no gesture was chosen), *reassure*,
*agree / disagree / acknowledge / success / return_to_idle*. The model only picks from these allowlisted ids; anything
else is dropped and the reply still plays.
