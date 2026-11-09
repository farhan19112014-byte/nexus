// [A99] NEXUS JavaScript budget — our own performance budget (no build tool, host or browser imposes it).
// Usage: npm run build && npm run check:bundle      (also run by scripts/e2e.mjs and CI)
//
// Two budgets, measured on the production build in dist/:
//  1. TOTAL  — all JavaScript except the on-demand 3D / workspace chunks (KiB, before gzip). A room-to-grow ceiling:
//     it counts every page's code together, although no single page loads all of it.
//  2. PAGES  — what a visitor's browser actually downloads before a page can run: the entry script plus everything it and
//     the page's chunk import statically (KiB, gzip — what goes over the network). This is the one that protects load time,
//     so new features that load on demand (a new page, panel or tool behind a button) only use the TOTAL budget.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Chunks that download only when their feature is opened: the 3D robot (three.js, model code, body animation), HOLOBUILD,
 *  Live Vision and the Motion Lab. Rollup names chunks after their first module; vite.config.ts names body3d-*. */
export const ON_DEMAND = /^(three\.module|Robot3D|presence-|body3d-|GLTFLoader|GLTFExporter|OrbitControls|RoomEnvironment|scene-|io-|HoloBuild-|holoInstance-|VisionPanel-|liveVision-|vision-|MotionLab-)/;
export const LIMITS = {
  /** raised from 900 KiB (Nov 2026): the old figure was set when the app was smaller; per-page caps below now guard load time */
  totalKiB: 1200,
  /** initial JS per page, gzip KiB (measured Nov 2026: home 142, robot workspace 235, learning 202) */
  pageGzipKiB: { Landing: 190, App: 300, LearningPage: 260 },
};

export function measure(dir = 'dist') {
  const A = `${dir}/assets/`;
  const all = readdirSync(A).filter((f) => f.endsWith('.js'));
  const bytes = new Map(all.map((f) => [f, readFileSync(A + f)]));
  const kib = (n) => n / 1024;
  const deps = (f) => [...new Set([...bytes.get(f).toString('utf8').matchAll(/(?:import|export)\s*(?:[^"';()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)].map((m) => m[1]))];
  const closure = (roots) => { const s = new Set(); const q = [...roots]; while (q.length) { const f = q.shift(); if (s.has(f) || !bytes.has(f)) continue; s.add(f); q.push(...deps(f)); } return s; };
  const entry = [...readFileSync(`${dir}/index.html`, 'utf8').matchAll(/assets\/([^"']+\.js)/g)].map((m) => m[1]);
  const total = all.filter((f) => !ON_DEMAND.test(f)).reduce((n, f) => n + bytes.get(f).length, 0);
  const onDemand = all.filter((f) => ON_DEMAND.test(f)).reduce((n, f) => n + bytes.get(f).length, 0);
  const pages = {};
  for (const name of Object.keys(LIMITS.pageGzipKiB)) {
    const chunk = all.find((f) => f.startsWith(`${name}-`));
    if (!chunk) { pages[name] = null; continue; }
    const files = closure([...entry, chunk]);
    let raw = 0, gz = 0; for (const f of files) { raw += bytes.get(f).length; gz += gzipSync(bytes.get(f), { level: 9 }).length; }
    pages[name] = { rawKiB: kib(raw), gzipKiB: kib(gz) };
  }
  const problems = [];
  if (kib(total) >= LIMITS.totalKiB) problems.push(`total ${Math.round(kib(total))} KiB ≥ ${LIMITS.totalKiB} KiB`);
  for (const [name, cap] of Object.entries(LIMITS.pageGzipKiB)) {
    const p = pages[name];
    if (!p) problems.push(`page chunk ${name}-*.js not found (renamed? update LIMITS.pageGzipKiB)`);
    else if (p.gzipKiB >= cap) problems.push(`${name} initial JS ${Math.round(p.gzipKiB)} KiB gzip ≥ ${cap} KiB`);
  }
  return { totalKiB: kib(total), onDemandKiB: kib(onDemand), pages, problems, ok: problems.length === 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = measure();
  console.log(`JS total (excl. on-demand): ${Math.round(r.totalKiB)} / ${LIMITS.totalKiB} KiB · on-demand: ${Math.round(r.onDemandKiB)} KiB`);
  for (const [n, p] of Object.entries(r.pages)) if (p) console.log(`  ${n.padEnd(13)} initial JS ${String(Math.round(p.rawKiB)).padStart(4)} KiB · ${Math.round(p.gzipKiB)} / ${LIMITS.pageGzipKiB[n]} KiB gzip`);
  if (!r.ok) { console.error(`Over budget: ${r.problems.join('; ')}`); process.exit(1); }
}
