/**
 * MISSION NEXUS space environment — a real 3D scene projected onto one Canvas 2D (perspective camera, depth sorting,
 * camera parallax), so it never competes with the 3D robot for a WebGL context.
 *
 * World: a banded planet at the system origin with its own ring; three inclined orbital rings carrying moons and probes
 * (different radii, speeds and directions); an asteroid belt on an inclined orbit that passes in front of and behind the
 * planet; a slowly turning orbital station; wireframe structures; two distant planets; three star layers; near-field
 * dust; soft light rays from the system's star; an occasional shooting star.
 *
 * Motion is continuous: everything follows closed orbits or eased springs — nothing jumps. The pointer turns the camera
 * a little (parallax), pushes nearby dust aside (it springs back), and lights up an orbital ring when it passes over it.
 * `mood` (the robot's state) changes the environment subtly: thinking speeds the orbits up, speaking makes the planet's
 * atmosphere pulse, listening brightens the light, an error dims it.
 */
export type Quality = 'high' | 'medium' | 'low';
export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';
export interface SceneOptions { focus: 'right' | 'full' | 'hero'; quality: Quality; theme: 'dark' | 'light'; seed?: number }
type V3 = [number, number, number];

/** small deterministic PRNG so every load looks the same */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; }; }

const PHI = (1 + Math.sqrt(5)) / 2;
const SHAPES = {
  octa: { v: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[], e: [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]] },
  cube: { v: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((p) => p.map((c) => c * 0.7)) as V3[], e: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] },
  icosa: (() => {
    const v = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map((p) => p.map((c) => c / Math.hypot(1, PHI)) as V3);
    const e: number[][] = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]) - 1.0515) < 0.05) e.push([i, j]);
    return { v, e };
  })(),
};
export const shapeEdges = (k: keyof typeof SHAPES) => SHAPES[k].e.length;
const COUNTS: Record<Quality, { stars: number; dust: number; belt: number; ringPts: number; rays: boolean }> = {
  high: { stars: 300, dust: 54, belt: 22, ringPts: 96, rays: true }, medium: { stars: 180, dust: 30, belt: 14, ringPts: 72, rays: true }, low: { stars: 100, dust: 14, belt: 8, ringPts: 48, rays: false },
};

/** rotate a point about X then Y (radians) */
const rotXY = ([x, y, z]: V3, ax: number, ay: number): V3 => { const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay); const y1 = y * cx - z * sx, z1 = y * sx + z * cx; return [x * cy + z1 * sy, y1, -x * sy + z1 * cy]; };

interface Orbit { r: number; incl: number; node: number; speed: number; phase: number; body: 'moon' | 'probe'; size: number; glow: number }
interface Rock { r: number; incl: number; node: number; speed: number; phase: number; dy: number; size: number; spin: number; rot: number; shape: number[] }
interface Dust { p: V3; v: V3; r: number; phase: number; ox: number; oy: number; vx: number; vy: number }
interface Star { x: number; y: number; r: number; layer: number; phase: number; speed: number; base: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number; age: number; len: number }
type Draw = { z: number; f: () => void };

export class SpaceScene {
  w = 1; h = 1; time = 0;
  /** eased camera from the pointer, −1…1 */
  px = 0; py = 0; private tx = 0; private ty = 0;
  /** pointer in canvas pixels (for proximity and hover), null when outside */
  private ptr: { x: number; y: number } | null = null;
  private stars: Star[] = []; private dust: Dust[] = []; private orbits: Orbit[] = []; private belt: Rock[] = []; private meteor: Meteor | null = null; private nextMeteor = 7;
  private glowRing = [0, 0, 0]; private ringHit = [0, 0, 0];
  private mood: Mood = 'idle'; private speedK = 1; private glowK = 1; private pulse = 0;
  private bg: HTMLCanvasElement | OffscreenCanvas | null = null; private bands: HTMLCanvasElement | OffscreenCanvas | null = null;
  constructor(public o: SceneOptions) {}

