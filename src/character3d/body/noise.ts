/**
 * Smooth, non-repeating motion noise for the presence layer: each channel is a sum of three sines whose frequencies
 * drift slowly (so the pattern never visibly loops) — continuous in value and velocity, bounded to ±1, deterministic
 * from a seed (tests replay exactly the same motion).
 */
import type { Rng } from './rng';

export class SmoothNoise {
  private f: number[]; private ph: number[]; private a: number[]; private drift: number[]; private t = 0;
  /** @param base centre frequency in Hz (the channel's "speed"), e.g. 0.12 for slow head drift */
  constructor(rng: Rng, base: number) {
    this.f = [base, base * 1.93, base * 3.71].map((x) => x * (0.85 + 0.3 * rng()));
    this.ph = [0, 1, 2].map(() => rng() * Math.PI * 2);
    this.a = [0.55, 0.3, 0.15];
    this.drift = [0, 1, 2].map(() => 0.03 + 0.05 * rng());
  }
  /** advance and return the value in [-1, 1] */
  step(dt: number) {
    this.t += dt; let v = 0;
    for (let i = 0; i < 3; i++) {
      // the frequency wanders ±15 % over tens of seconds: phases advance by a slowly modulated rate
      const f = this.f[i] * (1 + 0.15 * Math.sin(this.t * this.drift[i] + i));
      this.ph[i] += 2 * Math.PI * f * dt; v += this.a[i] * Math.sin(this.ph[i]);
    }
    return v;
  }
}

/** critically damped spring (no overshoot): x'' = w²(target − x) − 2w x' — sub-stepped for long frames */
export class Spring {
  v = 0;
  constructor(public x = 0, public w = 6) {}
  step(target: number, dt: number, w = this.w) {
    const n = Math.max(1, Math.ceil((dt * w) / 0.35)); const h = dt / n;            // sub-steps keep stiff springs stable
    for (let i = 0; i < n; i++) { const a = w * w * (target - this.x) - 2 * w * this.v; this.v += a * h; this.x += this.v * h; }
    return this.x;
  }
  snap(x: number) { this.x = x; this.v = 0; }
}
export class Spring3 {
  s: [Spring, Spring, Spring];
  constructor(x: [number, number, number] = [0, 0, 0], w = 6) { this.s = [new Spring(x[0], w), new Spring(x[1], w), new Spring(x[2], w)]; }
  step(t: readonly number[], dt: number, w?: number): [number, number, number] { return [this.s[0].step(t[0], dt, w), this.s[1].step(t[1], dt, w), this.s[2].step(t[2], dt, w)]; }
  get x(): [number, number, number] { return [this.s[0].x, this.s[1].x, this.s[2].x]; }
  speed() { return Math.hypot(this.s[0].v, this.s[1].v, this.s[2].v); }
  snap(x: readonly number[]) { for (let i = 0; i < 3; i++) this.s[i].snap(x[i]); }
}

/** two critically damped springs in series: a jump in the target gives a smooth S-curve with continuous ACCELERATION
 *  (no instant force), like a muscle easing in — used where a target switches (gesture phases, attention shifts) */
export class Cascade {
  private a: Spring; private b: Spring;
  constructor(x = 0, public w = 6) { this.a = new Spring(x, w); this.b = new Spring(x, w); }
  step(target: number, dt: number, w = this.w) { const k = w * 1.55; this.a.step(target, dt, k); return this.b.step(this.a.x, dt, k); }
  get x() { return this.b.x; }
  get v() { return this.b.v; }
  snap(x: number) { this.a.snap(x); this.b.snap(x); }
}
export class Cascade3 {
  s: [Cascade, Cascade, Cascade];
  constructor(x: [number, number, number] = [0, 0, 0], w = 6) { this.s = [new Cascade(x[0], w), new Cascade(x[1], w), new Cascade(x[2], w)]; }
  step(t: readonly number[], dt: number, w?: number): [number, number, number] { return [this.s[0].step(t[0], dt, w), this.s[1].step(t[1], dt, w), this.s[2].step(t[2], dt, w)]; }
  get x(): [number, number, number] { return [this.s[0].x, this.s[1].x, this.s[2].x]; }
  snap(x: readonly number[]) { for (let i = 0; i < 3; i++) this.s[i].snap(x[i]); }
}
