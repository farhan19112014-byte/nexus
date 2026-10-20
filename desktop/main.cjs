/**
 * NEXUS desktop app (Electron main process).
 *
 * - Starts the same NEXUS server used by `npm start` inside this process, bound to 127.0.0.1 only.
 *   API keys and provider settings stay here (in the server); the window never receives them.
 * - Opens one window that loads http://localhost:<port>. The page has no Node.js access
 *   (contextIsolation + sandbox, no preload), and cannot navigate to other sites.
 * - Settings → Model saves to <userData>/runtime-config.json (e.g. %APPDATA%\NEXUS on Windows).
 *   An optional <userData>/.env is read too.
 * - Memories and approved skills live in this window's browser storage for the localhost:<port> origin,
 *   so the port is kept stable (18787 by default, NEXUS_DESKTOP_PORT to change).
 */
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { existsSync } = require('node:fs');

const PORT = Number(process.env.NEXUS_DESKTOP_PORT || 18787);
const SMOKE = process.argv.includes('--smoke-test'); // CI/self-test: start, load, report, quit
let server = null;
let win = null;
let origin = '';

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

async function startBackend() {
  const root = app.getAppPath();
  const userData = app.getPath('userData');
  const { startServer } = await import(pathToFileURL(join(root, 'dist-server', 'start.js')).href);
  const envFile = existsSync(join(userData, '.env')) ? join(userData, '.env') : join(root, '.env');
  const s = await startServer({
    // exactly one port: memories, chats and skills live in browser storage for http://localhost:<port>,
    // so silently moving to another port would make them look lost
    port: PORT, portAttempts: 1, serveDist: true, distDir: join(root, 'dist'), envFile,
    runtimeConfigPath: process.env.RUNTIME_CONFIG_PATH || join(userData, 'runtime-config.json'),
  });
  if (!s.reused) server = s;
  return s.url;
}

function createWindow(url) {
  origin = new URL(url).origin;
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#07090d', title: 'NEXUS', autoHideMenuBar: true, show: false,
    icon: join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, devTools: !app.isPackaged || process.env.NEXUS_DEVTOOLS === '1' },
  });
  // Fit smaller laptop screens: never open larger than the work area.
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workAreaSize;
  if (wa.width < 1366 || wa.height < 820) win.setSize(Math.min(1366, wa.width), Math.min(820, wa.height));
  if (wa.width <= 1366 && wa.height <= 800) win.maximize();

  // Links (e.g. research sources) open in the normal browser; the app window never leaves NEXUS.
  win.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:\/\//i.test(target)) void shell.openExternal(target); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, target) => { let o = ''; try { o = new URL(target).origin; } catch { /* invalid */ } if (o !== origin) { e.preventDefault(); if (/^https?:\/\//i.test(target)) void shell.openExternal(target); } });
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.on('closed', () => { win = null; });
  return win.loadURL(`${url}/app`); // open straight into the robot workspace; the logo links to the home page
}

function lockDownSession() {
  // Only the microphone (voice input) and clipboard writes are allowed, and only for NEXUS itself.
  const ours = (u) => { try { return new URL(u).origin === origin; } catch { return false; } };
  const allowed = (p) => p === 'media' || p === 'clipboard-sanitized-write';
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(ours(details.requestingUrl || wc.getURL()) && allowed(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ours(requestingOrigin) && allowed(permission));
}

/** In-app navigation: every page of NEXUS lives inside this one window. */
function go(path) { if (win && origin) { void win.loadURL(`${origin}${path}`); if (win.isMinimized()) win.restore(); win.focus(); } }

const menu = Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'NEXUS', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { label: 'Open in browser (for voice input)', click: () => origin && shell.openExternal(`${origin}/app`) }, { label: 'Settings folder', click: () => shell.openPath(app.getPath('userData')) }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'Go', submenu: [
    { label: 'Robot', accelerator: 'CmdOrCtrl+1', click: () => go('/app') },
    { label: 'Home page', accelerator: 'CmdOrCtrl+2', click: () => go('/') },
    { label: 'About', click: () => go('/about') },
    { label: 'Privacy', click: () => go('/privacy') },
    { type: 'separator' },
    { label: 'Set up again (name, AI brain, theme)…', click: () => go('/app#setup') },
  ] },
  { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
]);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(menu);
  let url;
  try { url = await startBackend(); } catch (e) {
    if (SMOKE) { console.error(`SMOKE FAIL backend: ${e.message}`); app.exit(1); return; }
    const msg = /No free port/.test(String(e && e.message)) ? `Port ${PORT} is being used by another program, so NEXUS could not start.\n\nClose that program, or start NEXUS with a different NEXUS_DESKTOP_PORT. (NEXUS does not switch ports on its own, because your saved chats, memories and skills belong to this port.)` : String(e && e.message || e);
    dialog.showErrorBox('NEXUS could not start', msg); app.quit(); return;
  }
  lockDownSession();
  await createWindow(url);
  if (SMOKE) {
    const r = await win.webContents.executeJavaScript(`new Promise((ok) => { const t0 = Date.now(); const tick = () => { const svg = document.querySelector('.stage svg[role=img]'); const c = document.querySelector('#composer') || document.querySelector('.mic-btn'); if (svg && c) ok({ ok: true, title: document.title, nodeAccess: typeof require !== 'undefined' || typeof process !== 'undefined', ms: Date.now() - t0 }); else if (Date.now() - t0 > 15000) ok({ ok: false }); else setTimeout(tick, 100); }; tick(); })`);
    const status = await win.webContents.executeJavaScript(`fetch('/api/status').then((r) => r.json())`);
    const goMenu = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Go');
    const pages = goMenu ? goMenu.submenu.items.filter((i) => i.type !== 'separator').map((i) => i.label) : [];
    // every page lives inside this one window: navigate to the home page and back without leaving the app
    go('/'); await new Promise((t) => setTimeout(t, 800));
    const home = await win.webContents.executeJavaScript(`!!document.querySelector('.hero') && location.pathname === '/'`);
    go('/app'); await new Promise((t) => setTimeout(t, 800));
    const back = await win.webContents.executeJavaScript(`!!(document.querySelector('#composer') || document.querySelector('.mic-btn'))`);
    r.ok = r.ok && pages.length >= 4 && home && back;
    console.log(`SMOKE ${JSON.stringify({ ...r, url, provider: status.provider, reused: !server, pages, home, back })}`);
    if (process.env.NEXUS_SMOKE_SHOT) { win.setContentSize(1366, 740); win.show(); await new Promise((t) => setTimeout(t, 1500)); require('node:fs').writeFileSync(process.env.NEXUS_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG()); }
    app.exit(r.ok && !r.nodeAccess ? 0 : 1);
  }
});

app.on('window-all-closed', () => { app.quit(); });
app.on('will-quit', () => { if (server) void server.close(); });
