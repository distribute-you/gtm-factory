/**
 * One split mechanism on typed tactics, decision-tree style. It reads records
 * (tactic values, success or not, a like-for-like stratum) and looks for the
 * tactic that separates them:
 *
 *  - yes/no: true against false;
 *  - a list: values sorted by their rate, then every cut of that order (the
 *    values are grouped);
 *  - a number: thresholds at the deciles of the values seen.
 *
 * Each side needs at least 10 outcomes. The verdict rule:
 *  - CONCLUSION: the exact test on the raw counts passes, corrected for the
 *    number of splits tried (Bonferroni), AND the like-for-like test
 *    (Mantel-Haenszel across strata such as client x month) passes in the same
 *    direction;
 *  - SIGNAL: only the raw test passes;
 *  - NOISE: everything else, or a leader with fewer than 5 outcomes.
 *
 * Splits on leads propose a finer ICP; splits on scripts propose a strategy.
 */

import type { Tactic } from "./catalogue";
import { fisherExactTwoSided, mantelHaenszel, type Counts, type MantelHaenszelResult, type Table2x2 } from "./stats";
import type { Condition, TacticValue } from "./tactics";
import { meets } from "./tactics";

export interface SplitRecord {
  values: Record<string, TacticValue>;
  success: boolean;
  /** Like-for-like stratum (e.g. "brand-1|month-0"). */
  stratum: string;
}

export type Verdict = "conclusion" | "signal" | "noise";

export interface SplitLimits {
  alpha?: number;
  minOutcomesPerSide?: number;
  minLeaderOutcomes?: number;
  maxDepth?: number;
}

export interface Split {
  tactic: string;
  /** The condition of the side named "inside". */
  inside: Condition;
  /** The condition of the other side. */
  outside: Condition;
  insideCounts: Counts;
  outsideCounts: Counts;
  direction: "better" | "worse";
  crudePValue: number;
  likeForLike: MantelHaenszelResult;
  /** Alpha after the correction for the number of splits tried. */
  threshold: number;
  verdict: Verdict;
}

const DEFAULTS = { alpha: 0.05, minOutcomesPerSide: 10, minLeaderOutcomes: 5, maxDepth: 2 };

function table(records: readonly SplitRecord[], c: Condition): Table2x2 {
  const t = { a: 0, b: 0, c: 0, d: 0 };
  for (const r of records) {
    if (meets(r.values, c)) r.success ? t.a++ : t.b++;
    else r.success ? t.c++ : t.d++;
  }
  return t;
}

/** Every cut a tactic offers on these records: [inside, outside] conditions. */
export function candidateCuts(tactic: Tactic, records: readonly SplitRecord[]): [Condition, Condition][] {
  const values = records.map((r) => r.values[tactic.id]).filter((v) => v !== undefined);
  if (values.length === 0) return [];
  if (tactic.type.kind === "yesno") return [[{ op: "equals", tactic: tactic.id, value: true }, { op: "equals", tactic: tactic.id, value: false }]];
  if (tactic.type.kind === "list") {
    const stats = new Map<string, { s: number; n: number }>();
    for (const r of records) {
      const v = r.values[tactic.id];
      if (typeof v !== "string") continue;
      const x = stats.get(v) ?? { s: 0, n: 0 };
      x.n++;
      if (r.success) x.s++;
      stats.set(v, x);
    }
    const order = [...stats].sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n || (a[0] < b[0] ? -1 : 1)).map(([v]) => v);
    const cuts: [Condition, Condition][] = [];
    for (let k = 1; k < order.length; k++) {
      cuts.push([
        { op: "in", tactic: tactic.id, values: order.slice(0, k).sort() },
        { op: "in", tactic: tactic.id, values: order.slice(k).sort() },
      ]);
    }
    return cuts;
  }
  const nums = (values.filter((v) => typeof v === "number") as number[]).sort((a, b) => a - b);
  const thresholds = new Set<number>();
  for (let q = 1; q < 10; q++) {
    const t = nums[Math.floor((q / 10) * nums.length)];
    if (t !== undefined && t > nums[0]!) thresholds.add(t);
  }
  return [...thresholds].sort((a, b) => a - b).map((t) => [
    { op: "range", tactic: tactic.id, min: t },
    { op: "range", tactic: tactic.id, max: t },
  ]);
}

