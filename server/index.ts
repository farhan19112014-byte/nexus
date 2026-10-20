/** CLI entry: `npm run dev:server`, `npm start`, and the one-click start scripts (flags: --serve-dist, --open). */
import { openBrowser, startServer } from './start';

const serveDist = process.argv.includes('--serve-dist');
const open = process.argv.includes('--open');
const log = process.env.LOG_REQUESTS === 'false' ? undefined : (l: string) => console.log(`[api] ${l}`);

startServer({ serveDist, log }).then((s) => {
  if (s.reused) {
    console.log(`[nexus] NEXUS is already running at ${s.url} — opening it.`);
    if (open) openBrowser(s.url);
    process.exit(0);
  }
  console.log(`[nexus] API listening on ${s.url}  (bound to 127.0.0.1 — not reachable from other computers)`);
  if (serveDist) console.log(`[nexus] app on ${s.url}   ·   press Ctrl+C in this window to stop NEXUS`);
  if (open) openBrowser(s.url);
}).catch((e: Error) => { console.error(`[nexus] could not start: ${e.message}`); process.exit(1); });
