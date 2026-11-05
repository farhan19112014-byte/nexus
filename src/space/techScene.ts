/**
 * NEXUS technology environment — the robot page's backdrop (it replaces the earlier planetary scene). One Canvas 2D,
 * so it never competes with the 3D robot for a WebGL context.
 *
 * Layers, back to front: a dark navy gradient with a soft key light; a faint engineering grid; circuit traces with
 * pads (static, cached) along which an occasional data pulse travels; a slowly breathing neural network (nodes drift
 * on small closed paths, links fade with distance, a signal now and then runs along a link); a few translucent
 * glass panels with quiet data visualisations (a sparkline, bars, a ring gauge) that update slowly; a handful of
 * drifting data motes. Restrained by design: low alpha, cyan only as an accent, nothing flashes.
 *
 * Motion is continuous (closed paths, eased values — nothing jumps). The pointer tilts the layers a little (parallax)
 * and lights up nearby network nodes. `mood` (the robot's state) changes it subtly: thinking speeds the signals up,
 * speaking makes the network pulse gently, listening brightens it, an error dims it.
 */
export type Quality = 'high' | 'medium' | 'low';
export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export interface SceneOptions { focus: 'right' | 'full' | 'hero'; quality: Quality; theme: 'dark' | 'light'; seed?: number }

/** small deterministic PRNG so every load looks the same */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; }; }

const COUNTS: Record<Quality, { nodes: number; traces: number; motes: number; panels: number; signals: number }> = {
  high: { nodes: 46, traces: 26, motes: 26, panels: 3, signals: 4 }, medium: { nodes: 32, traces: 18, motes: 16, panels: 3, signals: 3 }, low: { nodes: 18, traces: 10, motes: 8, panels: 2, signals: 2 },
};
type P = { x: number; y: number };
interface Node { bx: number; by: number; ax: number; ay: number; fx: number; fy: number; ph: number; r: number; glow: number }
interface Trace { pts: P[]; len: number; pulse: number; speed: number; wait: number }
interface Signal { a: number; b: number; t: number; speed: number }
interface Panel { x: number; y: number; w: number; h: number; kind: 'spark' | 'bars' | 'ring'; data: number[]; target: number[]; tick: number; depth: number; /** sparkline scroll, 0…1 of one step */ scroll: number }
interface Mote { x: number; y: number; vy: number; r: number; ph: number }

export class TechScene {
  w = 1; h = 1; time = 0;
  /** eased pointer, −1…1 */
  px = 0; py = 0; private tx = 0; private ty = 0;
  private ptr: P | null = null;
  private nodes: Node[] = []; private links: [number, number][] = []; private traces: Trace[] = []; private signals: Signal[] = []; private panels: Panel[] = []; private motes: Mote[] = [];
  private mood: Mood = 'idle'; private speedK = 1; private glowK = 1; private pulse = 0; private nextSignal = 1.2; private r = rng(1);
  private bg: HTMLCanvasElement | OffscreenCanvas | null = null;
  constructor(public o: SceneOptions) {}

  resize(w: number, h: number) { this.w = Math.max(1, w); this.h = Math.max(1, h); this.populate(); this.bg = null; }
  setQuality(q: Quality) { if (q !== this.o.quality) { this.o.quality = q; this.populate(); this.bg = null; } }
  setTheme(t: 'dark' | 'light') { if (t !== this.o.theme) { this.o.theme = t; this.bg = null; } }
  setMood(m: Mood) { this.mood = m; }
  pointer(nx: number, ny: number, local: P | null = null) { this.tx = Math.max(-1, Math.min(1, nx)); this.ty = Math.max(-1, Math.min(1, ny)); this.ptr = local; }

  /** the region the network lives in (the robot owns the left of the robot page) */
  private get region() {
    const f = this.o.focus;
    if (f === 'right') return { x0: 0.5, x1: 0.98, y0: 0.06, y1: 0.9 };
    if (f === 'hero') return { x0: 0.62, x1: 1.0, y0: 0.02, y1: 0.55 };
    return { x0: 0.05, x1: 0.95, y0: 0.05, y1: 0.95 };
  }

