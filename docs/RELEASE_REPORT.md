# NEXUS — Release readiness & acceptance report

Generated 2026-11-05T06:07:36.873Z by `npm run report` from actual command results. Do not edit by hand.

## Summary

| | |
|---|---|
| Overall | **Some checks failed — see below** |
| typecheck | ✅ pass · 10.4s |
| build (app + server bundle) | ✅ pass · 15.0s |
| lint (eslint, 0 warnings) | ✅ pass · 6.7s |
| unit + integration tests | ✅ pass · 51.6s |
| end-to-end tests | ❌ fail (exit 1) · 609.2s |
| desktop app smoke test | ✅ pass · 17.2s |
| Unit tests | 234/234 passed |
| Integration tests | 75/75 passed |
| End-to-end checks | 163/165 passed |
| Assets | 141 verified · 0 implemented but not fully verified · 4 failing · 0 blocked · 0 not done |

**Status meanings.** *verified*: implemented and every test tagged with the asset id passed in this run. *implemented*: code exists but at least one required verification is missing in this run. *failing*: a tagged test failed. Verification uses headless Chromium and mocked external services; see each asset's limitation for what that does not prove.

## Failures

### end-to-end tests

```
✔ [A136] the Learning overview shows counted metrics (1 knowledge note, 1 research report) and states that the AI model is not retrained — 1knowledge notes1 pending1research reports1 sources · today 1/52experiences2 not reflected on yet0reflections0workflow skills0 approved · 0 runs1/1replies rated
✔ [A136] no page errors on the Learning page
✔ [A112] [A88] axe accessibility audit: no serious or critical issues on any page, dark and light
✔ [A98] no uncaught page errors during the run
✔ [UAT-S1] the Content-Security-Policy never blocked anything the app needs (no violations on any page in this run)
163/165 browser checks passed
```

Failing tests:
- [A127] performance measured: the 3D robot page keeps rendering in software WebGL (threshold: above 5 fps; no GPU in the test machine, so the number depends on machine load)
- [A99] bundle size is modest (< 900 KB of JS before gzip, excluding the on-demand 3D chunks)

## Asset registry

### Character identity & visual system

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A01 | NEXUS Master Character | ✅ verified | 2/0 | `src/character/Robot.tsx` |  |
| A02 | Official Color System | ✅ verified | 1/0 | `src/character/tokens.ts` |  |
| A03 | Character Proportion System | ✅ verified | 1/0 | `src/character/geometry.ts`, `shared/channels.ts` |  |
| A04 | Layered Facial Components | ✅ verified | 2/0 | `src/character/Robot.tsx` |  |
| A05 | Body Pose Library | ✅ verified | 1/0 | `src/character/poses.ts` |  |
| A06 | Rendering and Outline System | ✅ verified | 2/0 | `src/character/tokens.ts`, `src/character/Robot.tsx` |  |
| A07 | Accessory Components | ✅ verified | 2/0 | `src/character/Robot.tsx` |  |
| A08 | Visual Consistency Rules | ✅ verified | 1/0 | `src/character/consistency.ts`, `src/components/CharacterSheet.tsx` |  |
| A09 | Character Environment | ✅ verified | 2/0 | `src/character/Robot.tsx` |  |
| A10 | Asset Manifest | ✅ verified | 2/0 | `src/assets/registry.ts`, `scripts/report.mjs` |  |

### Facial expressions

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A11 | Happy Expression | ✅ verified | 1/0 | `src/expressions/presets.ts` |  |
| A12 | Curious Expression | ✅ verified | 1/0 | `src/expressions/presets.ts` |  |
| A13 | Surprised Expression | ✅ verified | 1/0 | `src/expressions/presets.ts`, `src/expressions/expressionController.ts` |  |
| A14 | Thinking Expression | ✅ verified | 3/0 | `src/expressions/presets.ts`, `src/core/companion.ts` |  |
| A15 | Confused Expression | ✅ verified | 1/0 | `src/expressions/presets.ts` |  |
| A16 | Sad or Concerned Expression | ✅ verified | 1/0 | `src/expressions/presets.ts` |  |
| A17 | Determined Expression | ✅ verified | 1/0 | `src/expressions/presets.ts` |  |
| A18 | Playful Expression | ✅ verified | 1/0 | `src/expressions/presets.ts`, `src/expressions/expressionController.ts` |  |
| A19 | Sleepy or Resting Expression | ✅ verified | 2/0 | `src/expressions/presets.ts`, `src/core/companion.ts` |  |
| A20 | Expression Preset Registry | ✅ verified | 2/0 | `src/expressions/expressionController.ts`, `src/skills/registry.ts` |  |