  resize(w: number, h: number) { this.w = Math.max(1, w); this.h = Math.max(1, h); this.populate(); this.bg = null; }
  setQuality(q: Quality) { if (q !== this.o.quality) { this.o.quality = q; this.populate(); } }
  setTheme(t: 'dark' | 'light') { if (t !== this.o.theme) { this.o.theme = t; this.bg = null; this.bands = null; } }
  setMood(m: Mood) { this.mood = m; }
  /** pointer: normalised −1…1 for the camera, plus canvas pixels for proximity effects (or null when outside) */
  pointer(nx: number, ny: number, local: { x: number; y: number } | null = null) { this.tx = Math.max(-1, Math.min(1, nx)); this.ty = Math.max(-1, Math.min(1, ny)); this.ptr = local; }

  /** where the system sits on screen, and its scale */
  private get layout() {
    const f = this.o.focus;
    if (f === 'right') return { cx: 0.76, cy: 0.42, scale: 1 };
    if (f === 'hero') return { cx: 0.94, cy: 0.26, scale: 0.55 };   // small, in the corner: clear of the navigation and the copy
    return { cx: 0.8, cy: 0.3, scale: 0.85 };
  }
  private get unit() { return Math.min(this.w, this.h * 1.25); }

  populate() {
    const r = rng(this.o.seed ?? 7_310); const c = COUNTS[this.o.quality];
    const area = Math.min(1.6, (this.w * this.h) / (1440 * 900));
    this.stars = Array.from({ length: Math.round(c.stars * Math.max(0.35, area)) }, () => { const layer = r() < 0.6 ? 0 : r() < 0.85 ? 1 : 2; return { x: r() * this.w * 1.1 - this.w * 0.05, y: r() * this.h * 1.1 - this.h * 0.05, r: 0.35 + r() * (layer === 2 ? 1.2 : 0.75), layer, phase: r() * Math.PI * 2, speed: 0.3 + r() * 1.2, base: 0.3 + r() * 0.6 }; });
    // dust lives in camera space: x/y in screen fractions, z = depth 0.3 (near) … 1 (far)
    this.dust = Array.from({ length: Math.round(c.dust * Math.max(0.4, area)) }, () => ({ p: [r(), r(), 0.3 + r() * 0.7] as V3, v: [(r() - 0.5) * 0.004, -(0.004 + r() * 0.01), 0] as V3, r: 0.6 + r() * 1.5, phase: r() * 6, ox: 0, oy: 0, vx: 0, vy: 0 }));
    this.orbits = [
      { r: 1.75, incl: 1.28, node: -0.35, speed: 0.22, phase: 0.4, body: 'moon', size: 0.13, glow: 0 },
      { r: 2.45, incl: 1.18, node: 0.25, speed: -0.13, phase: 2.6, body: 'probe', size: 0.05, glow: 0.9 },
      { r: 3.3, incl: 1.36, node: -0.12, speed: 0.08, phase: 4.4, body: 'moon', size: 0.08, glow: 0 },
    ];
    this.belt = Array.from({ length: c.belt }, () => { const n = 7 + Math.floor(r() * 4); return { r: 2.0 + r() * 0.55, incl: 1.22 + r() * 0.06, node: 0.6, speed: 0.05 + r() * 0.03, phase: r() * Math.PI * 2, dy: (r() - 0.5) * 0.12, size: 0.025 + r() * 0.04, spin: (r() - 0.5) * 0.8, rot: r() * 6, shape: Array.from({ length: n }, () => 0.66 + r() * 0.34) }; });
  }

  /** positions of moving things (tests / diagnostics) */
  snapshot() {
    return {
      dust: this.dust.map((d) => [d.p[0], d.p[1]] as const), belt: this.belt.map((b) => b.phase), orbits: this.orbits.map((o) => o.phase),
      stars: this.stars.length, meteor: this.meteor ? { ...this.meteor } : null, parallax: [this.px, this.py] as const, glow: [...this.glowRing], speedK: this.speedK,
    };
  }
  private dark() { return this.o.theme === 'dark'; }