/** Apply the verdict rule to one cut. */
export function verdictOf(crude: Table2x2, strata: readonly Table2x2[], tests: number, candidates: SplitLimits = {}) {
  const o = { ...DEFAULTS, ...candidates };
  const insideCounts = { successes: crude.a, trials: crude.a + crude.b };
  const outsideCounts = { successes: crude.c, trials: crude.c + crude.d };
  const rIn = insideCounts.trials > 0 ? insideCounts.successes / insideCounts.trials : 0;
  const rOut = outsideCounts.trials > 0 ? outsideCounts.successes / outsideCounts.trials : 0;
  const direction: "better" | "worse" = rIn >= rOut ? "better" : "worse";
  const threshold = o.alpha / Math.max(tests, 1);
  const crudePValue = fisherExactTwoSided(crude);
  const likeForLike = mantelHaenszel(strata);
  const leader = direction === "better" ? insideCounts.successes : outsideCounts.successes;
  const same = direction === "better" ? likeForLike.oddsRatio > 1 : likeForLike.oddsRatio < 1;
  let verdict: Verdict = "noise";
  if (leader >= o.minLeaderOutcomes && crudePValue < threshold) verdict = likeForLike.pValue < threshold && same ? "conclusion" : "signal";
  return { insideCounts, outsideCounts, direction, crudePValue, likeForLike, threshold, verdict };
}

/** Every cut of every tactic with enough outcomes on both sides, with its verdict. */
export function evaluateSplits(records: readonly SplitRecord[], tactics: readonly Tactic[], candidates: SplitLimits = {}): Split[] {
  const o = { ...DEFAULTS, ...candidates };
  const tried: { tactic: string; inside: Condition; outside: Condition; crude: Table2x2 }[] = [];
  for (const t of tactics) {
    for (const [inside, outside] of candidateCuts(t, records)) {
      const crude = table(records, inside);
      // The outside side is everything else that carries a value for the tactic.
      const valued = crude.a + crude.b + crude.c + crude.d;
      if (valued === 0 || crude.a < o.minOutcomesPerSide || crude.c < o.minOutcomesPerSide) continue;
      tried.push({ tactic: t.id, inside, outside, crude });
    }
  }
  const strataKeys = [...new Set(records.map((r) => r.stratum))].sort();
  const byStratum = new Map(strataKeys.map((k) => [k, records.filter((r) => r.stratum === k)]));
  return tried.map((c) => {
    const strata = strataKeys.map((k) => table(byStratum.get(k)!, c.inside));
    return { tactic: c.tactic, inside: c.inside, outside: c.outside, ...verdictOf(c.crude, strata, tried.length, o) };
  });
}

export interface SplitProposal {
  /** The conditions of the best branch found, root first. */
  conditions: Condition[];
  /** The splits taken, root first. */
  path: Split[];
  /** Rate of the branch and of every record. */
  branch: Counts;
  all: Counts;
}

export interface SplitStudy {
  /** Every cut looked at, at the root. */
  root: Split[];
  /** The better branch of each conclusion, grown as deep as the data allows (null = no conclusion). */
  proposal: SplitProposal | null;
}

/**
 * Grow the tree: at each node take the conclusion with the strongest
 * like-for-like evidence, keep its better side, and look again inside it.
 */
export function studySplits(records: readonly SplitRecord[], tactics: readonly Tactic[], candidates: SplitLimits = {}): SplitStudy {
  const o = { ...DEFAULTS, ...candidates };
  const root = evaluateSplits(records, tactics, o);
  const conditions: Condition[] = [];
  const path: Split[] = [];
  let population = records;
  let splits = root;
  const used = new Set<string>();
  for (let depth = 0; depth < o.maxDepth; depth++) {
    const best = splits
      .filter((s) => s.verdict === "conclusion" && !used.has(s.tactic))
      .sort((a, b) => a.likeForLike.pValue - b.likeForLike.pValue || (a.tactic < b.tactic ? -1 : 1))[0];
    if (!best) break;
    const side = best.direction === "better" ? best.inside : best.outside;
    conditions.push(side);
    path.push(best);
    used.add(best.tactic);
    population = population.filter((r) => meets(r.values, side));
    splits = evaluateSplits(population, tactics.filter((t) => !used.has(t.id)), o);
  }
  const count = (rs: readonly SplitRecord[]) => ({ successes: rs.filter((r) => r.success).length, trials: rs.length });
  return { root, proposal: path.length > 0 ? { conditions, path, branch: count(population), all: count(records) } : null };
}
