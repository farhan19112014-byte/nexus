/** [A124] hosted NEXUS: daily budgets reset each day; the browser client talks to a remote server and says when it is waking. */
import { describe, expect, it, vi } from 'vitest';
import { DailyBudget } from '../../../server/budget';
import { ApiClient } from '../../ai/apiClient';

describe('[A124] daily budget', () => {
  it('[A124] limits per visitor and in total, counts spoken characters, and starts fresh the next day', () => {
    let now = new Date('2026-10-21T10:00:00Z'); const b = new DailyBudget({ chatsPerDay: 3, chatsPerIpPerDay: 2, speechCharsPerDay: 10 }, () => now);
    expect(b.takeChat('a').ok).toBe(true); expect(b.takeChat('a').ok).toBe(true); expect(b.takeChat('a').ok).toBe(false);
    expect(b.takeChat('b').ok).toBe(true); expect(b.takeChat('c').ok).toBe(false);
    expect(b.takeSpeech(6).ok).toBe(true); expect(b.takeSpeech(5).ok).toBe(false); expect(b.takeSpeech(4).ok).toBe(true);
    now = new Date('2026-10-22T00:00:01Z'); expect(b.takeChat('a').ok).toBe(true); expect(b.snapshot()).toMatchObject({ day: '2026-10-22', chats: 1, speechChars: 0 });
    const open = new DailyBudget({ chatsPerDay: 0, chatsPerIpPerDay: 0, speechCharsPerDay: 0 }); for (let i = 0; i < 500; i++) expect(open.takeChat('x').ok).toBe(true);
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
