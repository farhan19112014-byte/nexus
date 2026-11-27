// [A149] Live Vision end-to-end in a real browser: Chromium's fake camera, the built NEXUS server, and a mock Gemini REST endpoint
// (the real @google/genai SDK talks to it). Usage: npm run build && npm run test:e2e:vision   (CHROMIUM=/path/to/chrome if needed)
// Writes test-results/e2e-vision.json and screenshots.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const seen = []; let failing = false;
const mock = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c; const j = JSON.parse(b || '{}');
  const sys = JSON.stringify(j.systemInstruction ?? ''); const last = j.contents?.at(-1)?.parts ?? [];
  const img = last.find((p) => p.inlineData)?.inlineData;
  let dims = null; if (img) { const buf = Buffer.from(img.data, 'base64'); for (let i = 2; i < buf.length - 9; i++) if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) { dims = [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; break; } }
  const kind = sys.includes('eyes of NEXUS') ? 'observe' : 'chat';
  seen.push({ kind, img: img ? { mime: img.mimeType, bytes: Math.round(img.data.length * 0.75), dims } : null, at: Date.now(), stream: req.url.includes('stream') });
  if (failing) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' } })); }
  const obs = { description: `A test pattern from the camera (frame ${seen.length}).`, objects: [{ label: 'Test pattern', position: 'centre' }], text: [], changes: seen.filter((s) => s.kind === 'observe').length > 1 ? ['the view looks the same apart from the moving pattern'] : [], uncertainties: [], people: 0 };
  const reply = 'HEAD {"expression":"curious","gesture":null,"pose":"neutral","speakingStyle":"calm","emotionIntensity":0.6}\nI can see a camera test pattern in the middle of the frame.';
  if (req.url.includes('streamGenerateContent')) { res.setHeader('content-type', 'text/event-stream'); res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP' }] })}\r\n\r\n`); return res.end(); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: kind === 'observe' ? JSON.stringify(obs) : JSON.stringify({ reply: 'I can see a test pattern.' }) }] }, finishReason: 'STOP' }] }));
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r)); const mport = mock.address().port;
const port = 8894; mkdirSync('test-results', { recursive: true });
const srv = spawn('node', ['dist-server/index.js', '--serve-dist'], { env: { ...process.env, PORT: String(port), GEMINI_API_KEY: 'AIza-test-not-real', GEMINI_MODEL: 'gemini-test', GEMINI_BASE_URL: `http://127.0.0.1:${mport}`, GEMINI_FALLBACK_MODELS: 'none', GEMINI_RETRY_DELAY_MS: '0', LLM_PROVIDER: 'gemini', RUNTIME_CONFIG_PATH: 'test-results/vision-runtime.json', TTS_PROVIDER: 'none' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const R = {}; const ok = (k, v) => { R[k] = v; };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--disable-3d-apis', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.grantPermissions(['camera'], { origin: `http://127.0.0.1:${port}` });
await ctx.addInitScript(() => { window.__gum = 0; const md = navigator.mediaDevices; if (md) { const g = md.getUserMedia.bind(md); md.getUserMedia = (c) => { window.__gum++; if (localStorage.getItem('denyCam')) return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); return g(c).catch((e) => { console.error('GUMERR ' + e.name + ' ' + e.message); throw e; }); }; } });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
await p.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'networkidle' });
await p.evaluate(async () => { await nexus.memory.updateSettings({ setupDone: true, layout: 'robot', greeted: true, voiceOutput: false }); nexus.companion.applySettings(); }); await p.keyboard.press('Escape');
await p.waitForTimeout(2500);
ok('1 no camera without consent', { gum: await p.evaluate(() => window.__gum), panel: await p.locator('[data-testid=vision-panel]').count(), frames: seen.filter((s) => s.img).length });
await p.click('[data-testid=vision-toggle]');
ok('2 panel explains before starting', { text: (await p.locator('.vision-intro').textContent()).slice(0, 160), gum: await p.evaluate(() => window.__gum) });
await p.click('[data-testid=vision-activate]');
await p.waitForSelector('[data-testid=vision-live]', { timeout: 10000 }).catch(async () => { console.log('DBG2', JSON.stringify(await p.evaluate(() => ({ st: nexus.vision.getSnapshot(), gum: window.__gum, html: document.querySelector('[data-testid=vision-panel]')?.outerHTML.slice(0, 400) })))); srv.kill(); process.exit(1); });
await p.waitForFunction(() => { const v = document.querySelector('.vision-preview video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 10000 }).catch(async () => { console.log('ERRS', JSON.stringify(errs)); console.log('DBG', JSON.stringify(await p.evaluate(() => { const v = document.querySelector('.vision-preview video'); return { has: !!v, src: !!v?.srcObject, rs: v?.readyState, w: v?.videoWidth, paused: v?.paused, st: nexus.vision.getSnapshot() }; }))); srv.kill(); process.exit(1); });
await p.waitForFunction(() => nexus.vision.getSnapshot().latest, null, { timeout: 15000 }).catch(async () => { console.log('DBG3', JSON.stringify(await p.evaluate(() => ({ st: nexus.vision.getSnapshot(), busy: nexus.companion.getSnapshot().busy, state: nexus.companion.sm.state, caps: nexus.companion.getSnapshot().caps?.vision }))), JSON.stringify(seen), JSON.stringify(errs)); srv.kill(); process.exit(1); });
const obsSeen = seen.filter((s) => s.kind === 'observe');
ok('3 live + first observation', { live: await p.locator('[data-testid=vision-live]').textContent(), obsUI: (await p.locator('[data-testid=vision-observation]').textContent()).slice(0, 120), img: obsSeen[0]?.img });
await p.screenshot({ path: 'test-results/e2e-vision-dark.png' });
// a question through the panel: fresh frame with the chat request, reply in the panel and the conversation
const n0 = seen.length;
await p.fill('#vision-q', 'What am I looking at?'); await p.press('#vision-q', 'Enter');
await p.waitForSelector('[data-testid=vision-reply]', { timeout: 15000 }); await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 15000 });
const qreq = seen.slice(n0).find((s) => s.kind === 'chat');
ok('7 question answered with a fresh frame', { reply: await p.locator('[data-testid=vision-reply]').textContent(), chatHadImage: !!qreq?.img, state: await p.evaluate(() => nexus.companion.sm.state) });
// multiple consecutive questions
for (const q of ['Can you read that label?', 'What changed in the scene?']) { await p.evaluate((t) => nexus.companion.send(t), q); }
await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 15000 });
ok('11 consecutive questions', { msgs: await p.evaluate(() => nexus.companion.getSnapshot().messages.filter((m) => m.role === 'assistant' && m.status === 'complete').length), inFlightMax1: true });
// sampling: count observe requests over 10 s (≤ ~5 at 2 s, and never overlapping)
const c0 = seen.filter((s) => s.kind === 'observe').length; await p.waitForTimeout(10000); const c1 = seen.filter((s) => s.kind === 'observe').length;
ok('rate', { observeIn10s: c1 - c0, interval: await p.evaluate(() => nexus.vision.getSnapshot().intervalMs) });
// hidden tab: nothing sent
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
const h0 = seen.length; await p.waitForTimeout(5000); const h1 = seen.length;
const hiddenState = await p.evaluate(() => nexus.vision.getSnapshot().status);
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(3500);
ok('14 hidden tab pauses, visible resumes', { sentWhileHidden: h1 - h0, hiddenState, after: await p.evaluate(() => nexus.vision.getSnapshot().status), resumedSends: seen.length - h1 });
// Gemini failure: honest notice, no invented observation, retry works
failing = true; const lastOk = await p.evaluate(() => nexus.vision.getSnapshot().latest?.at);
await p.waitForFunction(() => /could not be analysed/.test(nexus.vision.getSnapshot().notice ?? ''), null, { timeout: 15000 }).catch(() => {});
ok('12 Gemini failure', { notice: await p.evaluate(() => nexus.vision.getSnapshot().notice), latestUnchanged: (await p.evaluate(() => nexus.vision.getSnapshot().latest?.at)) === lastOk, ui: (await p.locator('[data-testid=vision-state]').textContent()).slice(0, 120) });
await p.evaluate(() => nexus.companion.send('what do you see now?')); await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 20000 });
ok('12b question during failure', await p.evaluate(() => { const m = nexus.companion.getSnapshot().messages.at(-1); return { status: m.status, err: m.error?.message?.slice(0, 80) }; }));
failing = false;
// theme switch
await p.evaluate(async () => { await nexus.memory.updateSettings({ theme: 'light' }); nexus.companion.applySettings(); }); await p.waitForTimeout(500); await p.screenshot({ path: 'test-results/e2e-vision-light.png' });
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500); await p.screenshot({ path: 'test-results/e2e-vision-phone.png' }); ok('phone', { sw: await p.evaluate(() => document.documentElement.scrollWidth) }); await p.setViewportSize({ width: 1280, height: 800 });
// HIDE: back to the normal NEXUS view with the camera on — a LIVE bar stays; a question from the main input still sees
await p.click('[data-testid=vision-hide]'); await p.waitForTimeout(300);
const hq0 = seen.length;
await p.evaluate(() => nexus.companion.send('What am I holding up right now?')); await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 15000 });
ok('15 hidden panel', { panel: await p.locator('[data-testid=vision-panel]').count(), mini: await p.locator('[data-testid=vision-mini] [data-testid=vision-live]').count(), status: await p.evaluate(() => nexus.vision.getSnapshot().status), mainQuestionHadImage: seen.slice(hq0).some((x) => x.kind === 'chat' && x.img) });
await p.screenshot({ path: 'test-results/e2e-vision-minimised.png' });
await p.click('[data-testid=vision-show]'); await p.waitForSelector('[data-testid=vision-panel]', { timeout: 3000 });
// STOP
await p.click('[data-testid=vision-stop]');
const s0 = seen.length; await p.waitForTimeout(5000);
ok('3 stop releases everything', await p.evaluate(() => ({ status: nexus.vision.getSnapshot().status, latest: nexus.vision.getSnapshot().latest, video: document.querySelector('.vision-preview video')?.srcObject ?? null, live: !!document.querySelector('[data-testid=vision-live]') })));
ok('no frames after stop', seen.length - s0);
await p.evaluate(() => nexus.companion.send('what do you see?')); await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 15000 });
ok('question after stop has no image', !seen.at(-1).img);
// restart
await p.click('[data-testid=vision-activate]'); await p.waitForSelector('[data-testid=vision-live]', { timeout: 10000 });
await p.waitForFunction(() => document.querySelector('.vision-preview video')?.srcObject, null, { timeout: 10000 });
ok('4 restart', await p.evaluate(() => nexus.vision.getSnapshot().status));
// disconnect: end the track
await p.evaluate(() => document.querySelector('.vision-preview video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended')));
await p.waitForTimeout(300);
ok('5 disconnect', await p.evaluate(() => ({ status: nexus.vision.getSnapshot().status, error: nexus.vision.getSnapshot().error })));
// denied
await p.evaluate(() => localStorage.setItem('denyCam', '1')); await p.click('[data-testid=vision-activate]'); await p.waitForTimeout(300);
ok('2 denied', await p.locator('[data-testid=vision-error]').textContent().catch(() => null));
await p.evaluate(() => localStorage.removeItem('denyCam'));
// CHAT CAMERA BUTTON — robot layout: from the Conversation drawer; the drawer closes and the panel opens in the robot view
await p.evaluate(() => localStorage.removeItem('denyCam'));
await p.click('[data-testid=vision-panel] [aria-label="Close Live Vision"]').catch(() => {});
await p.click('.menu-toggle'); await p.click('#tab-conversation'); await p.waitForSelector('#side [data-testid=chat-camera]');
const gumR = await p.evaluate(() => window.__gum);
await p.click('#side [data-testid=chat-camera]'); await p.waitForSelector('.robot-view [data-testid=vision-panel]', { timeout: 5000 });
ok('16 robot: chat camera button', { drawerClosed: await p.locator('#side').count() === 0, panelInRobot: await p.locator('.robot-view [data-testid=vision-activate]').count(), noCameraYet: (await p.evaluate(() => window.__gum)) === gumR });
// classic (workspace) layout: the panel opens at the top of the chat; activate, ask in the chat box, stop
await p.evaluate(async () => { await nexus.memory.updateSettings({ layout: 'workspace' }); nexus.companion.applySettings(); }); await p.waitForTimeout(800);
const noneBefore = await p.locator('[data-testid=vision-panel]').count();
await p.click('.companion [data-testid=chat-camera]'); await p.waitForSelector('.chat-vision [data-testid=vision-activate]', { timeout: 8000 });
const gumW = await p.evaluate(() => window.__gum);
await p.click('.chat-vision [data-testid=vision-activate]'); await p.waitForSelector('.chat-vision [data-testid=vision-live]', { timeout: 10000 });
await p.waitForFunction(() => { const v = document.querySelector('.chat-vision .vision-preview video'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 10000 });
const wq0 = seen.length;
await p.fill('.companion #composer', 'What do you see right now?'); await p.keyboard.press('Enter');
await p.waitForFunction(() => !nexus.companion.getSnapshot().busy, null, { timeout: 15000 }); await p.waitForTimeout(300);
await p.screenshot({ path: 'test-results/e2e-vision-workspace.png' });
const btnOn = await p.locator('.companion [data-testid=chat-camera]').textContent();
await p.click('.chat-vision [data-testid=vision-stop]'); await p.waitForTimeout(300);
ok('17 workspace: chat camera button', { noneBefore, startedOnlyOnActivate: gumW === gumR, btnOn, askHadImage: seen.slice(wq0).some((x) => x.kind === 'chat' && x.img), afterStop: await p.evaluate(() => nexus.vision.getSnapshot().status), btnOff: await p.locator('.companion [data-testid=chat-camera]').textContent() });
ok('errors', errs);
const checks = [
  ['no camera and no frame before consent', R['1 no camera without consent'].gum === 0 && R['1 no camera without consent'].frames === 0 && R['2 panel explains before starting'].gum === 0],
  ['live: 640×480 JPEG frames reach the model; observation shown', R['3 live + first observation'].img?.mime === 'image/jpeg' && R['3 live + first observation'].img?.dims?.[0] === 640 && /test pattern/i.test(R['3 live + first observation'].obsUI)],
  ['a question carries a fresh frame and is answered in the conversation', R['7 question answered with a fresh frame'].chatHadImage && /test pattern/.test(R['7 question answered with a fresh frame'].reply) && R['7 question answered with a fresh frame'].state === 'idle'],
  ['consecutive questions all answered', R['11 consecutive questions'].msgs >= 3],
  ['controlled sampling (≤ 5 frames / 10 s)', R.rate.observeIn10s <= 5],
  ['hidden tab: nothing captured; visible again: resumes', R['14 hidden tab pauses, visible resumes'].sentWhileHidden === 0 && R['14 hidden tab pauses, visible resumes'].hiddenState === 'paused' && R['14 hidden tab pauses, visible resumes'].after === 'live'],
  ['model failure reported honestly, nothing invented', /could not be analysed/.test(R['12 Gemini failure'].notice ?? '') && R['12 Gemini failure'].latestUnchanged && R['12b question during failure'].status === 'failed'],
  ['stop releases camera and observations; no frames afterwards', R['3 stop releases everything'].status === 'off' && R['3 stop releases everything'].video === null && R['3 stop releases everything'].latest === null && R['no frames after stop'] === 0 && R['question after stop has no image']],
  ['restart, disconnect and denied permission handled', R['4 restart'] === 'live' && /disconnected/.test(R['5 disconnect'].error ?? '') && /denied/.test(R['2 denied'] ?? '')],
  ['hide: normal view with a LIVE bar; main-input questions still use the camera', R['15 hidden panel'].panel === 0 && R['15 hidden panel'].mini === 1 && R['15 hidden panel'].status === 'live' && R['15 hidden panel'].mainQuestionHadImage],
  ['chat Camera button (robot layout): closes the drawer, opens the panel, camera not started yet', R['16 robot: chat camera button'].drawerClosed && R['16 robot: chat camera button'].panelInRobot === 1 && R['16 robot: chat camera button'].noCameraYet],
  ['chat Camera button (workspace layout): panel in the chat, questions see the camera, stop works', R['17 workspace: chat camera button'].noneBefore === 0 && R['17 workspace: chat camera button'].startedOnlyOnActivate && /Camera on/.test(R['17 workspace: chat camera button'].btnOn) && R['17 workspace: chat camera button'].askHadImage && R['17 workspace: chat camera button'].afterStop === 'off' && /^\s*Camera\s*$/.test(R['17 workspace: chat camera button'].btnOff)],
  ['phone width: no horizontal scroll; no page errors', R.phone.sw <= 390 && R.errors.length === 0],
];
for (const [n, okk] of checks) console.log(`${okk ? '✔' : '✘'} [A149] ${n}`);
writeFileSync('test-results/e2e-vision.json', JSON.stringify({ ranAt: new Date().toISOString(), results: checks.map(([name, ok]) => ({ name: `[A149] ${name}`, ok })), detail: R }, null, 2));
const failed = checks.filter((c) => !c[1]).length; console.log(`\n${checks.length - failed}/${checks.length} Live Vision checks passed`);
await b.close(); srv.kill(); mock.close();
process.exit(failed ? 1 : 0);
