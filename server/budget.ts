/**
 * Daily budgets for a public NEXUS server: they protect the owner's Gemini / ElevenLabs quota from being used up by
 * one visitor or by bots. 0 means "no limit" (the default on your own computer).
 *
 * Rules (each is covered by tests in src/tests/unit/budget.test.ts and src/tests/integration/server.test.ts):
 * - Enforced on the server only. Every limit has a whole-server cap AND a per-visitor cap.
 * - A reservation is atomic: the counter is incremented first and rolled back if it went over a cap, so parallel
 *   requests can never spend the same remaining allowance twice (also across several server instances when the
 *   counters live in a shared store).
 * - A reservation the provider did not fulfil (it returned an error before producing anything) is refunded exactly
 *   once — calling refund() again does nothing. Cancelled or timed-out requests are NOT refunded, because the provider
 *   may already have produced (and billed) the work.
 * - Days are UTC days. Counters are keyed by day, so the reset happens at 00:00 UTC on every instance.
 * - Visitors are identified by a salted hash of their network address (IPv6: the /64 network, which one household or
 *   device usually controls), never by the raw address, and the hash changes every day.
 * - If the counter store fails, metered requests are refused (fail closed) — never served without accounting.
 *
 * Stores (BUDGET_STORE): "memory" (resets when the process restarts), "file" (survives process restarts on the same
 * disk; NOT across Render free-plan spin-downs, whose disk is wiped), "upstash" (Upstash Redis REST: shared and durable,
 * survives restarts and works with several instances).
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface BudgetLimits {
  chatsPerDay: number; chatsPerIpPerDay: number;
  speechCharsPerDay: number; speechCharsPerIpPerDay: number;
  transcriptionsPerDay: number; transcriptionsPerIpPerDay: number;
}
export type MeterName = 'chat' | 'speech' | 'stt';
export type Denied = { ok: false; reason: string; status: 429 | 503; code: 'rate_limited' | 'quota' | 'quota_unavailable'; retryAfterS: number };
export type Reservation = { ok: true; refund: () => Promise<void> } | Denied;

/* ---------------------------------------------------------------- counter stores */
export interface CounterStore {
  readonly kind: 'memory' | 'file' | 'upstash';
  /** atomically add `by` (may be negative) to `key` and return the new value; the key expires after ttlS */
  incr(key: string, by: number, ttlS: number): Promise<number>;
  /** a stable secret for hashing visitor addresses (durable stores keep it, so per-visitor counts survive restarts) */
  secret(): string;
}

export class MemoryStore implements CounterStore {
  readonly kind: 'memory' | 'file' = 'memory';
  protected m = new Map<string, { v: number; exp: number }>();
  private s = randomBytes(16).toString('hex');
  constructor(protected now = () => Date.now()) {}
  secret() { return this.s; }
  protected prune() { const t = this.now(); for (const [k, e] of this.m) if (e.exp <= t) this.m.delete(k); }
  async incr(key: string, by: number, ttlS: number) {
    const t = this.now(); let e = this.m.get(key);
    if (!e || e.exp <= t) { e = { v: 0, exp: t + ttlS * 1000 }; this.m.set(key, e); if (this.m.size % 1000 === 0) this.prune(); }
    e.v += by; return e.v;
  }
  size() { return this.m.size; }
}

/** Memory counters written to a JSON file after every change (atomic rename); a write failure refuses the request. */
export class FileStore extends MemoryStore {
  override readonly kind = 'file' as const;
  private fileSecret: string;
  constructor(private path: string, now = () => Date.now()) {
    super(now);
    let data: { secret?: string; counters?: Record<string, { v: number; exp: number }> } = {};
    try { if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8')); } catch { data = {}; }   // unreadable: start a fresh day count (logged by the server)
    this.fileSecret = typeof data.secret === 'string' && data.secret.length >= 16 ? data.secret : randomBytes(16).toString('hex');
    for (const [k, e] of Object.entries(data.counters ?? {})) if (e && typeof e.v === 'number' && typeof e.exp === 'number' && e.exp > now()) this.m.set(k, e);
  }
  override secret() { return this.fileSecret; }
  override async incr(key: string, by: number, ttlS: number) {
    const v = await super.incr(key, by, ttlS);
    this.prune();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ secret: this.fileSecret, counters: Object.fromEntries(this.m) }), { mode: 0o600 });
    renameSync(tmp, this.path);
    return v;
  }
}

