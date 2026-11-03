/**
 * LIVE check of the real AI and voice services, using the keys in your .env (or data/runtime-config.json).
 * This is the only check that sends real requests, so it uses a little of your quota: one tiny request per Gemini model,
 * one chat through the NEXUS server code, and one short spoken sentence per voice service.
 *
 *   npm run verify:live                                    services configured on this computer
 *   npm run verify:live -- --server https://YOUR.onrender.com   also the deployed server (1 chat + 1 spoken sentence)
 *
 * Keys are never printed: every output line is scrubbed of them. Results → test-results/live-check.json, and the audio
 * produced → test-results/live-*.mp3|wav so you can listen to it. Exit code 1 if anything failed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { applyRuntime, loadDotEnv, loadRuntime, readConfig } from '../server/config';
import { GeminiProvider } from '../server/providers/gemini';
import { createApp } from '../server/app';
import { synthesize, ttsStatus } from '../server/speech';

const args = process.argv.slice(2);
const serverUrl = (() => { const i = args.indexOf('--server'); return i >= 0 ? (args[i + 1] ?? '').replace(/\/+$/, '') : ''; })();
loadDotEnv('.env');
let cfg = readConfig();
if (cfg.allowRuntimeConfig) cfg = applyRuntime(cfg, loadRuntime(cfg.runtimeConfigPath));

const secrets = [cfg.gemini.apiKey, cfg.openai.apiKey, cfg.anthropic.apiKey, cfg.speech.tts.apiKey, cfg.speech.stt.apiKey, cfg.speech.eleven.apiKey].filter((k) => k && k.length >= 8);
const scrub = (s) => secrets.reduce((t, k) => t.split(k).join('[key]'), String(s));
const results = []; mkdirSync('test-results', { recursive: true });
const record = (name, ok, detail) => { results.push({ name, ok, detail: scrub(detail) }); console.log(`${ok === null ? '–' : ok ? '✔' : '✘'} ${name}: ${scrub(detail)}`); };
const timed = async (ms, fn) => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), ms); const t0 = Date.now(); try { return { value: await fn(ctl.signal), ms: Date.now() - t0 }; } finally { clearTimeout(t); } };
const errText = (e) => `${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`;

// 1 · every Gemini model id NEXUS is configured to use (main + fallbacks), each asked directly, no fallback
const g = cfg.gemini;
if (!g.apiKey || /^replace/.test(g.apiKey)) record('Gemini', null, 'skipped — no GEMINI_API_KEY in .env');
else for (const model of [g.model, ...(g.fallbackModels ?? [])].filter((m, i, a) => m && a.indexOf(m) === i)) {
  try {
    const p = new GeminiProvider({ apiKey: g.apiKey, model, baseUrl: g.baseUrl, fallbackModels: [], retryDelayMs: 0 });
    const { value, ms } = await timed(45000, (signal) => p.complete({ system: 'Connection test.', messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 64, temperature: 0, json: false }, signal));
    record(`Gemini model ${model}`, true, `replied "${String(value).trim().slice(0, 40)}" in ${ms} ms`);
  } catch (e) { record(`Gemini model ${model}`, false, errText(e)); }
}

// 2 · one real chat through the NEXUS server code (prompt, JSON reply, validation) with the configured provider
if (cfg.provider === 'demo') record('NEXUS chat (local server code)', null, 'skipped — LLM_PROVIDER is the demo brain');
else {
  const app = createApp({ ...cfg, publicMode: false }, { persistRuntime: false });
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  try {
    const { value: r, ms } = await timed(90000, (signal) => fetch(`http://127.0.0.1:${s.address().port}/api/chat`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], stream: false }) }));
    const j = await r.json();
    if (r.ok && j.meta?.isLLM) record('NEXUS chat (local server code)', true, `${j.meta.provider} · ${j.meta.model} answered in ${ms} ms${j.meta.degraded ? ' (reply needed repair)' : ''}: "${String(j.response?.reply ?? '').slice(0, 80)}"`);
    else record('NEXUS chat (local server code)', false, `HTTP ${r.status} ${j.code ?? ''} ${j.error ?? ''}`);
  } catch (e) { record('NEXUS chat (local server code)', false, errText(e)); } finally { s.close(); }
}

// 3 · voice: the configured speech service, plus ElevenLabs if a key is present but another service is selected
const voices = [];
if (ttsStatus(cfg.speech.tts).configured) voices.push(cfg.speech.tts);
const el = cfg.speech.eleven;
if (el.apiKey && cfg.speech.tts.provider !== 'elevenlabs') voices.push({ provider: 'elevenlabs', baseUrl: el.baseUrl, apiKey: el.apiKey, model: el.model, voice: el.voice, format: 'mp3', style: '' });
if (!voices.length) record('Voice service', null, 'skipped — no speech service configured (the browser voice is used)');
for (const t of voices) {
  const label = `Voice ${t.provider} · ${t.model || 'default model'} · ${t.voice || 'no voice id'}`;
  if (!ttsStatus(t).configured) { record(label, false, ttsStatus(t).note); continue; }
  try {
    const { value: { audio, mime }, ms } = await timed(60000, (signal) => synthesize(t, 'Hello! I am NEXUS. This is a live voice check.', signal));
    const file = `test-results/live-${t.provider}.${/wav/.test(mime) ? 'wav' : 'mp3'}`; writeFileSync(file, audio);
    record(label, audio.length > 1000, `${(audio.length / 1024).toFixed(0)} KB of ${mime} in ${ms} ms → ${file} (listen to it)`);
  } catch (e) { record(label, false, errText(e)); }
}

// 4 · optional: the deployed server, exactly as a visitor uses it (counts against its public daily budget)
if (serverUrl) {
  try {
    const { value: home } = await timed(70000, (signal) => fetch(`${serverUrl}/`, { signal }));   // free hosts can take ~1 min to wake
    const csp = home.headers.get('content-security-policy') ?? '';
    record('Deployed security headers', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && home.headers.get('x-frame-options') === 'DENY' && !!home.headers.get('strict-transport-security'),
      csp ? `CSP present (${csp.split(';').length} directives) · x-frame-options ${home.headers.get('x-frame-options')} · HSTS ${home.headers.get('strict-transport-security') ? 'on' : 'missing'}` : 'no Content-Security-Policy header — is the deployed server older than this code?');
    // how the server identifies visitors behind the host's proxy: a value written by the client must not be trusted
    const v1 = await (await fetch(`${serverUrl}/api/visitor`)).json().catch(() => null);
    const v2 = await (await fetch(`${serverUrl}/api/visitor`, { headers: { 'x-forwarded-for': '203.0.113.250' } })).json().catch(() => null);
    if (!v1) record('Deployed visitor identity', false, '/api/visitor is missing — the deployed server is older than this code');
    else record('Deployed visitor identity', v1.ip === v2?.ip && v1.ip !== '203.0.113.250', `the server sees you as ${v1.ip} (${v1.forwardedEntries} forwarded entries, TRUST_PROXY=${v1.trustProxy}); a spoofed header ${v1.ip === v2?.ip ? 'was ignored ✓' : `changed it to ${v2?.ip} ✗`}. Compare with your real public IP (search "what is my ip"): if they differ, every visitor may share one limit — set TRUST_PROXY to the number of proxies.`);
    const { value: st } = await timed(30000, async (signal) => (await fetch(`${serverUrl}/api/status`, { signal })).json());
    record('Deployed server status', !!st.configured && st.isLLM, `provider ${st.provider} · model ${st.model ?? '?'} · configured ${st.configured} · voice ${st.speech?.tts?.configured ? st.speech.tts.note : 'not configured'}`);
    const { value: r, ms } = await timed(90000, (signal) => fetch(`${serverUrl}/api/chat`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello in one short sentence.' }], stream: false }) }));
    const j = await r.json();
    record('Deployed server chat', r.ok && !!j.meta?.isLLM, r.ok ? `${j.meta.provider} · ${j.meta.model} in ${ms} ms: "${String(j.response?.reply ?? '').slice(0, 80)}"` : `HTTP ${r.status} ${j.code ?? ''} ${j.error ?? ''}`);
    if (st.speech?.tts?.configured) {
      const { value: a, ms: ams } = await timed(60000, (signal) => fetch(`${serverUrl}/api/speech`, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello from the deployed NEXUS.' }) }));
      const buf = Buffer.from(await a.arrayBuffer()); const mime = a.headers.get('content-type') ?? '';
      if (a.ok) writeFileSync(`test-results/live-deployed.${/wav/.test(mime) ? 'wav' : 'mp3'}`, buf);
      record('Deployed server voice', a.ok && buf.length > 1000, a.ok ? `${(buf.length / 1024).toFixed(0)} KB of ${mime} in ${ams} ms` : `HTTP ${a.status} ${buf.toString().slice(0, 160)}`);
    }
  } catch (e) { record('Deployed server', false, errText(e)); }
}

const failed = results.filter((r) => r.ok === false).length, passed = results.filter((r) => r.ok === true).length;
writeFileSync('test-results/live-check.json', JSON.stringify({ ranAt: new Date().toISOString(), server: serverUrl || null, passed, failed, results }, null, 2));
console.log(`\n${passed} passed · ${failed} failed · ${results.length - passed - failed} skipped → test-results/live-check.json`);
process.exit(failed ? 1 : 0);