  populate() {
    const r = rng(this.o.seed ?? 9_271); this.r = rng((this.o.seed ?? 9_271) + 17); const c = COUNTS[this.o.quality];
    const area = Math.min(1.6, (this.w * this.h) / (1440 * 900)); const k = Math.max(0.4, area);
    const R = this.region;
    this.nodes = Array.from({ length: Math.round(c.nodes * k) }, () => ({
      bx: (R.x0 + r() * (R.x1 - R.x0)) * this.w, by: (R.y0 + r() * (R.y1 - R.y0)) * this.h,
      ax: 5 + r() * 12, ay: 4 + r() * 10, fx: (0.15 + r() * 0.2) * (r() < 0.5 ? -1 : 1), fy: 0.12 + r() * 0.2, ph: r() * Math.PI * 2, r: 1.4 + r() * 2.2, glow: 0,
    }));
    // links: each node to its two nearest neighbours (unique pairs)
    const L = new Set<string>(); this.links = [];
    this.nodes.forEach((n, i) => {
      const near = this.nodes.map((m, j) => ({ j, d: Math.hypot(m.bx - n.bx, m.by - n.by) })).filter((x) => x.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
      for (const { j } of near) { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!L.has(key)) { L.add(key); this.links.push([Math.min(i, j), Math.max(i, j)]); } }
    });
    // circuit traces: from the page edges inward, orthogonal runs with 45° bends, ending in a pad
    this.traces = Array.from({ length: Math.round(c.traces * k) }, () => {
      const side = Math.floor(r() * 4); let x = side === 0 ? 0 : side === 1 ? this.w : r() * this.w; let y = side === 2 ? 0 : side === 3 ? this.h : r() * this.h;
      let dx = side === 0 ? 1 : side === 1 ? -1 : 0, dy = side === 2 ? 1 : side === 3 ? -1 : 0;
      const pts: P[] = [{ x, y }]; const segs = 3 + Math.floor(r() * 3);
      for (let s = 0; s < segs; s++) {
        const len = 40 + r() * 110; x += dx * len; y += dy * len; pts.push({ x, y });
        if (s < segs - 1) {   // a 45° bend into the perpendicular direction
          const diag = 24 + r() * 30; const turn = r() < 0.5 ? 1 : -1;
          if (dx !== 0) { x += dx * diag; y += turn * diag; dx = 0; dy = turn; } else { x += turn * diag; y += dy * diag; dy = 0; dx = turn; }
          pts.push({ x, y });
        }
      }
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return { pts, len, pulse: -1, speed: 120 + r() * 120, wait: 2 + r() * 14 };
    });
    const panelSpecs: Record<SceneOptions['focus'], [number, number, number, number, Panel['kind']][]> = {
      right: [[0.56, 0.08, 0.15, 0.11, 'spark'], [0.84, 0.46, 0.12, 0.16, 'ring'], [0.62, 0.72, 0.16, 0.1, 'bars']],
      hero: [[0.72, 0.08, 0.13, 0.1, 'spark'], [0.88, 0.3, 0.09, 0.13, 'ring'], [0.74, 0.4, 0.12, 0.08, 'bars']],
      full: [[0.08, 0.1, 0.16, 0.12, 'spark'], [0.78, 0.18, 0.12, 0.16, 'ring'], [0.12, 0.74, 0.16, 0.1, 'bars']],
    };
    this.panels = panelSpecs[this.o.focus].slice(0, c.panels).map(([x, y, w, h, kind], i) => {
      const n = kind === 'spark' ? 24 : kind === 'bars' ? 7 : 1; const data = Array.from({ length: n }, () => 0.25 + r() * 0.6);
      return { x: x * this.w, y: y * this.h, w: Math.max(90, w * this.w), h: Math.max(56, h * this.h), kind, data, target: data.slice(), tick: r() * 2, depth: 0.6 + i * 0.2, scroll: 0 };
    });
    this.motes = Array.from({ length: Math.round(c.motes * k) }, () => ({ x: r(), y: r(), vy: 0.004 + r() * 0.01, r: 0.6 + r() * 1.2, ph: r() * 6 }));
    this.signals = [];
  }

