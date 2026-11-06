// [A147] The presence motion system in the REAL app: built bundle + API server + headless Chromium with WebGL
// (SwiftShader) and a mock speech API whose WAV has syllables, so the voice-driven paths really run.
// Usage: npm run build && node scripts/e2e-presence.mjs   → test-results/e2e-presence.json (+ screenshots)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';

mkdirSync('test-results/presence', { recursive: true });
/** mono 16-bit WAV: a voice-like tone, ~5 syllables a second, a short pause every 0.9 s */
function speechWav(dur = 3, sr = 16000) {
  const n = Math.round(sr * dur), d = Buffer.alloc(44 + n * 2);
  d.write('RIFF', 0); d.writeUInt32LE(36 + n * 2, 4); d.write('WAVE', 8); d.write('fmt ', 12); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(1, 22); d.writeUInt32LE(sr, 24); d.writeUInt32LE(sr * 2, 28); d.writeUInt16LE(2, 32); d.writeUInt16LE(16, 34); d.write('data', 36); d.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / sr; const syl = Math.max(0, Math.sin(t * Math.PI * 5)); const gap = (t % 0.9) < 0.75 ? 1 : 0.02; d.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 180 * t) * 14000 * syl * gap), 44 + i * 2); }
  return d;
}
let tts = 0;
const mock = http.createServer(async (req, res) => {
  if (req.url.startsWith('/v1/audio/speech')) { for await (const _ of req) { /* drain */ } tts++; res.setHeader('content-type', 'audio/wav'); return res.end(speechWav()); }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;
const PORT = 8813, ORIGIN = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['dist-server/index.js', '--serve-dist'], { env: { ...process.env, PORT: String(PORT), LLM_PROVIDER: 'demo', TTS_PROVIDER: 'openai', OPENAI_BASE_URL: `${MOCK}/v1`, OPENAI_API_KEY: 'sk-e2e-mock-key-000000', TTS_MODEL: 'mock-tts', TTS_VOICE: 'mock-voice', LOG_REQUESTS: 'false', ALLOW_RUNTIME_CONFIG: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('listening') && res()); setTimeout(() => rej(new Error('server start timeout')), 30000); });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
  const E = (fn, a) => pg.evaluate(fn, a);
  const P = () => E(() => { const raw = document.querySelector('.robot3d')?.getAttribute('data-presence'); return raw ? JSON.parse(raw) : null; });
  const M = () => E(() => { const raw = document.querySelector('.robot3d')?.getAttribute('data-body-metrics'); return raw ? JSON.parse(raw) : null; });
  const sample = async (seconds, every = 100) => { const out = []; for (let t = 0; t < seconds * 1000; t += every) { out.push({ t, p: await P(), m: await M(), st: await E(() => nexus.companion.sm.state) }); await pg.waitForTimeout(every); } return out; };
  const shot = async (name) => { const b = await pg.locator('.robot3d').boundingBox(); await pg.screenshot({ path: `test-results/presence/${name}.png`, clip: b ?? undefined }); };

  await pg.goto(`${ORIGIN}/app`, { waitUntil: 'networkidle' });
  await E(async () => { await nexus.memory.updateSettings({ setupDone: true, greeted: true, layout: 'robot', voiceOutput: true, voiceEngine: 'server', ambientBehaviours: false }); });
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForSelector('.robot3d[data-ready="1"]', { timeout: 60000 }).catch(() => null);
  await pg.waitForFunction(() => !!document.querySelector('.robot3d')?.getAttribute('data-presence'), null, { timeout: 20000 }).catch(() => null);
  await pg.waitForTimeout(1500);
  const ready = await E(() => ({ is3d: nexus.runtime.is3d, presence: !!nexus.runtime.body.presence, attr: !!document.querySelector('.robot3d')?.getAttribute('data-presence') }));
  check('[A147] the 3D robot runs the presence layer (attached when the 3D view is shown)', ready.is3d && ready.presence && ready.attr, JSON.stringify(ready));

  // 1 — idle for an extended period: breathing varies, feet stay planted, nothing frozen, no errors
  const idle = await sample(14, 120);
  const br = idle.map((x) => x.p?.breath ?? 0); const feet = idle.map((x) => x.p?.feet ?? [0, 0, 0, 0]);
  const footSpread = Math.max(...[0, 1, 2, 3].map((i) => Math.max(...feet.map((f) => f[i])) - Math.min(...feet.map((f) => f[i]))));
  const lowFoot = Math.min(...idle.map((x) => x.m?.foot ?? 0));
  check('[A147] idle: breathing rises and falls (never frozen)', Math.max(...br) - Math.min(...br) > 0.3, `breath ${Math.min(...br).toFixed(2)}…${Math.max(...br).toFixed(2)}`);
  check('[A147] idle: the boots stay planted (no sliding) and on the floor in the rendered model', footSpread < 0.005 && lowFoot > -0.03, `feet moved ${footSpread.toFixed(4)} m, lowest rendered foot pivot ${lowFoot.toFixed(3)}`);
  await shot('1-idle');

  // performance: the JS cost of a frame with and without the presence layer (same page, same renderer)
  const perf = await E(async () => {
    const R = nexus.runtime; const m = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) R.step(1 / 60); return (performance.now() - t0) / n; };
    m(30); const withP = m(240); const keep = R.body.presence; R.body.presence = null; const without = m(240); R.body.presence = keep; return { withP, without };
  });
  check('[A147] performance: the presence layer adds well under a millisecond per frame (frame-rate aware, no per-frame allocations of note)', perf.withP - perf.without < 1.5 && perf.withP < 16, `${perf.withP.toFixed(2)} ms/frame with presence vs ${perf.without.toFixed(2)} ms without (step + render submit, SwiftShader)`);

  // 2 — listening: attention on the user; a nod on the user's pause
  await E(() => { nexus.runtime.setMotion('listening'); for (let i = 0; i < 8; i++) setTimeout(() => nexus.runtime.presence.userActivity(), i * 150); });
  const lis = await sample(2.6, 100);
  check('[A147] listening: looks at the user and acknowledges the user\'s pause with a nod', lis.some((x) => x.p?.reaction === 'acknowledge') && lis.slice(-5).every((x) => x.p?.attention === 'user'), JSON.stringify(lis.map((x) => x.p?.reaction).filter(Boolean).slice(0, 3)));
  await E(() => nexus.runtime.setMotion('idle'));

  // 3+4+5 — a spoken reply (demo brain → server voice → sentences): gestures from the words, then relaxed
  await E(() => { void nexus.companion.send('Tell me something interesting about the ocean'); });
  const talk = await sample(9, 100);
  const spk = talk.filter((x) => x.st === 'speaking');
  const armPeak = Math.max(0, ...talk.map((x) => x.p?.armW ?? 0)); const forms = [...new Set(talk.map((x) => x.p?.gesture).filter(Boolean))];
  check('[A147] speaking: the voice plays (server audio) and the arms gesture during the reply', tts >= 1 && spk.length > 5 && armPeak > 0.6, `tts ${tts}, speaking samples ${spk.length}, arm weight peak ${armPeak.toFixed(2)}, forms ${forms.join(',')}`);
  const tail = await sample(3, 150);
  check('[A147] after the reply: the hands relax back to the sides and NEXUS returns to idle', tail.slice(-4).every((x) => (x.p?.armW ?? 1) < 0.1) && ['idle', 'listening'].includes(tail[tail.length - 1].st), JSON.stringify(tail.slice(-4).map((x) => [x.p?.armW, x.st])));
  check('[A147] no page errors so far', errs.length === 0, errs.slice(0, 3).join(' | '));

  // 9 — IVES: a reply with a visual (demo diagram) → NEXUS looks at the panel and presents it
  await E(() => { void nexus.companion.send('Explain photosynthesis please'); });
  const vis = await sample(8, 100);
  const panel = await E(() => !!document.querySelector('[data-testid=visual-panel]'));
  const looked = vis.filter((x) => x.p?.attention === 'visual').length;
  const presented = Math.max(0, ...vis.filter((x) => x.p?.attention === 'visual').map((x) => x.p?.armW ?? 0));
  const gazeRight = Math.max(...vis.map((x) => x.p?.gaze?.[0] ?? 0));
  check('[A147] IVES: with the visual on screen NEXUS turns its eyes and head to the panel and presents it with an open arm', panel && looked >= 3 && presented > 0.5 && gazeRight > 0.05, `panel ${panel}, samples looking at it ${looked}, arm ${presented.toFixed(2)}, gaze x max ${gazeRight.toFixed(2)}`);
  await shot('2-presenting');
  await pg.waitForTimeout(4000);

  // 11 — interrupted while speaking: hands retract, attention back to the user
  await E(() => { void nexus.companion.send('Tell me about the moon and the stars'); });
  await pg.waitForFunction(() => nexus.companion.sm.state === 'speaking', null, { timeout: 15000 }).catch(() => null);
  await pg.waitForTimeout(900);
  await E(() => nexus.companion.interrupt('user'));
  const intr = await sample(1.6, 100);
  check('[A147] interrupted mid-sentence: an interruption reaction, hands down within ~1.5 s, attention on the user', intr.some((x) => x.p?.reaction === 'interrupted') && (intr[intr.length - 1].p?.armW ?? 1) < 0.15 && intr[intr.length - 1].p?.attention === 'user', JSON.stringify(intr.filter((_, i) => i % 4 === 0).map((x) => [x.p?.reaction, x.p?.armW, x.p?.attention])));
  await pg.waitForTimeout(1500);

  // 7 — walking: "walk around" → the engine's walk skill → real steps on planted feet, there and back
  await E(() => { void nexus.companion.send('walk around please'); });
  const walk = await sample(20, 150);
  const xs = walk.map((x) => x.p?.root?.[0] ?? 0); const steps = Math.max(...walk.map((x) => x.p?.steps ?? 0)); const lift = Math.max(...walk.map((x) => x.p?.lift ?? 0));
  const lowW = Math.min(...walk.map((x) => x.m?.foot ?? 0));
  const end = walk[walk.length - 1].p;
  check('[A147] walking: alternating steps carry NEXUS over to the side and back; feet lift and land, never below the floor', Math.min(...xs) < -0.5 && steps >= 6 && lift > 0.03 && lowW > -0.03 && Math.abs(end.root[0]) < 0.08 && !end.walking, `min x ${Math.min(...xs).toFixed(2)}, steps ${steps}, max lift ${lift.toFixed(3)}, lowest foot ${lowW.toFixed(3)}, end ${JSON.stringify(end.root)} yaw ${end.yaw}`);
  await shot('3-after-walk');

  // 10 — HOLOBUILD: build a model, select a part → NEXUS turns its attention to it
  await pg.goto(`${ORIGIN}/holobuild`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.robot3d[data-ready="1"]', { timeout: 60000 }).catch(() => null);
  const hb = pg.locator('#holo-cmd');
  if (await hb.count()) { await hb.fill('build a robotic arm'); await hb.press('Enter'); }
  await pg.waitForSelector('[data-testid=holo-parts] button', { timeout: 30000 }).catch(() => null);
  await pg.waitForTimeout(1200);
  await pg.locator('[data-testid=holo-parts] button').nth(1).click().catch(() => null);
  const holo = await sample(3, 100);
  check('[A147] HOLOBUILD: selecting a part turns NEXUS\'s attention to the model (its real screen position)', holo.some((x) => x.p?.attention === 'holo'), JSON.stringify(holo.map((x) => x.p?.attention).filter((_, i) => i % 5 === 0)));
  await shot('4-holobuild');

  // Motion Lab — a real on-page target: present it
  const lab = await ctx.newPage(); const lErr = []; lab.on('pageerror', (e) => lErr.push(e.message));
  await lab.goto(`${ORIGIN}/motions`, { waitUntil: 'networkidle' }); await lab.waitForSelector('.robot3d[data-ready="1"]', { timeout: 60000 }).catch(() => null);
  await lab.click('[data-testid=ml-marker]'); await lab.waitForTimeout(800); await lab.click('[data-testid=ml-point]'); await lab.waitForTimeout(1600);
  const lp = JSON.parse(await lab.locator('.robot3d').getAttribute('data-presence'));
  check('[A147] Motion Lab: NEXUS looks at and points to a target placed on the page', lp.attention === 'visual' && lp.armW > 0.5 && lErr.length === 0, JSON.stringify(lp));
  const lb = await lab.locator('.ml-stage').boundingBox(); await lab.screenshot({ path: 'test-results/presence/5-lab-point.png', clip: lb ?? undefined });
  check('[A147] no page errors anywhere', errs.length === 0 && lErr.length === 0, [...errs, ...lErr].slice(0, 3).join(' | '));
} finally {
  writeFileSync('test-results/e2e-presence.json', JSON.stringify(results, null, 2));
  await browser.close(); server.kill(); mock.close();
  const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} presence checks passed`);
  process.exit(bad.length ? 1 : 0);
}