### Motion & body animation

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A21 | Idle Breathing | ✅ verified | 1/0 | `src/animation/engine.ts` |  |
| A22 | Natural Blinking | ✅ verified | 1/0 | `src/animation/engine.ts` |  |
| A23 | Gaze Controller | ✅ verified | 1/0 | `src/animation/engine.ts`, `src/components/Stage.tsx` |  |
| A24 | Head Tilt System | ✅ verified | 1/0 | `src/animation/builtinMotions.ts` |  |
| A25 | Arm Gesture Library | ✅ verified | 2/0 | `src/animation/builtinMotions.ts` |  |
| A26 | Body Bounce | ✅ verified | 2/0 | `src/animation/builtinMotions.ts` |  |
| A27 | Turn and Orientation System | ✅ verified | 1/0 | `shared/channels.ts`, `src/character/Robot.tsx` | Not a 3D turn: a front-facing 2D rig with parallax-style feature shift; no true side profile. |
| A28 | Animation Timeline Engine | ✅ verified | 2/0 | `src/animation/timeline.ts`, `src/animation/engine.ts` |  |
| A29 | Animation Blending | ✅ verified | 1/0 | `src/animation/engine.ts` |  |
| A30 | Animation Recovery | ✅ verified | 2/0 | `src/animation/engine.ts` |  |

### Interaction & reaction animations

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A31 | Greeting Animation | ✅ verified | 1/0 | `src/animation/builtinMotions.ts`, `src/core/companion.ts` |  |
| A32 | Listening Animation | ✅ verified | 1/0 | `src/core/companion.ts` |  |
| A33 | Speaking Animation | ✅ verified | 2/0 | `src/animation/engine.ts`, `src/voice/tts.ts` | Approximate: mouth shapes from word vowels at TTS boundary events, not phoneme-accurate lip-sync. |
| A34 | Response Completion Animation | ✅ verified | 1/0 | `src/animation/builtinMotions.ts`, `src/core/companion.ts` |  |
| A35 | Error Reaction | ✅ verified | 2/0 | `src/core/companion.ts` |  |
| A36 | Success Reaction | ✅ verified | 1/0 | `src/core/companion.ts` |  |
| A37 | Waiting Animation | ✅ verified | 1/0 | `src/core/companion.ts` |  |
| A38 | Notification Reaction | ✅ verified | 1/0 | `src/core/notifications.ts` |  |
| A39 | User-Requested Gesture Playback | ✅ verified | 2/0 | `src/core/companion.ts`, `src/components/SkillsPanel.tsx` |  |
| A40 | Animation State Machine | ✅ verified | 2/0 | `src/core/stateMachine.ts` |  |

