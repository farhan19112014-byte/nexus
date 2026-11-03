# Put NEXUS online (Render, free) — the website talks to Gemini

```
visitor's browser ──► https://farhan19112014-byte.github.io/nexus/   (website, GitHub Pages)
        │
        └──────────► https://nexus-xxxx.onrender.com                 (NEXUS server: Gemini + voice, keys live here)
                         also serves the full app itself
```

The keys stay in Render's settings — never in the repository, the website or the browser.

## What "free" means here

- **Render free web service:** no credit card needed. It **sleeps after 15 minutes without visitors**, and the first
  visit after that takes **about a minute** to wake up (NEXUS shows "Waking up the NEXUS server…"). 750 free hours a
  month, 512 MB memory — enough for this prototype. Render says free services aren't meant for production.
- **Gemini free tier:** per-minute and per-day limits; Google may use free-tier prompts to improve its products.
- **ElevenLabs:** optional; monthly character limits by plan.

Because anyone with the link can use your server, **public mode** protects your quotas:

| Protection | Default (change in Render → Environment) |
|---|---|
| messages per day, whole server | `DAILY_CHAT_LIMIT=400` |
| messages per visitor per day | `DAILY_CHAT_LIMIT_PER_VISITOR=60` |
| spoken characters per day, whole server (ElevenLabs) | `DAILY_SPEECH_CHAR_LIMIT=20000` |
| spoken characters per visitor per day | `DAILY_SPEECH_CHAR_LIMIT_PER_VISITOR=3000` |
| voice inputs (transcriptions) per day, whole server / per visitor | `DAILY_TRANSCRIPTION_LIMIT=600` / `DAILY_TRANSCRIPTION_LIMIT_PER_VISITOR=60` |
| messages per visitor per minute | `RATE_LIMIT_PER_MIN=12` |
| other websites that may call the server | only `ALLOWED_ORIGINS` (your GitHub Pages site) |
| settings changes from the browser | off (model, keys and voice are set only in Render) |
| key hints | hidden (not even the last 4 characters) |

How the limits work (`server/budget.ts`):

- **Whole-server vs per-visitor.** "Whole server" means every visitor together, counted in one place — the counter store
  below. With the file store that is this one server process; with Upstash it is every instance sharing that database.
  "Per visitor" is one network address (IPv6: one /64 network), stored only as a daily-changing salted hash.
- **Reserved before the AI or voice service is called**, atomically, so parallel requests can't spend the same allowance
  twice. Refused requests never reach the provider.
- **Refunds:** requests the service rejects (bad key, outage, provider quota) are given back — once. Requests the visitor
  cancels, or that hit NEXUS's own time limit (30 s voice, 45 s voice input), still count, because the service may already
  have produced and billed the work. Replaying a sentence generated in the last 10 minutes is free (served from memory).
- **Days are UTC days**; a refusal says when it resets (`Retry-After`).
- **If the counter store is unreachable, metered requests are refused** (HTTP 503) rather than served unmetered.

**Where the counts live** (`BUDGET_STORE`):

| Store | Survives a restart? | Several instances share it? | Set up |
|---|---|---|---|
| `file` (default on a public server) | yes, on the same disk — **not** after a Render free-plan spin-down (its disk is wiped) | no | nothing (`BUDGET_FILE`, default `data/budget.json`) |
| `upstash` (recommended for Render free) | yes | yes | free Upstash Redis database → set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Render (secret) |
| `memory` | no | no | `BUDGET_STORE=memory` |

Without Upstash on the free plan, each spin-down starts the day's counts again, so the real daily maximum can be higher than
the numbers above. Set a hard limit in your ElevenLabs and Google dashboards as well.

**Visitor addresses behind Render's proxy:** `TRUST_PROXY` (default `1`) is the number of proxies that add themselves to
`X-Forwarded-For`. After deploying, run `npm run verify:live -- --server https://YOUR.onrender.com`: it shows the address the
server sees for you and checks that a spoofed header is ignored. If that address isn't your real public IP, raise
`TRUST_PROXY` until it is (never set it to `true`: that would trust a header any visitor can write).

**Security headers:** every response has a Content-Security-Policy (only this site's own scripts, no `eval`, no embedding by
other sites), `X-Frame-Options: DENY`, `Permissions-Policy` (microphone only for this site), `Referrer-Policy: no-referrer`,
and HSTS on public servers. The GitHub Pages site carries the same policy as a `<meta>` tag (GitHub Pages can't send headers,
so the protection against being embedded in other sites is not available there).

## Steps (about 10 minutes)

1. **Push the latest code** to GitHub (it contains `render.yaml`).
2. Go to <https://render.com> → **Sign up with GitHub** → allow access to the `nexus` repository.
3. **New → Blueprint** → pick `farhan19112014-byte/nexus` → Render reads `render.yaml` and shows a service called **nexus**.
4. It asks for the secret values — type them in Render (not anywhere else):
   - `GEMINI_API_KEY` — from <https://aistudio.google.com/apikey>
   - `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — optional; leave empty to use the visitor's built-in browser voice
5. **Apply**. The first build takes a few minutes. When it says **Live**, copy the address (e.g.
   `https://nexus-ab12.onrender.com`) and open it — that is the full NEXUS with Gemini. Check
   `…onrender.com/api/status`: `"provider":"gemini"`, `"configured":true`, `"hosted":true`.
6. **Connect the GitHub Pages site** to it: GitHub → repository **Settings → Secrets and variables → Actions →
   Variables → New repository variable** → name `NEXUS_API_URL`, value your Render address (no trailing `/`).
   Then **Actions → Web demo (GitHub Pages) → Run workflow**. After it finishes, the Pages site uses Gemini too.
   (Delete the variable to go back to the offline web demo.)

> The Pages workflow must be the updated `.github/workflows/pages.yml` from this repository (it reads `NEXUS_API_URL`).
> If GitHub refuses to accept workflow changes from your computer, paste the file's content in GitHub's web editor
> (open the file on GitHub → pencil icon → Commit).

## Updating

Every push to `main` redeploys Render (`autoDeploy`) and the Pages site. Change limits or the model in
**Render → nexus → Environment** (saving restarts the service).

## Troubleshooting

| Problem | Fix |
|---|---|
| First message takes a minute | the free server was asleep — later messages are fast |
| "Cross-origin request refused" on the Pages site | `ALLOWED_ORIGINS` in Render must be exactly `https://farhan19112014-byte.github.io` |
| Pages site still says "web demo" | the `NEXUS_API_URL` variable is missing, or the Pages workflow wasn't re-run after adding it |
| "Gemini needs an API key" | `GEMINI_API_KEY` empty in Render → Environment |
| "Gemini quota reached" | Google's free-tier limit — wait, lower `DAILY_CHAT_LIMIT`, or enable billing in AI Studio |
| "today's limit … on this public server" | your own daily budget — raise the numbers in Render if you want |
| Build fails on Render | open **Logs**; `npm ci` needs the committed `package-lock.json` |
| Service suspended | free hours or bandwidth for the month are used up — it resumes next month |

## What this setup does not do

No accounts or logins: anyone with the link can talk to NEXUS, within the limits above. Saved memories and chats stay in
each visitor's own browser. The server keeps nothing between restarts (Render's free disk is temporary).
