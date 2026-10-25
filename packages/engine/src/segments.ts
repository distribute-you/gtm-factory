/**
 * Segment discovery. The expert step gives the first audiences; the data then
 * SPLITS them on lead attributes (country, company size, seniority, source,
 * niche...) when the split passes the verdict rule:
 *
 *  - each side of the split holds at least 10 outcomes, else it is not tested;
 *  - CONCLUSION: the crude exact test (Fisher) passes under Bonferroni AND the
 *    like-for-like test (Mantel-Haenszel across strata such as client x month)
 *    passes under Bonferroni in the same direction;
 *  - SIGNAL: only the crude test passes;
 *  - NOISE: everything else, or a leader holding fewer than 5 outcomes.
 *
 * A winning segment (conclusion, better) becomes an audience; a losing one
 * (conclusion, worse) is excluded.
 */

import type { SegmentRule } from "./client";
import { fisherExactTwoSided, mantelHaenszel, type Counts, type MantelHaenszelResult, type Table2x2 } from "./stats";

export interface SegmentRecord {
  attributes: Record<string, string>;
  success: boolean;
  /** Like-for-like stratum (e.g. "client-a|2026-10"). */
  stratum: string;
}

export type Verdict = "conclusion" | "signal" | "noise";

export interface VerdictOptions {
  alpha?: number;
  minOutcomesPerSide?: number;
  minLeaderOutcomes?: number;
  /** Attributes to consider (default: every attribute seen). */
  attributes?: string[];
}

export interface SplitResult {
  attribute: string;
  value: string;
  inside: Counts;
  outside: Counts;
  direction: "better" | "worse";
  crudePValue: number;
  likeForLike: MantelHaenszelResult;
  /** Alpha after Bonferroni (alpha / number of tests). */
  threshold: number;
  verdict: Verdict;
}

const DEFAULTS = { alpha: 0.05, minOutcomesPerSide: 10, minLeaderOutcomes: 5 };

function tableOf(records: readonly SegmentRecord[], inside: (r: SegmentRecord) => boolean): Table2x2 {
  const t = { a: 0, b: 0, c: 0, d: 0 };
  for (const r of records) {
    if (inside(r)) r.success ? t.a++ : t.b++;
    else r.success ? t.c++ : t.d++;
  }
  return t;
}

/** Apply the verdict rule to one comparison. */
export function verdictOf(
  crude: Table2x2,
  strata: readonly Table2x2[],
  tests: number,
  options: VerdictOptions = {},
): Omit<SplitResult, "attribute" | "value"> {
  const o = { ...DEFAULTS, ...options };
  const inside = { successes: crude.a, trials: crude.a + crude.b };
  const outside = { successes: crude.c, trials: crude.c + crude.d };
  const rateIn = inside.trials > 0 ? inside.successes / inside.trials : 0;
  const rateOut = outside.trials > 0 ? outside.successes / outside.trials : 0;
  const direction = rateIn >= rateOut ? "better" : "worse";
  const threshold = o.alpha / Math.max(tests, 1);
  const crudePValue = fisherExactTwoSided(crude);
  const likeForLike = mantelHaenszel(strata);
  const leaderOutcomes = direction === "better" ? inside.successes : outside.successes;
  const sameDirection = direction === "better" ? likeForLike.oddsRatio > 1 : likeForLike.oddsRatio < 1;
  let verdict: Verdict = "noise";
  if (leaderOutcomes >= o.minLeaderOutcomes && crudePValue < threshold) {
    verdict = likeForLike.pValue < threshold && sameDirection ? "conclusion" : "signal";
  }
  return { inside, outside, direction, crudePValue, likeForLike, threshold, verdict };
}

/** Every testable one-attribute split of a population, with its verdict. */
export function evaluateSplits(records: readonly SegmentRecord[], options: VerdictOptions = {}): SplitResult[] {
  const o = { ...DEFAULTS, ...options };
  const attributes = o.attributes ?? [...new Set(records.flatMap((r) => Object.keys(r.attributes)))].sort();
  const candidates: { attribute: string; value: string; crude: Table2x2 }[] = [];
  for (const attribute of attributes) {
    const values = [...new Set(records.map((r) => r.attributes[attribute]).filter((v): v is string => v !== undefined))].sort();
    if (values.length < 2) continue;
    for (const value of values) {
      const crude = tableOf(records, (r) => r.attributes[attribute] === value);
      if (crude.a < o.minOutcomesPerSide || crude.c < o.minOutcomesPerSide) continue;
      candidates.push({ attribute, value, crude });
    }
  }
  const strataKeys = [...new Set(records.map((r) => r.stratum))].sort();
  return candidates.map((c) => {
    const strata = strataKeys.map((k) =>
      tableOf(records.filter((r) => r.stratum === k), (r) => r.attributes[c.attribute] === c.value),
    );
    return { attribute: c.attribute, value: c.value, ...verdictOf(c.crude, strata, candidates.length, o) };
  });
}

export interface SegmentFinding {
  /** The segment: the path of conditions that leads to it. */
  rule: SegmentRule;
  split: SplitResult;
}

export interface SegmentDiscovery {
  winners: SegmentFinding[];
  losers: SegmentFinding[];
  /** Every split looked at, every level, for the record. */
  examined: { path: SegmentRule; splits: SplitResult[] }[];
}

/**
 * Grow a tree: at each node take the conclusion with the strongest
 * like-for-like evidence, split, and look again on both sides.
 */
export function discoverSegments(
  records: readonly SegmentRecord[],
  options: VerdictOptions & { maxDepth?: number } = {},
): SegmentDiscovery {
  const out: SegmentDiscovery = { winners: [], losers: [], examined: [] };
  const maxDepth = options.maxDepth ?? 3;
  const grow = (population: readonly SegmentRecord[], path: SegmentRule, depth: number) => {
    if (depth >= maxDepth) return;
    const used = new Set(Object.keys(path));
    const splits = evaluateSplits(population, options).filter((s) => !used.has(s.attribute));
    out.examined.push({ path, splits });
    const conclusions = splits
      .filter((s) => s.verdict === "conclusion")
      .sort((a, b) => a.likeForLike.pValue - b.likeForLike.pValue || (a.attribute + a.value < b.attribute + b.value ? -1 : 1));
    const best = conclusions[0];
    if (!best) return;
    const rule: SegmentRule = { ...path, [best.attribute]: [best.value] };
    (best.direction === "better" ? out.winners : out.losers).push({ rule, split: best });
    grow(population.filter((r) => r.attributes[best.attribute] === best.value), rule, depth + 1);
    const restValues = [...new Set(population.map((r) => r.attributes[best.attribute]).filter((v): v is string => v !== undefined && v !== best.value))].sort();
    grow(population.filter((r) => r.attributes[best.attribute] !== best.value), { ...path, [best.attribute]: restValues }, depth + 1);
  };
  grow(records, {}, 0);
  return out;
}