### Real LLM conversation

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A41 | LLM Provider Interface | ✅ verified | 2/0 | `server/providers/types.ts`, `server/providers/openai.ts`, `server/providers/anthropic.ts` |  |
| A42 | Secure Backend Integration | ✅ verified | 3/0 | `server/app.ts`, `server/config.ts` |  |
| A43 | Streaming Responses | ✅ verified | 7/0 | `server/brainService.ts`, `shared/streamParser.ts`, `src/ai/apiClient.ts` | Verified against mock OpenAI/Anthropic streams; not against a live paid API in this build. |
| A44 | Conversation Context Manager | ✅ verified | 2/0 | `src/ai/context.ts`, `server/brainService.ts` |  |
| A45 | System Instruction Manager | ✅ verified | 1/0 | `server/prompts/system.ts` |  |
| A46 | Conversation Cancellation | ✅ verified | 4/0 | `src/core/companion.ts`, `src/ai/apiClient.ts`, `server/app.ts` |  |
| A47 | Error and Retry Manager | ✅ verified | 5/0 | `server/providers/types.ts`, `server/brainService.ts`, `src/core/companion.ts` |  |
| A48 | Structured Response Parser | ✅ verified | 1/0 | `server/brainService.ts`, `shared/schema.ts` |  |
| A49 | Capability Disclosure | ✅ verified | 6/0 | `src/ai/capabilities.ts`, `src/components/StatusPanel.tsx` |  |
| A50 | Model Configuration Panel | ✅ verified | 3/0 | `src/components/SettingsPanel.tsx`, `server/config.ts` |  |

### Memory & personalization

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A51 | Session Memory | ✅ verified | 1/0 | `src/ai/context.ts`, `src/core/companion.ts` |  |
| A52 | Persistent Memory Store | ✅ verified | 1/0 | `src/memory/store.ts`, `src/storage/db.ts` |  |
| A53 | Memory Extraction | ✅ verified | 3/0 | `src/memory/store.ts`, `src/core/companion.ts` |  |
| A54 | Memory Retrieval | ✅ verified | 1/0 | `src/memory/retrieval.ts` |  |
| A55 | Memory Inspection Interface | ✅ verified | 2/0 | `src/components/MemoryPanel.tsx` |  |
| A56 | Memory Editing and Deletion | ✅ verified | 2/0 | `src/memory/store.ts`, `src/components/MemoryPanel.tsx` |  |
| A57 | User Preference Profile | ✅ verified | 2/0 | `src/memory/store.ts`, `src/components/SettingsPanel.tsx` |  |
| A58 | Context and Memory Boundaries | ✅ verified | 2/0 | `docs/PRIVACY.md`, `src/components/MemoryPanel.tsx` |  |
| A59 | Memory Conflict Resolution | ✅ verified | 1/0 | `src/memory/store.ts` |  |
| A60 | Memory Import and Export | ✅ verified | 1/0 | `src/memory/store.ts` |  |

### Constrained motion & expression learning

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A61 | Skill Registry | ✅ verified | 3/0 | `src/skills/registry.ts` |  |
| A62 | Declarative Motion Format | ✅ verified | 1/0 | `shared/schema.ts`, `shared/channels.ts` |  |
| A63 | New Motion Proposal Generator | ✅ verified | 2/0 | `src/skills/generator.ts`, `server/prompts/system.ts` |  |
| A64 | New Expression Proposal Generator | ✅ verified | 1/0 | `src/skills/generator.ts`, `src/skills/validator.ts` |  |
| A65 | Skill Schema Validator | ✅ verified | 1/0 | `src/skills/validator.ts` |  |
| A66 | Animation Sandbox | ✅ verified | 1/0 | `src/skills/sandbox.ts`, `src/skills/validator.ts` | Isolation is by construction (candidates are data interpreted by our engine) and by a separate engine instance; it is not a separate OS process or Web Worker. |
| A67 | Skill Preview Interface | ✅ verified | 2/0 | `src/components/SkillsPanel.tsx` |  |
| A68 | User Approval Workflow | ✅ verified | 2/0 | `src/skills/learning.ts`, `src/skills/registry.ts` |  |
| A69 | Skill Versioning and Rollback | ✅ verified | 1/0 | `src/skills/registry.ts` |  |
| A70 | Feedback-Based Refinement | ✅ verified | 2/0 | `src/skills/learning.ts` |  |

