/**
 * Local reminders & timers. Requests like "remind me in 10 minutes to stretch", "set a timer for 5 minutes" or
 * "remind me at 5:30pm to call mom" are understood on this device by a deterministic parser (no AI needed, works
 * offline), stored in IndexedDB, and fired while NEXUS is open. Reminders that came due while the app was
 * closed fire on the next start, marked as late — the app never claims to have alerted you when it could not.
 */
import { z } from 'zod';
import type { KV } from '../storage/db';

export const REMINDER_LIMITS = { minMs: 5_000, maxMs: 7 * 24 * 3600_000, active: 50, textChars: 140 };

export const ReminderSchema = z.object({
  id: z.string().max(64), kind: z.enum(['timer', 'reminder']), text: z.string().max(REMINDER_LIMITS.textChars),
  createdAt: z.number(), dueAt: z.number(), status: z.enum(['pending', 'fired', 'cancelled', 'done']), firedAt: z.number().optional(), late: z.boolean().optional(),
});
export type Reminder = z.infer<typeof ReminderSchema>;
export interface ParsedReminder { kind: 'timer' | 'reminder'; dueAt: number; text: string }

const UNIT: Record<string, number> = { s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, h: 3600_000, hr: 3600_000, hrs: 3600_000, hour: 3600_000, hours: 3600_000, d: 86400_000, day: 86400_000, days: 86400_000 };
const WORDNUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };
// A duration is "<number><unit>" ("10m", "10 minutes") or "<word> <unit>" ("an hour", "ten minutes") — word amounts need a space,
// and the amount must start a word, so "9am", "ad", "3d printer" are NOT durations.
const WORD_AMOUNT = String.raw`half an?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|forty|fifty|sixty|ninety`;
const UNITS = String.raw`(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|hr|h|days?|d)`;
const ONE = String.raw`(?:(\d+(?:\.\d+)?)\s*|(${WORD_AMOUNT})\s+)${UNITS}(?![a-z])`;
const DURATION_SRC = String.raw`(?<![\w.:])${ONE}(?:\s*(?:and\s+)?${ONE})?`;
const DURATION = new RegExp(DURATION_SRC, 'i');
const DURATION_ONLY = new RegExp(String.raw`^\s*${DURATION_SRC}\s*$`, 'i');
const REL = new RegExp(String.raw`\bin\s+(${DURATION_SRC})`, 'gi');

function amount(num: string | undefined, word: string | undefined): number { if (num) return Number(num); const k = (word ?? '').toLowerCase(); if (k.startsWith('half')) return 0.5; return WORDNUM[k] ?? NaN; }
/** "1 hour 30 minutes" → ms (null if none) */
export function parseDuration(s: string): number | null {
  const m = DURATION.exec(s); if (!m) return null;
  let ms = amount(m[1], m[2]) * UNIT[m[3].toLowerCase()];
  if (m[6]) ms += amount(m[4], m[5]) * UNIT[m[6].toLowerCase()];
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
}
/** "5pm", "17:30", "5:30 pm", "noon" relative to now (today, or tomorrow if already past / "tomorrow" said). */
export function parseClock(s: string, now: number): number | null {
  const tomorrow = /\btomorrow\b/i.test(s);
  let h: number, min = 0;
  if (/\bat\s+noon\b/i.test(s)) h = 12; else if (/\bat\s+midnight\b/i.test(s)) h = 0;
  else {
    const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d:])/i.exec(s); if (!m) return null;
    h = Number(m[1]); min = m[2] ? Number(m[2]) : 0; const ap = m[3]?.toLowerCase().replace(/\./g, '');
    if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (!ap && !m[2] && h < 8) h += 12; // "at 5" in conversation almost always means 5 pm
  }
  const d = new Date(now); d.setSeconds(0, 0); d.setHours(h, min);
  if (tomorrow) d.setDate(d.getDate() + 1); else if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const cleanTask = (t: string) => t.replace(/^\s*(to|that|about)\s+/i, '').replace(/\s*(please|pls|thanks?)\W*$/i, '').replace(/[.!?\s]+$/, '').trim().slice(0, REMINDER_LIMITS.textChars);

