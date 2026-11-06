/** Seeded RNG for the presence layer (mulberry32, the same generator as the animation engine): varied, reproducible. */
export type Rng = () => number;
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
export const pick = <T>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length];