  /** advance by dt seconds */
  step(dt: number) {
    dt = Math.min(dt, 0.1); this.time += dt;
    const ease = (k: number) => 1 - Math.exp(-dt * k);
    this.px += (this.tx - this.px) * ease(2.2); this.py += (this.ty - this.py) * ease(2.2);
    const m = this.mood;
    this.speedK += ((m === 'thinking' ? 1.7 : 1) - this.speedK) * ease(1.5);
    this.glowK += ((m === 'listening' ? 1.3 : m === 'error' ? 0.6 : m === 'thinking' ? 1.15 : 1) - this.glowK) * ease(2);
    this.pulse += ((m === 'speaking' ? 1 : 0) - this.pulse) * ease(3);
    for (const o of this.orbits) o.phase += o.speed * this.speedK * dt;
    for (const b of this.belt) { b.phase += b.speed * this.speedK * dt; b.rot += b.spin * dt; }
    for (let i = 0; i < 3; i++) this.glowRing[i] += (this.ringHit[i] - this.glowRing[i]) * ease(6);
    for (const d of this.dust) {
      d.p[0] += (d.v[0] + Math.sin(this.time * 0.25 + d.phase) * 0.0015) * dt; d.p[1] += d.v[1] * dt;
      if (d.p[1] < -0.06) d.p[1] = 1.06; if (d.p[0] < -0.06) d.p[0] = 1.06; else if (d.p[0] > 1.06) d.p[0] = -0.06;   // off-screen only (they fade at the edges)
      // pointer proximity: a soft push away, then a spring back to the drift path
      let fx = -d.ox * 6 - d.vx * 3.2, fy = -d.oy * 6 - d.vy * 3.2;
      if (this.ptr) { const sx = d.p[0] * this.w + d.ox, sy = d.p[1] * this.h + d.oy; const dx = sx - this.ptr.x, dy = sy - this.ptr.y; const dist = Math.hypot(dx, dy); const R = 110;
        if (dist < R && dist > 0.01) { const k = (1 - dist / R) * 900 * (1.3 - d.p[2]); fx += (dx / dist) * k; fy += (dy / dist) * k; } }
      d.vx += fx * dt; d.vy += fy * dt; d.ox += d.vx * dt; d.oy += d.vy * dt;
    }
    if (this.meteor) { this.meteor.age += dt; this.meteor.x += this.meteor.vx * dt; this.meteor.y += this.meteor.vy * dt; if (this.meteor.age >= this.meteor.life) this.meteor = null; }
    else if ((this.nextMeteor -= dt) <= 0) {
      const r = rng(Math.floor(this.time * 1000) + 3); const sp = this.unit * (0.7 + r() * 0.4); const ang = Math.PI * (0.78 + r() * 0.1);
      this.meteor = { x: this.w * (0.55 + r() * 0.45), y: this.h * (0.04 + r() * 0.3), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6, life: 1.1 + r() * 0.5, age: 0, len: this.unit * (0.12 + r() * 0.08) };
      this.nextMeteor = 10 + r() * 12;
    }
  }

  /** camera: the system is viewed from a slowly breathing angle that the pointer turns a little */
  private cam() {
    const L = this.layout; const u = this.unit * 0.14 * L.scale;   // world unit = planet radius in px
    const yaw = this.px * 0.16 + Math.sin(this.time * 0.021) * 0.05, pitch = -0.08 + this.py * 0.07 + Math.sin(this.time * 0.017 + 1) * 0.02;
    const D = 9;   // camera distance in planet radii
    const proj = (p: V3) => { const q = rotXY(p, pitch, yaw); const s = D / (D + q[2]); return { x: this.w * L.cx + q[0] * u * s, y: this.h * L.cy + q[1] * u * s, z: q[2], s }; };
    return { u, proj, yaw, pitch };
  }
  private orbitPoint(r: number, incl: number, node: number, a: number, dy = 0): V3 {
    // circle in XZ, inclined about X, then rotated about Y by the node angle
    const p: V3 = [Math.cos(a) * r, dy, Math.sin(a) * r]; return rotXY(rotXY(p, incl - Math.PI / 2, 0), 0, node);
  }

