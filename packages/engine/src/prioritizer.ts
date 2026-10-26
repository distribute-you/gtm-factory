/**
 * The universal prioritizer: ONE algorithm for every choice (the play of a
 * leg, the script of a pipe at an input, the Unit to consume). Thompson
 * sampling on value per dollar:
 *
 *  1. every option carries a Beta belief about the share of its decisions that
 *     reach the outcome the decision exists for (the end of the campaign's leg),
 *     and a belief about its measured cost from the decision to that end;
 *  2. draw one rate and one cost from each belief;
 *  3. score = rate x value / cost;
 *  4. pick the highest.
 *
 * An option with little data has wide beliefs: sometimes it draws high and gets
 * tried. Exploration comes by construction: no quota, no threshold.
 */

import type { Rng } from "./rng";
import { betaMean, type BetaPosterior } from "./stats";

/** A belief about a cost in dollars: its mean and the uncertainty of that mean. */
export interface CostBelief {
  mean: number;
  sd: number;
}

export interface PricedOption {
  id: string;
  /** Belief about the share of decisions reaching the leg's end. */
  posterior: BetaPosterior;
  /** Belief about the dollars spent from the decision to the leg's end. */
  cost: CostBelief;
}

export interface ScoredOption {
  id: string;
  /** Value per dollar at the means of both beliefs. */
  meanScore: number;
  /** Value per dollar of this draw. */
  sampledScore: number;
}

export interface ChoiceResult {
  chosenId: string;
  options: ScoredOption[];
}

const MIN_COST = 1e-6;

export function meanScore(o: PricedOption, value: number): number {
  return (betaMean(o.posterior) * value) / Math.max(o.cost.mean, MIN_COST);
}

/** Draw a cost from its belief (normal, kept above a fifth of its mean). */
export function drawCost(c: CostBelief, rng: Rng): number {
  const x = c.mean + c.sd * rng.normal();
  return Math.max(x, c.mean * 0.2, MIN_COST);
}

/** One Thompson draw. Ties break on the option order. */
export function prioritize(options: readonly PricedOption[], value: number, rng: Rng): ChoiceResult {
  if (options.length === 0) throw new Error("a choice needs at least one option");
  const scored: ScoredOption[] = options.map((o) => ({
    id: o.id,
    meanScore: meanScore(o, value),
    sampledScore: (rng.beta(o.posterior.alpha, o.posterior.beta) * value) / drawCost(o.cost, rng),
  }));
  let best = 0;
  for (let i = 1; i < scored.length; i++) if (scored[i]!.sampledScore > scored[best]!.sampledScore) best = i;
  return { chosenId: scored[best]!.id, options: scored };
}
