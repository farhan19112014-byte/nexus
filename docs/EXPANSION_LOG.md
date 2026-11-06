# NEXUS expansion — HOLOBUILD, Learning Engine, Robot Interaction

Implementation log for the "Master Feature Development Directive". Each stage records what changed, the files, the
tests and the limitations. Nothing here claims more than the tests show.

## Stage 1 — Assessment of the existing project

**What already exists (reused, not duplicated)**

| Area | Existing implementation | Reused for |
|---|---|---|
| Frontend | Vite + React 19 + TypeScript, tiny history router (`src/router.tsx`), lazy page chunks (`src/main.tsx`) | new `/holobuild` and `/learning` pages |
| Robot | 3D NEXUS GLB (`public/models/nexus.glb`) via three.js (`src/character3d/Robot3D.tsx`), light/dark skins, 2D fallback (`RobotAuto`) | the same robot, unchanged, docked in HOLOBUILD |
| Animation | channel engine (`src/animation/engine.ts`), expression controller, 3D motion engine with per-state body language (`motion3d.ts`), one render loop (`characterRuntime.ts`) | new motion states (explaining, waiting, serious) |
| Interaction states | companion state machine (`src/core/stateMachine.ts`): idle, listening, processing, responding, speaking, paused, acting, interrupted, error, recovering, resting | extended with activity indicators (building, researching) |
| Voice | server TTS (ElevenLabs / Gemini / OpenAI-compatible) + server STT, browser fallback, audio-level + spectrum lip-sync, interruption | ElevenLabs character timestamps for lip-sync (same voice, same endpoint family) |
| AI | Gemini (+ OpenAI-compatible, Anthropic, demo brain) behind the NEXUS server; keys server-side; daily budgets | HOLOBUILD design/edit, research synthesis, reflection, skill runs |
| Research | Wikipedia / SearXNG / Tavily adapters, sources fenced as untrusted (`server/research`) | the learning engine's research pipeline |
| Memory | consent-based memory (IndexedDB), suggestions, conflicts, summaries | unchanged; knowledge is a separate, verified store |
| Skills | motion/expression skill registry with validation, sandbox preview, approval, versions, rollback | pattern reused for workflow skills (separate store) |
| Persistence | IndexedDB wrapper (`src/storage/db.ts`, v2) | v3 adds stores; existing data kept |
| Auth / creator | **none**: no accounts; "creator" = the person running NEXUS on their own computer; a public server is configured only via its environment | creator diagnostics shown only when not on a public server |
| Deployment | `npm start` locally, Render (public mode) + GitHub Pages, Electron desktop | unchanged |

**Decisions**

- **3D generation = procedural, no paid service.** Two honest routes, both labelled in the UI:
  1. *Procedural templates* built into NEXUS (engine, clock, bridge, robotic arm, motorcycle, heart schematic, house,
     furniture, molecules, solar system, basic shapes) — work offline and in the web demo.
  2. *AI-designed procedural models*: Gemini (or the configured model) returns a validated JSON part list built from
     basic shapes, rendered by three.js. Approximations, never presented as engineering designs.
  Mesh-generating text-to-3D services (Meshy, Tripo, etc.) are paid and need another API key; **not integrated**.
  Imported GLB/GLTF files are the third, clearly labelled origin.
- **Learning = data around the model, never model training.** Experiences, verified knowledge, research reports, workflow
  skills with tests and versions, audit log — all in the browser's IndexedDB. Research and reflection run on the NEXUS
  server (keys stay there) and count against the same daily budgets.
- **Background learning runs only while NEXUS is open** (no server cron on the free host), off by default, with daily limits.
- **Lip-sync**: ElevenLabs' documented `/with-timestamps` endpoint returns per-character timing for the same voice and the
  same character cost; mouth shapes follow those characters. Other voices keep the audio loudness + spectrum method.
  This is character-level timing, not phoneme recognition.

