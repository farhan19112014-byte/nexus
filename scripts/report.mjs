// [A100] Release readiness report. Runs typecheck, build, unit+integration tests and e2e, then computes each
// asset's status from the ACTUAL results: "verified" only if implemented AND every tag [Axx] it references
// has at least one passing test and no failing test. Writes docs/RELEASE_REPORT.md and public|dist/asset-status.json.
// Usage: npm run report   (pass --skip-e2e to skip the browser run)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { ASSETS } from '../src/assets/registry.ts';

const skipE2E = process.argv.includes('--skip-e2e');
const run = (name, cmd, args) => {
  const t0 = Date.now(); const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  console.log(`${r.status === 0 ? '✔' : '✘'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { name, ok: r.status === 0, code: r.status, seconds: (Date.now() - t0) / 1000, tail: out.split('\n').filter(Boolean).slice(-6).join('\n'), out };
};
mkdirSync('test-results', { recursive: true });
const steps = [
  run('typecheck', 'npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']),
  run('build (app + server bundle)', 'npm', ['run', 'build']),
  run('lint (eslint, 0 warnings)', 'npx', ['eslint', '.', '--max-warnings=0']),
  run('unit + integration tests', 'npx', ['vitest', 'run']),
];
if (!skipE2E) steps.push(run('end-to-end tests', 'node', ['scripts/e2e.mjs']));
// Desktop app (Electron) smoke test: starts the real main process, loads the window, checks isolation, quits.
let desktop = { ran: false, note: 'Electron is not installed (npm install), so the desktop smoke test was skipped.' };
if (existsSync('node_modules/electron/path.txt')) {
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const st = headless ? run('desktop app smoke test', 'xvfb-run', ['-a', 'node_modules/.bin/electron', '.', '--smoke-test', '--no-sandbox']) : run('desktop app smoke test', 'npx', ['electron', '.', '--smoke-test']);
  const line = (st.out.split('\n').find((l) => l.startsWith('SMOKE ')) ?? '').slice(6);
  desktop = { ran: true, ok: st.ok, note: line || st.tail, platform: `${process.platform}-${process.arch}` };
  steps.push(st);
}

const tests = [];  // { name, ok, suite }
if (existsSync('test-results/vitest.json')) {
  const j = JSON.parse(readFileSync('test-results/vitest.json', 'utf8'));
  for (const f of j.testResults ?? []) for (const a of f.assertionResults ?? []) tests.push({ name: a.fullName ?? a.title, ok: a.status === 'passed', suite: f.name.includes('/integration/') ? 'integration' : 'unit', skipped: a.status !== 'passed' && a.status !== 'failed' });
}
if (!skipE2E && existsSync('test-results/e2e.json')) for (const r of JSON.parse(readFileSync('test-results/e2e.json', 'utf8')).results) tests.push({ name: r.name, ok: r.ok, suite: 'e2e' });
const counted = tests.filter((t) => !t.skipped);
const suite = (s) => { const x = counted.filter((t) => t.suite === s); return { total: x.length, passed: x.filter((t) => t.ok).length }; };
const S = { unit: suite('unit'), integration: suite('integration'), e2e: suite('e2e') };
const allOk = steps.every((s) => s.ok);

const status = {};
for (const a of ASSETS) {
  const tags = a.tests;
  let passed = 0, failed = 0; const missing = [];
  for (const tag of tags) {
    const hit = counted.filter((t) => t.name.includes(tag));
    passed += hit.filter((t) => t.ok).length; failed += hit.filter((t) => !t.ok).length;
    if (!hit.some((t) => t.ok)) missing.push(tag);
  }
  // suite-level assets: verified by whole suites, not by tags
  if (['A96', 'A97', 'A98', 'A100'].includes(a.id)) missing.length = 0;
  if (a.id === 'A96') { passed = S.unit.passed; failed = S.unit.total - S.unit.passed; if (!S.unit.total) missing.push('unit suite'); }
  if (a.id === 'A97') { passed = S.integration.passed; failed = S.integration.total - S.integration.passed; if (!S.integration.total) missing.push('integration suite'); }
  if (a.id === 'A98') { const e = S.e2e; passed = e.passed; failed = e.total - e.passed; if (!e.total) missing.push(skipE2E ? 'e2e skipped' : 'e2e suite'); }
  if (a.id === 'A100') { passed = steps.filter((s) => s.ok).length; failed = steps.length - passed; if (skipE2E) missing.push('e2e skipped'); }
  const st = a.implementation !== 'implemented' ? a.implementation : failed > 0 ? 'failing' : missing.length ? 'implemented' : 'verified';
  status[a.id] = { status: st, passed, failed, missing };
}
const by = (k) => Object.values(status).filter((s) => s.status === k).length;
const generatedAt = new Date().toISOString();
const json = { generatedAt, steps: steps.map(({ tail: _tail, out: _out, ...s }) => s), suites: S, assets: status };
mkdirSync('public', { recursive: true });
writeFileSync('public/asset-status.json', JSON.stringify(json, null, 2));
if (existsSync('dist')) copyFileSync('public/asset-status.json', 'dist/asset-status.json');

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const cats = [...new Set(ASSETS.map((a) => a.category))];
let md = `# NEXUS — Release readiness & acceptance report\n\nGenerated ${generatedAt} by \`npm run report\` from actual command results. Do not edit by hand.\n\n`;
md += `## Summary\n\n| | |\n|---|---|\n| Overall | ${allOk ? '**All checks passed**' : '**Some checks failed — see below**'} |\n`;
for (const s of steps) md += `| ${s.name} | ${s.ok ? '✅ pass' : `❌ fail (exit ${s.code})`} · ${s.seconds.toFixed(1)}s |\n`;
md += `| Unit tests | ${S.unit.passed}/${S.unit.total} passed |\n| Integration tests | ${S.integration.passed}/${S.integration.total} passed |\n| End-to-end checks | ${skipE2E ? 'skipped' : `${S.e2e.passed}/${S.e2e.total} passed`} |\n`;
md += `| Assets | ${by('verified')} verified · ${by('implemented')} implemented but not fully verified · ${by('failing')} failing · ${by('blocked')} blocked · ${by('planned') + by('in_progress')} not done |\n\n`;
md += `**Status meanings.** *verified*: implemented and every test tagged with the asset id passed in this run. *implemented*: code exists but at least one required verification is missing in this run. *failing*: a tagged test failed. Verification uses headless Chromium and mocked external services; see each asset's limitation for what that does not prove.\n\n`;
const failedSteps = steps.filter((s) => !s.ok);
if (failedSteps.length) { md += `## Failures\n\n`; for (const s of failedSteps) md += `### ${s.name}\n\n\`\`\`\n${s.tail}\n\`\`\`\n\n`; const ft = counted.filter((t) => !t.ok); if (ft.length) md += `Failing tests:\n${ft.map((t) => `- ${esc(t.name)}`).join('\n')}\n\n`; }
md += `## Asset registry\n\n`;
for (const c of cats) {
  md += `### ${c}\n\n| ID | Asset | Status | Tests (pass/fail) | Implementation | Known limitation |\n|---|---|---|---|---|---|\n`;
  for (const a of ASSETS.filter((x) => x.category === c)) { const s = status[a.id]; md += `| ${a.id} | ${esc(a.name)} | ${s.status === 'verified' ? '✅ verified' : s.status === 'failing' ? '❌ failing' : `⚠️ ${s.status}`}${s.missing.length ? ` (missing: ${s.missing.join(', ')})` : ''} | ${s.passed}/${s.failed} | \`${a.paths.join('`, `')}\` | ${esc(a.limitations ?? '')} |\n`; }
  md += '\n';
}
md += `## Laptop & desktop app\n\n`;
md += `- Laptop layouts (1024–1536 px wide, 640–800 px tall, including browser-bar heights such as 1366×657) are checked by the end-to-end suite (asset A90 rows above).\n`;
md += `- Desktop app smoke test (${desktop.platform ?? 'n/a'}): ${desktop.ran ? (desktop.ok ? '✅' : '❌') : 'skipped'} — \`${esc(desktop.note).slice(0, 300)}\`\n`;
md += `- Not verifiable here: the Windows installer (\`npm run dist:win\`) and the \`.bat\` start scripts were not run on Windows by this report. Voice input is unavailable inside the desktop app (Electron ships no speech-to-text service); the app says so and voice works in Chrome/Edge.\n\n`;
md += `## Configuration requirements\n\n- None for the demo: \`npm install && npm run dev\`.\n- Real conversation: \`LLM_PROVIDER=openai|anthropic\` plus the provider's base URL/model/key in \`.env\` or Settings → Model (see docs/SETUP.md).\n- Live research: \`RESEARCH_PROVIDER=wikipedia|searxng|tavily\` (+ \`SEARXNG_URL\` / \`TAVILY_API_KEY\`).\n- Voice: a browser with Web Speech support (Chrome/Edge for recognition); speech synthesis voices come from the OS.\n\n`;
md += `## Blocked or unverifiable in this environment\n\n- No live LLM, search or speech service was reachable from the test environment: provider, research and voice code paths are verified with mocks/fakes only.\n- Real microphone permission prompts and real TTS audio cannot be exercised headlessly.\n- No model training is implemented (by design).\n\n## Remaining work\n\n- Streaming of structured metadata incrementally (currently the head and the trailing META block).\n- Phoneme-level lip-sync (needs a TTS engine that reports phoneme timings).\n- True side-profile artwork for orientation (current turns are a 2D feature shift).\n- Running the validator in a Web Worker for stronger isolation of preview computation.\n- Accounts/authentication if the server is ever exposed beyond localhost.\n- Reminders only alert while NEXUS is open (browser tab or desktop app); there is no background service. Missed ones show on next start.\n- The accessibility audit is automated (axe-core); it does not replace testing with a real screen reader.\n- Markdown support is deliberately small (no tables or images); anything else shows as plain text.\n`;
writeFileSync('docs/RELEASE_REPORT.md', md);
console.log(`\nAssets: ${by('verified')} verified, ${by('implemented')} implemented (unverified), ${by('failing')} failing. Report → docs/RELEASE_REPORT.md`);
process.exit(allOk ? 0 : 1);