### Knowledge & research

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A71 | General Knowledge Interface | ✅ verified | 2/0 | `server/prompts/system.ts`, `server/brainService.ts` | Answer quality depends entirely on the configured model; no live model was available in this build. |
| A72 | External Research Adapter | ✅ verified | 2/0 | `server/research/index.ts` | Tested with mocked HTTP; live provider behaviour depends on network access. |
| A73 | Source and Evidence Display | ✅ verified | 2/0 | `src/components/ChatPanel.tsx`, `shared/schema.ts` |  |
| A74 | Knowledge Freshness Labels | ✅ verified | 3/0 | `src/components/ChatPanel.tsx` |  |
| A75 | Research Summarization | ✅ verified | 1/0 | `server/prompts/system.ts` |  |
| A76 | Follow-Up Context | ✅ verified | 1/0 | `src/ai/context.ts` |  |
| A77 | Uncertainty Handling | ✅ verified | 2/0 | `server/prompts/system.ts`, `shared/schema.ts`, `src/components/ChatPanel.tsx` |  |
| A78 | Tool Permission Registry | ✅ verified | 1/0 | `src/security/toolPermissions.ts` |  |
| A79 | Tool Result Verification | ✅ verified | 1/0 | `src/skills/registry.ts`, `src/memory/store.ts`, `src/core/companion.ts` |  |
| A80 | Learning and Training Disclosure | ✅ verified | 2/0 | `src/components/ChatPanel.tsx`, `src/components/StatusPanel.tsx` |  |

### Voice, interface & accessibility

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A81 | Microphone Permission Controller | ✅ verified | 1/0 | `src/voice/mic.ts` | Real permission prompts cannot be exercised in headless CI. |
| A82 | Speech Recognition | ✅ verified | 2/0 | `src/voice/recognition.ts` | Logic tested with a fake recognizer; real recognition depends on the browser (Chrome/Edge/Safari). |
| A83 | Text-to-Speech | ✅ verified | 2/0 | `src/voice/tts.ts` | Logic tested with a fake speechSynthesis; real voices depend on the OS/browser. |
| A84 | Voice Interruption | ✅ verified | 2/0 | `src/core/companion.ts`, `src/voice/recognition.ts` |  |
| A85 | Main Companion Workspace | ✅ verified | 1/0 | `src/components/App.tsx`, `src/components/Stage.tsx` |  |
| A86 | Conversation History Interface | ✅ verified | 1/0 | `src/components/ChatPanel.tsx` |  |
| A87 | Settings and Preferences | ✅ verified | 3/0 | `src/components/SettingsPanel.tsx` |  |
| A88 | Accessibility Controls | ✅ verified | 9/0 | `src/components/App.tsx`, `src/components/styles.css` |  |
| A89 | Notifications and Quiet Mode | ✅ verified | 2/0 | `src/core/notifications.ts` |  |
| A90 | Responsive Layout | ✅ verified | 6/0 | `src/components/styles.css` |  |

### Security, reliability & testing

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A91 | Authentication and Session Boundaries | ✅ verified | 2/0 | `server/index.ts`, `server/app.ts` | No accounts (local single-user prototype by design); do not expose the server publicly without adding authentication. |
| A92 | Data Protection | ✅ verified | 1/0 | `docs/PRIVACY.md`, `server/app.ts` |  |
| A93 | Input and Output Validation | ✅ verified | 1/0 | `shared/schema.ts`, `src/security/validation.ts` |  |
| A94 | Abuse and Resource Limits | ✅ verified | 2/0 | `shared/schema.ts`, `server/app.ts`, `src/animation/engine.ts` |  |
| A95 | Observability and Diagnostics | ✅ verified | 1/0 | `src/diagnostics/log.ts`, `src/components/StatusPanel.tsx` |  |
| A96 | Automated Unit Tests | ✅ verified | 234/0 | `src/tests/unit` |  |
| A97 | Integration Tests | ✅ verified | 75/0 | `src/tests/integration` |  |
| A98 | End-to-End Tests | ❌ failing | 163/2 | `scripts/e2e.mjs` |  |
| A99 | Performance and Compatibility | ❌ failing | 5/1 | `scripts/e2e.mjs`, `src/core/characterRuntime.ts` |  |
| A100 | Release Readiness and Acceptance Report | ❌ failing | 5/1 | `scripts/report.mjs`, `docs/RELEASE_REPORT.md` |  |

