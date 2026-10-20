/**
 * Asset 20 — expression runtime. Requests come from several sources (system state, the AI
 * response, skill cues, user preview); the highest priority wins, ties go to the most recent.
 * Transitions interpolate from the currently displayed face to the new preset.
 * Low-priority reactions (e.g. "surprised", 2) can never override urgent ones (error, 5).
 */
import { CHANNELS, FACE_CHANNELS, isChannel, clampChannel, type Channel, type ChannelValues } from '../../shared/channels';
import type { ExpressionPreset } from '../../shared/schema';
import type { FaceSource } from '../animation/engine';
import { ease } from '../animation/timeline';

export type ExprSource = 'system' | 'response' | 'skill' | 'user' | 'reaction' | 'attention';
interface Request { source: ExprSource; id: string; intensity: number; priority: number; seq: number; until: number | null }

export class ExpressionController implements FaceSource {
  private presets = new Map<string, ExpressionPreset>();
  private requests: Request[] = [];
  private seq = 0;
  private time = 0;
  private from: Record<string, number> = {};
  private to: Record<string, number> = {};
  private head = { from: { rot: 0, nod: 0, y: 0 }, to: { rot: 0, nod: 0, y: 0 } };
  private progress = 1;
  private durS = 0.25;
  private shown = 'neutral';
  private listeners = new Set<(id: string) => void>();
  /** Asset 18: playful reactions can be disabled. */
  allowPlayful = true;

  constructor(presets: ExpressionPreset[]) {
    for (const p of presets) this.presets.set(p.id, p);
    this.to = this.compute('neutral', 1); this.from = { ...this.to };
  }
  register(p: ExpressionPreset) { this.presets.set(p.id, p); }
  /** Face shown when nothing else is requested (Settings → Personalization → resting face). */
  baseline = 'neutral';
  setBaseline(id: string) { if (!this.presets.has(id)) return false; if (id !== this.baseline) { this.baseline = id; this.lastKey = ''; this.resolve(); } return true; }
  unregister(id: string) { this.presets.delete(id); this.requests = this.requests.filter((r) => r.id !== id); }
  has(id: string) { return this.presets.has(id); }
  get(id: string) { return this.presets.get(id); }
  ids() { return [...this.presets.keys()]; }
  onChange(fn: (id: string) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Request an expression. `seconds` makes it transient. Returns false if unknown/disabled. */
  set(source: ExprSource, id: string, intensity = 1, seconds: number | null = null, priority?: number): boolean {
    const p = this.presets.get(id);
    if (!p) return false;
    if (!this.allowPlayful && p.tags.includes('optional')) id = 'happy';
    this.requests = this.requests.filter((r) => r.source !== source);
    this.requests.push({ source, id, intensity: Math.max(0, Math.min(1, intensity)), priority: priority ?? p.priority, seq: ++this.seq, until: seconds === null ? null : this.time + seconds });
    this.resolve();
    return true;
  }
  release(source: ExprSource) { this.requests = this.requests.filter((r) => r.source !== source); this.resolve(); }
  current() { return this.shown; }
  /** true when no face transition is in progress */
  settled() { return this.progress >= 1; }
  blinkRate() { return this.presets.get(this.shown)?.blinkRate ?? 1; }
  idleMotion() { return this.presets.get(this.shown)?.idleMotion ?? null; }

  private winner(): Request | null {
    const live = this.requests.filter((r) => r.until === null || r.until > this.time);
    if (!live.length) return null;
    return live.reduce((a, b) => (b.priority > a.priority || (b.priority === a.priority && b.seq > a.seq) ? b : a));
  }

  private compute(id: string, intensity: number): Record<string, number> {
    const p = this.presets.get(id) ?? this.presets.get('neutral')!;
    const out: Record<string, number> = {};
    for (const ch of FACE_CHANNELS) {
      const rest = CHANNELS[ch].rest;
      const v = p.face[ch];
      out[ch] = v === undefined ? rest : clampChannel(ch, rest + (v - rest) * intensity);
    }
    return out;
  }

  private resolve() {
    const w = this.winner();
    const id = w?.id ?? this.baseline;
    const key = `${id}@${w?.intensity ?? 1}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.from = this.snapshot();
    this.head.from = this.headNow();
    this.to = this.compute(id, w?.intensity ?? 1);
    const p = this.presets.get(id)!;
    const i = w?.intensity ?? 1;
    this.head.to = { rot: (p.head.rot ?? 0) * i, nod: (p.head.nod ?? 0) * i, y: (p.head.y ?? 0) * i };
    this.durS = p.transitionMs / 1000;
    this.progress = 0;
    this.shown = id;
    this.listeners.forEach((f) => f(id));
  }
  private lastKey = '';

  private snapshot() { const u = ease('easeInOut', this.progress); const o: Record<string, number> = {}; for (const k in this.to) o[k] = (this.from[k] ?? this.to[k]) + (this.to[k] - (this.from[k] ?? this.to[k])) * u; return o; }
  private headNow() { const u = ease('easeInOut', this.progress); const f = this.head.from, t = this.head.to; return { rot: f.rot + (t.rot - f.rot) * u, nod: f.nod + (t.nod - f.nod) * u, y: f.y + (t.y - f.y) * u }; }

  update(dt: number) {
    this.time += dt;
    if (this.requests.some((r) => r.until !== null && r.until <= this.time)) {
      this.requests = this.requests.filter((r) => r.until === null || r.until > this.time);
      this.resolve();
    }
    this.progress = Math.min(1, this.progress + dt / Math.max(0.05, this.durS));
  }
  targets(): ChannelValues {
    const s = this.snapshot(); const out: ChannelValues = {};
    for (const k in s) if (isChannel(k)) out[k as Channel] = s[k];
    return out;
  }
  headOffset() { return this.headNow(); }
  debugRequests() { return this.requests.map((r) => ({ ...r })); }
}
