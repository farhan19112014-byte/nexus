/** [A124] hosted NEXUS: daily budgets reset each day; the browser client talks to a remote server and says when it is waking. */
import { describe, expect, it, vi } from 'vitest';
import { DailyBudget, MemoryStore } from '../../../server/budget';
import { ApiClient } from '../../ai/apiClient';

describe('[A124] daily budget', () => {
  it('[A124] limits per visitor and in total, counts spoken characters, and starts fresh the next UTC day', async () => {
    let now = new Date('2026-10-21T10:00:00Z'); const b = new DailyBudget({ chatsPerDay: 3, chatsPerIpPerDay: 2, speechCharsPerDay: 10 }, new MemoryStore(() => now.getTime()), () => now);
    expect((await b.reserve('chat', 'a', 1)).ok).toBe(true); expect((await b.reserve('chat', 'a', 1)).ok).toBe(true); expect((await b.reserve('chat', 'a', 1)).ok).toBe(false);
    expect((await b.reserve('chat', 'b', 1)).ok).toBe(true); expect((await b.reserve('chat', 'c', 1)).ok).toBe(false);
    expect((await b.reserve('speech', 'a', 6)).ok).toBe(true); expect((await b.reserve('speech', 'b', 5)).ok).toBe(false); expect((await b.reserve('speech', 'b', 4)).ok).toBe(true);
    now = new Date('2026-10-22T00:00:01Z'); expect((await b.reserve('chat', 'a', 1)).ok).toBe(true);
    expect(await b.snapshot()).toMatchObject({ day: '2026-10-22', totals: { chat: 1, speech: 0 } });
    const open = new DailyBudget({ chatsPerDay: 0, chatsPerIpPerDay: 0, speechCharsPerDay: 0 }); for (let i = 0; i < 500; i++) expect((await open.reserve('chat', 'x', 1)).ok).toBe(true);
  });
});