### Website, identity & personalization

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A101 | Landing Homepage | ✅ verified | 6/0 | `src/site/Landing.tsx`, `src/site/PreviewRobot.tsx`, `src/site/site.css` |  |
| A102 | Routing and Site Navigation | ✅ verified | 7/0 | `src/router.tsx`, `src/main.tsx`, `src/site/Site.tsx`, `src/site/Pages.tsx` |  |
| A103 | Robot Identity and Rename | ✅ verified | 21/0 | `shared/identity.ts`, `src/components/RenameDialog.tsx`, `src/core/companion.ts`, `server/prompts/system.ts` |  |
| A104 | Personalization Settings | ✅ verified | 5/0 | `src/components/SettingsPanel.tsx`, `src/memory/store.ts` |  |
| A105 | Blue / Dark-Blue / White / Black / Grey Design Tokens | ✅ verified | 1/0 | `src/character/tokens.ts`, `src/components/styles.css`, `src/site/site.css` |  |
| A106 | Safe Markdown Replies | ✅ verified | 8/0 | `src/components/Markdown.tsx` |  |
| A107 | Saved Chats and Search | ✅ verified | 6/0 | `src/core/chats.ts`, `src/components/CompanionPanels.tsx` |  |
| A108 | Regenerate, Edit and Copy | ✅ verified | 4/0 | `src/components/ChatPanel.tsx`, `src/core/companion.ts` |  |
| A109 | Reminders and Timers (on device) | ✅ verified | 12/0 | `src/core/reminders.ts`, `src/components/CompanionPanels.tsx` |  |
| A110 | Liveliness: Typing Attention, Ambient Behaviours, Daily Greeting | ✅ verified | 4/0 | `src/core/companion.ts`, `src/animation/builtinMotions.ts` |  |
| A111 | Light Theme | ✅ verified | 2/0 | `src/theme.ts`, `src/components/styles.css` |  |
| A112 | Lint and Automated Accessibility Audit | ✅ verified | 2/0 | `eslint.config.js`, `scripts/e2e.mjs` |  |
| A114 | First-run Setup Wizard | ✅ verified | 2/0 | `src/components/SetupWizard.tsx` |  |
| A115 | Battery-friendly Rendering and Installable Web App | ✅ verified | 3/0 | `src/core/characterRuntime.ts`, `public/manifest.webmanifest` |  |
| A116 | End-to-end User Journey (spec §23) | ✅ verified | 1/0 | `scripts/e2e.mjs` |  |
| A117 | One Desktop App (NEXUS.exe) + in-app model download | ✅ verified | 2/0 | `desktop/main.cjs`, `src/components/OllamaDownload.tsx` |  |
| A118 | Master-prompt Pass: Containment, Icons, Motions, Read-aloud | ✅ verified | 8/0 | `src/components/ErrorBoundary.tsx`, `src/components/Icon.tsx`, `src/animation/builtinMotions.ts` |  |
| A119 | Robot-first Voice Experience: server TTS/STT, audio lip-sync, PAUSED/RECOVERING | ✅ verified | 30/0 | `src/components/RobotView.tsx`, `src/voice/serverVoice.ts`, `src/voice/router.ts`, `server/speech.ts` |  |
| A120 | Google Gemini brain (official @google/genai SDK) + youthful browser-voice preset | ✅ verified | 3/0 | `server/providers/gemini.ts`, `server/config.ts`, `src/voice/tts.ts`, `src/components/SettingsPanel.tsx` |  |
| A121 | ElevenLabs voice: /api/speech, account voice picker, no silent voice substitution | ✅ verified | 3/0 | `server/speech.ts`, `server/app.ts`, `src/voice/router.ts`, `src/components/SettingsPanel.tsx` |  |
| A122 | Master-prompt pass: editable persona file, speech-safe text, typed robot events, speech volume, secret-safe memory | ✅ verified | 8/0 | `server/prompts/persona.ts`, `src/voice/speakable.ts`, `src/core/robotEvents.ts`, `src/security/validation.ts` |  |
| A123 | Light mode: white and light-blue NEXUS robot, sky-blue site, one-click theme switch | ✅ verified | 6/0 | `src/character/tokens.ts`, `src/character/Robot.tsx`, `src/components/ThemeToggle.tsx`, `src/site/site.css` |  |
| A124 | Hosted NEXUS: public mode, Render blueprint, CORS for the Pages site, daily quota budgets, wake-up notice | ✅ verified | 24/0 | `server/budget.ts`, `server/app.ts`, `render.yaml`, `src/webDemo.ts` |  |
| A125 | 3D NEXUS: rigged GLB model, three.js renderer driven by the same animation channels, 2D/3D switch | ✅ verified | 7/0 | `tools/nexus3d/build-model.mjs`, `public/models/nexus.glb`, `src/character3d/Robot3D.tsx`, `src/character3d/rig3d.ts` |  |
| A126 | Website redesign: the real 3D NEXUS in the landing hero, state demo (idle…error), startup transition, About and Privacy | ✅ verified | 24/0 | `src/site/Landing.tsx`, `src/site/PreviewRobot.tsx`, `src/character3d/webgl.ts`, `src/boot.ts`, `src/site/Pages.tsx` |  |
| A127 | 3D Motion Engine: state body language, bounded procedural primitives, springs + follow-through, priorities, interruption; 3D everywhere WebGL exists | ❌ failing | 15/1 | `src/character3d/motion3d.ts`, `src/character3d/Robot3D.tsx`, `src/core/characterRuntime.ts`, `src/site/site.css` |  |
| A128 | MISSION NEXUS website: cinematic boot, landing (hero, robot viewer with view angles, capabilities with honest status, architecture, roadmap), route transitions, robot-page theme, 3D loading progress + retry | ✅ verified | 1/0 | `src/site/Landing.tsx`, `src/site/site.css`, `src/site/reveal.ts`, `src/boot.ts`, `src/character3d/Robot3D.tsx`, `src/components/app-theme.css` |  |
| A113 | Compact Prompt for Small Local Models | ✅ verified | 3/0 | `server/prompts/system.ts`, `server/brainService.ts` |  |
| A141 | Technology environment (replaced the planetary scene): dark navy grid, circuit traces with travelling data pulses, a breathing neural network with signals, translucent glass panels with quiet live readouts, data motes, parallax; stage light, micro-interactions, boot sequence | ✅ verified | 9/0 | `src/space/techScene.ts`, `src/space/SpaceField.tsx`, `src/space/space.css`, `index.html` | Canvas 2D illustration; the panels show decorative readouts (not real metrics — the real status is the System panel); the NEXUS robot model is unchanged. |
| A142 | Live experience: truthful system status (server, AI, voice, interaction) with the NEXUS chain, audio-reactive voice scope from measured mic/voice levels, optional synthesized interface sounds, landing storytelling (voice step, HOLOBUILD + learning tiles), holographic HOLOBUILD frame | ✅ verified | 9/0 | `src/space/systemStatus.ts`, `src/space/SystemPanel.tsx`, `src/space/VoiceScope.tsx`, `src/voice/levels.ts`, `src/core/uiSounds.ts`, `src/site/Landing.tsx` | Browser voices expose no audio, so they get no waveform; with browser speech recognition the waveform comes from a separate microphone meter. |
| A143 | Adaptive Colour Studio: two colours (48-colour library or custom HEX) generate a full site theme and recolour the robot — every brand colour re-mapped with lightness kept for contrast, live preview, smooth switch, saved with settings, one-click reset | ✅ verified | 18/0 | `src/theme/palette.ts`, `src/theme/colour.ts`, `src/theme/studio.ts`, `src/site/ColourStudio.tsx`, `src/theme/palette.css` |  |
| A144 | Full-body 3D motion system: 29 clips (clap with palm contact, wave, nod, shake, shrug, point, thumbs up, speaking gestures, look around, excited, celebrate jump, confused, curious, disappointed, think, laugh, surprised, backflip, forward roll, two dances, jump, squat, one-leg balance, turn around, sit/stand), two-bone IK, a state + action controller (IDLE…DANCING) driven by the engine, AI/command triggers, Motion Lab preview | ✅ verified | 20/0 | `src/character3d/body/clips.ts`, `src/character3d/body/clip.ts`, `src/character3d/body/ik.ts`, `src/character3d/body/controller.ts`, `src/character3d/body/checks.ts`, `src/site/MotionLab.tsx` | Rigid parts on joints (no skin deformation); mitten hands, so pointing and thumbs up are whole-hand poses; the 2D robot shows simplified versions; stepping turns pivot on the planted foot. |
| A145 | Visual presenter: NEXUS shows a credited Wikimedia Commons photo or an AI-generated diagram (9 types: orbit, network, flow, cycle, compare, timeline, forces, hierarchy, bars) beside the robot while it explains, points to it, uses presenter gestures (explain, point left/right, compare) and speech-coordinated hands and head | ✅ verified | 22/0 | `shared/visual.ts`, `shared/imageSearch.ts`, `src/visual/VisualPanel.tsx`, `src/visual/DiagramView.tsx`, `server/app.ts`, `src/core/companion.ts`, `src/character3d/body/clips.ts` | Images are the lead picture of the best-matching Wikipedia article, so they can be generic; diagrams are schematic (not to scale); no paid image-generation model is used; gestures follow the voice loudness, not the meaning of individual words. |
| A147 | Presence motion system (3D): non-repeating idle life and breathing, attention to the user / IVES panel / HOLOBUILD part at their real screen positions (eyes → head → torso → feet), sentence-planned conversational gestures timed to the voice, listening nods, thinking gaze, reactions, interruption retract, real stepping walk with foot-lock IK | ✅ verified | 19 unit + 14 browser | `src/character3d/body/presence.ts`, `gestures.ts`, `locomotion.ts`, `footlock.ts`, `frame.ts`, `noise.ts`, `src/character3d/attention.ts`, `src/core/characterRuntime.ts`, `src/core/companion.ts` | Rig has ball hands (thumb only, no fingers), one torso joint (no spine/neck/clavicle), a screen face; gestures follow word meaning and loudness, not phonemes; walking stays within ~0.8 m of the stage centre. |

