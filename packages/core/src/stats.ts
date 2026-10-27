/**
 * Statistics used by every calculation of the engine: Beta posteriors with
 * partial pooling, the empirical Bayes fit of the pooling strength, exact and
 * stratified tests for the verdict rule. Pure functions, no state.
 */

/** A count of trials and the successes among them. */
export interface Counts {
  successes: number;
  trials: number;
}

/** A Beta(alpha, beta) belief about a rate. */
export interface BetaPosterior {
  alpha: number;
  beta: number;
}

export function betaMean(p: BetaPosterior): number {
  return p.alpha / (p.alpha + p.beta);
}

export function betaVariance(p: BetaPosterior): number {
  const n = p.alpha + p.beta;
  return (p.alpha * p.beta) / (n * n * (n + 1));
}

/** A prior: a rate from the level above and how many trials it is worth. */
export interface PoolingPrior {
  rate: number;
  /** Pooling strength k: the prior counts as k trials at `rate`. */
  strength: number;
}

/**
 * Partial pooling of one group's counts with the level above.
 * estimate = (successes + k x rate) / (trials + k).
 */
export function pooledPosterior(counts: Counts, prior: PoolingPrior): BetaPosterior {
  const k = Math.max(prior.strength, 1e-9);
  const rate = clampRate(prior.rate);
  return {
    alpha: counts.successes + k * rate,
    beta: Math.max(counts.trials - counts.successes, 0) + k * (1 - rate),
  };
}

export function pooledEstimate(counts: Counts, prior: PoolingPrior): number {
  return betaMean(pooledPosterior(counts, prior));
}

/** One level of a hierarchy, from the widest (fleet) to the narrowest (client). */
export interface PoolingLevel extends Counts {
  /** Strength with which the level above pulls this one. Ignored on the top level. */
  strength: number;
}

/**
 * Hierarchical partial pooling: the top level's rate (or `rootRate` when the
 * top level is empty) is the prior of the next level, whose pooled estimate is
 * the prior of the next, down to the last level, whose posterior is returned.
 */
export function hierarchicalPosterior(
  levels: readonly PoolingLevel[],
  rootRate = 0.5,
): BetaPosterior {
  if (levels.length === 0) return { alpha: rootRate, beta: 1 - rootRate };
  const [top, ...rest] = levels as [PoolingLevel, ...PoolingLevel[]];
  let posterior = pooledPosterior(top, { rate: rootRate, strength: top.strength > 0 ? top.strength : 1 });
  for (const level of rest) {
    posterior = pooledPosterior(level, { rate: betaMean(posterior), strength: level.strength });
  }
  return posterior;
}

/**
 * Empirical Bayes: fit the pooling strength k from several groups (method of
 * moments on the beta-binomial). k = m(1-m)/tau2 - 1, where tau2 is the
 * between-group variance of the true rates once the sampling noise is removed.
 * When the groups do not differ more than noise, every group is the fleet:
 * k = total trials (full pooling), never infinity.
 */
export function fitPoolingStrength(groups: readonly Counts[]): number {
  const live = groups.filter((g) => g.trials > 0);
  const total = live.reduce((s, g) => s + g.trials, 0);
  if (live.length < 2 || total === 0) return Math.max(total, 1);
  const m = live.reduce((s, g) => s + g.successes, 0) / total;
  if (m <= 0 || m >= 1) return total;
  let weighted = 0;
  let sumSquares = 0;
  for (const g of live) {
    const r = g.successes / g.trials;
    weighted += g.trials * (r - m) * (r - m);
    sumSquares += g.trials * g.trials;
  }
  const numerator = weighted - (live.length - 1) * m * (1 - m);
  const denominator = total - sumSquares / total;
  const tau2 = denominator > 0 ? numerator / denominator : 0;
  if (!(tau2 > 0)) return total;
  return Math.min(Math.max(m * (1 - m) / tau2 - 1, 1e-6), total);
}

function clampRate(r: number): number {
  return Math.min(Math.max(r, 1e-9), 1 - 1e-9);
}

// ---------------------------------------------------------------------------
// Exact and stratified tests
// ---------------------------------------------------------------------------

const logFactorialCache: number[] = [0];

export function logFactorial(n: number): number {
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache[i] = (logFactorialCache[i - 1] ?? 0) + Math.log(i);
  }
  return logFactorialCache[n] ?? 0;
}

/** A 2x2 table: rows = in segment / rest, columns = success / failure. */
export interface Table2x2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

function hypergeometricLog(a: number, row1: number, row2: number, col1: number): number {
  const n = row1 + row2;
  return (
    logFactorial(row1) + logFactorial(row2) + logFactorial(col1) + logFactorial(n - col1) -
    logFactorial(n) - logFactorial(a) - logFactorial(row1 - a) - logFactorial(col1 - a) -
    logFactorial(row2 - col1 + a)
  );
}

/** Fisher's exact test, two-sided p-value. */
export function fisherExactTwoSided(t: Table2x2): number {
  const row1 = t.a + t.b;
  const row2 = t.c + t.d;
  const col1 = t.a + t.c;
  const lo = Math.max(0, col1 - row2);
  const hi = Math.min(row1, col1);
  const observed = hypergeometricLog(t.a, row1, row2, col1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = hypergeometricLog(x, row1, row2, col1);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

/** Complementary error function (Numerical Recipes erfcc, relative error < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Survival function of a chi-square with one degree of freedom. */
export function chiSquare1Survival(x: number): number {
  if (!(x > 0)) return 1;
  return erfc(Math.sqrt(x / 2));
}

export interface MantelHaenszelResult {
  /** Common odds ratio across strata. */
  oddsRatio: number;
  /** Cochran-Mantel-Haenszel statistic (no continuity correction). */
  statistic: number;
  pValue: number;
}

/**
 * Mantel-Haenszel across strata (like-for-like: each stratum compares the
 * segment and the rest inside the same client and month).
 */
export function mantelHaenszel(strata: readonly Table2x2[]): MantelHaenszelResult {
  let num = 0;
  let den = 0;
  let diff = 0;
  let variance = 0;
  for (const s of strata) {
    const n = s.a + s.b + s.c + s.d;
    if (n < 2) continue;
    num += (s.a * s.d) / n;
    den += (s.b * s.c) / n;
    const row1 = s.a + s.b;
    const row2 = s.c + s.d;
    const col1 = s.a + s.c;
    const col2 = s.b + s.d;
    diff += s.a - (row1 * col1) / n;
    variance += (row1 * row2 * col1 * col2) / (n * n * (n - 1));
  }
  const oddsRatio = den > 0 ? num / den : num > 0 ? Number.POSITIVE_INFINITY : 1;
  const statistic = variance > 0 ? (diff * diff) / variance : 0;
  return { oddsRatio, statistic, pValue: chiSquare1Survival(statistic) };
}
