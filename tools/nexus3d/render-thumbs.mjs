/**
 * Renders the home page's images FROM THE REAL APP (no hand-made art):
 *   npm run dev:web   (or any server with the site), then
 *   node tools/nexus3d/render-thumbs.mjs http://localhost:5173
 * → public/images/faces/<expression>.jpg  — the live 3D robot's screen face for each expression tile
 * → public/images/faces/s-<state>.jpg      — the face during listening / thinking / speaking
 * → public/images/nexus-render.png         — a transparent full-body render (closing section)
 * → public/images/app-preview.jpg         — a screenshot of the real robot page (dark theme)
 */
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
const p = await ctx.newPage();
await p.goto(`${BASE}/app`); await p.waitForFunction(() => window.nexus?.memory);
await p.evaluate(async () => { await nexus.memory.ready; await nexus.memory.updateSettings({ theme: 'dark', setupDone: true, layout: 'robot', voiceOutput: false }); });
// faces
await p.goto(`${BASE}/#robot`, { waitUntil: 'networkidle' });
await p.waitForSelector('.viewer-stage .robot3d[data-ready="1"]', { timeout: 120000 });
await p.addStyleTag({ content: '.viewer-stage .tag, .viewer-stage .state-note, .viewer-stage .callouts, .viewer-stage .stage-bar { display: none !important; } html.js-reveal .reveal, html.js-reveal .reveal * { opacity: 1 !important; transform: none !important; }' });
const stageBox = async () => { await p.locator('.viewer-stage').scrollIntoViewIfNeeded(); return p.locator('.viewer-stage').boundingBox(); };
const faceShot = async (file) => { const box = await stageBox(); const h = box.height * 0.25, w = h * 4 / 3; await p.screenshot({ path: file, type: 'jpeg', quality: 84, clip: { x: box.x + (box.width - w) / 2, y: box.y + box.height * 0.175, width: w, height: h } }); };
const faces = ['happy', 'excited', 'curious', 'confused', 'thinking', 'sad', 'surprised', 'angry', 'playful'];
for (const [i, id] of faces.entries()) { await p.locator('.face-tile').nth(i).click(); await p.waitForTimeout(1900); await faceShot(`public/images/faces/${id}.jpg`); console.log('face', id); }
// the same face during real states (for the conversation timeline)
for (const st of ['Listening', 'Thinking', 'Speaking']) {
  await p.getByRole('group', { name: /states/ }).getByRole('button', { name: st }).click(); await p.waitForTimeout(1900);
  await faceShot(`public/images/faces/s-${st.toLowerCase()}.jpg`); console.log('state face', st);
}
// a transparent full-body render for the closing section (happy face, front view)
await p.locator('.face-tile').nth(0).click(); await p.waitForTimeout(1600);
await p.addStyleTag({ content: 'html, body, .site, .showcase, .viewer-stage { background: transparent !important; box-shadow: none !important; border-color: transparent !important; } .viewer-stage .stage-light, .viewer-stage .stage-floor, .site-header, .callout, .stage-bar { display: none !important; }' });
{ const box = await stageBox(); const w = box.height * 0.72; await p.screenshot({ path: 'public/images/nexus-render.png', omitBackground: true, clip: { x: box.x + (box.width - w) / 2, y: box.y + 4, width: w, height: box.height - 8 } }); console.log('render'); }
// the robot page
const a = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
await a.goto(`${BASE}/app`); await a.waitForFunction(() => window.nexus?.memory);
await a.evaluate(async () => { await nexus.memory.ready; await nexus.memory.updateSettings({ theme: 'dark', setupDone: true, layout: 'robot', voiceOutput: false, introduceOnOpen: false, greetEverySession: false }); });
await a.reload(); await a.waitForSelector('.robot3d[data-ready="1"]', { timeout: 120000 }); await a.keyboard.press('Escape'); await a.waitForTimeout(2500);
await a.screenshot({ path: 'public/images/app-preview.jpg', type: 'jpeg', quality: 80 });
console.log('app preview');
await b.close();