### HOLOBUILD 3D workspace

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A129 | HOLOBUILD model format + procedural templates (engine, clock, bridge, arm, motorcycle, heart, house, furniture, molecules, solar system, rocket, shapes) | ✅ verified | 5/0 | `shared/holo.ts`, `src/holobuild/templates.ts` | Procedural learning models built from basic shapes — simplified, not engineering or anatomical drawings. No paid text-to-mesh service is connected. |
| A130 | HOLOBUILD natural-language editing: scale, stretch, move, rotate, material, colour, transparency, hide/isolate/remove, duplicate, x-ray, rename | ✅ verified | 5/0 | `shared/holoEdit.ts`, `shared/holo.ts`, `server/aiTasks.ts` | The offline parser understands common English phrasings; anything else needs a connected AI model. |
| A131 | HOLOBUILD workspace: 3D viewport (orbit, zoom, pan, perspective/orthographic, wireframe, grid, axes, labels, dimensions, selection, exploded view), command bar, voice, docked robot | ✅ verified | 8/0 | `src/holobuild/HoloBuild.tsx`, `src/holobuild/HoloViewport.tsx`, `src/holobuild/scene.ts`, `src/holobuild/controller.ts`, `src/holobuild/holobuild.css` |  |
| A132 | HOLOBUILD library + files: save (read back), rename, delete with confirmation, collections, reopen; GLB/GLTF export (re-validated) and safe import | ✅ verified | 6/0 | `src/holobuild/store.ts`, `src/holobuild/io.ts`, `src/storage/db.ts` |  |

