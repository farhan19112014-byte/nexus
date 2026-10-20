# Setup

Requirements: Node.js 20+ (tested on 22), npm. A Chromium-based browser for voice input.

```bash
npm install
npm run dev            # API on http://localhost:8787 + app on http://localhost:5173
```

Production-style single process: `npm start` → http://localhost:8787 (the server binds to 127.0.0.1 only and answers only to
`localhost`/`127.0.0.1` Host headers, which blocks DNS-rebinding from web pages; add names with `ALLOWED_HOSTS` if you proxy it).

Laptop users: see [LAPTOP.md](LAPTOP.md) for the double-click scripts, the desktop app and free offline AI via Ollama
(`npm run setup:ollama [model]`).

## Choosing a brain

| Option | Cost | How |
|---|---|---|
| Demo brain (default) | free | nothing to do — clearly labelled "not an LLM" |
| Local model via Ollama / LM Studio | free (your hardware) | `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=http://localhost:11434/v1`, `OPENAI_MODEL=<pulled model>` |
| Hosted OpenAI-compatible API | usually paid per token | `LLM_PROVIDER=openai`, base URL, key, model |
| Anthropic | usually paid per token | `LLM_PROVIDER=anthropic`, key, model |

Set these in `.env` (copy `.env.example`) **or** in the app: **Settings → Model**, then **Test connection**.
Keys typed in the app are sent once to your local server, stored in `data/runtime-config.json` (mode 0600, git-ignored) and never shown again.
Pricing and free tiers change — check your provider. Small local models sometimes break the output format; NEXUS then retries once and, if needed, shows the text without running any actions.

## Live research (optional)

`RESEARCH_PROVIDER=wikipedia` (free), `searxng` (+`SEARXNG_URL`, self-hosted, JSON output enabled) or `tavily` (+`TAVILY_API_KEY`). Then turn on **Research** under the message box. Without a provider NEXUS says research is unavailable.

## Voice

Microphone input uses the browser's Web Speech recognition (Chrome/Edge; Safari partially). Permission is requested only when you press **Speak**. Spoken replies use the OS voices via SpeechSynthesis (toggle "Spoken replies"). Both fall back to text.

## Commands

| | |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | unit + integration tests (Vitest) |
| `npm run test:e2e` | browser end-to-end tests (needs `npm run build`; set `CHROMIUM=/path/to/chrome` if Playwright's browser is not installed — `npx playwright install chromium`) |
| `npm run report` | runs everything and regenerates `docs/RELEASE_REPORT.md` + the asset status shown in Status → Asset registry |
| `/?sheet=1` | character sheet: every expression, pose and motion side by side |