describe('[A124] public mode detection', () => {
  it('[A124] PUBLIC_MODE in any common spelling, or Render itself, turns public mode on; PUBLIC_MODE=false always wins', async () => {
    const { isPublicMode } = await import('../../../server/config');
    for (const v of ['true', 'TRUE', ' True ', '"true"', '1', 'yes']) expect(isPublicMode({ PUBLIC_MODE: v } as NodeJS.ProcessEnv), v).toBe(true);
    expect(isPublicMode({ RENDER: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPublicMode({ RENDER: 'true', PUBLIC_MODE: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPublicMode({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('[A124] remote API client', () => {
  it('[A124] calls the configured server URL and reports a slow first wake-up once', async () => {
    vi.useFakeTimers();
    const calls: string[] = []; let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn((u: string) => { calls.push(u); return new Promise<Response>((r) => { release = r; }); }));
    const api = new ApiClient('https://nexus-x.onrender.com', 1000, false, true); const woke = vi.fn(); api.onWaking = woke;
    const p = api.status(); await vi.advanceTimersByTimeAsync(3100); expect(woke).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ provider: 'gemini', isLLM: true, hosted: true }), { headers: { 'content-type': 'application/json' } }));
    expect(await p).toMatchObject({ provider: 'gemini', hosted: true }); expect(calls[0]).toBe('https://nexus-x.onrender.com/api/status');
    const p2 = api.status(); await vi.advanceTimersByTimeAsync(3100); release(new Response('{}', { headers: { 'content-type': 'application/json' } })); await p2;
    expect(woke).toHaveBeenCalledTimes(1);                                   // only the first, cold request
    vi.unstubAllGlobals(); vi.useRealTimers();
  });
});

describe('[A124] user-testing comparison mode', () => {
  it('?study=voice hides the robot for a fair voice-only comparison; anything else keeps the normal app', async () => {
    const { studyMode } = await import('../../study/studyMode');
    expect(studyMode('?study=voice')).toBe('voice'); expect(studyMode('?p=%2Fapp&study=voice')).toBe('voice');
    expect(studyMode('?study=robot')).toBe('robot'); expect(studyMode('?study=evil')).toBeNull(); expect(studyMode('')).toBeNull();
  });
});

describe('[A124] deployment configuration agrees with the code', () => {
  it('render.yaml limits equal the public-mode defaults, and every setting is documented in .env.example and DEPLOY.md', async () => {
    const { readFileSync } = await import('node:fs'); const { readConfig, configWarnings } = await import('../../../server/config');
    const yaml = readFileSync('render.yaml', 'utf8'); const envEx = readFileSync('.env.example', 'utf8'); const deploy = readFileSync('docs/DEPLOY.md', 'utf8');
    const vars = new Map<string, string | null>(); for (const m of yaml.matchAll(/- key: (\w+)\n\s+(?:value: "?([^"\n]*)"?|sync: false)/g)) vars.set(m[1], m[2] ?? null);
    const pub = readConfig({ PUBLIC_MODE: 'true' } as NodeJS.ProcessEnv).budget;
    const map: Record<string, keyof typeof pub> = { DAILY_CHAT_LIMIT: 'chatsPerDay', DAILY_CHAT_LIMIT_PER_VISITOR: 'chatsPerIpPerDay', DAILY_SPEECH_CHAR_LIMIT: 'speechCharsPerDay', DAILY_SPEECH_CHAR_LIMIT_PER_VISITOR: 'speechCharsPerIpPerDay', DAILY_TRANSCRIPTION_LIMIT: 'transcriptionsPerDay', DAILY_TRANSCRIPTION_LIMIT_PER_VISITOR: 'transcriptionsPerIpPerDay' };
    for (const [k, field] of Object.entries(map)) { expect(vars.get(k), k).toBe(String(pub[field])); expect(envEx, k).toContain(`${k}=${pub[field]}`); expect(deploy, k).toContain(`${k}=${pub[field]}`); }
    expect(pub).toMatchObject({ speechCharsPerIpPerDay: 3000, transcriptionsPerIpPerDay: 60, transcriptionsPerDay: 600 });
    for (const k of vars.keys()) if (!['NODE_VERSION', 'ELECTRON_SKIP_BINARY_DOWNLOAD'].includes(k)) expect(envEx, `${k} in .env.example`).toContain(k);
    for (const k of ['TRUST_PROXY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BUDGET_STORE', 'RATE_LIMIT_PER_MIN']) expect(deploy, `${k} in DEPLOY.md`).toContain(k);
    expect(vars.get('UPSTASH_REDIS_REST_TOKEN')).toBeNull();                     // a secret: set in the dashboard, never in the file
    // the startup notes tell the owner where the counts live
    expect(configWarnings(readConfig({ PUBLIC_MODE: 'true' } as NodeJS.ProcessEnv)).join(' ')).toMatch(/data\/budget\.json.*UPSTASH_REDIS_REST_URL/);
    expect(configWarnings(readConfig({ PUBLIC_MODE: 'true', BUDGET_STORE: 'upstash' } as NodeJS.ProcessEnv)).join(' ')).toMatch(/refused until they are set/);
  });
});

describe('[A124] user-acceptance plan stays in step with the automated tests', () => {
  it('every automated check named in docs/UAT.md exists in the test suites; no results are pre-filled', async () => {
    const { readFileSync } = await import('node:fs');
    const uat = readFileSync('docs/UAT.md', 'utf8'); const e2e = readFileSync('scripts/e2e.mjs', 'utf8');
    const units = ['src/tests/unit/memory.test.ts', 'src/tests/unit/v4.test.tsx', 'src/tests/unit/public-host.test.ts', 'src/tests/integration/server.test.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const cited = [...uat.matchAll(/`(\[[A-Z0-9-]+\](?: \[[A-Z0-9]+\])* [^`]+?)`/g)].map((m) => m[1].replace(/…$/, ''));
    expect(cited.length).toBeGreaterThan(20);
    for (const c of cited) expect(e2e.includes(c) || units.includes(c), c).toBe(true);
    expect(uat).toMatch(/not yet run with real people/);
    const rows = readFileSync('docs/uat-results.csv', 'utf8').trim().split('\n').slice(1).map((r) => r.split(','));
    for (const r of rows) expect(r[5], 'result column must start empty').toBe('');
  });
});
