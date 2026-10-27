/**
 * Deterministic random numbers. Every random draw in the engine goes through
 * an `Rng` built from a seed, so a run replays byte for byte.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Standard normal draw. */
  normal(): number;
  /** Gamma(shape, 1) draw. */
  gamma(shape: number): number;
  /** Beta(alpha, beta) draw. */
  beta(alpha: number, beta: number): number;
  /** True with probability p. */
  bernoulli(p: number): boolean;
  /** Binomial(n, p) draw. */
  binomial(n: number, p: number): number;
  /** Index drawn from unnormalised non-negative weights. */
  weighted(weights: readonly number[]): number;
  /** A child stream, independent of this one, keyed by a label. */
  fork(label: string): Rng;
}

/** 32-bit string hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 generator with Marsaglia-Tsang gamma and Box-Muller normals. */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  let spareNormal: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spareNormal !== null) {
      const v = spareNormal;
      spareNormal = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spareNormal = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  const gamma = (shape: number): number => {
    if (!(shape > 0)) throw new Error(`gamma shape must be > 0, got ${shape}`);
    if (shape < 1) {
      let u = 0;
      while (u === 0) u = next();
      return gamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    normal,
    gamma,
    beta: (a, b) => {
      const x = gamma(a);
      const y = gamma(b);
      return x / (x + y);
    },
    bernoulli: (p) => next() < p,
    binomial: (n, p) => {
      if (n <= 0 || p <= 0) return 0;
      if (p >= 1) return n;
      if (n < 64) {
        let k = 0;
        for (let i = 0; i < n; i++) if (next() < p) k++;
        return k;
      }
      const mean = n * p;
      const sd = Math.sqrt(n * p * (1 - p));
      const k = Math.round(mean + sd * normal());
      return Math.min(n, Math.max(0, k));
    },
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return Math.floor(next() * weights.length);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    fork: (label) => createRng((hashString(label) ^ Math.imul(state, 0x85ebca6b)) >>> 0),
  };
  return rng;
}