### Learning engine

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A133 | Learning engine data: experiences (corrections, feedback, failures, repeated questions, knowledge gaps) with metadata, privacy limits and retention | ✅ verified | 3/0 | `src/learning/engine.ts`, `shared/learning.ts`, `src/components/ChatPanel.tsx` |  |
| A134 | Research + verification: multi-source research, claim extraction, credibility and contradictions, verification states, cited knowledge base with retrieval | ✅ verified | 5/0 | `server/learn.ts`, `src/learning/engine.ts`, `shared/learning.ts` |  |
| A135 | Workflow skills + controlled self-improvement: versions, deterministic tests, approval, rollback, audit log | ✅ verified | 2/0 | `src/learning/engine.ts`, `shared/learning.ts`, `server/learn.ts` |  |
| A136 | Learning dashboard + background learning: inspect, correct, delete, approve/reject, pause/resume, limits, permissions; real metrics only | ✅ verified | 3/0 | `src/learning/LearningPage.tsx`, `src/learning/engine.ts` |  |

### Robot interaction

| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |
|---|---|---|---|---|---|
| A137 | Unified interaction states + activity indicators (building, researching), explaining / waiting / serious body language | ✅ verified | 1/0 | `src/core/companion.ts`, `src/character3d/motion3d.ts`, `src/expressions/presets.ts`, `src/components/App.tsx` |  |
| A138 | Timestamp lip-sync: ElevenLabs character timing → mouth shapes, audio-level fallback for other voices | ✅ verified | 2/0 | `server/speech.ts`, `server/app.ts`, `src/voice/serverVoice.ts` |  |
| A139 | Personality settings (humour, energy, curiosity, formality) — tone only, never safety or voice | ✅ verified | 1/0 | `shared/schema.ts`, `server/prompts/system.ts`, `src/memory/store.ts`, `src/components/SettingsPanel.tsx` |  |
| A140 | Creator diagnostics: interaction state, activity, lip-sync source, learning queue — local NEXUS only | ✅ verified | 1/0 | `src/components/StatusPanel.tsx` |  |

