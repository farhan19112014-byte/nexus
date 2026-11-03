/** [A124] usage budgets: atomic reservations, one-shot refunds, durable stores, fail-closed, visitor identity. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyBudget, FileStore, MemoryStore, UpstashStore, makeCounterStore, secondsToUtcMidnight, visitorOf, type CounterStore } from '../../../server/budget';

const L = { chatsPerDay: 100, chatsPerIpPerDay: 5, speechCharsPerDay: 20000, speechCharsPerIpPerDay: 3000, transcriptionsPerDay: 600, transcriptionsPerIpPerDay: 60 };

/** a store whose every call takes a real async turn (like a network store), to expose race conditions */
class SlowStore extends MemoryStore { override async incr(k: string, by: number, ttl: number) { await new Promise((r) => setTimeout(r, Math.random() * 5)); return super.incr(k, by, ttl); } }

describe('[A124] budget reservations', () => {
  it('[A124] parallel requests cannot spend the same allowance twice (per visitor and in total)', async () => {
    const b = new DailyBudget(L, new SlowStore());
    const results = await Promise.all(Array.from({ length: 40 }, () => b.reserve('speech', '9.9.9.9', 100)));
    expect(results.filter((r) => r.ok).length).toBe(30);                       // 3000 per visitor / 100 each, never more
    const tot = new DailyBudget({ ...L, speechCharsPerDay: 1000, speechCharsPerIpPerDay: 0 }, new SlowStore());
    const many = await Promise.all(Array.from({ length: 50 }, (_, i) => tot.reserve('speech', `10.0.0.${i}`, 100)));
    expect(many.filter((r) => r.ok).length).toBeLessThanOrEqual(10);           // whole-server cap holds under a race
    expect((await tot.snapshot()).totals.speech).toBeLessThanOrEqual(1000);
  });

  it('[A124] the exact boundary: 3,000 characters fit, 3,001 do not; 60 voice inputs fit, the 61st does not', async () => {
    const b = new DailyBudget(L);
    expect((await b.reserve('speech', 'a', 3000)).ok).toBe(true); expect((await b.reserve('speech', 'a', 1)).ok).toBe(false);
    for (let i = 0; i < 60; i++) expect((await b.reserve('stt', 'a', 1)).ok).toBe(true);
    const r = await b.reserve('stt', 'a', 1); expect(r).toMatchObject({ ok: false, status: 429, code: 'quota' });
    if (!r.ok) expect(r.retryAfterS).toBeGreaterThan(0);
  });

  it('[A124] refunds happen once: calling refund twice (or racing it) never creates extra allowance', async () => {
    const b = new DailyBudget(L);
    const r = await b.reserve('speech', 'a', 3000); if (!r.ok) throw new Error('reserve failed');
    await Promise.all([r.refund(), r.refund(), r.refund()]); await r.refund();
    expect((await b.reserve('speech', 'a', 3000)).ok).toBe(true); expect((await b.reserve('speech', 'a', 1)).ok).toBe(false);
    expect((await b.snapshot()).totals.speech).toBe(3000);
  });

  it('[A124] a refused reservation leaves no trace (rolled back), so refusals cannot pile up or go negative', async () => {
    const b = new DailyBudget({ ...L, speechCharsPerDay: 50, speechCharsPerIpPerDay: 40 });
    for (let i = 0; i < 10; i++) await b.reserve('speech', 'a', 45);           // always over the visitor cap
    expect((await b.snapshot()).totals.speech).toBe(0);
    expect((await b.reserve('speech', 'a', 40)).ok).toBe(true);
  });

  it('[A124] invalid amounts and limits are rejected (no negative or fractional spending)', async () => {
    const b = new DailyBudget(L);
    for (const n of [0, -5, 1.5, Number.NaN]) await expect(b.reserve('speech', 'a', n)).rejects.toThrow(/amount/);
    expect(() => new DailyBudget({ ...L, chatsPerDay: -1 })).toThrow(/whole number/);
    expect(() => new DailyBudget({ ...L, speechCharsPerIpPerDay: 2.5 })).toThrow(/whole number/);
  });

  it('[A124] days are UTC days: counts reset at 00:00 UTC, and Retry-After points there', async () => {
    let now = new Date('2026-10-21T23:59:30Z'); const store = new MemoryStore(() => now.getTime());
    const b = new DailyBudget(L, store, () => now);
    expect((await b.reserve('speech', 'a', 3000)).ok).toBe(true);
    const r = await b.reserve('speech', 'a', 1); expect(r.ok).toBe(false); if (!r.ok) expect(r.retryAfterS).toBe(30);
    now = new Date('2026-10-22T00:00:00Z'); expect((await b.reserve('speech', 'a', 3000)).ok).toBe(true);
    expect(secondsToUtcMidnight(new Date('2026-10-22T12:00:00Z'))).toBe(43200);
  });
});