  /** positions and counters (tests / diagnostics) */
  snapshot() {
    return {
      nodes: this.nodes.map((n) => this.nodePos(n)), links: this.links.length, traces: this.traces.length, panels: this.panels.length,
      motes: this.motes.map((m) => [m.x, m.y] as const), pulses: this.traces.filter((t) => t.pulse >= 0).length, signals: this.signals.length,
      parallax: [this.px, this.py] as const, speedK: this.speedK, glow: this.nodes.reduce((a, n) => Math.max(a, n.glow), 0), panelData: this.panels.map((p) => p.data.slice()),
    };
  }
  private nodePos(n: Node): readonly [number, number] { const t = this.time; return [n.bx + Math.sin(t * n.fx + n.ph) * n.ax, n.by + Math.cos(t * n.fy + n.ph * 1.3) * n.ay] as const; }
  private dark() { return this.o.theme === 'dark'; }

  step(dt: number) {
    dt = Math.min(dt, 0.1); this.time += dt;
    const ease = (k: number) => 1 - Math.exp(-dt * k);
    this.px += (this.tx - this.px) * ease(2.2); this.py += (this.ty - this.py) * ease(2.2);
    const m = this.mood;
    this.speedK += ((m === 'thinking' ? 1.8 : 1) - this.speedK) * ease(1.5);
    this.glowK += ((m === 'listening' ? 1.3 : m === 'error' ? 0.55 : m === 'thinking' ? 1.15 : 1) - this.glowK) * ease(2);
    this.pulse += ((m === 'speaking' ? 1 : 0) - this.pulse) * ease(3);
    const c = COUNTS[this.o.quality];
    // circuit pulses: one travels a trace, then the trace rests a while (so only a few are ever lit)
    let lit = this.traces.filter((t) => t.pulse >= 0).length;
    for (const t of this.traces) {
      if (t.pulse >= 0) { t.pulse += (t.speed * this.speedK * dt) / Math.max(1, t.len); if (t.pulse > 1) { t.pulse = -1; t.wait = 4 + this.r() * 16; lit--; } }
      else if ((t.wait -= dt * this.speedK) <= 0) { if (lit < c.signals + 1) { t.pulse = 0; lit++; } else t.wait = 1 + this.r() * 3; }
    }
    // network signals along links
    for (const s of this.signals) s.t += s.speed * this.speedK * dt;
    this.signals = this.signals.filter((s) => s.t < 1);
    if ((this.nextSignal -= dt * this.speedK) <= 0 && this.links.length) {
      if (this.signals.length < c.signals) { const [a, b] = this.links[Math.floor(this.r() * this.links.length)]; const fwd = this.r() < 0.5; this.signals.push({ a: fwd ? a : b, b: fwd ? b : a, t: 0, speed: 0.5 + this.r() * 0.5 }); }
      this.nextSignal = 0.9 + this.r() * 2.2;
    }
    // pointer proximity lights nearby nodes (eased in and out)
    for (const n of this.nodes) {
      let target = 0;
      if (this.ptr) { const [x, y] = this.nodePos(n); const d = Math.hypot(x + this.px * 10 - this.ptr.x, y + this.py * 10 - this.ptr.y); if (d < 140) target = 1 - d / 140; }
      n.glow += (target - n.glow) * ease(target > n.glow ? 8 : 2.5);
    }
    // panels: data eases toward a new target every couple of seconds (a quiet, live-looking readout)
    for (const p of this.panels) {
      p.tick += dt; if (p.kind === 'spark') p.scroll = Math.min(1, p.tick / 2.2);
      if (p.tick > 2.2) { p.tick = 0; if (p.kind === 'spark') { p.target.shift(); p.target.push(Math.max(0.1, Math.min(0.95, p.target[p.target.length - 1] + (this.r() - 0.5) * 0.35))); p.data.shift(); p.data.push(p.data[p.data.length - 1]); p.scroll = 0; } else p.target = p.target.map(() => 0.2 + this.r() * 0.7); }
      for (let i = 0; i < p.data.length; i++) p.data[i] += (p.target[i] - p.data[i]) * ease(1.6);
    }
    for (const mo of this.motes) { mo.y -= mo.vy * dt; mo.x += Math.sin(this.time * 0.2 + mo.ph) * 0.0008 * dt; if (mo.y < -0.04) mo.y = 1.04; }
  }

