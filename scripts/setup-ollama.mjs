#!/usr/bin/env node
/**
 * Free offline AI for NEXUS via Ollama (https://ollama.com). Real open-weights models run on this computer:
 * no account, no API key, no per-use cost, and conversation text never leaves the machine.
 *
 *   node scripts/setup-ollama.mjs [model]     (default: llama3.2 — ~2 GB, runs on most laptops)
 *
 * What it does, step by step (and nothing else):
 *   1. checks that Ollama is installed and running (opens the download page if it is not);
 *   2. downloads the model with `ollama pull <model>` if it is not installed yet;
 *   3. sends a one-line test prompt to the model to prove it answers;
 *   4. saves provider=openai, baseUrl=<ollama>/v1, model=<model> to data/runtime-config.json
 *      (the same file Settings → Model writes). Existing keys in that file are kept.
 * Env: OLLAMA_URL (default http://127.0.0.1:11434), RUNTIME_CONFIG_PATH, NEXUS_NO_PULL=1, NEXUS_NO_OPEN=1.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const OLLAMA = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MODEL = process.argv[2] ?? process.env.NEXUS_OLLAMA_MODEL ?? 'llama3.2';
const RC = process.env.RUNTIME_CONFIG_PATH ?? 'data/runtime-config.json';
const say = (s) => console.log(`[nexus] ${s}`);
if (!/^[\w.:/-]{1,120}$/.test(MODEL)) { say(`"${MODEL}" is not a valid model name.`); process.exit(2); }

const openUrl = (u) => {
  if (process.env.NEXUS_NO_OPEN) return;
  const [c, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  try { spawn(c, a, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref(); } catch { /* ignore */ }
};
async function tags() {
  try { const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) }); if (!r.ok) return null; return ((await r.json()).models ?? []).map((m) => String(m.name)); } catch { return null; }
}
const hasCli = () => spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { stdio: 'ignore' }).status === 0;
const sameModel = (have, want) => have === want || have === `${want}:latest`;

let models = await tags();
if (models === null && hasCli()) {
  say('Ollama is installed but not running — starting it…');
  try { spawn('ollama', ['serve'], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
  for (let i = 0; i < 20 && models === null; i++) { await new Promise((r) => setTimeout(r, 500)); models = await tags(); }
}
if (models === null) {
  say(`Ollama is not running at ${OLLAMA}.`);
  say('1) Install it (free) from https://ollama.com/download — opening the page now.');
  say('2) Start Ollama (on Windows it runs in the system tray after installing).');
  say('3) Run this setup again.');
  openUrl('https://ollama.com/download');
  process.exit(1);
}
say(`Ollama is running (${models.length} model(s) installed).`);

if (!models.some((m) => sameModel(m, MODEL))) {
  if (process.env.NEXUS_NO_PULL) { say(`Model ${MODEL} is not installed (NEXUS_NO_PULL set).`); process.exit(1); }
  say(`Downloading ${MODEL} — this happens once and can take several minutes…`);
  const r = spawnSync('ollama', ['pull', MODEL], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { say(`"ollama pull ${MODEL}" failed. Check your internet connection and the model name, then try again.`); process.exit(1); }
  models = (await tags()) ?? [];
}
const installed = models.find((m) => sameModel(m, MODEL)) ?? MODEL;

say(`Testing ${installed} (the first answer loads the model and may take a minute)…`);
try {
  const r = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(240000),
    body: JSON.stringify({ model: installed, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 8, temperature: 0 }),
  });
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content;
  if (!r.ok || typeof text !== 'string') throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  say(`✓ The model answered: "${text.trim().slice(0, 30)}"`);
} catch (e) { say(`The model did not answer: ${e.message}`); process.exit(1); }

let rc = {};
try { if (existsSync(RC)) rc = JSON.parse(readFileSync(RC, 'utf8')); } catch { rc = {}; }
rc.provider = 'openai';
rc.openai = { ...(rc.openai ?? {}), baseUrl: `${OLLAMA}/v1`, model: installed };
if (rc.openai.apiKey) say('Note: the saved OpenAI-compatible API key was removed so it is never sent to the local model. Re-enter it in Settings → Model if you switch back.');
delete rc.openai.apiKey; // Ollama needs no key
mkdirSync(dirname(RC), { recursive: true });
writeFileSync(RC, JSON.stringify(rc, null, 2), { mode: 0o600 });
try { chmodSync(RC, 0o600); } catch { /* windows */ }
say(`✓ NEXUS will now use ${installed} on this computer (saved to ${RC}).`);
say('  Restart NEXUS if it is already running. To switch back: Settings → Model → Provider.');