/** Upstash Redis over its REST API (no extra dependency): INCRBY + EXPIRE in one pipeline call. */
export class UpstashStore implements CounterStore {
  readonly kind = 'upstash' as const;
  private s: string;
  constructor(private url: string, private token: string, private fetchImpl: typeof fetch = (...a) => fetch(...a), private timeoutMs = 2500) {
    this.url = url.replace(/\/+$/, '');
    // a stable hashing secret without extra configuration: derived from the (secret) token
    this.s = createHash('sha256').update(`nexus-visitor|${token}`).digest('hex');
  }
  secret() { return this.s; }
  async incr(key: string, by: number, ttlS: number) {
    const r = await this.fetchImpl(`${this.url}/pipeline`, {
      method: 'POST', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify([['INCRBY', key, String(by)], ['EXPIRE', key, String(ttlS)]]),
    });
    if (!r.ok) throw new Error(`counter store answered HTTP ${r.status}`);
    const j = (await r.json()) as { result?: unknown; error?: string }[];
    const first = Array.isArray(j) ? j[0] : undefined;
    if (!first || first.error || typeof first.result !== 'number') throw new Error(`counter store error: ${String(first?.error ?? 'unexpected reply').slice(0, 120)}`);
    return first.result;
  }
}

export interface StoreEnv { BUDGET_STORE?: string; BUDGET_FILE?: string; UPSTASH_REDIS_REST_URL?: string; UPSTASH_REDIS_REST_TOKEN?: string }
/** Picks the store: BUDGET_STORE if set; else Upstash when its URL+token are set; else a file on a public server; else memory. */
export function makeCounterStore(env: StoreEnv, publicMode: boolean): { store: CounterStore; note?: string } {
  const want = (env.BUDGET_STORE ?? '').trim().toLowerCase();
  const up = env.UPSTASH_REDIS_REST_URL?.trim(), tok = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (want === 'upstash' || (!want && up && tok)) {
    if (!up || !tok || !/^https:\/\//i.test(up)) return { store: new FailingStore('BUDGET_STORE=upstash needs UPSTASH_REDIS_REST_URL (https://…) and UPSTASH_REDIS_REST_TOKEN'), note: 'Usage budgets: Upstash is selected but not configured — metered requests are refused until it is fixed.' };
    return { store: new UpstashStore(up, tok) };
  }
  if (want === 'file' || (!want && publicMode)) {
    const path = env.BUDGET_FILE?.trim() || 'data/budget.json';
    return { store: new FileStore(path), note: publicMode ? `Usage budgets are kept in ${path}: they survive restarts on the same disk, but a free host that wipes its disk (Render free plan spin-down) starts the day's counts again. For durable, shared counts set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.` : undefined };
  }
  return { store: new MemoryStore(), note: publicMode ? 'Usage budgets are kept in memory only: a restart starts the day\'s counts again.' : undefined };
}
/** A store that always fails, so a misconfigured durable store refuses metered requests instead of allowing them. */
class FailingStore implements CounterStore {
  readonly kind = 'upstash' as const;
  constructor(private why: string) {}
  secret() { return 'unused'; }
  async incr(): Promise<number> { throw new Error(this.why); }
}

/* ---------------------------------------------------------------- visitors and days */
/** The visitor part of an address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by its /64 network. */
export function visitorOf(ip: string | undefined): string {
  const a = (ip ?? '').trim().toLowerCase();
  if (!a) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a); if (mapped) return mapped[1];
  if (!a.includes(':')) return a;
  // expand :: so the first four groups are the /64 network
  const [head, tail = ''] = a.split('::'); const h = head ? head.split(':') : []; const t = tail ? tail.split(':') : [];
  const groups = a.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`;
}
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);
/** seconds until the next 00:00 UTC */
export const secondsToUtcMidnight = (d: Date) => Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime()) / 1000));

/* ---------------------------------------------------------------- the budget */
const TTL_S = 2 * 86400;                 // a day's counters are kept a little past their day, then expire
const MAX_VISITORS_TRACKED = 50000;      // memory guard for the memory/file stores (see `visitorKey`)
const TEXT: Record<MeterName, { all: string; ip: (n: number) => string }> = {
  chat: { all: 'NEXUS has answered as many messages as this public server allows today (to protect its free AI quota). Please try again tomorrow — or run NEXUS on your own computer.', ip: (n) => `You have reached today's limit of ${n} messages on this public server. Please come back tomorrow — or run NEXUS on your own computer for unlimited use.` },
  speech: { all: "The voice has used today's budget on this public server — replies are shown as text until tomorrow.", ip: () => "You have used today's voice allowance on this public server — replies are shown as text until tomorrow." },
  stt: { all: "Voice input has reached today's limit on this public server — please type instead until tomorrow.", ip: () => "You have used today's voice-input allowance on this public server — please type instead until tomorrow." },
};

