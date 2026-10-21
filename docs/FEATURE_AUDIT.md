# NEXUS — feature audit against the master implementation prompt

Status key: **Verified** = implemented and covered by passing automated tests (ids in brackets are the asset/test tags in
`docs/RELEASE_REPORT.md`) · **Implemented, not verifiable here** = code exists, but the check needs a credential, device or
operating system this build environment does not have · **Not implemented** = deliberately out of scope (reason given).

Baseline before this pass: typecheck, build, lint, 92 unit + 44 integration tests, 83 browser checks — all passing (v4.1).

| § | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 00 | Inspect, audit, preserve, test | Verified | This file; nothing removed; full suite re-run (`npm run report`) |
| 02 | Routes `/`, `/app`, `/about`, `/privacy`, `/settings`, 404; Back/Forward; direct load | Verified | [A102] unit route table + e2e: direct load, dead-link crawl, 404, CTA without reload |
| 02.3 | Shared header/footer/buttons/dialogs/toasts/status | Verified | `src/site/Site.tsx`, shared tokens; [A101] [A105] |
| 03 | Palette tokens, surfaces, spacing, radius, type, motion, reduced motion | Verified | `--nexus-*` + semantic tokens; [A105] contrast test; [A111] light theme; reduced-motion e2e |
| 04 | Landing: header + mobile menu, hero, real robot, CTAs, 6 features, demo controls, how-it-works, transparency, CTA, footer | Verified | [A101] [A102] e2e incl. 320–1440 px, Esc menu, preview motion, no console errors |
| 05 | Cute original 2D robot, articulated rig, scales without distortion | Verified | `src/character/Robot.tsx`; character unit tests [A01–A09]; laptop/mobile e2e |
| 05.9 | Chest core reflects **real** state (idle, listening, processing, responding, speaking, acting, success, error, offline) | Verified (new) | `Robot.tsx` `CORE_COLOR`, `Companion.indicatorFor`; integration test: "responding" while text streams, never "speaking" without audio, "success" only after a verified save |
| 06 | Rig hierarchy, pivots, single transform owner, neutral pose, clamped interpolation | Verified | `shared/channels.ts`, engine is the only writer; [A21–A30] |
| 07 | 14 required expressions + resting; validated transitions; event→expression mapping; model IDs validated | Verified | 15 presets; speaking face now used while audio plays; success face after verified saves; [A11–A20] |
| 08 | Central controller; wave/bounce/celebrate/clap/nod/shake/think/listen/point/greeting/idle; priorities; cancel; Stop/Reset | Verified | [A24–A40]; journey e2e Stop/Reset; user-requested moves queue behind short reactions, and a refused move is now reported (`playSkill` → `blocked`) instead of "played" |
| 08.9 | Performance | Verified | ~20 fps calm / full rate moving [A115]; frame work < 4 ms [A99] |
| 09 | Three-region workspace, composer, starters, history | Verified | [A85] [A86] [A90]; laptop sizes e2e |
| 10 | Rename: brand vs name vs ids, dialog, validation, persistence, cross-app update, LLM identity | Verified | [A103] unit + integration + e2e; **journey e2e proves the provider receives the new name** (mock reads the real system prompt) |
| 11 | Personalization: name + restore default, resting face, idle, speaking mouth, greeting, theme, robot size, reset w/ confirm; versioned settings | Verified | [A104] [A111]; `settingsVersion` + per-field fallback so one bad field never resets the rest |
| 12.1–12.2 | Provider adapters (OpenAI-compatible, Anthropic, local, demo), loopback-only config, connection test | Verified with mocks | [A41] [A50]; keys server-side only [A42] |
| 12.3 | Demo clearly labelled; **no silent substitution on failure** | Verified (fixed) | Before: an unreachable server was silently answered by the browser demo. Now it is an error with *Retry* and an explicit *Answer with the offline demo (not an AI)* button |
| 12.8 | Status shows **connected** only after a real success | Verified (fixed) | Chip: `model · not checked yet / connected / last request failed`; capability is "partial" until a request or test succeeds |
| 12.4–12.7 | Bounded context, streaming, cancellation, structured output validation, typed errors | Verified with mocks | [A43–A48] [A113] compact prompt for local models |
| 13 | Skill pipeline: propose → validate → sandbox preview → approve → version → rollback; data only, never code | Verified | [A60–A70]; journey e2e: refine wave via LLM proposal → preview → approve → reuse → survives reload |
| 14 | Memory categories, consent, edit/delete, bulk delete with in-app confirmation, import validation (additive), failure handling | Verified | [A51–A59]; "Delete all" now uses an in-app confirmation instead of a browser pop-up |
| 15 | Research with sources, untrusted content | Verified with mocks | [A72–A75] |
| 16 | Mic states, permissions, transcript review, TTS, speaking face | Implemented; logic verified with fakes | [A81–A84]; real microphone/voices **not verifiable here** (headless) |
| 17 | Settings groups; Status: app state, AI mode, model, **last AI check**, active animation, skill registry, memory | Verified (extended) | "Right now" table in Status |
| 18 | Secrets, input limits, sanitized Markdown, tool allowlist, Host/Origin guard, external content untrusted | Verified | [A42] [A91–A94] [A106] |
| 19 | Accessibility | Verified (automated) | axe-core: 0 serious/critical on all pages, both themes [A112]; screen-reader testing by a person still recommended |
| 20 | Responsive 320–1440 | Verified | [A90] [A101] |
| 22 | Typecheck, lint, unit, integration, build, e2e | Verified | `npm run report` |
| 23 | **30-step end-to-end journey** | Verified (new) | [A116] — real NEXUS server + mock OpenAI-compatible provider, including the provider going down (honest failure) and local features continuing |