  draw(g: CanvasRenderingContext2D) {
    const { w, h } = this; const d = this.dark(); const t = this.time; const U = this.unit; const q = COUNTS[this.o.quality];
    g.clearRect(0, 0, w, h);
    // the nebula's light breathes very slowly (atmosphere), a little brighter while NEXUS listens
    g.globalAlpha = Math.min(1, (0.8 + 0.2 * Math.sin(t * 0.035)) * this.glowK); g.drawImage(this.backdrop() as CanvasImageSource, 0, 0, w, h); g.globalAlpha = 1;
    const C = this.cam();
    const sky = (a: number) => (d ? `rgba(125,211,252,${a})` : `rgba(14,165,233,${a})`);
    const blue = (a: number) => (d ? `rgba(59,139,255,${a})` : `rgba(18,104,245,${a})`); const cyan = (a: number) => (d ? `rgba(56,217,255,${a})` : `rgba(18,104,245,${a})`);

    // stars: three layers, parallax grows with nearness, slow twinkle
    for (const s of this.stars) {
      const k = [0.3, 0.7, 1.3][s.layer]; const x = s.x - C.yaw * U * 0.09 * k, y = s.y + (C.pitch + 0.08) * U * 0.09 * k;
      g.globalAlpha = s.base * (0.72 + 0.28 * Math.sin(t * s.speed + s.phase)) * (d ? 1 : 0.4); g.fillStyle = d ? (s.phase < 1 ? '#7dd3fc' : s.layer === 2 ? '#e6f4ff' : '#a9c8ff') : (s.phase < 1 ? '#0284c7' : '#2e5ea8');
      g.beginPath(); g.arc(x, y, s.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    // light rays from the system's star (off-screen, upper right), breathing slowly
    if (q.rays) {
      const sx = w * 1.05, sy = -h * 0.12;
      for (let i = 0; i < 3; i++) {
        const ang = Math.PI * (0.62 + i * 0.07) + Math.sin(t * 0.05 + i) * 0.02; const len = Math.hypot(w, h) * 0.95; const wid = 0.045 + i * 0.012;
        const gr = g.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); gr.addColorStop(0, (i === 1 ? sky : cyan)((d ? 0.07 : 0.06) * this.glowK)); gr.addColorStop(1, 'rgba(56,217,255,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(ang - wid) * len, sy + Math.sin(ang - wid) * len); g.lineTo(sx + Math.cos(ang + wid) * len, sy + Math.sin(ang + wid) * len); g.closePath(); g.fill();
      }
    }

    // distant planets (far behind the system: small parallax)
    this.sphere(g, w * (this.o.focus === 'hero' ? 0.6 : this.o.focus === 'right' ? 0.58 : 0.14) - C.yaw * U * 0.04, h * (this.o.focus === 'hero' ? 0.9 : 0.14), U * 0.022, d ? ['#7aa6e8', '#1d3f78', '#08142a'] : ['#cfe0fb', '#7fa6e6', '#4a73b8']);
    this.sphere(g, w * (this.o.focus === 'right' ? 0.97 : this.o.focus === 'hero' ? 0.55 : 0.46) - C.yaw * U * 0.06, h * (this.o.focus === 'right' ? 0.9 : this.o.focus === 'hero' ? 0.6 : 0.06), U * 0.012, d ? ['#c9d6ea', '#4d5c76', '#0d1422'] : ['#ffffff', '#b8c6dc', '#7c8aa3']);

    // ---- the system: depth-sorted drawables ----
    const items: Draw[] = []; const R = C.u;
    // orbital rings: sampled 3D circles, split into segments sorted by depth; the pointer lights a ring up
    this.ringHit = [0, 0, 0];
    this.orbits.forEach((o, i) => {
      const pts = Array.from({ length: q.ringPts + 1 }, (_, k) => C.proj(this.orbitPoint(o.r, o.incl, o.node, (k / q.ringPts) * Math.PI * 2)));
      if (this.ptr) for (let k = 0; k < pts.length; k += 2) if (Math.hypot(pts[k].x - this.ptr.x, pts[k].y - this.ptr.y) < 14) { this.ringHit[i] = 1; break; }
      const lit = this.glowRing[i];
      for (let k = 0; k < q.ringPts; k += 4) {
        const seg = pts.slice(k, k + 5); const z = seg[2].z;
        items.push({ z, f: () => { g.strokeStyle = (i === 1 ? sky : blue)((0.16 + lit * 0.4 - i * 0.03) * (z > 0 ? 0.55 : 1) * this.glowK); g.lineWidth = 1 + lit * 1.2; g.setLineDash(i === 1 ? [3, 6] : []); g.beginPath(); seg.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); g.setLineDash([]); } });
      }
      // the body on this orbit
      const b = C.proj(this.orbitPoint(o.r, o.incl, o.node, o.phase));
      items.push({ z: b.z, f: () => {
        if (o.body === 'moon') this.sphere(g, b.x, b.y, R * o.size * b.s, i === 2 ? (d ? ['#e0f5ff', '#5fb4dc', '#0c2a3d'] : ['#ffffff', '#9ed9f5', '#4f97c0']) : d ? ['#c9d6ea', '#56657e', '#141c2a'] : ['#ffffff', '#b8c6dc', '#7c8aa3']);
        else { const rr = R * o.size * b.s; g.fillStyle = d ? '#dfe9f7' : '#0d1828'; g.fillRect(b.x - rr, b.y - rr * 0.4, rr * 2, rr * 0.8); const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, rr * 5); gr.addColorStop(0, cyan(0.55 * o.glow)); gr.addColorStop(1, 'rgba(56,217,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, rr * 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = cyan(0.7); g.lineWidth = 1; g.beginPath(); g.moveTo(b.x - rr * 2.6, b.y); g.lineTo(b.x + rr * 2.6, b.y); g.stroke(); }
      } });
    });
    // asteroid belt
    for (const a of this.belt) {
      const p = C.proj(this.orbitPoint(a.r, a.incl, a.node, a.phase, a.dy)); const size = R * a.size * p.s;
      items.push({ z: p.z, f: () => {
        g.save(); g.translate(p.x, p.y); g.rotate(a.rot); const gr = g.createLinearGradient(-size, -size, size, size); gr.addColorStop(0, d ? '#6b7a92' : '#a5b5cb'); gr.addColorStop(1, d ? '#121926' : '#56657d');
        g.fillStyle = gr; g.globalAlpha = p.z > 0 ? 0.75 : 1; g.beginPath(); a.shape.forEach((m, i) => { const ang = (i / a.shape.length) * Math.PI * 2; const x = Math.cos(ang) * size * m, y = Math.sin(ang) * size * m * 0.8; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.fill(); g.restore();
      } });
    }
    // the planet's own ring (thin annulus), split front/back like the orbits
    { const ringPts = (rad: number) => Array.from({ length: 65 }, (_, k) => C.proj(rotXY(rotXY([Math.cos((k / 64) * Math.PI * 2) * rad, 0, Math.sin((k / 64) * Math.PI * 2) * rad], 0.32, 0), 0, -0.35)));
      for (const [rad, a] of [[1.42, 0.34], [1.56, 0.26], [1.7, 0.16]] as const) {
        const pts = ringPts(rad);
        for (let k = 0; k < 64; k += 4) { const seg = pts.slice(k, k + 5); const z = seg[2].z; items.push({ z: z * 0.999, f: () => { g.strokeStyle = d ? `rgba(160,205,255,${a})` : `rgba(40,90,170,${a})`; g.lineWidth = R * 0.05; g.beginPath(); seg.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); } }); }
      }
    }
    // the planet itself (z = 0)
    const pc = C.proj([0, 0, 0]); items.push({ z: 0, f: () => this.planet(g, pc.x, pc.y, R * pc.s, t) });
    items.sort((a, b) => b.z - a.z).forEach((it) => it.f());

    // orbital station and wireframe structures (their own positions, outside the system)
    const spots: [number, number, keyof typeof SHAPES | 'station', number][] = this.o.focus === 'right'
      ? [[0.6, 0.17, 'octa', 0.03], [0.93, 0.76, 'icosa', 0.036], [0.62, 0.82, 'station', 0.05]]
      : this.o.focus === 'hero' ? [[0.5, 0.16, 'octa', 0.024], [0.97, 0.6, 'icosa', 0.028], [0.9, 0.9, 'station', 0.035]] : [[0.12, 0.22, 'octa', 0.03], [0.9, 0.7, 'icosa', 0.034], [0.5, 0.88, 'station', 0.045]];
    spots.forEach(([fx, fy, kind, sz], i) => {
      if (kind === 'station' && this.o.focus === 'right' && w < 1100) return;   // the robot fills the width on tablets: keep its feet clear
      const x = w * fx - C.yaw * U * 0.12, y = h * fy + Math.sin(t * 0.45 + i * 2) * U * 0.008; const S = U * sz;
      const near = this.ptr ? Math.max(0, 1 - Math.hypot(this.ptr.x - x, this.ptr.y - y) / (S * 3)) : 0;
      if (kind === 'station') { this.station(g, x, y, S, t, near); return; }
      const sh = SHAPES[kind]; const ax = t * (0.13 + i * 0.03), ay = t * (0.19 - i * 0.02);
      const pts = sh.v.map((v) => { const p = rotXY(v, ax, ay); const s = 3 / (3 + p[2]); return [x + p[0] * S * s, y + p[1] * S * s, p[2]] as const; });
      g.lineWidth = 1 + near * 0.6;
      for (const [a, b] of sh.e) { const z = (pts[a][2] + pts[b][2]) / 2; g.strokeStyle = d ? `rgba(120,190,255,${(0.3 - z * 0.12) * (1 + near)})` : `rgba(18,104,245,${(0.36 - z * 0.14) * (1 + near)})`; g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); g.stroke(); }
      g.fillStyle = cyan(0.55 + near * 0.4); for (const p of pts) { g.beginPath(); g.arc(p[0], p[1], 1.3, 0, Math.PI * 2); g.fill(); }
    });

    // near-field dust (fades near the edges so the off-screen wrap is invisible)
    for (const p of this.dust) {
      const k = 1.4 - p.p[2]; const x = p.p[0] * w + p.ox - C.yaw * U * 0.2 * k, y = p.p[1] * h + p.oy + (C.pitch + 0.08) * U * 0.2 * k;
      const edge = Math.min(1, x / 60, (w - x) / 60, y / 60, (h - y) / 60); if (edge <= 0) continue;
      const a = edge * (0.3 + 0.2 * Math.sin(t * 0.7 + p.phase)) * k; const rr = p.r * k * 2.6;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, p.phase < 2 ? sky(a) : cyan(a)); gr.addColorStop(1, 'rgba(56,217,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }

    // shooting star: fades in and out over its life
    if (this.meteor) {
      const m = this.meteor; const a = Math.sin(Math.PI * (m.age / m.life)); const n = Math.hypot(m.vx, m.vy) || 1; const tx = m.x - (m.vx / n) * m.len, ty = m.y - (m.vy / n) * m.len;
      const gr = g.createLinearGradient(m.x, m.y, tx, ty); gr.addColorStop(0, d ? `rgba(230,245,255,${0.9 * a})` : `rgba(18,104,245,${0.7 * a})`); gr.addColorStop(1, 'rgba(56,217,255,0)');
      g.strokeStyle = gr; g.lineWidth = 1.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(m.x, m.y); g.lineTo(tx, ty); g.stroke();
    }
  }

  private planet(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number) {
    const d = this.dark();
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    const strip = this.bandStrip() as CanvasImageSource; const sw = R * 4, sh = R * 2; const off = ((t * 0.012 * this.speedK) % 1) * sw;
    g.translate(cx, cy); g.rotate(-0.22); g.drawImage(strip, -R - off, -R, sw, sh); g.drawImage(strip, -R - off + sw, -R, sw, sh); g.rotate(0.22); g.translate(-cx, -cy);
    // lit from the upper right (the star the light rays come from)
    const sh2 = g.createRadialGradient(cx + R * 0.45, cy - R * 0.45, R * 0.1, cx, cy, R * 1.05); sh2.addColorStop(0, 'rgba(255,255,255,0.12)'); sh2.addColorStop(0.55, 'rgba(0,0,0,0)'); sh2.addColorStop(1, d ? 'rgba(2,6,16,0.9)' : 'rgba(20,40,90,0.45)');
    g.fillStyle = sh2; g.fillRect(cx - R, cy - R, R * 2, R * 2); g.restore();
    const atmA = (d ? 0.34 : 0.24) * this.glowK * (1 + this.pulse * 0.35 * (0.5 + 0.5 * Math.sin(t * 6)));
    const atm = g.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.2); atm.addColorStop(0, d ? `rgba(59,139,255,${atmA})` : `rgba(18,104,245,${atmA})`); atm.addColorStop(1, 'rgba(59,139,255,0)');
    g.fillStyle = atm; g.beginPath(); g.arc(cx, cy, R * 1.2, 0, Math.PI * 2); g.fill();
  }
  private station(g: CanvasRenderingContext2D, x: number, y: number, S: number, t: number, near: number) {
    // a ring station seen at an angle, turning slowly; spokes and a lit hub
    const d = this.dark(); const spin = t * 0.12; const tilt = 0.42;
    const P = (a: number, r: number) => [x + Math.cos(a + spin) * r, y + Math.sin(a + spin) * r * tilt] as const;
    g.lineWidth = 1 + near * 0.5; g.strokeStyle = d ? `rgba(150,200,255,${0.38 + near * 0.3})` : `rgba(18,104,245,${0.42 + near * 0.3})`;
    g.beginPath(); g.ellipse(x, y, S, S * tilt, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(x, y, S * 0.82, S * 0.82 * tilt, 0, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const [x1, y1] = P(a, S * 0.18), [x2, y2] = P(a, S * 0.82); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); const [mx, my] = P(a, S * 0.91); g.fillStyle = d ? 'rgba(56,217,255,0.75)' : 'rgba(18,104,245,0.75)'; g.fillRect(mx - 1.5, my - 1.5, 3, 3); }
    const hub = g.createRadialGradient(x, y, 0, x, y, S * 0.3); hub.addColorStop(0, d ? `rgba(56,217,255,${0.5 + near * 0.4})` : `rgba(18,104,245,${0.45 + near * 0.3})`); hub.addColorStop(1, 'rgba(56,217,255,0)');
    g.fillStyle = hub; g.beginPath(); g.arc(x, y, S * 0.3, 0, Math.PI * 2); g.fill();
  }
  private sphere(g: CanvasRenderingContext2D, x: number, y: number, r: number, [hi, mid, lo]: string[]) {
    const gr = g.createRadialGradient(x + r * 0.4, y - r * 0.4, r * 0.05, x, y, r); gr.addColorStop(0, hi); gr.addColorStop(0.55, mid); gr.addColorStop(1, lo);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  /** deep-space backdrop + nebula, pre-rendered (redrawn only on resize / theme change) */
  private backdrop(): HTMLCanvasElement | OffscreenCanvas {
    if (this.bg) return this.bg;
    const c = makeCanvas(this.w, this.h); const g = c.getContext('2d') as CanvasRenderingContext2D; const L = this.layout; const d = this.dark(); const U = this.unit;
    const neb = (x: number, y: number, rad: number, col: string, sy = 1) => { g.save(); g.translate(x, y); g.scale(1, sy); const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(-rad, -rad, rad * 2, rad * 2); g.restore(); };
    neb(this.w * L.cx, this.h * L.cy, U * 0.8, d ? 'rgba(18,104,245,0.17)' : 'rgba(18,104,245,0.10)');
    neb(this.w * (L.cx - 0.2), this.h * (L.cy + 0.38), U * 0.55, d ? 'rgba(56,217,255,0.07)' : 'rgba(56,217,255,0.08)', 0.6);
    neb(this.w * 0.2, this.h * 0.08, U * 0.5, d ? 'rgba(59,139,255,0.05)' : 'rgba(59,139,255,0.05)', 0.7);
    neb(this.w * (L.cx + 0.1), this.h * (L.cy - 0.22), U * 0.42, d ? 'rgba(125,211,252,0.07)' : 'rgba(56,189,248,0.09)', 0.55);
    this.bg = c; return c;
  }
  /** a seamless strip of soft bands scrolled inside the planet disc (rotation) */
  private bandStrip(): HTMLCanvasElement | OffscreenCanvas {
    if (this.bands) return this.bands;
    const W = 512, H = 256; const c = makeCanvas(W, H); const g = c.getContext('2d') as CanvasRenderingContext2D; const r = rng(91); const d = this.dark();
    g.fillStyle = d ? '#123a7a' : '#7fb0f5'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 18; i++) {
      const y = r() * H, hh = 4 + r() * 22; const light = r() > 0.5;
      g.fillStyle = light ? (d ? (i % 3 === 0 ? `rgba(125,211,252,${0.1 + r() * 0.16})` : `rgba(120,190,255,${0.08 + r() * 0.16})`) : `rgba(255,255,255,${0.15 + r() * 0.25})`) : (d ? `rgba(4,14,36,${0.15 + r() * 0.25})` : `rgba(18,60,140,${0.08 + r() * 0.14})`);
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin((x / W) * Math.PI * 4 + i) * 3);
      g.lineTo(W, y + hh); for (let x = W; x >= 0; x -= 16) g.lineTo(x, y + hh + Math.sin((x / W) * Math.PI * 4 + i * 1.7) * 3); g.closePath(); g.fill();
    }
    for (const ox of [0, W]) { const gr = g.createRadialGradient(330 - ox, 160, 0, 330 - ox, 160, 26); gr.addColorStop(0, d ? 'rgba(160,215,255,0.35)' : 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    this.bands = c; return c;
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
}