  private colors() {
    return this.dark()
      ? { line: 'rgba(125, 211, 252, ', node: 'rgba(56, 217, 255, ', glass: 'rgba(13, 24, 40, 0.42)', glassLine: 'rgba(125, 211, 252, 0.16)', text: 'rgba(148, 197, 255, ' }
      : { line: 'rgba(18, 104, 245, ', node: 'rgba(18, 104, 245, ', glass: 'rgba(255, 255, 255, 0.5)', glassLine: 'rgba(18, 104, 245, 0.16)', text: 'rgba(18, 104, 245, ' };
  }
  private background(): HTMLCanvasElement | OffscreenCanvas | null {
    if (this.bg) return this.bg;
    const make = (w: number, h: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
    const cv = make(Math.ceil(this.w), Math.ceil(this.h)); if (!cv) return null;
    const g = cv.getContext('2d') as CanvasRenderingContext2D | null; if (!g) return null;
    const dark = this.dark(); const C = this.colors();
    const grd = g.createLinearGradient(0, 0, 0, this.h);
    if (dark) { grd.addColorStop(0, '#050c1b'); grd.addColorStop(0.55, '#071429'); grd.addColorStop(1, '#040915'); } else { grd.addColorStop(0, '#f2f7ff'); grd.addColorStop(1, '#e2ecfb'); }
    g.fillStyle = grd; g.fillRect(0, 0, this.w, this.h);
    const R = this.region; const kx = ((R.x0 + R.x1) / 2) * this.w, ky = ((R.y0 + R.y1) / 2) * this.h;
    const glow = g.createRadialGradient(kx, ky, 0, kx, ky, Math.max(this.w, this.h) * 0.55);
    glow.addColorStop(0, dark ? 'rgba(18, 104, 245, 0.16)' : 'rgba(255, 255, 255, 0.9)'); glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = glow; g.fillRect(0, 0, this.w, this.h);
    // engineering grid, fading toward the edges
    g.lineWidth = 1; const step = 48;
    for (let x = (this.w % step) / 2; x < this.w; x += step) { g.strokeStyle = `${C.line}${dark ? 0.035 : 0.06})`; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, this.h); g.stroke(); }
    for (let y = (this.h % step) / 2; y < this.h; y += step) { g.strokeStyle = `${C.line}${dark ? 0.035 : 0.06})`; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(this.w, y + 0.5); g.stroke(); }
    // circuit traces and pads
    for (const t of this.traces) {
      g.strokeStyle = `${C.line}${dark ? 0.1 : 0.14})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(t.pts[0].x, t.pts[0].y); for (const p of t.pts.slice(1)) g.lineTo(p.x, p.y); g.stroke();
      const e = t.pts[t.pts.length - 1]; g.beginPath(); g.arc(e.x, e.y, 3, 0, Math.PI * 2); g.stroke();
      g.fillStyle = `${C.line}${dark ? 0.08 : 0.1})`; g.beginPath(); g.arc(e.x, e.y, 1.4, 0, Math.PI * 2); g.fill();
    }
    this.bg = cv; return cv;
  }
  private along(t: Trace, f: number): P {
    let d = f * t.len;
    for (let i = 1; i < t.pts.length; i++) { const a = t.pts[i - 1], b = t.pts[i]; const l = Math.hypot(b.x - a.x, b.y - a.y); if (d <= l) return { x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l }; d -= l; }
    return t.pts[t.pts.length - 1];
  }

  draw(g: CanvasRenderingContext2D) {
    const dark = this.dark(); const C = this.colors(); const G = this.glowK;
    g.clearRect(0, 0, this.w, this.h);
    const bg = this.background(); if (bg) g.drawImage(bg as CanvasImageSource, 0, 0, this.w, this.h);
    // circuit pulses (traces are in the cached background)
    g.save(); g.translate(this.px * 4, this.py * 3);
    for (const t of this.traces) if (t.pulse >= 0) {
      const a = this.along(t, Math.max(0, t.pulse - 0.06)), b = this.along(t, t.pulse);
      const lg = g.createLinearGradient(a.x, a.y, b.x, b.y); lg.addColorStop(0, `${C.node}0)`); lg.addColorStop(1, `${C.node}${0.55 * G})`);
      g.strokeStyle = lg; g.lineWidth = 1.8; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.restore();
    // neural network
    g.save(); g.translate(this.px * 10, this.py * 7);
    const pos = this.nodes.map((n) => this.nodePos(n));
    g.lineWidth = 1;
    for (const [i, j] of this.links) {
      const [x1, y1] = pos[i], [x2, y2] = pos[j]; const d = Math.hypot(x2 - x1, y2 - y1); const a = Math.max(0, 1 - d / 260) * (dark ? 0.2 : 0.26) * G * (1 + 0.6 * Math.max(this.nodes[i].glow, this.nodes[j].glow));
      if (a < 0.01) continue; g.strokeStyle = `${C.line}${a})`; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    for (const s of this.signals) {
      const [x1, y1] = pos[s.a], [x2, y2] = pos[s.b]; const x = x1 + (x2 - x1) * s.t, y = y1 + (y2 - y1) * s.t; const a = Math.sin(Math.PI * s.t) * 0.8 * G;
      g.fillStyle = `${C.node}${a})`; g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    }
    const breathe = this.pulse * (0.5 + 0.5 * Math.sin(this.time * 3.2));
    this.nodes.forEach((n, i) => {
      const [x, y] = pos[i]; const a = Math.min(1, (dark ? 0.42 : 0.5) * G + n.glow * 0.5 + breathe * 0.18);
      if (n.glow > 0.05 || breathe > 0.1) { const rg = g.createRadialGradient(x, y, 0, x, y, n.r * 6); rg.addColorStop(0, `${C.node}${0.22 * (n.glow + breathe * 0.5)})`); rg.addColorStop(1, `${C.node}0)`); g.fillStyle = rg; g.beginPath(); g.arc(x, y, n.r * 6, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = `${C.node}${a})`; g.beginPath(); g.arc(x, y, n.r, 0, Math.PI * 2); g.fill();
    });
    g.restore();
    // translucent panels with quiet readouts
    for (const p of this.panels) {
      g.save(); g.translate(this.px * 16 * p.depth, this.py * 10 * p.depth);
      g.fillStyle = C.glass; g.strokeStyle = C.glassLine; g.lineWidth = 1;
      g.beginPath(); g.roundRect?.(p.x, p.y, p.w, p.h, 10); if (!g.roundRect) g.rect(p.x, p.y, p.w, p.h); g.fill(); g.stroke();
      g.fillStyle = `${C.text}0.35)`; g.fillRect(p.x + 10, p.y + 10, p.w * 0.32, 2); g.fillRect(p.x + 10, p.y + 16, p.w * 0.18, 2);
      const ix = p.x + 10, iy = p.y + 26, iw = p.w - 20, ih = p.h - 36;
      if (p.kind === 'spark') {
        g.strokeStyle = `${C.node}${0.5 * G})`; g.lineWidth = 1.4; g.beginPath();
        const stepW = iw / (p.data.length - 2); g.save(); g.beginPath(); g.rect(ix, iy - 2, iw, ih + 4); g.clip(); g.beginPath();
        p.data.forEach((v, i) => { const x = ix + (i - p.scroll) * stepW, y = iy + ih - v * ih; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.restore();
      } else if (p.kind === 'bars') {
        const bw = iw / p.data.length; p.data.forEach((v, i) => { g.fillStyle = `${C.node}${0.22 + 0.18 * v})`; g.fillRect(ix + i * bw + 2, iy + ih - v * ih, bw - 4, v * ih); });
      } else {
        const cx = p.x + p.w / 2, cy = iy + ih / 2, rr = Math.max(8, Math.min(iw, ih) / 2 - 2);
        g.strokeStyle = `${C.line}0.14)`; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = `${C.node}${0.55 * G})`; g.beginPath(); g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + p.data[0] * Math.PI * 2); g.stroke();
      }
      g.restore();
    }
    // data motes
    for (const m of this.motes) {
      const edge = Math.min(1, m.y * 6, (1 - m.y) * 6); if (edge <= 0) continue;
      g.fillStyle = `${C.node}${(dark ? 0.35 : 0.3) * edge * (0.6 + 0.4 * Math.sin(this.time + m.ph))})`; g.beginPath(); g.arc(m.x * this.w + this.px * 6, m.y * this.h + this.py * 4, m.r, 0, Math.PI * 2); g.fill();
    }
  }
}