## Laptop & desktop app

- Laptop layouts (1024–1536 px wide, 640–800 px tall, including browser-bar heights such as 1366×657) are checked by the end-to-end suite (asset A90 rows above).
- Desktop app smoke test (linux-x64): ✅ — `{"ok":true,"title":"NEXUS — robot workspace","nodeAccess":false,"ms":347,"url":"http://localhost:18787","provider":"demo","reused":false,"pages":["Robot","Home page","About","Privacy","Set up again (name, AI brain, theme)…"],"home":true,"back":true}`
- Not verifiable here: the Windows installer (`npm run dist:win`) and the `.bat` start scripts were not run on Windows by this report. Voice input is unavailable inside the desktop app (Electron ships no speech-to-text service); the app says so and voice works in Chrome/Edge.

## Configuration requirements

- None for the demo: `npm install && npm run dev`.
- Real conversation: `LLM_PROVIDER=openai|anthropic` plus the provider's base URL/model/key in `.env` or Settings → Model (see docs/SETUP.md).
- Live research: `RESEARCH_PROVIDER=wikipedia|searxng|tavily` (+ `SEARXNG_URL` / `TAVILY_API_KEY`).
- Voice: a browser with Web Speech support (Chrome/Edge for recognition); speech synthesis voices come from the OS.

## Blocked or unverifiable in this environment

- No live LLM, search or speech service was reachable from the test environment: provider, research and voice code paths are verified with mocks/fakes only.
- Real microphone permission prompts and real TTS audio cannot be exercised headlessly.
- No model training is implemented (by design).

## Remaining work

- Streaming of structured metadata incrementally (currently the head and the trailing META block).
- Phoneme-level lip-sync (needs a TTS engine that reports phoneme timings).
- True side-profile artwork for orientation (current turns are a 2D feature shift).
- Running the validator in a Web Worker for stronger isolation of preview computation.
- Accounts/authentication if the server is ever exposed beyond localhost.
- Reminders only alert while NEXUS is open (browser tab or desktop app); there is no background service. Missed ones show on next start.
- The accessibility audit is automated (axe-core); it does not replace testing with a real screen reader.
- Markdown support is deliberately small (no tables or images); anything else shows as plain text.
