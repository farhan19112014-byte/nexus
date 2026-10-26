#!/usr/bin/env node
/**
 * Make NEXUS speak in YOUR voice with Gemini voice replication (run once, on your own computer).
 *
 *   node scripts/make-voice.mjs my-voice.wav my-consent.wav
 *
 * my-voice.wav    10–30 seconds of you speaking naturally (clean, no music or noise)
 * my-consent.wav  you saying, same microphone and room:
 *                 "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."
 * Both: WAV, ideally 24 kHz mono 16-bit. Uses GEMINI_API_KEY from .env (or the environment); the key is only sent to Google.
 * Prints a voice id (voice_...) and saves a short test reply as nexus-voice-test.wav. Your recordings are not stored by NEXUS.
 * Only replicate a voice you own or have explicit permission to use.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

class Stop extends Error {}
const fail = (msg) => { console.error(msg); throw new Stop(msg); };

try {

const [src, consent] = process.argv.slice(2);
if (!src || !consent) fail('Usage: node scripts/make-voice.mjs my-voice.wav my-consent.wav');
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const key = process.env.GEMINI_API_KEY;
if (!key) fail('GEMINI_API_KEY is missing — put it in .env (GEMINI_API_KEY=...) and run again.');
const base = (process.env.GEMINI_VOICE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
const model = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const wav = (p) => { if (!existsSync(p)) fail(`File not found: ${p}`); const b = readFileSync(p); if (b.subarray(0, 4).toString('latin1') !== 'RIFF') fail(`${p} is not a WAV file — convert it to WAV first.`); return b.toString('base64'); };
const say = (e) => String(e).replace(/AIza[0-9A-Za-z_-]+/g, '…');

const r = await fetch(`${base}/voices`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ store: true, voice: { model, type: 'replicated', display_name: 'NEXUS', replicated: { source_audio: { mime_type: 'audio/wav', data: wav(src) }, consent_audio: { mime_type: 'audio/wav', data: wav(consent) } } } }) }).catch((e) => fail(`Could not reach Google: ${say(e.message)}`));
const j = await r.json().catch(() => ({}));
if (!r.ok) fail(`Google refused (HTTP ${r.status}): ${say(j.error?.message ?? JSON.stringify(j).slice(0, 300))}${r.status === 403 && /tier/i.test(JSON.stringify(j)) ? '\nVoice replication needs billing turned on for this Gemini key (AI Studio → Billing).' : ''}`);
const id = j.id ?? j.name?.split('/').pop() ?? j.voice?.id;
if (!id) fail(`Created, but no voice id in the answer: ${JSON.stringify(j).slice(0, 300)}`);
console.log(`\nYour voice id: ${id}\n`);

// quick test so you can hear it
const t = await fetch(`${base}/interactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ model, input: [{ type: 'user_input', content: [{ type: 'text', text: "Hi! I'm NEXUS. This is how I sound now." }] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: id }] } }) });
const find = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 8) return null; if (typeof o.data === 'string' && o.data.length > 40) return o.data; for (const v of Object.values(o)) { const f = find(v, d + 1); if (f) return f; } return null; };
const audio = t.ok ? find(await t.json().catch(() => null)) : null;
if (audio) { writeFileSync('nexus-voice-test.wav', Buffer.from(audio, 'base64')); console.log('Test saved: nexus-voice-test.wav — double-click it to listen.'); }
else console.log(`(The voice was created, but the test sentence failed: HTTP ${t.status}.)`);
console.log(`\nNow in Render → nexus → Environment add:\n  TTS_PROVIDER = gemini\n  TTS_VOICE    = ${id}\nand remove ELEVENLABS_API_KEY if you set it. Save, rebuild and deploy.\n`);
} catch (e) { if (!(e instanceof Stop)) console.error(e); process.exitCode = 1; }