## Blocked by unavailable credentials / devices in this environment

- A **real** hosted model (OpenAI, Anthropic …) and a real **Ollama** install: no keys, and model downloads are blocked here. The
  same code paths are exercised against mock servers that speak the real wire formats.
- Real microphone capture and audible speech output (headless browser).
- Running the Windows installer and `.bat` scripts on Windows.

## Not implemented (by design)

- Model training / fine-tuning — NEXUS stores approved skills, memories and preferences; the language model never changes.
- Accounts / cloud sync — the app is local-first and binds to 127.0.0.1.

## v4.4 — audit against "THE ULTIMATE MASTER IMPLEMENTATION PROMPT" (robot is the interface, voice first)

| § | Requirement | Status | Evidence / notes |
|---|---|---|---|
| 2 | Inspect before changing; preserve working features | Verified | Baseline 158 → all previous checks still pass; classic workspace kept as a Layout option |
| 3 | Robot is the dominant interface; no feed/sidebar by default; text is a compact alternative; robot fully visible | Verified (new) | `RobotView.tsx`; e2e [A119]: antenna-to-feet visible at 1280×800 and 390×844, no chat feed or side panel, axe clean |
| 4 | Full-body articulated original robot | Verified | unchanged rig (head, neck, face, brows, mouth, torso, shoulders, upper/fore-arms, hands, hips, thighs, shins, feet) + 3D shading |
| 5 | 18 semantic expressions, priorities, smooth transitions | Verified (extended) | added excited, interested, sympathetic, reassuring → 19 presets; unit [A119] |
| 6 | Motion set incl. speaking gestures, open-hand explanation, reassure, acknowledgement, return to idle | Verified (extended) | `explain`, `speak_beat`, `reassure` + earlier `agree/disagree/acknowledge/success/return_to_idle`; all validated [A26] [A119] |
| 7 | Central state machine incl. PAUSED, RECOVERING; interruption; stale results never win | Verified (extended) | `stateMachine.ts`; integration [A119] paused/resume/supersede, error→recovering→idle; e2e Stop mid-speech |
| 8–10 | Real LLM via backend, validated response metadata with safe defaults | Verified with mocks | unchanged provider layer; prompt v2026.10.21-2 adds expression guidance; unknown ids are dropped |
| 11 | Voice input: permission, listening state, end-of-speech, no duplicates, cancel, fallback | Verified (new path) | `ServerSpeechInput` (MediaRecorder + silence detection) + browser recognition; e2e with a fake microphone file: auto-stop, one transcription call, transcript offered for review |
| 12 | Spoken replies from a configurable provider; mute, cancel, no overlap, cleanup | Verified with a mock speech API | `ServerSpeechOutput` (ordered prefetch, generation counter, object-URL cleanup) + browser fallback per sentence |
| 13 | Lip-sync tied to the playing audio, priority order, honest about approximation | Verified (amplitude level) | e2e: mouth > 0.35 during tone, < 0.15 during the silent gap, closed after; phoneme timestamps not available from the API (documented) |
| 14 | Controlled memory | Verified (unchanged) | IndexedDB on this device; single-user local app — no multi-user claims |
| 15 | Constrained skill acquisition | Verified (unchanged) | declarative data only; validate → simulate → preview → approve → version/rollback |
| 18–19 | Modular backend, validation, limits, secrets server-side | Verified | `server/speech.ts`; integration [A119]: keys never in `/api/config`, chat key not sent to other hosts, typed errors, size limits |
| 20 | Failure paths | Verified | speech service down → browser voice + one notice; transcription errors → message, robot idle; error boundaries per area |

**Not verifiable here:** a real hosted or local speech service, real microphones/speakers, and the Windows build running on
Windows — the speech paths ran only against mock OpenAI-compatible servers and Chromium's fake microphone.