**Dependencies:** no new npm packages (three.js already includes OrbitControls, GLTFExporter, GLTFLoader).
**Compatibility risks:** IndexedDB upgrade (v2→v3, additive); `ChatRequest` gains an optional `context` field (old
clients unaffected); new motion states must stay within existing joint limits.

## Stages 2–3 — HOLOBUILD viewport, generation, manipulation, inspection, exploded view, saving, export

**What changed**
- `shared/holo.ts` — the model format (named parts from 8 basic shapes + imported meshes), materials, validation,
  `coerceModel` for untrusted AI output, edit operations and the pure `applyOps` (stretches along world axes; pitched
  slabs such as roofs get steeper instead of thicker; scaling keeps parts standing on their base).
- `shared/holoEdit.ts` — offline natural-language edits (scale, dimension adjectives, move with units, rotate, material,
  colour, transparency, hide/show/isolate/remove, "add another …", x-ray, rename, explode/assemble/undo). Ambiguous
  singular targets ask; everyday synonyms ("support" → legs/piers…); a model's `front` decides "forward".
- `src/holobuild/templates.ts` — 13 procedural templates with descriptions, groups, assembly steps, facts and caveats.
- `src/holobuild/scene.ts`, `HoloViewport.tsx` — three.js geometry per shape (gears, tubes, tori, capsules, tapered
  cylinders), materials, selection highlight, animated + adjustable exploded view, orbit/zoom/pan, perspective ↔
  orthographic, wireframe, grid, axes, labels, dimensions, fullscreen; render-on-demand; full GPU cleanup; WebGL fallback.
- `src/holobuild/controller.ts` — command routing (build / edit / view / question), undo/redo, steps, AI design and AI
  edits (validated twice), save with read-back, rename, collections, reopen, delete, import, export.
- `src/holobuild/store.ts`, `io.ts`, `src/storage/db.ts` (IndexedDB v3, additive) — library; GLB/GLTF export re-checked
  before download; imports checked (size ≤ 25 MB, glTF 2.0 header/length, embedded resources only, no Draco/meshopt).
- `server/aiTasks.ts`, `server/app.ts` — `/api/holo/design`, `/api/holo/edit`: one AI call + one repair, user text fenced
  as data, output validated; charged to the daily chat allowance and refunded when the provider fails; demo mode → 503
  with an honest message.
- `shared/schema.ts`, `server/prompts/system.ts` — optional `context` (open model, learned knowledge) fenced as data;
  `profile.personality` (tone only).
- `src/core/companion.ts` — `beginActivity` (robot thinks while real work runs; happy only on success, confused on
  failure), `announce` (labelled on-device line), `transcriptHandler` (voice commands on the HOLOBUILD page).
- `src/holobuild/HoloBuild.tsx` + CSS, router `/holobuild`, links from the site and the robot workspace.

**Tests:** `src/tests/unit/holobuild.test.ts` (13: templates, parser incl. all directive example commands, isolation of
edits, ambiguity, scene build + explode, GLB/GLTF round trip, import refusals, library, controller incl. AI paths),
`src/tests/integration/ai-tasks.test.ts` (2: design/edit endpoints, validation, refusal, demo mode, quota refund);
e2e HOLOBUILD block (build, isolated edit, explode, select, save → reload → reopen, GLB download, confirmed delete).
Full unit+integration suite: 245/245 passed at this point (e2e run with the final report).

**Limitations:** procedural models are simplified approximations from basic shapes; AI-designed models depend on the
connected model's spatial sense and can look crude; no paid text-to-mesh service (Meshy/Tripo — paid, separate API key)
is connected; imported files with external textures or compression are refused rather than partly loaded; the offline
edit parser covers common English phrasings only.

## Stages 4–6 — Learning engine: experiences, research + verification, knowledge, reflection, skills, dashboard

**What changed**
- `shared/learning.ts` — schemas (experience, knowledge with verification state + sources, research report, reflection,
  workflow skill with versions/tests/metrics, audit entry, learning settings), deterministic skill-test evaluation,
  offline lexical retrieval, claim similarity.
