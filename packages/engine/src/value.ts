/**
 * The two calculations.
 *
 * Value BACKWARD from the target: V(target) = its value (the offer's lifetime
 * revenue for a paid client). For any other step s,
 *   V(s) = max(0, max over plays leaving s of  y x V(to) - c)
 * (Bellman: the best thing to do with one occurrence at s, or nothing.)
 *
 * Cost FORWARD from Start: the cost of one occurrence of step s along the
 * cheapest way to reach it,
 *   C(start) = 0,  C(to) = min over plays into to of (C(from) + c) / y.
 *
 * Under a budget, actions are funded by value per dollar until the budget runs
 * out; the value per dollar of the last funded action is the shadow price of a
 * dollar.
 */

import { START, type Catalogue, type StepKey } from "./catalogue";
import type { Offer } from "./client";
import { keptPipes, type LegEstimate, type PlayEstimator } from "./funnels";

export interface StepValue {
  step: StepKey;
  /** Net value of one occurrence at this step, dollars (0 = better do nothing). */
  value: number;
  /** The play to run from this step, or null when doing nothing is best. */
  bestPlayId: string | null;
  /** Value per dollar of the best play: y x V(to) / c. */
  valuePerDollar: number | null;
}

export interface ValueBackwardResult {
  values: Map<StepKey, StepValue>;
  iterations: number;
  converged: boolean;
}

interface Edge {
  playId: string;
  from: StepKey;
  to: StepKey;
  estimate: LegEstimate;
}

function edgesFor(catalogue: Catalogue, offer: Offer, estimator: PlayEstimator): Edge[] {
  const edges: Edge[] = [];
  for (const pipe of keptPipes(catalogue, offer)) {
    for (const play of catalogue.playsOf(pipe.id)) {
      const estimate = estimator(play, pipe);
      if (estimate && estimate.yieldRate > 0 && estimate.costPerTrial >= 0)
        edges.push({ playId: play.id, from: pipe.from, to: pipe.to, estimate });
    }
  }
  return edges;
}

/** Value backward from the target (value iteration; handles cycles). */
export function valueBackward(
  catalogue: Catalogue,
  offer: Offer,
  target: StepKey,
  targetValue: number,
  estimator: PlayEstimator,
  maxIterations = 1000,
): ValueBackwardResult {
  const edges = edgesFor(catalogue, offer, estimator).filter((e) => e.from !== target);
  const steps = [START, ...offer.steps];
  const v = new Map<StepKey, number>(steps.map((s) => [s, s === target ? targetValue : 0]));
  let iterations = 0;
  let converged = false;
  while (iterations < maxIterations) {
    iterations++;
    let delta = 0;
    for (const s of steps) {
      if (s === target) continue;
      let best = 0;
      for (const e of edges) {
        if (e.from !== s) continue;
        best = Math.max(best, e.estimate.yieldRate * (v.get(e.to) ?? 0) - e.estimate.costPerTrial);
      }
      delta = Math.max(delta, Math.abs(best - (v.get(s) ?? 0)));
      v.set(s, best);
    }
    if (delta < 1e-12) {
      converged = true;
      break;
    }
  }
  const values = new Map<StepKey, StepValue>();
  for (const s of steps) {
    let bestPlayId: string | null = null;
    let bestVpd: number | null = null;
    if (s !== target) {
      let best = 0;
      for (const e of edges) {
        if (e.from !== s) continue;
        const net = e.estimate.yieldRate * (v.get(e.to) ?? 0) - e.estimate.costPerTrial;
        if (net > best) {
          best = net;
          bestPlayId = e.playId;
          bestVpd = valuePerDollarOf(e.estimate, v.get(e.to) ?? 0);
        }
      }
    }
    values.set(s, { step: s, value: v.get(s) ?? 0, bestPlayId, valuePerDollar: bestVpd });
  }
  return { values, iterations, converged };
}

/** Value per dollar of one action: what it returns per dollar it spends. */
export function valuePerDollarOf(e: { yieldRate: number; costPerTrial: number }, valueOfTo: number): number {
  if (e.costPerTrial <= 0) return Number.POSITIVE_INFINITY;
  return (e.yieldRate * valueOfTo) / e.costPerTrial;
}

export interface StepCost {
  step: StepKey;
  /** Dollars to produce one occurrence of this step from Start, cheapest way. */
  cost: number;
  viaPlayId: string | null;
}

/** Cost forward from Start (Bellman-Ford style relaxation; handles cycles). */
export function costForward(catalogue: Catalogue, offer: Offer, estimator: PlayEstimator): Map<StepKey, StepCost> {
  const edges = edgesFor(catalogue, offer, estimator);
  const steps = [START, ...offer.steps];
  const c = new Map<StepKey, StepCost>(steps.map((s) => [s, { step: s, cost: s === START ? 0 : Number.POSITIVE_INFINITY, viaPlayId: null }]));
  for (let i = 0; i < steps.length; i++) {
    let changed = false;
    for (const e of edges) {
      const from = c.get(e.from)!.cost;
      if (!Number.isFinite(from)) continue;
      const candidate = (from + e.estimate.costPerTrial) / e.estimate.yieldRate;
      if (candidate < c.get(e.to)!.cost - 1e-12) {
        c.set(e.to, { step: e.to, cost: candidate, viaPlayId: e.playId });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return c;
}

export interface FundableAction {
  id: string;
  valuePerDollar: number;
  /** Most this action can absorb, dollars. */
  capacity: number;
}

export interface BudgetAllocation {
  funded: { id: string; amount: number; valuePerDollar: number }[];
  unspent: number;
  /**
   * Value of one more dollar: the value per dollar of the marginal funded
   * action when the budget binds, else 1 (a dollar left unspent is a dollar).
   */
  shadowPrice: number;
}

/** Fund actions by value per dollar, only those returning more than they cost, until the budget. */
export function allocateBudget(actions: readonly FundableAction[], budget: number): BudgetAllocation {
  const sorted = [...actions]
    .filter((a) => a.valuePerDollar > 1 && a.capacity > 0)
    .sort((a, b) => b.valuePerDollar - a.valuePerDollar || (a.id < b.id ? -1 : 1));
  let left = budget;
  const funded: BudgetAllocation["funded"] = [];
  let shadowPrice = 1;
  for (const a of sorted) {
    if (left <= 0) break;
    const amount = Math.min(a.capacity, left);
    funded.push({ id: a.id, amount, valuePerDollar: a.valuePerDollar });
    left -= amount;
    if (left <= 0) shadowPrice = a.valuePerDollar;
  }
  return { funded, unspent: Math.max(0, left), shadowPrice };
}
