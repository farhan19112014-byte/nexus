# NEXUS modes

One NEXUS, five operational modes: **Default** (the original companion), **Educational**, **Medical**, **Legal** and **IT**.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Mode registry | `shared/modes.ts` | The five modes: name, icon, description, outfit, permissions, scope notice, the one option each mode uses. Shared by browser and server. |
| Mode Manager (browser) | `src/core/companion.ts` (`mode`, `setMode`, `outfit`, `previewOutfit`) | Switches mode without a reload, keeps the conversation, tags every message with its mode, sends `mode`, `modeOptions` and `conversationId` with each request. |
| Validation (server) | `shared/schema.ts` (`ChatRequestSchema`) + `resolveMode` | Unknown modes, unsafe option text and malformed conversation ids are rejected (400). A disabled mode runs as Default. |
| Instructions | `server/modes/prompts.ts` | Only the active mode's block is added to the ONE shared system prompt (same Gemini integration, same streaming contract, voice and body). Default adds nothing. The platform safety rules stay last. |
| Permissions | `server/modes/permissions.ts` | Enforced on the model's output, not by the prompt: research, pictures (all / diagrams only), animation proposals, memory. Removed parts are listed in `meta.withheld`. |
| Safety | `shared/safety.ts` | Deterministic emergency / crisis detection in every mode; the server sets `meta.safety`, the browser shows the notice at once. Medical and Legal answers carry a fixed scope notice. |
| Context | `src/ai/context.ts` | History is kept across switches; answers given in another mode are sent as `[answered in X mode] …` so they are context, not instructions. |
| Selector | `src/modes/ModeSwitch.tsx` (top bar) + `ModeLauncher.tsx` (lazy panel) | Five cards (radio group), active indicator, the active mode's option (jurisdiction / language / level), keyboard and phone friendly. |
| Accents | `src/modes/accents.css` | A thin accent line under the top bar and on mode tags — the theme, layout and robot stay the original NEXUS. |
| Outfits | `src/character3d/outfits/*` | Procedural clothing on the existing 3D model's nodes (no textures, no model changes), one lazy chunk per outfit, ~400 ms cross-fade. Settings → Appearance: auto switch, fixed outfit, accessories, preview, restore original. |

## Tests
- Unit: `src/tests/unit/modes.test.ts`, `src/tests/integration/companion.test.ts` (`[A150]`).
- Browser: `npm run build && npm run test:e2e:modes` — real Gemini SDK against a mock endpoint, mock ElevenLabs, WebGL outfits.
