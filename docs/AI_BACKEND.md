# NEXUS AI backend — Gemini brain + ElevenLabs voice (Windows setup)

NEXUS's look and animation are unchanged. The browser talks only to the NEXUS server (`server/`, Node.js + Express);
the server calls Google Gemini (official `@google/genai` SDK) and ElevenLabs with keys from `.env`. No key is ever sent
to the browser, put in the frontend bundle, or written to logs.

```
browser (React app, robot)  ──►  NEXUS server :8787  ──►  Gemini API        (chat)
   chat box / mic                  /api/chat               ElevenLabs API    (voice)
   speaker, mouth animation  ◄──   /api/speech
```

## 1. Install (once)

1. Install **Node.js 20 LTS or newer** from <https://nodejs.org> (tick "Add to PATH").
2. Open **Command Prompt** in the project folder (in File Explorer type `cmd` in the address bar and press Enter).
3. Run:
   ```bat
   npm install
   copy .env.example .env
   notepad .env
   ```

## 2. Get the keys

| Setting | Where | Notes |
|---|---|---|
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> → **Create API key** | Free tier available with per-minute / per-day limits; free-tier prompts may be used by Google to improve products. |
| `GEMINI_MODEL` | already `gemini-3.8-flash` | Any current Gemini text model id works; see <https://ai.google.dev/gemini-api/docs/models>. |
| `ELEVENLABS_API_KEY` | <https://elevenlabs.io> → profile → **API keys** → Create | Plans have monthly character limits; some Voice Library voices need a paid plan for API use. |
| `ELEVENLABS_VOICE_ID` | ElevenLabs → **Voices → My Voices** → a voice → **⋯ → Copy voice ID** | Or leave it empty, start NEXUS and pick a voice in **Settings → Voice → Speech services → Load my voices**. |
| `PORT` | `8787` | Change only if another program uses it. |

**Picking the NEXUS voice:** in the ElevenLabs *Voice Library* search for terms like *young, warm, bright, friendly,
conversational* and preview a few; avoid deep narrator voices and exaggerated cartoon voices. Add your favourite to
*My Voices*, then copy its ID (or choose it in Settings). How the voice is delivered (stability, style, speed) is set in one
place: `ELEVEN_VOICE_SETTINGS` in `server/speech.ts`.

Save `.env` with your values. It is listed in `.gitignore` — never commit it or paste keys into source files.

## 3. Run

```bat
npm start
```
Open <http://localhost:8787>. The console prints notes for anything missing (for example *"ELEVENLABS_VOICE_ID is
missing"*) — never the keys themselves.

For development with live reload: `npm run dev` (app on <http://localhost:5173>, API on 8787 via the Vite proxy).

Check it: <http://localhost:8787/api/health> → `{"ok":true}`; <http://localhost:8787/api/status> shows the provider, model
and whether the voice is configured (no secrets). The top bar says *connected* only after a successful request or
**Settings → Model → Test connection**.

## 4. API

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/chat` | `{ "message": "hi", "history": [{ "role": "user"\|"assistant", "content": "…" }], "stream": false }` (the app itself sends `{ messages, … , stream: true }` and gets Server-Sent Events) | `{ response: { reply, expression, gesture, … }, meta: { provider, model, isLLM, latencyMs, … } }` |
| `POST /api/speech` | `{ "text": "Hello!" }` (1–1200 characters; the app splits long replies by sentence) | `audio/mpeg` from the configured ElevenLabs voice |
| `GET /api/speech/voices` | — (this computer only) | the voices on your ElevenLabs account |
| `GET /api/health`, `GET /api/status` | — | liveness; capabilities without secrets |

Errors come back as `{ error, code, retryable }` with a status code: `400 invalid_request`, `429 rate_limited`,
`503 unconfigured / not_configured`, `502 provider / network / voice_not_found / auth`, `402 quota`, `504 timeout`.
Limits: request body 128 KB, at most 40 messages of ≤ 6000 characters each (the app limits typing to 4000), history trimmed to the last 16 messages / 12 000 characters,
30 chat requests per minute per client, Gemini timeout 45 s.

Protection: the server listens on `127.0.0.1` only; it refuses requests whose Host is not `localhost` (DNS-rebinding
protection) and cross-origin POSTs (no CORS headers are sent, so other websites cannot call it); settings changes are
accepted only from this computer; rate limits on chat and speech; logs contain method, path, status and duration only.

## 5. What needs the internet

| Feature | Internet |
|---|---|
| Robot, animation, settings, memory, demo brain | no |
| Gemini replies | yes (Google) |
| ElevenLabs voice | yes (ElevenLabs) |
| Built-in computer voice (no ElevenLabs) | no (some browser "online" voices do use the vendor's servers) |
| Microphone in Chrome/Edge | Chrome/Edge speech recognition sends audio to Google/Microsoft |

## 6. Microphone

Press the microphone, talk, press again or pause — the words go into the box for you to check (Enter sends; turn the
review off in Settings → Voice). Browser speech recognition works in **Chrome and Edge**; **Firefox** and the **desktop
app** have none — there NEXUS says so, and you can type, or configure a transcription service (Settings → Voice →
Speech services → Voice input). Access is requested only when you press the microphone.

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| "Gemini needs an API key" | `GEMINI_API_KEY` missing in `.env`, or `.env` not in the project folder; restart `npm start` after editing |
| "Gemini rejected the API key" | copy the key again from AI Studio (no spaces/quotes) |
| "Gemini does not know this model id" | set `GEMINI_MODEL` to a current id from Google's model list |
| "Gemini quota reached" / rate-limited | free-tier limits — wait a minute (or until tomorrow for daily limits), or enable billing |
| "Could not reach Gemini" / ElevenLabs | internet connection, firewall or proxy |
| "ElevenLabs does not know this voice id" | wrong `ELEVENLABS_VOICE_ID`, or the voice is not in *My Voices* — pick it in Settings |
| "ElevenLabs quota used up" | monthly characters used — wait for the reset or upgrade; replies still show as text |
| "needs a paid plan for this voice or model" | choose one of your own / premade voices, or upgrade |
| Reply shows, but no sound | the browser blocked autoplay: click the page once, or press **read aloud** on the reply; check the speaker button isn't muted |
| Voice fails and you'd rather hear *some* voice | Settings → Voice → *If the voice service fails, speak with this computer's voice instead* (off by default) |
| "Port 8787 is being used" | close the other program or set `PORT=8788` in `.env` |
| Microphone does nothing | use Chrome/Edge, allow the microphone in the address bar's site settings, check Windows *Privacy → Microphone* |

## 8. Deployment

This prototype is meant to run on your own computer. The GitHub Pages site is static — it cannot run this server or
hold keys, so it keeps the labelled demo brain. To put the AI version online you need a host that runs a persistent
Node.js process (a small VPS or a Node app platform), HTTPS, the keys as environment variables there, `ALLOWED_HOSTS`
set to your domain, and your own decision about who may use it (each request costs your Gemini/ElevenLabs quota) —
none of that is set up or tested here.