describe('[A124] durable and shared counters', () => {
  it('[A124] file store: counts survive a restart (same visitor still blocked); a corrupt file starts clean', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-budget-')); const path = join(dir, 'budget.json');
    const b1 = new DailyBudget(L, new FileStore(path));
    expect((await b1.reserve('speech', '1.2.3.4', 3000)).ok).toBe(true);
    const b2 = new DailyBudget(L, new FileStore(path));                      // "restart": a new process reads the file
    expect((await b2.reserve('speech', '1.2.3.4', 1)).ok).toBe(false);
    expect((await b2.reserve('speech', '5.6.7.8', 10)).ok).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toContain('1.2.3.4');             // visitors are stored as salted hashes only
    writeFileSync(path, '{not json'); expect((await new DailyBudget(L, new FileStore(path)).reserve('speech', 'a', 10)).ok).toBe(true);
  });

  it('[A124] storage failure fails closed: metered requests are refused with 503, unmetered ones are unaffected', async () => {
    const broken: CounterStore = { kind: 'upstash', secret: () => 's', incr: async () => { throw new Error('down'); } };
    const b = new DailyBudget(L, broken);
    expect(await b.reserve('speech', 'a', 10)).toMatchObject({ ok: false, status: 503, code: 'quota_unavailable' });
    const free = new DailyBudget({ chatsPerDay: 0, chatsPerIpPerDay: 0, speechCharsPerDay: 0 }, broken);
    expect((await free.reserve('chat', 'a', 1)).ok).toBe(true);
    // a half-written reservation (first counter ok, second fails) is rolled back
    let calls = 0; const flaky = new MemoryStore(); const half: CounterStore = { kind: 'upstash', secret: () => 's', incr: async (k, n, t) => { if (++calls === 2) throw new Error('blip'); return flaky.incr(k, n, t); } };
    expect((await new DailyBudget(L, half).reserve('speech', 'a', 10)).ok).toBe(false);
    expect(await flaky.incr(`nexus:${new Date().toISOString().slice(0, 10)}:speech:all`, 0, 60)).toBe(0);
  });

  it('[A124] two server instances sharing one Upstash store enforce one limit (REST protocol, mocked)', async () => {
    const redis = new Map<string, number>(); const seen: unknown[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://up.example/pipeline'); expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-123');
      const cmds = JSON.parse(String(init.body)) as string[][]; seen.push(cmds);
      const [, key, by] = cmds[0]; const v = (redis.get(key) ?? 0) + Number(by); redis.set(key, v);
      return new Response(JSON.stringify([{ result: v }, { result: 1 }]), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const a = new DailyBudget(L, new UpstashStore('https://up.example/', 'tok-123', fake));
    const b = new DailyBudget(L, new UpstashStore('https://up.example', 'tok-123', fake));
    expect((await a.reserve('speech', '7.7.7.7', 2000)).ok).toBe(true);
    expect((await b.reserve('speech', '7.7.7.7', 1001)).ok).toBe(false);          // the other instance sees the same count
    expect((await b.reserve('speech', '7.7.7.7', 1000)).ok).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('7.7.7.7');                        // the address never leaves the server
    expect((seen[0] as string[][])[1][0]).toBe('EXPIRE');
    // an error reply from the store refuses the request
    const err = new UpstashStore('https://up.example', 't', (async () => new Response(JSON.stringify([{ error: 'WRONGPASS' }]))) as unknown as typeof fetch);
    expect(await new DailyBudget(L, err).reserve('speech', 'a', 1)).toMatchObject({ ok: false, status: 503 });
  });

  it('[A124] store selection: Upstash when configured, a file on public servers, memory locally; half-configured Upstash refuses', async () => {
    expect(makeCounterStore({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }, true).store.kind).toBe('upstash');
    expect(makeCounterStore({}, true).store.kind).toBe('file');
    expect(makeCounterStore({}, false).store.kind).toBe('memory');
    const bad = makeCounterStore({ BUDGET_STORE: 'upstash' }, true); expect(bad.note).toMatch(/refused/);
    expect(await new DailyBudget(L, bad.store).reserve('chat', 'a', 1)).toMatchObject({ ok: false, status: 503 });
  });
});

describe('[A124] visitor identity', () => {
  it('[A124] IPv4 as is, IPv4-mapped IPv6 as IPv4, IPv6 by its /64 network (rotating the last 64 bits does not help)', () => {
    expect(visitorOf('203.0.113.9')).toBe('203.0.113.9'); expect(visitorOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(visitorOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64'); expect(visitorOf('2001:db8:1:2:ffff:ffff:ffff:fff0')).toBe('2001:db8:1:2::/64');
    expect(visitorOf('2001:db8::1')).toBe('2001:db8:0:0::/64'); expect(visitorOf(undefined)).toBe('unknown');
  });
  it('[A124] many distinct addresses cannot reset a blocked visitor: past the tracking cap, newcomers share one allowance', async () => {
    const b = new DailyBudget({ ...L, chatsPerDay: 0, chatsPerIpPerDay: 1 });
    expect((await b.reserve('chat', 'victim', 1)).ok).toBe(true); expect((await b.reserve('chat', 'victim', 1)).ok).toBe(false);
    // 2001:db8:x::/64 networks are all different visitors; the victim stays blocked throughout
    for (let i = 0; i < 50100; i++) await b.reserve('chat', `2001:db8:${(i >> 16).toString(16)}:${(i & 0xffff).toString(16)}::1`, 1);
    expect((await b.reserve('chat', 'victim', 1)).ok).toBe(false);
    expect((await b.reserve('chat', '2001:db8:ffff:ffff::1', 1)).ok).toBe(false);  // newcomers share the (used) overflow allowance
  });
});