/** Returns a reminder/timer if the message is clearly one; otherwise null (the message goes to the AI as usual). */
export function parseReminder(raw: string, now = Date.now()): ParsedReminder | { error: string } | null {
  const t = raw.trim();
  if (t.length > 300) return null;
  // "set a timer for 5 minutes [for tea]", "timer 90 seconds", or "[set a] 5 minute timer" (only a duration before "timer")
  const suffix = /^(?:(?:please\s+)?(?:set|start)\s+(?:a\s+|an\s+)?)?(.+?)[\s-]+timer[.!]?$/i.exec(t);
  const timer = /^(?:please\s+)?(?:set|start)\s+(?:a\s+|an\s+)?(?:timer|countdown)\s+(?:for\s+)?(.+)$/i.exec(t) ?? /^(?:timer|countdown)\s+(?:for\s+)?(.+)$/i.exec(t)
    ?? (suffix && DURATION_ONLY.test(suffix[1].replace(/(\d)-(?=[a-z])/gi, '$1 ')) ? [suffix[0], suffix[1].replace(/(\d)-(?=[a-z])/gi, '$1 ')] : null);
  if (timer) {
    const ms = parseDuration(timer[1]); if (ms === null) return null;
    if (ms < REMINDER_LIMITS.minMs || ms > REMINDER_LIMITS.maxMs) return { error: 'Timers can be between 5 seconds and 7 days.' };
    const label = cleanTask(timer[1].replace(DURATION, '').replace(/^\s*(for|called|named)\s+/i, ''));
    return { kind: 'timer', dueAt: now + ms, text: label || 'Timer' };
  }
  const rem = /^(?:please\s+)?(?:can you\s+|could you\s+)?remind\s+me\s+(.+)$/i.exec(t);
  if (!rem) return null;
  const body = rem[1];
  // the LAST "in <duration>" wins, so "put the cake in the oven in 5 minutes" keeps "in the oven" in the task
  const rels = [...body.matchAll(REL)]; const rel = rels.at(-1);
  let dueAt: number | null = null; let task = body;
  if (rel) { const ms = parseDuration(rel[1]); if (ms !== null) { dueAt = now + ms; task = body.slice(0, rel.index) + ' ' + body.slice((rel.index ?? 0) + rel[0].length); } }
  if (dueAt === null) { const at = parseClock(body, now); if (at !== null) { dueAt = at; task = body.replace(/\b(tomorrow\s+)?at\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?|\b(tomorrow\s+)?at\s+(noon|midnight)|\btomorrow\b/gi, ' '); } }
  if (dueAt === null && !/^\s*(to|about)\b/i.test(body)) return null; // e.g. "remind me what my favourite colour is" → a question for the AI
  if (dueAt === null) return { error: 'I can set a reminder with a time — for example “remind me in 20 minutes to stretch” or “remind me at 5:30pm to call Mum”.' };
  const ms = dueAt - now;
  if (ms < REMINDER_LIMITS.minMs || ms > REMINDER_LIMITS.maxMs) return { error: 'Reminders can be between 5 seconds and 7 days from now.' };
  return { kind: 'reminder', dueAt, text: cleanTask(task.replace(/\s+/g, ' ')) || 'Reminder' };
}

export function describeDue(dueAt: number, now = Date.now()): string {
  const ms = dueAt - now;
  const time = new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (ms < 90_000) return `in ${Math.max(1, Math.round(ms / 1000))} seconds`;
  if (ms < 3600_000) return `in ${Math.round(ms / 60_000)} minutes (${time})`;
  const sameDay = new Date(dueAt).toDateString() === new Date(now).toDateString();
  return sameDay ? `at ${time}` : `${new Date(dueAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

const newId = () => `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export class ReminderStore {
  items: Reminder[] = [];
  ready: Promise<void>;
  version = 0;
  onFire: ((r: Reminder) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** when this session started — a reminder due before this was missed while NEXUS was closed */
  readonly startedAt: number;
  constructor(private kv: KV, private clock: () => number = Date.now) { this.startedAt = clock(); this.ready = this.load(); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }
  private async load() {
    try { for (const row of await this.kv.all<unknown>('reminders')) { const p = ReminderSchema.safeParse(row); if (p.success) this.items.push(p.data); } } catch { /* storage unavailable */ }
    this.items.sort((a, b) => a.dueAt - b.dueAt); this.changed();
  }
  pending() { return this.items.filter((r) => r.status === 'pending').sort((a, b) => a.dueAt - b.dueAt); }
  recent() { return this.items.filter((r) => r.status === 'fired').sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0)).slice(0, 10); }
  async add(p: ParsedReminder): Promise<Reminder> {
    if (this.pending().length >= REMINDER_LIMITS.active) throw new Error(`You already have ${REMINDER_LIMITS.active} reminders — cancel some first.`);
    const r: Reminder = ReminderSchema.parse({ id: newId(), kind: p.kind, text: p.text, createdAt: this.clock(), dueAt: p.dueAt, status: 'pending' });
    await this.kv.put('reminders', r);
    this.items.push(r); this.changed(); this.schedule(); return r;
  }
  private async update(id: string, patch: Partial<Reminder>) {
    const r = this.items.find((x) => x.id === id); if (!r) return null;
    const next = { ...r, ...patch }; await this.kv.put('reminders', next);
    this.items = this.items.map((x) => (x.id === id ? next : x)); this.changed(); return next;
  }
  cancel(id: string) { return this.update(id, { status: 'cancelled' }).then((r) => { this.schedule(); return r; }); }
  dismiss(id: string) { return this.update(id, { status: 'done' }); }
  snooze(id: string, ms = 5 * 60_000) { return this.update(id, { status: 'pending', dueAt: this.clock() + ms, late: false }).then((r) => { this.schedule(); return r; }); }
  async clearFinished() { for (const r of this.items.filter((x) => x.status !== 'pending')) await this.kv.del('reminders', r.id).catch(() => {}); this.items = this.items.filter((x) => x.status === 'pending'); this.changed(); }

  /** Fires everything that is due (late ones flagged) and arms a timer for the next one. */
  async tick() {
    const now = this.clock();
    for (const r of this.pending().filter((x) => x.dueAt <= now)) {
      const fired = await this.update(r.id, { status: 'fired', firedAt: now, late: r.dueAt < this.startedAt }).catch(() => null);
      if (fired) this.onFire?.(fired);
    }
    this.schedule();
  }
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    const next = this.pending()[0]; if (!next) return;
    const wait = Math.min(Math.max(0, next.dueAt - this.clock()), 60_000); // re-check at least every minute (sleep, clock changes)
    this.timer = setTimeout(() => void this.tick(), wait);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