- `server/learn.ts` + routes — `/api/learn/research` (up to 3 queries → configured search provider → one AI call extracts
  claims → **rule-based** verification: a citation is kept only if the source text contains the claim's key terms;
  `verified` = ≥2 credible sources from different organisations and no contradiction; one source → `pending`;
  contradicted → `conflicting`; unsupported claims dropped; domain credibility by rules), `/api/learn/reflect` (lessons must
  cite real experience ids; proposals touching code/security/permissions/safety are dropped), `/api/learn/skill/draft`
  and `/run` (skills are validated data; input fenced). Same daily allowance and refund rules as chat.
- `src/learning/engine.ts` — records real events only (feedback buttons, corrections, repeated questions, knowledge gaps
  from the model's own uncertainty, failures, HOLOBUILD failures); short redacted summaries, sensitive text skipped,
  90-day retention; research → knowledge (merging duplicates); retrieval into chat (`context.knowledge`, with status, and
  a note on the reply saying knowledge was sent); user corrections / verify / reject / outdated / delete / teach;
  reflection; skills: draft → isolated tests → approval only if all pass → runs counted → improved version (old tests
  kept) → rollback; background learning (off by default, only while open/visible/idle, approved questions first, then
  re-checks of verified notes past their review date, daily limit, pause/resume); every change in an audit log.
- `src/learning/LearningPage.tsx` at `/learning` — overview with counted metrics, research queue (approve/dismiss),
  knowledge (search/filter/correct/verify/reject/re-check/delete/teach), research reports with sources and
  contradictions, skills, experiences, reflection, settings & permissions, activity log.
- Chat: Helpful / Not helpful buttons; companion `knowledgeFor` + `onExchange` hooks; IndexedDB v3 stores.

**Tests:** `src/tests/unit/learning.test.ts` (5), `ai-tasks.test.ts` research/reflection/skill endpoints incl. a
prompt-injection source and unsupported claims; companion integration (knowledge + exchange reporting); e2e learning block.

**Limitations:** Wikipedia alone is one organisation, so with `RESEARCH_PROVIDER=wikipedia` claims stay `pending` (by
design); SearXNG/Tavily give independent sources. The support check is lexical — it catches invented citations but
not subtle misreadings. Retrieval is keyword-based (no embeddings). Background learning cannot run while NEXUS is
closed (no server job on the free host). Reflection quality depends on the connected model.

## Stages 7–8 — Unified interaction states, lip-sync, expressions, body animation

**What changed**
- One state source: the companion state machine → body (`motion3d`), face, core light and UI. New body states
  `explaining` (long replies — more gestures) and `waiting` (after a reply that ends in a question; cleared by any
  input or after 12 s); new `serious` face. `beginActivity` shows real work (building, editing, researching,
  reflecting) on the robot (thinking face/body, core light) and as a chip in the workspace header.
- Lip-sync: with ElevenLabs the browser asks for `timing: true`; the server uses ElevenLabs' documented
  `/v1/text-to-speech/{voice}/with-timestamps` (same voice, model, settings and character cost) and returns the audio
  plus validated character timing; the mouth shape follows the character being spoken, gated by the measured loudness.
  Other voices keep the loudness + spectrum method. The voice itself is unchanged. This is letter timing, not phonemes.
- Personality settings (humour, energy, curiosity, formality) in Settings → tone lines in the prompt only.
- Creator diagnostics in Status (state → body/face/light, activity, lip-sync source, learning queue) — only when not
  hosted.

**Tests:** companion integration [A137]/[A139], voice unit test and server integration test [A138], e2e [A140].

**Limitations:** ElevenLabs timing verified against a mock of the documented API, not with a real key; spelling is only a
rough guide to mouth shapes; no phoneme recognition for other voices.

## Stage 9 — Integration
- HOLOBUILD ↔ robot: the docked robot, voice commands, spoken/announced results, thinking/happy/confused reactions
  tied to real outcomes. HOLOBUILD ↔ learning: failures and corrected edits become experiences; questions about a model
  go to the conversation with the model as context (and any relevant knowledge). Learning ↔ robot: research and
  reflection show as activities; knowledge reaches replies with its status. Chat → HOLOBUILD: "build a 3D model of …"
  in the conversation opens HOLOBUILD and builds it there.
- Privacy and About pages describe the new stored data and what is sent where.

## Stage 10 — Verification
See `docs/RELEASE_REPORT.md` (generated by `npm run report`) for the full run: typecheck, lint, build, unit +
integration, e2e in Chromium (incl. HOLOBUILD, learning, a11y audit of the new pages), desktop smoke.

## Space interface redesign (MISSION NEXUS)

**Inspected first:** robot page layout (`App.tsx` → `RobotView` → `Stage` → `RobotAuto`/`Robot3D`), landing hero
(`Landing.tsx` + `PreviewRobot`), boot overlay (`index.html` + `src/boot.ts`), theme tokens; the AI path (browser →
`/api/chat` → Gemini on the server) and voice path (`/api/tts` → ElevenLabs, timestamp lip-sync) are untouched.

**What changed**
- `src/space/spaceScene.ts` + `SpaceField.tsx` — one Canvas 2D environment (no extra WebGL context next to the robot):
  three star layers with slow twinkle, nebula, a banded gas giant whose bands scroll for rotation, its ring and a moon
  that passes behind it, a distant planet, orbital rings with satellites, wireframe octahedron / icosahedron / cube,
  asteroids on closed elliptical paths, drifting particles that fade before wrapping, an occasional shooting star, and
  eased pointer parallax by depth. Deterministic layout; 40 fps cap; pixel ratio ≤ 1.5; paused off-screen and in hidden
  tabs; a still frame under reduced motion; quality by device and stepped down automatically if drawing gets slow;
  light and dark palettes.
- Robot page (`/app`, robot layout): robot, captions and voice dock in the left 60 %, the environment on the right, a
  stage light behind the robot, and a mission HUD with real status (state, AI link, voice, activity). Tablet: full-width
  robot over a dimmer environment; phone: simplified environment, HUD hidden, no horizontal scroll. High-contrast mode
  keeps the plain layout.
- Landing hero: the same environment, composed around the robot (planet in the far corner, rings low behind the copy).
- Boot overlay: star field and an orbiting dot around the mark; timings unchanged (never held artificially).
- Micro-interactions: glow on hover for the dock and header buttons, glass voice dock, animated status rings only while
  NEXUS is really listening / thinking / speaking, panel and drawer entrances; all off under reduced motion.
- The NEXUS model, materials, faces, animations and lip-sync are unchanged.

**Tests:** `src/tests/unit/space.test.ts` (determinism, counts by quality/screen, continuous motion over one simulated
minute, eased parallax, occasional shooting stars, device quality); e2e space block (decorative layer never covers a
control, HUD shows real state, animates / still under reduced motion / resumes, phone layout).

## "Beyond the Interface" pass

**Audit (unchanged):** Vite + React 19 + TypeScript front end; Express server (`/api/chat` → Gemini, `/api/tts` →
ElevenLabs with timestamps, `/api/transcribe`, `/api/holo/*`, `/api/learn/*`); robot = rigged GLB in three.js
(`Robot3D`) with the motion engine; env vars and `render.yaml` untouched.

**What changed**
- The space environment is now a real 3D scene drawn on Canvas 2D: perspective camera, depth-sorted drawing, a planet
  with its own ring, three inclined orbital rings carrying moons and a probe in different directions, an asteroid belt
  that passes in front of and behind the planet, a slowly turning ring station, wireframe structures, distant planets,
  three star layers, near-field dust and soft light rays from the system's star.
- Interaction: the pointer turns the camera slightly (parallax by depth), pushes nearby dust aside (spring back), and
  lights up an orbital ring or structure it passes over; the canvas itself never takes input.
- The environment follows the robot's real state: thinking speeds the orbits up, speaking makes the atmosphere pulse,
  listening brightens the light, an error dims it — all eased.
- About, Privacy and 404 pages share the environment in their margins (the reading column stays clear); the robot
  page's side drawer is a glass panel.
- Performance: the asset manifest (~28 KB) is now a JSON file loaded only when Status → Asset registry opens, so the JS
  every visitor downloads went down (≈ 882 KB, under the 900 KB budget, threshold unchanged).

## Next-level experience upgrade (A142)

- **Truthful system panel** (replaces the mission HUD): NEXUS server, AI model (Gemini when configured), voice
  (ElevenLabs when configured), and interaction, each ONLINE / STANDBY / CONNECTING / PROCESSING / SPEAKING / OFFLINE /
  ERROR from real state. A configured service shows STANDBY until it has actually answered; the demo brain is reported
  as OFFLINE and the header says DEMO, never ONLINE. A chain (Intelligence → Conversation → Voice → Expression →
  Movement) lights only the stages that are really active. No keys or secrets are ever shown.
- **Measured audio**: a level bus carries real loudness only — the microphone while listening (server transcription's
  recorder, or a meter opened just for the listening window with browser speech recognition) and the ElevenLabs voice
  while it plays. The old decorative wave is gone; with browser voices (no audio access) a plain state shows instead.
- **Sound design**: four short WebAudio-synthesized cues (startup, listen, listen end, toggle); off by default, toggle in
  the system panel, silent in quiet mode, only after a user gesture. No audio files, no music.
- **Storytelling**: Technology now names Gemini (words) and ElevenLabs (voice) with a Voice step in the pipeline and the
  intelligence → movement chain; HOLOBUILD and Learning tiles on the landing page; HOLOBUILD's viewport has its own
  holographic frame (grid glow, scan line, corner brackets; off with reduced motion).
- Not verified live: Gemini and ElevenLabs (no keys in this environment — covered by mocked tests only).

## Adaptive Colour Studio (A143)

- **/studio**: two slots (primary, accent) with swatch, name and HEX; a 48-colour library; custom HEX (#RGB/#RRGGBB, with
  a native picker); live preview of a small NEXUS (nav, hero, buttons, cards, chat, input, gradient) with the generated
  role colours and a WCAG readout; Apply (needs exactly two different colours) and Reset to NEXUS default. Reached from a
  palette button beside the light/dark switch on every page, the footer, and Settings → Animation & appearance.
- **Architecture**: every brand-family colour literal in the stylesheets and the boot screen (73 distinct colours) now
  goes through a channel variable `--k-<hex>` (`rgb(var(--k-…) / a)`); defaults in `src/theme/palette.css` reproduce
  the original look exactly. Status colours, pure neutrals and high-contrast mode are not routed.
- **Generation** (`src/theme/palette.ts`): each routed colour keeps its OKLCH lightness and takes the hue/chroma of
  colour 1 (blue family, tinted neutrals) or colour 2 (cyan/sky family), gamut-clipped; the primary button tier may only
  darken and is checked against its text; the bright accent tier follows colour 2's own brightness within readable
  bounds. All 2,256 ordered library pairs pass 15 text/background checks (AA 4.5:1) in unit tests.
- **Persistence**: `settings.palette` (validated in SettingsSchema, part of "Reset personalization"); a localStorage
  copy of the pair and the generated CSS (validated by a strict pattern) is injected by index.html before first paint.
- Smooth switch: a 0.5 s colour transition while a theme changes (none with reduced motion).
- Robot: NEXUS (3D model, 2D fallback and logo) follows the theme — eyes, mouth, LEDs, trim and antenna take the accent/primary like the site; shell, limbs, joints and boots keep their lightness with a visible primary tint; status lights (listening green, error red) never change.
- Limits: the canvas space scene is turned toward colour 1 with a CSS
  hue-rotate/saturate filter (an approximation, not a repaint); the 2D/3D robot logo mark is unchanged.

## Full-body 3D motion system (A144)

- **Same robot**: the GLB, proportions, materials, colours, panels and face are unchanged. The body system rotates the
  existing pivots (body, head, antenna, upper arms, forearms, hands, thighs, shins, feet) and moves the existing
  Body_Root; nothing is rescaled or reshaped.
- **29 clips** (`src/character3d/body/clips.ts`): clap (real palm contact, repeats while held), wave, nod, shake head,
  shrug, point, thumbs up, speaking gestures, look around; excited, celebrate (jump), confused, curious, disappointed,
  think, laugh, surprised; backflip (takeoff, full 360° rotation, landing, recovery), forward roll, side-to-side dance,
  dance routine, jump, squat, one-leg balance, turn around, sit down/stand up; plus listening/happy/surprised state loops.
- **Motion maths**: keyframes with monotone Hermite interpolation (hold keys ease in/out), two-bone analytic IK for arms
  (hand targets) and legs (planted feet stay on the floor), smooth reach limits, per-pose knee/elbow poles, shoulder
  protraction/shrug, a soft-knee baseline.
- **Checks** (`checks.ts`, unit tests + Motion Lab): every clip on every frame — nothing below the floor, planted feet
  do not slide, no part through the torso/helmet (superellipsoid shells), joint speed ≤ 26 rad/s, no velocity jumps
  (snaps) at 480 Hz.
- **Controller** (`controller.ts`): a state layer (IDLE, LISTENING, THINKING, SPEAKING, HAPPY, EXCITED, CONFUSED,
  CURIOUS, SURPRISED, CELEBRATING, DANCING — 0.5 s crossfades) and one action layer started/ended by the animation
  engine's own events, so its priorities and queue decide; airborne clips cannot be cut mid-air (a stop lands first).
  The face, lip-sync and expressions stay with their own systems.
- **Triggers**: chat commands ("do a backflip", "clap", "dance", "forward roll then jump"…), planner aliases, jokes →
  laugh, greetings → wave; the AI prompt asks for moves only when they fit.
- **Motion Lab** (`/motions`): a button per clip and state, transition sequences, hold/release/stop, a speaking-mouth
  toggle, live measurements from the rendered model and per-clip check results.
- Fix found while testing: the 3D/2D wrapper did not forward the body output to the 3D robot.
- Limits: rigid parts (no skin), mitten hands (point/thumbs up are whole-hand poses), the 2D robot shows simplified
  versions, stepping turns pivot on the planted foot; with software rendering (very low frame rates) a frame step is
  capped at 0.1 s, so moves play slower rather than skipping.

## Visual presenter + technology environment (A145, A141 replaced)

- **Visuals beside the robot** (`shared/visual.ts`): the model may add ONE optional `visual` to its HEAD line —
  `{"kind":"image","query"}` for real-world references, or `{"kind":"diagram","diagram":{…}}` with one of nine typed
  diagram specs (orbit, network, flow, cycle, compare, timeline, forces, hierarchy, bars). Invalid → null; the reply is
  kept. The prompt (`VISUAL_GUIDE`) tells it to use null for chit-chat, jokes, personal or sensitive topics and short answers.
- **Image retrieval** (`shared/imageSearch.ts`, `GET /api/visual/image`): Wikipedia search → the article's lead image with a
  free licence (`pilicense=free`) → Commons metadata for author, licence and file page. Free, no key, cached 6 h on the
  server, 8 s timeout; misses and outages return `{image:null}` (never a 5xx). Without a server (web demo) the browser asks
  Wikipedia directly. Only `https://upload.wikimedia.org` images are shown (CSP img-src + a URL check).
- **AI-generated diagrams** (`src/visual/DiagramView.tsx`): the model supplies data; the app draws SVG with theme tokens.
  Labels are text (React-escaped), never markup.
- **Panel** (`src/visual/VisualPanel.tsx`): right 40% of the robot page on wide screens, above the robot on narrow ones
  (the robot stage shrinks, nothing overlaps); fade/slide in, crossfade on change, fade out when the next reply has no
  visual; close button; honest source label ("described by the AI, drawn by NEXUS" / "scripted demo" / "Wikimedia Commons");
  credit line with links. Also docked at the top of the chat column in the workspace layout.
- **Presenter body language**: new clips `point_right` / `point_left` (viewer's sides; the panel is on the right, so the
  robot's left arm), `compare` (alternating palms), `explain` (presenter hands, loop) and a subtle head-only
  `state_thinking`; new body state EXPLAINING. Once per visual, while the reply is delivered, NEXUS points to the panel
  (a comparison gets `compare`), unless the model already chose a pointing gesture; never in quiet or reduced-motion mode.
- **Speech coordination**: the speaking/explaining gestures follow the voice — mouth openness (measured audio level or
  ElevenLabs timing) drives an envelope: arms relax in pauses, the head gives a small additive nod on stressed syllables
  (≤ 4°), and gestures tagged to the voice (`speechbeat`) are cancelled the moment the audio ends.
- **Technology environment** (`src/space/techScene.ts` replaces `spaceScene.ts`): navy gradient, faint grid, circuit
  traces with occasional data pulses, a slowly breathing neural network with signals, translucent glass panels with quiet
  decorative readouts, data motes; parallax and pointer-lit nodes; mood-aware; same performance rules as before.
- Fix found while testing: on phones the 3D canvas did not shrink with its stage; it now fits the stage exactly.

## Presence motion system (A147)

- **Where it sits**: `src/character3d/body/presence.ts` adds one layer to the 3D body (`controller.ts` → `frame.ts`):
  state clips → presence gesture arms → explicit action clips (slerp by weight) → presence additive life → stage root
  (walking position/heading) → foot-lock IK → arm/torso collision pass. Action clips (wave, backflip, dances) always win;
  the presence layer fades its arms/head under them. 2D keeps the existing system unchanged.
- **Idle**: asymmetric breathing with drifting rate (inhale in speech pauses), hip weight shifts with the feet planted,
  head/hand/shoulder/glance events chosen without immediate repeats, smooth-noise micro-motion; all amplitudes go
  through cascaded critically damped springs (C2-smooth, no velocity jumps on state changes).
- **Attention** (`src/character3d/attention.ts`): the IVES panel and HOLOBUILD model/selected part register their REAL
  page position; the 3D view turns it into a stage point (camera ray → plane in front of the robot). Eyes lead, then the
  head (±34°), then the torso (±24°), then the feet turn in steps past 58°. No source/off screen → NEXUS looks at the user.
- **Gestures from meaning** (`gestures.ts`): each spoken sentence (TTS `onSentence`, with its real audio duration) is
  planned into 0–4 forms (self, open palm, offer, frame, wide, small, question, negate, emphasis, count, present, beat),
  hands alternating, never the same form twice in a row; prep → stroke on the voice's accent onset → hold → retract.
  A visual is presented with an open hand aimed (IK) at its real position. With the presence layer attached the canned
  `explain`/`speak_beat`/`point_*` clips are dropped from spoken replies (the presence layer does those from real data).
- **Conversation**: listening nods on the user's pauses, thinking gaze aversion (up and aside), reactions (acknowledge,
  curious, surprise, discovery, correction, uncertain, interrupted); an interruption retracts the hands fast and keeps the
  eyes on the user for 1.8 s.
- **Walking** (`locomotion.ts`, `footlock.ts`): capture-style stepping (a foot steps when the stance error passes a
  threshold), alternating feet, heel-toe lift profile, pelvis bob/sway, arm swing, hips kept 1.5 cm short of full leg
  extension; two-bone IK keeps planted boots exactly still. The engine's "walk across" becomes a real walk over and back.
- **Slow frames**: the presence layer splits a frame of up to 0.25 s into ≤ 50 ms steps, so its time keeps real pace on
  slow machines and in power-saving mode.
- **Tests**: `src/tests/unit/presence.test.ts` (19, physics at 480 Hz: no snaps, no sliding, no penetration, feet above
  the floor), `scripts/e2e-presence.mjs` (14 checks in the real built app with WebGL, real server, mock speech audio).
