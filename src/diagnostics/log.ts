/**
 * Asset 95 — privacy-conscious diagnostics. A bounded ring buffer of events with codes, timings and
 * counts. Message content is NOT recorded unless the user opts in, and is always secret-redacted.
 */
import { redact } from '../security/validation';
export interface DiagEvent { at: number; type: 'request' | 'error' | 'skill' | 'memory' | 'voice' | 'storage' | 'perf' | 'state'; code: string; ms?: number; detail?: string }
export class Diagnostics {
  events: DiagEvent[] = [];
  includeContent = false;
  private listeners = new Set<() => void>();
  version = 0;
  constructor(private max = 300) {}
  log(e: Omit<DiagEvent, 'at'>, content?: string) {
    const ev: DiagEvent = { ...e, at: Date.now(), detail: e.detail ? redact(e.detail).slice(0, 200) : undefined };
    if (content && this.includeContent) ev.detail = `${ev.detail ?? ''} | ${redact(content).slice(0, 200)}`;
    this.events.push(ev); if (this.events.length > this.max) this.events.shift();
    this.version++; this.listeners.forEach((f) => f());
  }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  counts() { const c: Record<string, number> = {}; for (const e of this.events) c[`${e.type}:${e.code}`] = (c[`${e.type}:${e.code}`] ?? 0) + 1; return c; }
  export() { return JSON.stringify({ format: 'nexus-diagnostics', exportedAt: new Date().toISOString(), includesContent: this.includeContent, events: this.events }, null, 2); }
  clear() { this.events = []; this.version++; this.listeners.forEach((f) => f()); }
}
