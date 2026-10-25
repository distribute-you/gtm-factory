/**
 * The universal prioritizer: ONE algorithm for every choice node (which sales
 * funnel, which play, which audience, which workflow, which template, which
 * LLM). Thompson sampling on value per dollar:
 *
 *  1. every option carries a Beta posterior on each yield it depends on,
 *     built by partial pooling (client <- similar clients <- fleet) on
 *     censoring-corrected counts;
 *  2. draw one yield from each posterior;
 *  3. score = value / cost per target outcome under the drawn yields;
 *  4. pick the highest score.
 *
 * An option with little data has a wide posterior, so it sometimes draws high
 * and gets tried: exploration comes by construction, no quota, no threshold.
 */

import { censoredCounts, type Cohort, type DelayDistribution } from "./delay";
import type { Rng } from "./rng";
import { betaMean, pooledPosterior, type BetaPosterior, type Counts } from "./stats";

export interface OptionLeg {
  posterior: BetaPosterior;
  /** Dollars per input processed on this leg. */
  costPerTrial: number;
}

export interface ChoiceOption {
  id: string;
  /** Legs in order (a single leg for a workflow, template, LLM or audience; several for a funnel). */
  legs: OptionLeg[];
  /** Value of one outcome at the end of the last leg, dollars. */
  value: number;
}

export interface ScoredOption {
  id: string;
  /** Value per dollar with each yield at its posterior mean. */
  meanScore: number;
  /** Value per dollar with each yield drawn from its posterior (this draw). */
  sampledScore: number;
}

export interface ChoiceResult {
  chosenId: string;
  options: ScoredOption[];
  /** Plain-English reason, for the choice log. */
  reason: string;
}

const MIN_COST = 1e-9;

/** Value per dollar of an option for given yields (one per leg). */
export function scoreOption(option: ChoiceOption, yields: readonly number[]): number {
  let reach = 1;
  let costPerTarget = 0;
  for (let i = option.legs.length - 1; i >= 0; i--) {
    reach *= Math.max(yields[i] ?? 0, 1e-12);
    costPerTarget += Math.max(option.legs[i]!.costPerTrial, MIN_COST) / reach;
  }
  return option.value / costPerTarget;
}

/** One Thompson draw over the options. Ties break on the option order. */
export function prioritize(options: readonly ChoiceOption[], rng: Rng): ChoiceResult {
  if (options.length === 0) throw new Error("a choice needs at least one option");
  const scored: ScoredOption[] = options.map((o) => ({
    id: o.id,
    meanScore: scoreOption(o, o.legs.map((l) => betaMean(l.posterior))),
    sampledScore: scoreOption(o, o.legs.map((l) => rng.beta(l.posterior.alpha, l.posterior.beta))),
  }));
  let best = 0;
  for (let i = 1; i < scored.length; i++) if (scored[i]!.sampledScore > scored[best]!.sampledScore) best = i;
  const chosen = scored[best]!;
  let bestMean = 0;
  for (let i = 1; i < scored.length; i++) if (scored[i]!.meanScore > scored[bestMean]!.meanScore) bestMean = i;
  const reason =
    best === bestMean
      ? `highest value per dollar (${fmt(chosen.meanScore)} expected)`
      : `explored: drew ${fmt(chosen.sampledScore)} per dollar against ${fmt(scored[bestMean]!.meanScore)} expected for ${scored[bestMean]!.id}`;
  return { chosenId: chosen.id, options: scored, reason };
}

/** Run the prioritizer once per unit (a lead, a dollar slice) and count the picks. */
export function allocateUnits(options: readonly ChoiceOption[], units: number, rng: Rng): Map<string, number> {
  const counts = new Map<string, number>(options.map((o) => [o.id, 0]));
  for (let i = 0; i < units; i++) {
    const r = prioritize(options, rng);
    counts.set(r.chosenId, (counts.get(r.chosenId) ?? 0) + 1);
  }
  return counts;
}

function fmt(x: number): string {
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : "unbounded";
}

/** Evidence about one option at one level, as dated cohorts. */
export interface LevelEvidence {
  cohorts: Cohort[];
}

/**
 * Build an option's yield posterior: censoring-corrected counts at each level,
 * pooled from the widest level (fleet) down to the narrowest (client), each
 * level pulled toward the one above with its own strength k.
 */
export function yieldPosterior(
  levels: readonly { counts: Counts; strength: number }[],
  rootRate: number,
  rootStrength = 2,
): BetaPosterior {
  let posterior: BetaPosterior = { alpha: rootRate * rootStrength, beta: (1 - rootRate) * rootStrength };
  for (const level of levels) {
    posterior = pooledPosterior(level.counts, { rate: betaMean(posterior), strength: level.strength });
  }
  return posterior;
}

/** Censoring-corrected counts of a level's cohorts. */
export function levelCounts(evidence: LevelEvidence, delay: DelayDistribution): Counts {
  return censoredCounts(evidence.cohorts, delay);
}