export class DailyBudget {
  readonly limits: BudgetLimits;
  private visitors = new Map<string, Set<string>>();   // day → visitor hashes seen (memory/file stores only)
  constructor(limits: Partial<BudgetLimits> & Pick<BudgetLimits, 'chatsPerDay' | 'chatsPerIpPerDay' | 'speechCharsPerDay'>, readonly store: CounterStore = new MemoryStore(), private now = () => new Date()) {
    const L = { speechCharsPerIpPerDay: 0, transcriptionsPerDay: 0, transcriptionsPerIpPerDay: 0, ...limits };
    for (const [k, v] of Object.entries(L)) if (!Number.isInteger(v) || v < 0) throw new Error(`Budget limit ${k} must be a whole number ≥ 0 (got ${String(v)})`);
    this.limits = L;
  }
  private caps(m: MeterName): [number, number] {
    const L = this.limits;
    return m === 'chat' ? [L.chatsPerDay, L.chatsPerIpPerDay] : m === 'speech' ? [L.speechCharsPerDay, L.speechCharsPerIpPerDay] : [L.transcriptionsPerDay, L.transcriptionsPerIpPerDay];
  }
  /** true when this meter has any limit (unmetered meters never touch the store) */
  metered(m: MeterName) { const [a, b] = this.caps(m); return a > 0 || b > 0; }
  private visitorKey(day: string, ip: string | undefined) {
    const h = createHash('sha256').update(`${this.store.secret()}|${day}|${visitorOf(ip)}`).digest('base64url').slice(0, 22);
    if (this.store.kind === 'upstash') return h;
    // memory/file: past this many distinct visitors in one day, new ones share one "overflow" visitor allowance —
    // conservative (never more than the per-visitor cap in total for all of them), instead of wiping everyone's counts
    let seen = this.visitors.get(day);
    if (!seen) { this.visitors.clear(); seen = new Set(); this.visitors.set(day, seen); }
    if (seen.has(h)) return h;
    if (seen.size >= MAX_VISITORS_TRACKED) return 'overflow';
    seen.add(h); return h;
  }

  /** Reserve `amount` of a meter for this visitor. On success you get a one-shot refund(). */
  async reserve(m: MeterName, ip: string | undefined, amount: number): Promise<Reservation> {
    if (!Number.isInteger(amount) || amount < 1) throw new Error('reserve: amount must be a whole number ≥ 1');
    const now = this.now(); const retryAfterS = secondsToUtcMidnight(now);
    if (!this.metered(m)) return { ok: true, refund: async () => {} };
    const [maxAll, maxIp] = this.caps(m);
    const day = utcDay(now); const kAll = `nexus:${day}:${m}:all`; const kIp = `nexus:${day}:${m}:v:${this.visitorKey(day, ip)}`;
    const undo: [string, number][] = [];
    try {
      if (maxAll) { const v = await this.store.incr(kAll, amount, TTL_S); undo.push([kAll, amount]); if (v > maxAll) { await this.rollback(undo); return { ok: false, reason: TEXT[m].all, status: 429, code: m === 'chat' ? 'rate_limited' : 'quota', retryAfterS }; } }
      if (maxIp) { const v = await this.store.incr(kIp, amount, TTL_S); undo.push([kIp, amount]); if (v > maxIp) { await this.rollback(undo); return { ok: false, reason: TEXT[m].ip(maxIp), status: 429, code: m === 'chat' ? 'rate_limited' : 'quota', retryAfterS }; } }
    } catch {
      await this.rollback(undo).catch(() => {});
      return { ok: false, reason: 'Usage limits cannot be checked right now, so this request was not sent to the AI or voice service. Please try again shortly.', status: 503, code: 'quota_unavailable', retryAfterS: 30 };
    }
    let refunded = false;
    return { ok: true, refund: async () => { if (refunded) return; refunded = true; await this.rollback(undo).catch(() => {}); } };
  }
  private async rollback(undo: [string, number][]) { for (const [k, n] of undo.splice(0).reverse()) await this.store.incr(k, -n, TTL_S); }

  /** Today's whole-server totals (no visitor data). */
  async snapshot() {
    const day = utcDay(this.now()); const out: Record<MeterName, number> = { chat: 0, speech: 0, stt: 0 };
    for (const m of ['chat', 'speech', 'stt'] as const) if (this.caps(m)[0]) out[m] = await this.store.incr(`nexus:${day}:${m}:all`, 0, TTL_S).catch(() => -1);
    return { day, store: this.store.kind, totals: out, limits: this.limits };
  }
}
