# NEXUS on your laptop — one app

NEXUS is **one desktop app: `NEXUS.exe`**. It is a single file — no installer, no Node.js, no scripts, no browser needed.
Everything is inside it: the home page, the robot, chats, skills, memory, reminders, settings, the first-run setup and
the free offline AI download.

## Start

1. Put `NEXUS.exe` somewhere permanent (for example your Desktop or `Documents`).
2. Double-click it. The first start takes a few seconds (the app unpacks itself each time it starts).
3. Windows SmartScreen may say "Windows protected your PC" because the app is not code-signed:
   click **More info → Run anyway**.

The first time, a short setup asks for the robot's name, its brain (demo / free offline AI / hosted AI) and a theme.
You can run it again from the menu **Go → Set up again** or **Settings**.

NEXUS runs only on your computer: its built-in server listens on `127.0.0.1` (port 18787), so other devices on your
Wi-Fi cannot reach it. Starting it twice just brings the open window to the front.

## Inside the app

| Menu | |
|---|---|
| **Go → Robot** (`Ctrl+1`) | the robot workspace (chat, skills, memory, reminders, settings, status) |
| **Go → Home page** (`Ctrl+2`), **About**, **Privacy** | the information pages |
| **Go → Set up again** | the first-run setup |
| **NEXUS → Settings folder** | where the model settings are saved (`%APPDATA%\NEXUS\runtime-config.json`) |
| **NEXUS → Open in browser (for voice input)** | the same NEXUS in Chrome/Edge while the app is open — see *Voice* below |
| **Menu** (top right in the robot view) | the whole conversation, chats, skills, memory, reminders, settings, status |

API keys are kept in the app's background process and are never sent to the window. Memories, chats and approved skills
are saved inside the app (in `%APPDATA%\NEXUS`), so they survive restarts and moving `NEXUS.exe` to another folder.

## Free offline AI (Ollama)

Without a model NEXUS uses its *demo brain* — scripted and labelled "not an LLM". For real conversation without paying for an API:

1. Install **Ollama** from <https://ollama.com/download> (free; on Windows it then runs in the system tray).
2. In NEXUS open **Settings → Model** (or the setup's "Free AI on this computer" option) and press **Check again**.
3. Choose a model and press **Download model**. The app shows Ollama's real download progress; you can cancel.
4. Press **Use …**, then **Save** and **Test connection**. The top bar shows "connected" only after the test succeeds.

| RAM | Model | Notes |
|---|---|---|
| 8 GB | `llama3.2` (default, about 2 GB) | fastest; simple answers, may ignore movement hints more often |
| 16 GB | `qwen2.5:7b` or `llama3.1:8b` (about 5 GB) | noticeably better answers; slower without a dedicated GPU |

Honest expectations: small local models are less capable than large hosted ones, the first reply after starting loads
the model and can take up to a minute (NEXUS waits up to 3 minutes for local models), and replies on a laptop without a
dedicated GPU can take several seconds. Conversation text stays on your computer.

## Google Gemini brain + ElevenLabs voice

Step-by-step (keys, `.env`, voice choice, troubleshooting): **[AI_BACKEND.md](AI_BACKEND.md)**. In the app: **Settings → Model →
Google Gemini** (paste the key, Save, Test connection) and **Settings → Voice → Speech services → ElevenLabs voice** (paste the
key, Save, *Load my voices*, pick one, Save, Test voice). Keys stay in NEXUS's background process.

Without a voice service, **Settings → Voice → Voice character → Youthful** (the default) makes this computer's voice a
little brighter and, with the voice on *Automatic*, prefers a young-adult voice such as Microsoft Jenny or Aria.

## Voice

NEXUS opens in the **robot view**: press the big microphone and talk; press it again (or just stop talking) to finish.
By default the words you said are put in the text box so you can check them — press Enter to send (turn this off in
Settings → Voice → *Let me review recognised speech*). The speaker button mutes spoken replies; while NEXUS talks you can
**pause**, resume or **stop** it (Esc also stops).

Two ways to get voice:

| | Spoken replies | Voice input | Mouth movement |
|---|---|---|---|
| **Built in** (no setup) | this computer's voices | **not in the desktop app** (Electron has no speech recognition); works in Chrome/Edge via *NEXUS → Open in browser* | follows word timing (approximation) |
| **Speech service** (Settings → Voice → Speech services) | a generated voice from the service | works everywhere, including the desktop app | follows the real audio loudness (approximation, not phonemes) |

A speech service is any OpenAI-compatible audio API (hosted, or a local server on this computer). Enter its base URL,
model and voice names and, for hosted services, an API key — the key stays in NEXUS's background process and is never
shown again. Hosted services may charge per use. NEXUS sends your recording only after you press the microphone and does
not keep the audio.

## Battery

The robot drops to about 20 frames per second while it is just breathing and blinking, to about 8 while resting, and goes back
to full speed the moment it moves or speaks. It stops drawing completely when the window is minimised.

## Layout and keyboard

- 1280 px and wider: robot, chat and the Skills/Memory/Settings panel side by side.
- 1024–1279 px (small laptops, 150% display scaling): robot and chat use the full width; the panel slides over from the
  right — open it with the top-right button or `Alt+1`…`Alt+6`.

| Key | Action |
|---|---|
| `/` | jump to the message box |
| `Enter` / `Shift+Enter` | send / new line |
| `Esc` | close the panel drawer, otherwise stop speaking, stop moving, cancel the reply |
| `Alt+1` … `Alt+6` | Chats, Skills, Memory, Reminders, Settings, Status |
| `Alt+P` | show / hide the panel |
| `Ctrl` + `+` / `-` / `0` | zoom |

## Troubleshooting

| Problem | Fix |
|---|---|
| "Port 18787 is being used by another program" | close that program (or an older NEXUS still running from source), then start NEXUS again |
| Model replies time out | the first local reply loads the model — wait and retry; use a smaller model; close heavy apps |
| "Ollama is not running" | start Ollama from the Start menu (tray icon), then press **Check again** |
| Download fails | check the internet connection and free disk space; press **Download model** again (Ollama resumes) |

## Building it yourself (developers)

```bat
npm install
npm run dist:win            &rem → release\NEXUS.exe  (the single-file app)
npm run dist:win:installer  &rem optional: a classic installer with Start-menu shortcut instead
```

The `start-nexus.*`, `rebuild-nexus.bat` and `setup-offline-ai.*` scripts are only for running NEXUS from source in a
browser during development; you do not need them with `NEXUS.exe`.
