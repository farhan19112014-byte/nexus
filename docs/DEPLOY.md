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
| spoken characters per day (ElevenLabs) | `DAILY_SPEECH_CHAR_LIMIT=20000` |
| messages per visitor per minute | `RATE_LIMIT_PER_MIN=12` |
| other websites that may call the server | only `ALLOWED_ORIGINS` (your GitHub Pages site) |
| settings changes from the browser | off (model, keys and voice are set only in Render) |
| key hints | hidden (not even the last 4 characters) |

When a limit is reached, NEXUS says so plainly; the counts restart every day (and when the server restarts).

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
