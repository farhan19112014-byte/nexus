// [A98] End-to-end tests in a real (headless) Chromium against the built app + API server.
// Usage: npm run build && npm run test:e2e   (set CHROMIUM=/path/to/chrome if Playwright's browser isn't installed)
// Writes test-results/e2e.json, consumed by scripts/report.mjs.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';

// Mock OpenAI-compatible streaming LLM + mock Wikipedia (no external network needed)
const words = ['**Photosynthesis** ', 'lets ', 'plants ', 'turn ', 'light ', 'into ', 'chemical ', 'energy ', '[1]. ', 'It ', 'happens ', 'in ', '`chloroplasts`.'];
const ttsCalls = []; const sttCalls = [];
/** 1.2 s mono 16-bit WAV: 0.45 s tone, 0.3 s silence, 0.45 s tone */
function toneWav(dur = 1.2, on = (t) => t < 0.45 || t > 0.75, sr = 16000) { const n = Math.round(sr * dur), d = Buffer.alloc(44 + n * 2); d.write('RIFF', 0); d.writeUInt32LE(36 + n * 2, 4); d.write('WAVEfmt ', 8); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(sr, 24); d.writeUInt32LE(sr * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write('data', 36); d.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) { const t = i / sr; d.writeInt16LE(on(t) ? Math.round(Math.sin(2 * Math.PI * 220 * t) * 16000) : 0, 44 + i * 2); } return d; }
let mockFailing = false; // toggled by the journey test to simulate the provider going down
const mock = http.createServer(async (req, res) => {
  if (req.url.startsWith('/mock/fail')) { mockFailing = req.url.includes('on=1'); return res.end('ok'); }
  // mock OpenAI-compatible speech APIs: TTS returns a real WAV (tone – silence – tone) so lip-sync can follow actual audio
  if (req.url.startsWith('/v1/audio/speech')) { let b = ''; for await (const c of req) b += c; ttsCalls.push(JSON.parse(b)); res.setHeader('content-type', 'audio/wav'); return res.end(toneWav()); }
  if (req.url.startsWith('/v1/audio/transcriptions')) { let n = 0; let raw = ''; for await (const c of req) { n += c.length; if (raw.length < 2_000_000) raw += c.toString('latin1'); } sttCalls.push({ bytes: n, model: /name="model"\r\n\r\n([^\r]+)/.exec(raw)?.[1] }); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ text: 'please wave' })); }
  if (req.url.startsWith('/w/api.php')) {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('list=search')) return res.end(JSON.stringify({ query: { search: [{ pageid: 7, title: 'Photosynthesis' }] } }));
    return res.end(JSON.stringify({ query: { pages: { 7: { title: 'Photosynthesis', extract: 'Photosynthesis is the process plants use to convert light into chemical energy.', fullurl: 'https://en.wikipedia.org/wiki/Photosynthesis' } } } }));
  }
  let body = ''; for await (const c of req) body += c;
  const j = JSON.parse(body || '{}');
  if (!j.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); }
  if (mockFailing) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ error: { message: 'mock provider is down' } })); }
  res.setHeader('content-type', 'text/event-stream');
  const send = (t) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  // contextual replies for the end-to-end journey: the mock reads the real system prompt and the last user turn
  const sys = j.messages?.find((m) => m.role === 'system')?.content ?? '';
  const lastUser = ([...(j.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '').split(/\n+/).filter(Boolean).at(-1) ?? ''; // consecutive user turns are merged; answer the newest
  const name = /Your name is "([^"]+)"/.exec(sys)?.[1] ?? (/^You are NEXUS/.test(sys) ? 'NEXUS' : '?');
  const scripted = /introduce yourself/i.test(lastUser) ? { head: { expression: 'happy', gesture: null }, text: `Hi! I'm ${name}, your robot companion.`, meta: {} }
    : /more casual/i.test(lastUser) ? { head: { expression: 'playful', gesture: null }, text: 'Here is a more casual wave — preview it, and approve it if you like it.', meta: { skillProposal: { format: 'generator', spec: { id: 'casual_wave', name: 'Casual wave', description: 'A relaxed, smaller wave.', motifs: [{ motif: 'wave', side: 'right', intensity: 0.6, duration: 1.6, repeats: 2 }] } } } }
    : /^please wave/i.test(lastUser) ? { head: { expression: 'happy', gesture: 'wave' }, text: 'Waving hello!', meta: { actions: [{ type: 'skill', skillId: 'wave', timing: 'with_speech' }] } }
    : null;
  if (scripted) {
    send(`HEAD ${JSON.stringify({ pose: 'neutral', speakingStyle: 'warm', emotionIntensity: 0.8, ...scripted.head })}\n`);
    for (const w of scripted.text.split(' ')) { await new Promise((r) => setTimeout(r, 30)); send(`${w} `); }
    if (Object.keys(scripted.meta).length) send(`\n<<<META>>>\n${JSON.stringify(scripted.meta)}`);
    res.write('data: [DONE]\n\n'); return res.end();
  }
  send('HEAD {"expression":"curious","gesture":"nod","pose":"neutral","speakingStyle":"calm","emotionIntensity":0.7}\n');
  for (const w of words) { await new Promise((r) => setTimeout(r, 120)); send(w); }
  send('\n<<<META>>>\n{"citations":[1],"uncertainty":"low","memoryCandidates":[{"text":"User is curious about biology","category":"fact","explicit":false,"reason":"topic interest"}]}');
  res.write('data: [DONE]\n\n'); res.end();
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const LLM_PORT = 8798;
const llmServer = spawn(process.execPath, ['dist-server/index.js', '--serve-dist'], { env: { ...process.env, PORT: String(LLM_PORT), LLM_PROVIDER: 'openai', OPENAI_BASE_URL: `${MOCK}/v1`, OPENAI_API_KEY: 'sk-e2e-mock-key-000000', TTS_PROVIDER: 'openai', TTS_MODEL: 'mock-tts', TTS_VOICE: 'mock-voice', STT_PROVIDER: 'openai', STT_MODEL: 'mock-stt', OPENAI_MODEL: 'mock-llm', RESEARCH_PROVIDER: 'wikipedia', WIKIPEDIA_BASE_URL: MOCK, ALLOW_RUNTIME_CONFIG: 'false', LOG_REQUESTS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { llmServer.stdout.on('data', (d) => String(d).includes('listening') && res()); setTimeout(() => rej(new Error('llm server start timeout')), 30000); });

const PORT = 8799; const ORIGIN = `http://127.0.0.1:${PORT}`; const URL = `${ORIGIN}/app`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); };
const rc = 'test-results/e2e-runtime-config.json'; rmSync(rc, { force: true });
const server = spawn(process.execPath, ['dist-server/index.js', '--serve-dist'], { env: { ...process.env, PORT: String(PORT), LLM_PROVIDER: 'demo', RUNTIME_CONFIG_PATH: rc, LOG_REQUESTS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('listening') && res()); server.on('exit', (c) => rej(new Error(`server exited ${c}`))); setTimeout(() => rej(new Error('server start timeout')), 30000); });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
const N = (fn, arg) => page.evaluate(fn, arg);
const idle = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await N(() => ({ st: nexus.companion.sm.state, b: nexus.companion.getSnapshot().busy })); if ((s.st === 'idle' || s.st === 'error') && !s.b) return s.st; await page.waitForTimeout(100); } return 'timeout'; };
const send = async (t) => { const box = page.locator('#composer'); await box.fill(t); await box.press('Enter'); await page.waitForTimeout(150); return idle(); };
const lastAssistant = () => page.locator('.msg.assistant').last();

try {
  // ---- first-run setup wizard (fresh profile) ----
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const fw = await fresh.newPage();
  await fw.goto(URL, { waitUntil: 'networkidle' }); await fw.waitForTimeout(400);
  const wiz = fw.getByRole('dialog', { name: /set up your robot/ });
  const wizShown = await wiz.isVisible();
  await wiz.getByLabel('What should your robot be called?').fill('Pixel'); await wiz.getByRole('button', { name: 'Next' }).click(); await fw.waitForTimeout(250);
  await fw.getByRole('radio', { name: /Free AI on this computer/ }).check(); await fw.waitForTimeout(600);
  const ollamaNote = await fw.locator('.brain-detail [role=status]').textContent();
  await fw.getByRole('radio', { name: /Demo brain/ }).check(); await fw.getByRole('button', { name: 'Next' }).click(); await fw.waitForTimeout(250);
  await fw.getByLabel('Theme').selectOption('light'); await fw.getByRole('button', { name: 'Start chatting' }).click(); await fw.waitForTimeout(300);
  const after = await fw.evaluate(() => ({ name: document.querySelector('[data-testid=robot-name]').textContent, theme: document.documentElement.dataset.theme, done: nexus.memory.settings.setupDone, open: !!document.querySelector('dialog[open]') }));
  await fw.reload({ waitUntil: 'networkidle' }); await fw.waitForTimeout(400);
  const reopened = await fw.evaluate(() => !!document.querySelector('dialog.setup[open]'));
  check('[A114] first-run setup: shown once on a fresh profile; name, brain and theme are applied; not shown again', wizShown && after.name === 'Pixel' && after.theme === 'light' && after.done && !after.open && !reopened, JSON.stringify(after));
  check('[A114] setup reports the real Ollama status (not installed here) instead of pretending', /not running/i.test(ollamaNote ?? ''), ollamaNote);
  await fresh.close();

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[role="img"]');
  await N(() => nexus.memory.updateSettings({ setupDone: true }));
  await N(() => nexus.memory.updateSettings({ greeted: true, voiceOutput: false, setupDone: true, layout: 'workspace' }));
  // A85 workspace
  check('[A85] workspace: robot, conversation, composer and body controls are present', await page.locator('.stage svg[role=img]').count() === 1 && await page.locator('#composer').count() === 1 && await page.getByRole('toolbar', { name: 'Body controls' }).count() === 1);
  check('[A01] [A98] journey: app opens and the 2D robot renders', await page.locator('[data-part="face"]').count() === 1);
  check('[A49] capability chip shows the demo brain honestly', (await page.locator('.top .badge').first().textContent()).toLowerCase().includes('not an llm'));

  // journey: send a message, receive a response, gestures + expression
  const started = []; await page.exposeFunction('__s', (id) => started.push(id)); await N(() => nexus.engine.on('start', (e) => window.__s(e.skillId)));
  let st = await send('wave then nod');
  check('[A98] journey: send a message and receive a response', st === 'idle' && (await lastAssistant().locator('.bubble').textContent()).includes('wave'));
  check('[A07] [A25] response triggers coordinated body movements', started.includes('wave') && started.includes('nod'), started.join(','));
  check('[A86] history shows timestamps and status metadata', await page.locator('.msg.assistant time').count() > 0 && (await lastAssistant().locator('.msg-meta').textContent()).includes('demo brain'));
  check('[A74] freshness label distinguishes model knowledge from retrieved sources', (await lastAssistant().locator('.fresh').textContent()).includes('background knowledge'));

  // journey: change an expression
  const ex = await N(() => { nexus.companion.showExpression('surprised'); nexus.step(0.5); return nexus.expressions.current(); });
  check('[A98] journey: change an expression', ex === 'surprised');
  const eyeH = await N(() => { nexus.step(0.3); return Number(document.querySelector('.stage [data-part="eye-L"] > rect:not([data-part])').getAttribute('height')); });
  check('[A04] facial components update in the DOM', eyeH > 40, `eye height ${eyeH}`);

  // journey: interrupt a response (slow server)
  await page.route('**/api/chat', async (route) => { await new Promise((r) => setTimeout(r, 2500)); try { await route.continue(); } catch { /* aborted */ } });
  await page.locator('#composer').fill('hello there'); await page.locator('#composer').press('Enter');
  await page.waitForSelector('.msg.assistant.ms-sending');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(300);
  check('[A46] [A98] journey: interrupt a response — marked cancelled, never complete', await lastAssistant().evaluate((e) => e.classList.contains('ms-cancelled')));
  await page.unroute('**/api/chat');
  await page.waitForTimeout(2600);
  check('[A46] cancelled result does not appear later', await lastAssistant().evaluate((e) => e.classList.contains('ms-cancelled')));

  // journey: recover from errors (provider failure → explanation + retry)
  await page.route('**/api/chat', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'The AI provider returned 503: overloaded', code: 'provider', retryable: true }) }));
  await send('hello again');
  const errCard = await lastAssistant().locator('.card.error').textContent();
  const face = await N(() => nexus.expressions.current());
  check('[A35] [A47] failure shows an explanation, the error face and a retry button', errCard.includes('overloaded') && face === 'error' && await lastAssistant().getByRole('button', { name: 'Retry', exact: true }).count() === 1);
  await page.unroute('**/api/chat');
  await lastAssistant().getByRole('button', { name: 'Retry', exact: true }).click(); await idle();
  check('[A98] journey: recover from an error via retry', await lastAssistant().evaluate((e) => e.classList.contains('ms-complete')));

  // journey: save a skill (propose → preview → approve)
  await send('Invent a new greeting');
  check('[A63] proposal card appears for an invented motion', await page.locator('.card.proposal').last().isVisible());
  await page.locator('.card.proposal').last().getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForTimeout(600);
  check('[A67] preview shows the sandbox robot with parameters and validation', await page.locator('.card.preview svg[role=img]').count() === 1 && (await page.locator('.card.preview').textContent()).includes('passed validation'));
  const pid = await N(() => nexus.companion.getSnapshot().preview.id);
  check('[A118] while previewing, the stage says so and the proposal is labelled "awaiting approval"', /previewing/.test(await page.getByTestId('previewing').textContent().catch(() => '')) && /awaiting approval/.test(await page.locator('.card.preview .badge').first().textContent()));
  await page.locator('.card.preview').getByRole('button', { name: 'Approve' }).click(); await page.waitForTimeout(400);
  check('[A68] [A98] journey: save a skill (approved & reusable)', await N((id) => !!nexus.registry.get(id), pid), pid);
  const playName = `Play ${await N((id) => nexus.registry.get(id).name, pid)}`; console.log('   play button:', await page.getByRole('button', { name: playName }).count());
  await page.getByRole('button', { name: playName }).click();
  for (let i = 0; i < 40 && !started.includes(pid); i++) await page.waitForTimeout(100); // may queue behind the higher-priority celebration
  check('[A39] approved skill plays on demand from the library', started.includes(pid));
  {
    const row = page.locator('li.skill').filter({ has: page.getByRole('button', { name: playName }) });
    await row.locator('button.name').click();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const ask = row.getByRole('alertdialog');
    const asked = await ask.isVisible() && /Other skills are not affected/.test(await ask.textContent());
    await ask.getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(150);
    check('[A118] deleting a skill asks in the app (no browser pop-up); "Keep it" leaves the skill in place', asked && await N((id) => !!nexus.registry.get(id), pid));
    await row.locator('button.name').click();
    const ttsOk = await N(() => nexus.companion.tts.supported);
    const readBtn = await lastAssistant().getByRole('button', { name: 'read aloud', exact: true }).count();
    check('[A118] each finished reply has a "read aloud" control when speech voices exist (hidden when they do not)', ttsOk ? readBtn === 1 : readBtn === 0, `tts ${ttsOk}, button ${readBtn}`);
  }

  // journey: inspect memory (explicit request saved; shown with why/when)
  await send('remember that my favourite colour is teal');
  await page.getByRole('tab', { name: 'Memory' }).click();
  const memText = await page.locator('.mem-list').first().textContent();
  check('[A55] [A98] journey: inspect memory — item listed with why and when', memText.includes('favourite colour is teal') && memText.includes('Why:'));
  await page.locator('.mem-list li').first().getByRole('button', { name: 'delete' }).click(); await page.waitForTimeout(200);
  check('[A56] delete removes the memory from storage', await N(() => nexus.memory.active().length) === 0);

  // settings change real behaviour
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.locator('[data-testid=ollama-install]').first().waitFor({ timeout: 5000 }).catch(() => {});
  const inst = await page.locator('[data-testid=ollama-install]').first().textContent().catch(() => '');
  check('[A117] Settings offers the in-app Ollama setup and honestly says Ollama is not installed here (no script needed)', /ollama\.com\/download/.test(inst ?? '') && !/\.bat|setup-offline-ai/.test(await page.locator('.card.ollama').textContent()), inst);
  await page.getByLabel('High contrast').check(); await page.getByLabel('Larger text').check();
  check('[A87] [A88] settings change behaviour: high contrast & larger text applied', await page.locator('.app.hc.lt').count() === 1);
  await page.getByLabel(/Quiet mode/).check();
  check('[A87] [A89] quiet mode persists and is applied', await N(() => nexus.memory.settings.quietMode && !nexus.expressions.allowPlayful));
  await page.getByLabel('Environment').selectOption('transparent');
  check('[A09] [A87] environment setting changes the stage', await page.locator('.stage svg [data-part="env"]').count() === 0);
  await page.getByLabel('High contrast').uncheck(); await page.getByLabel('Larger text').uncheck(); await page.getByLabel(/Quiet mode/).uncheck();

  // keyboard accessibility
  await page.locator('#composer').focus(); await page.keyboard.type('nod'); await page.keyboard.press('Enter'); await idle();
  check('[A88] keyboard: Enter sends from the composer', (await lastAssistant().locator('.bubble').textContent()).includes('nod'));
  await page.keyboard.press('Shift+Tab'); const focused = await N(() => document.activeElement?.tagName);
  const unlabeled = await N(() => [...document.querySelectorAll('button, input, select, textarea')].filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim() || el.closest('label') || el.id && document.querySelector(`label[for="${el.id}"]`) || el.type === 'file')).length);
  check('[A88] focus moves with the keyboard and every control has an accessible name', !!focused && unlabeled === 0, `unlabeled: ${unlabeled}`);

  // status / model panel
  await page.getByRole('tab', { name: 'Status' }).click();
  check('[A10] [A49] status panel lists capabilities and all 121 assets', (await page.locator('.assets tbody tr').count()) === 121 && (await page.locator('.caps li').count()) >= 8);

  // reduced motion preference from the OS
  const rmPage = await ctx.newPage(); await rmPage.emulateMedia({ reducedMotion: 'reduce' }); await rmPage.goto(URL, { waitUntil: 'networkidle' }); await rmPage.waitForTimeout(800);
  check('[A88] [A99] OS reduced-motion preference turns on reduced motion', await rmPage.evaluate(() => nexus.memory.settings.reducedMotion && nexus.engine.reducedMotion));
  await rmPage.evaluate(() => nexus.memory.updateSettings({ reducedMotion: false })); await rmPage.close();

  // responsive layout
  const mobile = await browser.newPage({ viewport: { width: 375, height: 760 } }); await mobile.goto(URL, { waitUntil: 'networkidle' }); await mobile.evaluate(() => nexus.memory.updateSettings({ setupDone: true, layout: 'workspace' })); await mobile.waitForTimeout(600);
  const ratio = (p) => p.evaluate(() => { const r = document.querySelector('.stage [data-part="torso"]').getBoundingClientRect(); const h = document.querySelector('.stage [data-part="head"]').getBoundingClientRect(); return { torso: r.width / r.height, head: h.width / h.height }; });
  const desk = await ratio(page);
  const m = await mobile.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, composer: (document.querySelector('#composer')?.getBoundingClientRect().width ?? 0) > 200 }));
  const mr = await ratio(mobile);
  check('[A90] mobile width: no horizontal scroll, robot keeps its proportions, composer usable', m.overflow <= 1 && Math.abs(mr.torso - desk.torso) < 0.05 && Math.abs(mr.head - desk.head) < 0.12 && m.composer, JSON.stringify({ overflow: m.overflow, desk, mobile: mr }));
  await mobile.screenshot({ path: 'test-results/e2e-mobile.png' }); await mobile.close();
  const tablet = await browser.newPage({ viewport: { width: 820, height: 1100 } }); await tablet.goto(URL, { waitUntil: 'networkidle' });
  check('[A90] tablet width: no horizontal scroll', await tablet.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1); await tablet.close();
  // Laptop screens: browser viewports on 13–15" laptops (with browser chrome) and full-height app windows.
  const LAPTOPS = [[1366, 657], [1366, 768], [1280, 689], [1280, 800], [1440, 789], [1536, 730], [1024, 640]];
  const lap = [];
  for (const [w, h] of LAPTOPS) {
    const lp = await browser.newPage({ viewport: { width: w, height: h } }); await lp.goto(URL, { waitUntil: 'networkidle' }); await lp.evaluate(() => nexus.memory.updateSettings({ setupDone: true, layout: 'workspace' })); await lp.waitForTimeout(300);
    const r = await lp.evaluate(() => {
      const b = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const robot = document.querySelector('.stage svg[role=img]').getBoundingClientRect(), msgs = b('.messages'), comp = b('#composer'), send = [...document.querySelectorAll('.composer button')].find((x) => x.textContent === 'Send').getBoundingClientRect();
      const inView = (x) => x.top >= 0 && x.bottom <= innerHeight + 0.5 && x.left >= 0 && x.right <= innerWidth + 0.5;
      return { overflowX: document.documentElement.scrollWidth - innerWidth, overflowY: document.documentElement.scrollHeight - innerHeight, robotH: robot.height, robotW: robot.width, msgsH: msgs.height, composer: inView(comp) && inView(send), side: !!document.querySelector('.side'), drawer: !!document.querySelector('.side.drawer') };
    });
    lap.push({ w, h, ...r });
    if (w === 1366 && h === 657) await lp.screenshot({ path: 'test-results/e2e-laptop-1366x657.png' });
    if (w === 1024) {
      await lp.keyboard.press('Alt+3'); await lp.waitForTimeout(200);
      r.drawerOpens = await lp.evaluate(() => !!document.querySelector('.side.drawer') && document.querySelector('[role=tab][aria-selected=true]').textContent.startsWith('Memory'));
      await lp.keyboard.press('Escape'); await lp.waitForTimeout(100);
      r.drawerCloses = await lp.evaluate(() => !document.querySelector('.side'));
      lap[lap.length - 1] = { ...lap[lap.length - 1], drawerOpens: r.drawerOpens, drawerCloses: r.drawerCloses };
    }
    await lp.close();
  }
  const fits = lap.every((l) => l.overflowX <= 1 && l.overflowY <= 1 && l.composer && l.robotH >= 380 && l.msgsH >= 300);
  check('[A90] laptop screens (1024–1536 wide, 640–800 tall): robot, chat and composer visible together, no page scroll', fits, lap.filter((l) => !(l.overflowX <= 1 && l.overflowY <= 1 && l.composer && l.robotH >= 380 && l.msgsH >= 300)).map((l) => JSON.stringify(l)).join(' ') || lap.map((l) => `${l.w}x${l.h}: robot ${Math.round(l.robotH)}px chat ${Math.round(l.msgsH)}px`).join('; '));
  check('[A90] ≥1280 px shows the side panel beside the chat; narrower laptops use a drawer', lap.filter((l) => l.w >= 1280).every((l) => l.side && !l.drawer) && lap.filter((l) => l.w < 1280).every((l) => !l.side));
  const small = lap.find((l) => l.w === 1024);
  check('[A88] [A90] keyboard: Alt+3 opens the Memory drawer, Esc closes it', small.drawerOpens && small.drawerCloses);

  // performance & compatibility
  await page.waitForTimeout(1500);
  // power saving: count frames per second while calm vs. while a motion plays
  const fps = await N(async () => {
    const count = async (ms) => { const f0 = nexus.runtime.frames; await new Promise((r) => setTimeout(r, ms)); return (nexus.runtime.frames - f0) * 1000 / ms; };
    await nexus.memory.updateSettings({ ambientBehaviours: false }); nexus.engine.stopAll(); await new Promise((r) => setTimeout(r, 1500));
    let calm = Infinity; for (let i = 0; i < 3; i++) calm = Math.min(calm, await count(1000)); // best calm second (gaze saccades briefly go to full rate)
    void nexus.companion.playSkill('wave'); await new Promise((r) => setTimeout(r, 150));
    const busy = await count(900);
    await nexus.memory.updateSettings({ ambientBehaviours: true });
    return { calm, busy };
  });
  check('[A99] [A115] power saving: the robot renders at a low frame rate when calm and full rate while moving', fps.calm <= fps.busy * 0.5 && fps.busy >= 40, `calm ${fps.calm.toFixed(0)} fps · moving ${fps.busy.toFixed(0)} fps`);
  const perf = await N(() => nexus.runtime.stats());
  check('[A99] animation frame work stays small (avg < 4 ms, one loop)', perf.avgFrameMs < 4 && perf.frames > 30, `avg ${perf.avgFrameMs.toFixed(2)}ms max ${perf.maxFrameMs.toFixed(2)}ms`);
  const hiddenStops = await N(async () => { const f0 = nexus.runtime.frames; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); await new Promise((r) => setTimeout(r, 400)); const f1 = nexus.runtime.frames; Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); return f1 - f0 <= 1; });
  check('[A99] rendering pauses while the tab is hidden', hiddenStops);
  const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js')).reduce((n, f) => n + statSync(`dist/assets/${f}`).size, 0);
  check('[A99] bundle size is modest (< 900 KB of JS before gzip)', js < 900_000, `${Math.round(js / 1024)} KB`);
  const bundle = readdirSync('dist/assets').filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
  // env-var NAMES may appear in help text; secret VALUES, auth-header code or .env contents must not
  const leaks = ['x-api-key', 'Bearer ', 'authorization', 'replace-me', 'process.env'].filter((k) => bundle.toLowerCase().includes(k.toLowerCase()));
  check('[A42] no secret values, auth-header code or env access in the shipped bundle', leaks.length === 0 && !/\bsk-[A-Za-z0-9]{16,}/.test(bundle), leaks.join(','));

  // LLM path in the browser: streaming, research sources, citations, consent (mock provider)
  const llm = await ctx.newPage();
  await llm.goto(`http://127.0.0.1:${LLM_PORT}/app`, { waitUntil: 'networkidle' }); await llm.waitForTimeout(500);
  await llm.evaluate(() => nexus.memory.updateSettings({ greeted: true, research: true, setupDone: true, layout: 'workspace', voiceOutput: false }));
  const chip = await llm.locator('.top .badge').first().textContent();
  check('[A41] [A49] UI reports the configured LLM (model name), not the demo', chip.includes('mock-llm'), chip);
  await llm.locator('#composer').fill('What is photosynthesis?'); await llm.locator('#composer').press('Enter');
  let sawPartial = false, sawStreamingClass = false;
  for (let i = 0; i < 60; i++) {
    const st = await llm.evaluate(() => { const m = nexus.companion.getSnapshot().messages.at(-1); return { status: m?.status, text: m?.text ?? '' }; });
    if (st.status === 'streaming') { sawStreamingClass = true; if (st.text.includes('plants') && !st.text.includes('chloroplasts')) sawPartial = true; }
    if (st.status === 'complete') break;
    await llm.waitForTimeout(80);
  }
  check('[A43] [A98] streamed text appears incrementally in the browser before completion', sawStreamingClass && sawPartial);
  await llm.waitForSelector('.msg.assistant.ms-complete');
  const src = await llm.locator('.msg.assistant').last().locator('.sources').textContent();
  check('[A72] [A73] research sources shown with title, provider and retrieval time; cited source marked', src.includes('Photosynthesis') && src.includes('wikipedia') && src.includes('retrieved') && src.includes('cited'));
  check('[A74] freshness label says the answer uses retrieved sources', (await llm.locator('.msg.assistant').last().locator('.fresh').textContent()).includes('source(s) retrieved'));
  check('[A53] model-suggested memory waits for consent in the UI', await llm.getByRole('group', { name: 'Memory suggestion' }).count() === 1 && await llm.evaluate(() => nexus.memory.active().length === 0));
  check('[A80] "What changed?" disclosure available on the reply', await llm.locator('.msg.assistant').last().getByRole('button', { name: /What changed/ }).count() === 1);
  const exprNow = await llm.evaluate(() => ({ cur: nexus.expressions.current(), req: nexus.expressions.requests.map((r) => `${r.source}:${r.id}:${r.priority}`) }));
  check('[A14] expression from the model head applied (curious), not thinking, after reply', exprNow.cur === 'curious', JSON.stringify(exprNow));
  check('[A42] the provider key never reaches the browser', !(await llm.evaluate(() => document.documentElement.outerHTML + JSON.stringify(nexus.companion.getSnapshot()))).includes('sk-e2e-mock-key'));
  const md = await llm.locator('.msg.assistant').last().evaluate((e) => ({ strong: e.querySelector('.bubble strong')?.textContent, code: e.querySelector('.bubble code')?.textContent, raw: e.querySelector('.bubble').textContent }));
  check('[A106] model replies render Markdown safely (bold, inline code) without raw markers', md.strong === 'Photosynthesis' && md.code === 'chloroplasts' && !md.raw.includes('**') && !md.raw.includes('`'), JSON.stringify(md));
  check('[A113] a model on this computer (the mock LLM runs on 127.0.0.1) gets the compact prompt, and the reply says so', (await llm.locator('.msg.assistant').last().locator('.msg-meta').textContent()).includes('compact prompt'));
  await llm.close();

  // ================= THE REQUIRED END-TO-END USER JOURNEY (spec §23) — real server, mock OpenAI-compatible provider =================
  const LLM = `http://127.0.0.1:${LLM_PORT}`;
  const jp = await ctx.newPage(); const jErrors = []; jp.on('pageerror', (e) => jErrors.push(e.message));
  const J = (fn, arg) => jp.evaluate(fn, arg);
  const jIdle = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const st = await J(() => ({ s: nexus.companion.sm.state, b: nexus.companion.getSnapshot().busy })); if ((st.s === 'idle' || st.s === 'error') && !st.b) return st.s; await jp.waitForTimeout(100); } return 'timeout'; };
  const jSend = async (t) => { await jp.locator('#composer').fill(t); await jp.locator('#composer').press('Enter'); await jp.waitForTimeout(150); return jIdle(); };
  const jLast = () => jp.locator('.msg.assistant').last();
  const steps = {};
  await jp.goto(`${LLM}/`, { waitUntil: 'networkidle' }); await jp.waitForTimeout(500);                                     // 1
  steps.s2_identity = await jp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(8, 11, 18)';  // 2 (dark palette)
  steps.s3_robot = await jp.locator('.hero svg[role=img] [data-part="face"]').count() === 1;                                  // 3
  await jp.getByRole('link', { name: /^Meet / }).first().click(); await jp.waitForSelector('#composer');                      // 4–5
  await J(() => nexus.memory.updateSettings({ setupDone: true, greeted: true, layout: 'workspace', voiceOutput: false }));
  steps.s6_name = (await jp.getByTestId('robot-name').textContent()) === 'NEXUS';                                              // 6
  await jp.getByRole('button', { name: /^Rename/ }).click(); await jp.getByLabel('Name', { exact: true }).fill('Nova'); await jp.getByLabel('Name', { exact: true }).press('Enter'); await jp.waitForTimeout(300); // 7–9
  steps.s10_header = (await jp.getByTestId('robot-name').textContent()) === 'Nova' && (await jp.locator('.top .brand').textContent()) === 'NEXUS';  // 10
  await jSend('Please introduce yourself');                                                                                    // 11–13
  steps.s11_intro_from_llm = (await jLast().locator('.bubble').textContent()).includes("I'm Nova") && (await jLast().locator('.msg-meta').textContent()).includes('LLM · mock-llm');
  steps.s13_connected = (await jp.getByTestId('ai-chip').textContent()).includes('connected');
  steps.s14_expression = await J(() => nexus.expressions.current()) === 'happy';                                              // 14
  const startedJ = []; await J(() => { window.__started = []; nexus.engine.on('start', (e) => window.__started.push(e.skillId)); });
  await jSend('Please wave');                                                                                                  // 15–16
  await jp.waitForTimeout(300); steps.s16_wave = (await J(() => window.__started)).includes('wave'); void startedJ;
  await jSend('Make the wave more casual');                                                                                    // 17–18
  const prop = jp.locator('.card.proposal').last();
  steps.s19_validated = await prop.isVisible() && /proposed/.test(await prop.textContent()) && await J(() => nexus.registry.getRecord('casual_wave')?.versions.at(-1)?.report?.ok !== false);
  await prop.getByRole('button', { name: /Preview/ }).click(); await jp.waitForTimeout(400);                                   // 20
  steps.s20_preview = await jp.locator('.card.preview svg[role=img]').count() === 1 && (await jp.locator('.card.preview').textContent()).includes('passed validation');
  await prop.getByRole('button', { name: 'Approve' }).click(); await jp.waitForTimeout(400);                                   // 21–22
  steps.s22_saved = await J(() => { const r = nexus.registry.getRecord('casual_wave'); return !!r && r.versions.some((v) => v.status === 'approved'); });
  await J(() => { void nexus.companion.playSkill('casual_wave'); });
  // it may queue behind the short "celebrate" reaction to the approval, so wait for it to actually start
  await jp.waitForFunction(() => window.__started.includes('casual_wave'), null, { timeout: 6000 }).catch(() => {});
  const playing = await J(() => window.__started.includes('casual_wave') && nexus.engine.active().some((a) => a.skillId === 'casual_wave' && !a.preview));
  await jp.getByRole('button', { name: /Stop action/ }).click(); await jp.waitForTimeout(500);                                 // 23
  await jp.getByRole('button', { name: /Reset character/ }).click(); await jp.waitForTimeout(700);                             // 24
  const afterReset = await J(() => ({ active: nexus.engine.active().filter((a) => !a.preview && a.phase !== 'out').map((a) => a.skillId), pose: nexus.engine.getPose() }));
  steps.s23_24_stop_reset = playing && afterReset.active.length === 0 && afterReset.pose === 'neutral';
  if (!steps.s23_24_stop_reset) steps.debug_reset = { playing, ...afterReset };
  const userTurns = await jp.locator('.msg.user').count();
  await jp.reload({ waitUntil: 'networkidle' }); await jp.waitForTimeout(800);                                                 // 25
  steps.s26_persist = (await jp.getByTestId('robot-name').textContent()) === 'Nova' && await J(() => nexus.memory.settings.setupDone);
  steps.s27_skill_kept = await J(() => nexus.registry.getRecord('casual_wave')?.versions.some((v) => v.status === 'approved') === true);
  steps.s28_conversation = await jp.locator('.msg.user').count() === userTurns;                                               // 28
  await fetch(`${MOCK}/mock/fail?on=1`);                                                                                       // 29
  await jSend('Please introduce yourself');
  const failCard = await jLast().locator('.card.error').textContent().catch(() => '');
  steps.s29_honest_failure = /mock provider is down|AI provider|503|unavailable|error/i.test(failCard) && await jLast().evaluate((e) => e.classList.contains('ms-failed')) && !(await jLast().locator('.bubble').textContent()).includes("I'm Nova") && (await jp.getByTestId('ai-chip').textContent()).includes('last request failed');
  // a user-requested move after an error may queue behind the short error reaction; wait until it really starts
  await J(() => { window.__started = []; nexus.engine.on('start', (e) => window.__started.push(e.skillId)); void nexus.companion.playSkill('nod'); });
  await jp.waitForFunction(() => window.__started.includes('nod'), null, { timeout: 6000 }).catch(() => {});
  const nodOk = await J(() => window.__started.includes('nod'));
  await jSend('set a timer for 5 minutes');
  const lastMeta = await jLast().locator('.msg-meta').textContent();
  const pend = await J(() => nexus.reminders.pending().length);
  steps.s30_local_features = nodOk && lastMeta.includes('handled on this device') && pend >= 1;
  if (!steps.s30_local_features) steps.debug_local = { nodOk, lastMeta, pend, ...(await J(() => ({ log: window.__log, active: nexus.engine.active().map((a) => `${a.skillId}:${a.phase}`), queue: nexus.engine.queue.map((a) => a.skill.id), state: nexus.companion.sm.state }))) };
  await fetch(`${MOCK}/mock/fail?on=0`);
  const failedSteps = Object.entries(steps).filter(([, v]) => !v).map(([k]) => k);
  check('[A116] [A98] the required 30-step user journey passes end to end (home → rename → LLM intro uses the new name → wave → refine → preview → approve → stop/reset → reload → honest provider failure → local features)', failedSteps.length === 0 && jErrors.length === 0, failedSteps.length ? `failed: ${failedSteps.join(', ')}` : `${Object.keys(steps).length} step groups ok`);
  writeFileSync('test-results/journey.json', JSON.stringify(steps, null, 2));
  await jp.screenshot({ path: 'test-results/e2e-journey.png' });
  await jp.close();

  // persistence across sessions
  const usersBeforeReload = await page.locator('.msg.user').count();
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  check('[A107] the conversation is restored after a reload', usersBeforeReload > 0 && await page.locator('.msg.user').count() === usersBeforeReload, `${usersBeforeReload} user messages`);
  check('[A61] [A98] approved skill remains available after reload', await N((id) => !!nexus.registry.get(id), pid));

  // ---------------- v3: website, routing, identity & personalization ----------------
  const msgsBeforeRename = await page.locator('.msg').count();
  await page.getByRole('button', { name: 'Rename NEXUS' }).click();
  const dlg = page.getByRole('dialog', { name: 'Give your robot a name' });
  const nameBox = dlg.getByLabel('Name', { exact: true });
  check('[A103] rename dialog opens with the current name and focus in the field', await dlg.isVisible() && await nameBox.inputValue() === 'NEXUS' && await N(() => document.activeElement?.id) === 'robot-name-input');
  await nameBox.fill('   '); await dlg.getByRole('button', { name: 'Save name' }).click({ force: true });
  const emptyErr = await dlg.getByRole('alert').textContent().catch(() => '');
  await nameBox.fill('x'.repeat(33)); await page.waitForTimeout(50);
  const longErr = await dlg.getByRole('alert').textContent().catch(() => '');
  check('[A103] empty and over-long names are rejected inline with a reason', /empty/.test(emptyErr) && /limit is 32/.test(longErr), `${emptyErr} | ${longErr}`);
  await nameBox.fill('Nova 🤖'); await page.waitForTimeout(50);
  const previewOk = (await dlg.locator('.preview-greeting').textContent()).includes('Nova 🤖');
  await dlg.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(100);
  check('[A103] live preview, and Cancel keeps the old name and returns focus to the pencil', previewOk && !(await dlg.isVisible()) && (await page.getByTestId('robot-name').textContent()) === 'NEXUS' && await N(() => document.activeElement?.getAttribute('aria-label')) === 'Rename NEXUS');
  await page.getByRole('button', { name: 'Rename NEXUS' }).click(); await nameBox.fill('Nova'); await nameBox.press('Escape'); await page.waitForTimeout(100);
  const escClosed = !(await dlg.isVisible()) && (await page.getByTestId('robot-name').textContent()) === 'NEXUS';
  await page.getByRole('button', { name: 'Rename NEXUS' }).click(); await nameBox.fill('  Nova  '); await nameBox.press('Enter'); await page.waitForTimeout(300);
  const ws = await N(() => ({ name: document.querySelector('[data-testid=robot-name]').textContent, brand: document.querySelector('.top .brand').textContent, title: document.title, ph: document.querySelector('#composer').placeholder, stage: document.querySelector('.stage').getAttribute('aria-label'), stored: nexus.memory.settings.robotName }));
  check('[A103] Esc cancels; Save trims and applies the name in header, title, placeholder and labels — brand stays NEXUS', escClosed && ws.name === 'Nova' && ws.stored === 'Nova' && ws.brand === 'NEXUS' && ws.title.startsWith('Nova') && ws.ph.startsWith('Message Nova') && ws.stage.startsWith('Nova'), JSON.stringify(ws));
  await send('hello');
  check('[A103] the robot introduces itself with the new name', (await lastAssistant().locator('.bubble').textContent()).includes("I'm Nova"));
  check('[A103] rename kept the conversation and approved skills', (await page.locator('.msg').count()) >= msgsBeforeRename + 2 && await N((id) => !!nexus.registry.get(id), pid));
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  check('[A103] the new name persists after reload', (await page.getByTestId('robot-name').textContent()) === 'Nova');

  // personalization
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Resting face').selectOption('happy'); await page.waitForTimeout(150);
  await page.getByLabel('Idle liveliness').selectOption('lively'); await page.waitForTimeout(150);
  const pz = await N(() => ({ base: nexus.expressions.baseline, idle: nexus.engine.idleScale }));
  check('[A104] personalization controls change the engine (resting face, idle liveliness)', pz.base === 'happy' && pz.idle === 1.6, JSON.stringify(pz));

  // landing page (same browser profile → same saved name)
  const home = await ctx.newPage(); const homeErrors = []; home.on('pageerror', (e) => homeErrors.push(e.message));
  await home.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' }); await home.waitForTimeout(700);
  const hero = await home.evaluate(() => ({ h1: document.querySelector('h1')?.textContent, robots: document.querySelectorAll('.hero svg[role=img] [data-part="face"]').length, pill: document.querySelector('.status-pill')?.textContent ?? '', cta: [...document.querySelectorAll('.hero a')].map((a) => a.textContent), lead: document.querySelector('.lead')?.textContent ?? '' }));
  check('[A101] landing: headline, the real robot rig, live status from /api/status, and the custom name', /digital companion/.test(hero.h1) && hero.robots === 1 && /Demo brain — not an LLM/.test(hero.pill) && hero.cta.includes('Meet Nova') && hero.lead.includes('Nova is your NEXUS robot'), JSON.stringify(hero));
  await home.getByRole('button', { name: 'Wave' }).click(); await home.waitForTimeout(400);
  check('[A101] personality preview plays a real motion', (await home.getByRole('status').filter({ hasText: 'Now showing' }).textContent().catch(() => '')).includes('Wave'));
  await home.getByRole('link', { name: 'Explore features' }).click(); await home.waitForTimeout(600);
  check('[A102] "Explore features" scrolls to the features section and moves focus there', await home.evaluate(() => document.activeElement?.id === 'features' && document.getElementById('features').getBoundingClientRect().top < 120));
  await home.evaluate(() => { window.__noReload = true; });
  await home.getByRole('link', { name: 'Meet Nova' }).click(); await home.waitForSelector('#composer');
  check('[A101] [A102] hero CTA opens the robot workspace without a page reload', home.url().endsWith('/app') && await home.evaluate(() => window.__noReload === true && !!document.querySelector('.stage svg[role=img]')));
  await home.locator('#composer').fill('wave'); await home.locator('#composer').press('Enter');
  await home.waitForFunction(() => document.querySelectorAll('.msg.assistant').length > 0 && !nexus.companion.getSnapshot().busy, null, { timeout: 15000 });
  const msgCount = await home.locator('.msg').count();
  await home.getByRole('link', { name: 'NEXUS home page' }).click(); await home.waitForSelector('.hero');
  const backHome = home.url() === `${ORIGIN}/`;
  await home.getByRole('link', { name: 'Meet Nova' }).click(); await home.waitForSelector('#composer');
  check('[A102] the workspace logo leads back home; the conversation is still there on return', backHome && await home.locator('.msg').count() === msgCount && msgCount >= 2 && await home.evaluate(() => window.__noReload === true), `msgs ${msgCount}`);

  // every internal link on the public pages resolves to a real page (no dead links)
  const links = new Set();
  for (const path of ['/', '/about', '/privacy', '/does-not-exist']) {
    await home.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' });
    for (const h of await home.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))) links.add(h);
  }
  const dead = [];
  for (const h of links) {
    if (/^https?:/.test(h)) { dead.push(`external:${h}`); continue; }
    if (h.startsWith('#')) { continue; }
    await home.goto(`${ORIGIN}${h}`, { waitUntil: 'networkidle' });
    const ok = await home.evaluate((hh) => !document.querySelector('.notfound') && (!hh.includes('#') || !!document.getElementById(hh.split('#')[1])), h);
    if (!ok) dead.push(h);
  }
  check('[A102] no dead links on the home, about, privacy and 404 pages', dead.length === 0 && links.size >= 6, `${links.size} links; dead: ${dead.join(', ')}`);
  await home.goto(`${ORIGIN}/no/such/page`, { waitUntil: 'networkidle' });
  check('[A102] unknown routes show a friendly not-found page with a way home', await home.locator('.notfound h1').textContent() === 'This page doesn’t exist' && await home.getByRole('link', { name: 'Go home' }).count() === 1);
  check('[A101] [A98] no page errors on the public pages', homeErrors.length === 0, homeErrors.slice(0, 3).join(' | '));
  await home.close();

  // responsive public pages + mobile menu
  const widths = [320, 375, 430, 768, 1024, 1280, 1440];
  const over = [];
  for (const w of widths) {
    const rp = await browser.newPage({ viewport: { width: w, height: 800 } });
    for (const path of ['/', '/about', '/privacy']) { await rp.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' }); const o = await rp.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) over.push(`${w}${path}:${o}`); }
    if (w === 375) {
      await rp.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' }); await rp.screenshot({ path: 'test-results/e2e-home-mobile.png' });
      const btn = rp.getByRole('button', { name: 'Open menu' }); const hiddenBefore = !(await rp.getByRole('navigation', { name: 'Main' }).isVisible());
      await btn.click(); const shown = await rp.getByRole('link', { name: 'Privacy' }).first().isVisible();
      await rp.keyboard.press('Escape'); const closed = !(await rp.getByRole('navigation', { name: 'Main' }).isVisible());
      check('[A102] [A88] mobile header: menu button opens the navigation, Esc closes it', hiddenBefore && shown && closed);
    }
    if (w === 1440) { await rp.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' }); await rp.waitForTimeout(900); await rp.screenshot({ path: 'test-results/e2e-home-desktop.png' }); }
    await rp.close();
  }
  check('[A101] [A90] public pages have no horizontal scroll from 320 to 1440 px', over.length === 0, over.join(' '));

  // reduced motion: the hero robot does not greet or sway
  const rmHome = await ctx.newPage(); await rmHome.emulateMedia({ reducedMotion: 'reduce' }); await rmHome.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const armSamples = [];
  for (let i = 0; i < 6; i++) { armSamples.push(await rmHome.evaluate(() => { const g = document.querySelector('.hero [data-part="arm-R"]'); const h = document.querySelector('.hero [data-part="head"]') ?? g; return `${g?.getAttribute('transform')}|${g?.style.transform}|${h?.getAttribute('transform')}`; })); await rmHome.waitForTimeout(250); }
  await rmHome.close();
  const mvHome = await ctx.newPage(); await mvHome.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const mvSamples = [];
  for (let i = 0; i < 6; i++) { mvSamples.push(await mvHome.evaluate(() => document.querySelector('.hero [data-part="arm-R"]')?.getAttribute('transform') ?? '')); await mvHome.waitForTimeout(250); }
  await mvHome.close();
  check('[A101] [A88] reduced motion: the landing robot stays still (no automatic greeting or idle sway); without it, it moves', new Set(armSamples).size === 1 && /rotate|translate/.test(armSamples[0]) && new Set(mvSamples).size > 1, `${armSamples[0]} · moving samples: ${new Set(mvSamples).size}`);

  // reset personalization (with confirmation) brings the default name back
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Reset personalization…' }).click();
  const confirmShown = await page.getByRole('alertdialog', { name: 'Confirm reset' }).isVisible();
  await page.getByRole('alertdialog', { name: 'Confirm reset' }).getByRole('button', { name: 'Reset' }).click(); await page.waitForTimeout(250);
  check('[A104] reset personalization asks first, then restores the default name and face', confirmShown && (await page.getByTestId('robot-name').textContent()) === 'NEXUS' && await N(() => nexus.expressions.baseline) === 'neutral');
  check('[A119] resetting personalization also restores the default robot view layout', await N(() => nexus.memory.settings.layout) === 'robot');
  await N(() => nexus.memory.updateSettings({ layout: 'workspace' })); await page.waitForTimeout(300);

  // ---------------- v4: conversation tools, reminders, chats, liveliness, theme, accessibility audit ----------------
  await send('Wave then nod');
  const lastReplyBefore = await lastAssistant().locator('.bubble').textContent();
  const repliesBefore = await page.locator('.msg.assistant').count();
  await lastAssistant().getByRole('button', { name: 'Regenerate reply' }).click(); await idle();
  check('[A108] regenerate asks again and replaces the last reply (no duplicate turns)', await page.locator('.msg.assistant').count() === repliesBefore && (await lastAssistant().locator('.bubble').textContent()).length > 0, lastReplyBefore.slice(0, 40));
  check('[A108] copy button on replies', await lastAssistant().getByRole('button', { name: 'Copy message' }).count() === 1);
  await page.locator('.msg.user').last().getByRole('button', { name: 'Edit your last message' }).click();
  const edited = await page.locator('#composer').inputValue();
  await page.locator('#composer').fill('clap'); await page.locator('#composer').press('Enter'); await page.waitForTimeout(150); await idle();
  check('[A108] edit puts your last message back in the box and sending replaces it', edited === 'Wave then nod' && (await page.locator('.msg.user').last().textContent()).includes('clap') && !(await page.locator('.msg.user').allTextContents()).slice(-2).some((t) => t.includes('Wave then nod')));

  // typing reaction
  await page.locator('#composer').pressSequentially('hi th', { delay: 30 });
  const typingFace = await N(() => nexus.expressions.current());
  await page.locator('#composer').fill('');
  check('[A110] while you type the robot looks attentive (listening face)', typingFace === 'listening', typingFace);
  check('[A110] ambient idle behaviours are real built-in motions', await N(() => ['look_around', 'stretch', 'antenna_wiggle'].every((id) => !!nexus.registry.get(id))));

  // reminders (on-device)
  const callsGuard = await N(() => nexus.companion.getSnapshot().messages.length);
  await send('set a timer for 5 seconds');
  const timerReply = await lastAssistant().evaluate((e) => ({ text: e.querySelector('.bubble').textContent, meta: e.querySelector('.msg-meta').textContent }));
  check('[A109] "set a timer" is handled on this device and says so', /Timer set/.test(timerReply.text) && /handled on this device · no AI/.test(timerReply.meta) && callsGuard > 0, JSON.stringify(timerReply));
  await page.getByRole('tab', { name: /Reminders/ }).click();
  const pendingShown = await page.locator('.rem-list .rem-pending').count();
  await page.waitForTimeout(6500);
  const fired = await N(() => ({ sys: [...document.querySelectorAll('.msg.system')].map((e) => e.textContent).filter((t) => t.includes('⏰')), toast: !!document.querySelector('.toast.t-reminder') }));
  check('[A109] the timer goes off: chat message, toast, and it moves to "Went off" with snooze', pendingShown === 1 && fired.sys.some((t) => t.includes('Timer finished')) && fired.toast && await page.getByRole('button', { name: /^Snooze/ }).count() >= 1, JSON.stringify(fired));
  await page.locator('#rem-input').fill('in 2 hours to stretch'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await idle();
  check('[A109] reminders can be added from the panel and cancelled', await page.locator('.rem-list .rem-pending').count() === 1 && await (async () => { await page.getByRole('button', { name: 'Cancel stretch' }).click(); await page.waitForTimeout(150); return page.locator('.rem-list .rem-pending').count(); })() === 0);

  // saved chats
  await page.getByRole('tab', { name: 'Chats' }).click();
  await page.getByLabel('Search chats').fill('timer'); await page.waitForTimeout(100);
  const found = await page.locator('.chat-list li').count();
  await page.getByLabel('Search chats').fill('');
  const userMsgs = await page.locator('.msg.user').count();
  await page.locator('.quick-actions').getByRole('button', { name: /New chat/ }).click(); await page.waitForTimeout(300);
  const cleared = await page.locator('.msg.user').count() === 0;
  await page.locator('.chat-list li').filter({ hasText: 'messages' }).first().locator('.chat-open').click(); await page.waitForTimeout(300);
  check('[A107] Chats: search finds a chat, "New chat" starts fresh, and an old chat reopens', found >= 1 && cleared && await page.locator('.msg.user').count() === userMsgs, `found ${found}, users ${userMsgs}`);

  // light theme
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Theme').selectOption('light'); await page.waitForTimeout(200);
  const lightBg = await N(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r + g + b) / 3; };
  check('[A111] light theme applies to the workspace', lightBg.theme === 'light' && lum(lightBg.bg) > 200, JSON.stringify(lightBg));
  await page.screenshot({ path: 'test-results/e2e-light.png' });

  const manifest = await page.evaluate(async () => { const r = await fetch('/manifest.webmanifest'); const j = await r.json(); const icons = await Promise.all(j.icons.map((i) => fetch(new URL(i.src, new URL('/manifest.webmanifest', location.href))).then((x) => x.ok && x.headers.get('content-type').includes('png')))); return { type: r.headers.get('content-type'), name: j.short_name, start: new URL(j.start_url, new URL('/manifest.webmanifest', location.href)).pathname, display: j.display, icons, link: !!document.querySelector('link[rel=manifest]') }; });
  check('[A115] installable web app: valid manifest (standalone, starts in /app) with PNG icons', manifest.link && /manifest\+json|json/.test(manifest.type) && manifest.name === 'NEXUS' && manifest.start === '/app' && manifest.display === 'standalone' && manifest.icons.length >= 3 && manifest.icons.every(Boolean), JSON.stringify(manifest));
  // ---- Robot view (default layout) + server voice: TTS audio drives the mouth, interruption, server transcription ----
  {
    // fake microphone: 0.3 s quiet, 1.2 s of "speech" (a tone), then quiet — the end-of-speech detector should stop on its own
    writeFileSync('test-results/fake-mic.wav', toneWav(5, (t) => t > 0.3 && t < 1.5, 48000));
    const vb = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.cwd()}/test-results/fake-mic.wav%noloop`] });
    const vctx = await vb.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    const rv = await vctx.newPage(); const rvErr = []; rv.on('pageerror', (e) => rvErr.push(e.message));
    const R = (fn, arg) => rv.evaluate(fn, arg);
    await rv.goto(`http://127.0.0.1:${LLM_PORT}/app`, { waitUntil: 'networkidle' });
    await R(() => nexus.memory.updateSettings({ setupDone: true, greeted: true })); await rv.reload({ waitUntil: 'networkidle' }); await rv.waitForTimeout(800);
    const fit = async (pg) => pg.evaluate(() => { const svg = document.querySelector('.robot-view svg[role=img]'); const head = svg?.querySelector('[data-part="antenna"]')?.getBoundingClientRect(); const feet = [...svg.querySelectorAll('[data-part^="leg-"]')].map((l) => l.getBoundingClientRect().bottom); return { layout: nexus.memory.settings.layout, top: head?.top ?? -1, bottom: Math.max(...feet), vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, feed: !!document.querySelector('.messages'), mic: !!document.querySelector('.mic-btn'), voice: nexus.companion.voiceOut?.engineName, input: nexus.companion.voiceIn?.kind }; });
    const f1 = await fit(rv);
    check('[A119] robot view is the default: the whole robot (antenna to feet) is visible, voice controls only, no chat feed or side panel', f1.layout === 'robot' && f1.top >= 0 && f1.bottom <= f1.vh && f1.overflow <= 1 && !f1.feed && f1.mic && !(await rv.locator('aside.side').count()), JSON.stringify(f1));
    check('[A119] with a speech service configured, replies use the server voice and voice input uses server transcription', f1.voice === 'server' && f1.input === 'server', `${f1.voice} / ${f1.input}`);
    // spoken reply: real audio from the (mock) speech API; the mouth follows the audio level, including the silent gap
    const samples = [];
    await rv.keyboard.press('/'); await rv.waitForTimeout(250); await rv.keyboard.type('Please introduce yourself'); await rv.keyboard.press('Enter');
    for (let i = 0; i < 120; i++) { const v = await R(() => ({ st: nexus.companion.sm.state, mouth: nexus.engine.values['mouth.open'], lvl: nexus.engine.speech.levelMode })); samples.push(v); if (i > 10 && v.st === 'idle' && samples.some((x) => x.st === 'speaking')) break; await rv.waitForTimeout(40); }
    const sp = samples.filter((x) => x.st === 'speaking' && x.lvl);
    const maxM = Math.max(0, ...sp.map((x) => x.mouth)); const minM = Math.min(1, ...sp.slice(3).map((x) => x.mouth));
    await rv.waitForTimeout(400);
    const after = await R(() => ({ st: nexus.companion.sm.state, mouth: nexus.engine.values['mouth.open'], speaking: nexus.companion.getSnapshot().speaking, cap: document.querySelector('[data-testid=captions]')?.textContent ?? '' }));
    check('[A119] spoken reply: SPEAKING only while the server audio plays; the mouth opens with the sound and closes in the silence; back to idle', ttsCalls.length >= 1 && ttsCalls[0].model === 'mock-tts' && ttsCalls[0].voice === 'mock-voice' && sp.length > 5 && maxM > 0.35 && minM < 0.15 && after.st === 'idle' && !after.speaking && after.mouth < 0.2, `tts calls ${ttsCalls.length}, speaking samples ${sp.length}, mouth max ${maxM.toFixed(2)} min ${minM.toFixed(2)}, end ${after.st} ${after.mouth.toFixed(2)}`);
    check('[A119] captions show the exchange under the robot (usable without sound)', /introduce yourself/.test(after.cap) && /I'm NEXUS/.test(after.cap), after.cap.slice(0, 120));
    // interruption: Stop while speaking cancels audio, mouth and request; nothing resumes afterwards
    await rv.locator('#composer').fill('Please introduce yourself'); await rv.locator('#composer').press('Enter');
    for (let i = 0; i < 80 && (await R(() => nexus.companion.sm.state)) !== 'speaking'; i++) await rv.waitForTimeout(30);
    await rv.getByRole('button', { name: 'Stop', exact: true }).click(); await rv.waitForTimeout(150);
    const st1 = await R(() => ({ st: nexus.companion.sm.state, speaking: nexus.companion.tts.speaking, lvl: nexus.engine.speech.levelMode }));
    await rv.waitForTimeout(1500);
    const st2 = await R(() => ({ st: nexus.companion.sm.state, speaking: nexus.companion.tts.speaking }));
    check('[A119] interrupting speech stops the audio, the mouth and the reply at once; the stale reply never resumes', !st1.speaking && !st1.lvl && st1.st !== 'speaking' && st2.st === 'idle' && !st2.speaking, JSON.stringify({ st1, st2 }));
    // voice input through the server transcription service (fake microphone); the transcript is offered for review
    await rv.getByRole('button', { name: 'Talk' }).click();
    for (let i = 0; i < 40 && !(await R(() => nexus.companion.getSnapshot().listening)); i++) await rv.waitForTimeout(50);
    const listening = await R(() => ({ st: nexus.companion.sm.state, face: nexus.expressions.current() }));
    let autoStopped = false;
    for (let i = 0; i < 80; i++) { await rv.waitForTimeout(100); if (!(await R(() => nexus.companion.getSnapshot().listening))) { autoStopped = true; break; } }
    check('[A119] end of speech is detected from the microphone level (recording stops by itself after the user stops talking)', autoStopped);
    if (!autoStopped) await rv.getByRole('button', { name: 'Stop listening' }).click();
    let draft = '';
    for (let i = 0; i < 60 && !draft; i++) { await rv.waitForTimeout(100); draft = await rv.locator('#composer').inputValue().catch(() => ''); }
    check('[A119] voice input: LISTENING state and face while recording, audio transcribed by the server, transcript placed in the box for review', listening.st === 'listening' && listening.face === 'listening' && sttCalls.length === 1 && sttCalls[0].bytes > 100 && sttCalls[0].model === 'mock-stt' && draft === 'please wave', JSON.stringify({ listening, stt: sttCalls, draft }));
    await rv.locator('#composer').press('Enter'); await rv.waitForTimeout(300);
    for (let i = 0; i < 300 && ((await R(() => nexus.companion.sm.state)) !== 'idle' || await R(() => nexus.companion.getSnapshot().busy)); i++) await rv.waitForTimeout(50);
    const endState = await R(() => ({ tail: nexus.companion.getSnapshot().messages.slice(-4).map((m) => m.role + ':' + m.status + ':' + m.text.slice(0, 40)), last: nexus.companion.getSnapshot().messages.at(-1)?.text ?? '', st: nexus.companion.sm.state, started: nexus.companion.getSnapshot().lastSkillId }));
    check('[A119] the transcribed request runs end to end (LLM reply + wave) and the robot returns to idle', endState.last.includes('Waving') && endState.st === 'idle', JSON.stringify(endState));
    await rv.screenshot({ path: 'test-results/e2e-robot-view.png' });
    // phone size: robot still fully visible
    const ph = await vctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 }); await ph.goto(`http://127.0.0.1:${LLM_PORT}/app`, { waitUntil: 'networkidle' }); await ph.waitForTimeout(700);
    const f2 = await fit(ph);
    check('[A119] robot view on a phone: the whole robot fits, no horizontal scroll', f2.top >= 0 && f2.bottom <= f2.vh && f2.overflow <= 1, JSON.stringify(f2));
    await ph.screenshot({ path: 'test-results/e2e-robot-view-phone.png' });
    const v1 = []; await ph.addScriptTag({ content: readFileSync('node_modules/axe-core/axe.min.js', 'utf8') });
    for (const v of await ph.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}: ${x.nodes[0]?.target}`))) v1.push(v);
    check('[A119] [A112] robot view passes the axe audit (no serious/critical issues)', v1.length === 0, v1.join(' | '));
    check('[A119] no page errors in the robot view', rvErr.length === 0, rvErr.join(' | '));
    await vb.close();
  }

  // automated accessibility audit (axe-core) — dark and light, all destinations
  const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
  const audit = async (pg) => { await pg.addScriptTag({ content: axeSrc }); return pg.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.slice(0, 4).map((n) => `${v.id}: ${n.target.join(' ')} ${n.any?.[0]?.message?.slice(0, 90) ?? ''}`)); }); };
  const a11y = [];
  for (const theme of ['light', 'dark']) {
    for (const path of ['/', '/about', '/privacy', '/missing-page', '/app']) {
      const ap = await ctx.newPage(); await ap.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle' }); await ap.waitForTimeout(path === '/app' ? 900 : 400);
      const th = await ap.evaluate(() => document.documentElement.dataset.theme);
      for (const v of await audit(ap)) a11y.push(`${theme}${path}: ${v}`);
      if (th !== theme) a11y.push(`${theme}${path}: theme was ${th}`);
      await ap.close();
    }
    if (theme === 'light') { await page.getByLabel('Theme').selectOption('dark'); await page.waitForTimeout(200); }
  }
  check('[A112] [A88] axe accessibility audit: no serious or critical issues on any page, dark and light', a11y.length === 0, a11y.slice(0, 6).join(' | '));
  writeFileSync('test-results/a11y.json', JSON.stringify(a11y, null, 2));
  await page.screenshot({ path: 'test-results/e2e-final.png' });
  check('[A98] no uncaught page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('[A98] e2e run completed without crashing', false, e.message);
} finally { await browser.close(); server.kill(); llmServer.kill(); mock.close(); }

mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/e2e.json', JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
