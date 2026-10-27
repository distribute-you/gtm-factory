/**
 * Sales funnels and the two calculations.
 *
 * A sales funnel is a view: a straight line of lead states from a start outcome
 * (Start, the market, or any outcome) to a Target, one play per step. A step
 * A -> B is served by any leg making B whose subject comes from A.
 *
 * Cost flows FORWARD from Start: C(to) = (C(from) + c) / y.
 * Value flows BACKWARD from the Target: V(s) = max(0, y x V(to) - c).
 * Per Target Unit, a line of steps costs T = sum_i c_i / (y_i ... y_n) and
 * returns value / T per dollar.
 */

import { START, type Catalogue, type OutcomeId, type Leg } from "./catalogue";

/** What a decision reads about a step: cost per attempt and the share of attempts reaching its end. */
export interface StepFigures {
  /** Dollars per attempt (the step's own production, never its inputs from earlier steps). */
  costPerAttempt: number;
  yieldRate: number;
  label: "expected" | "measured";
}

export interface StepEdge {
  from: OutcomeId;
  to: OutcomeId;
  legId: string;
}

/**
 * Every step a client's business can walk: from Start, a lead state the offer
 * has, or the campaign's start outcome, to a lead state the offer has.
 */
export function stepEdges(catalogue: Catalogue, offerOutcomes: readonly OutcomeId[], start: OutcomeId = START): StepEdge[] {
  const kept = new Set([start, ...offerOutcomes]);
  const edges: StepEdge[] = [];
  for (const p of catalogue.legs) {
    if (!catalogue.isLegLive(p) || p.webhook) continue;
    const out = catalogue.outcome(p.output);
    if (!out?.track || !kept.has(p.output)) continue;
    for (const r of catalogue.rootsOf(p, new Set([start]))) if (kept.has(r) && r !== p.output) edges.push({ from: r, to: p.output, legId: p.id });
  }
  return edges;
}

export interface FunnelStep extends StepEdge {
  estimate: StepFigures;
  /** Attempts this step makes per Target Unit. */
  attemptsPerTarget: number;
  /** Dollars this step spends per target outcome. */
  costPerTarget: number;
}

export interface RankedFunnel {
  /** The line of outcomes, start first. */
  line: OutcomeId[];
  steps: FunnelStep[];
  costPerTarget: number;
  valuePerDollar: number;
  label: "expected" | "measured";
}

export type StepEstimator = (edge: StepEdge, leg: Leg) => StepFigures | null;

/**
 * Lazily enumerate funnels start -> target, cheapest per target first: a
 * best-first search backward from the target. Extending a suffix by one step can
 * only add cost, so funnels come out in increasing cost.
 */
export function* enumerateFunnels(
  catalogue: Catalogue,
  offerOutcomes: readonly OutcomeId[],
  target: OutcomeId,
  estimator: StepEstimator,
  targetValue: number,
  start: OutcomeId = START,
  maxExpansions = 50_000,
): Generator<RankedFunnel> {
  if (!offerOutcomes.includes(target)) return;
  const edges = stepEdges(catalogue, offerOutcomes, start);
  const into = new Map<OutcomeId, StepEdge[]>();
  for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e]);
  interface State {
    at: OutcomeId;
    reach: number;
    cost: number;
    steps: { edge: StepEdge; estimate: StepFigures }[];
  }
  const heap = new MinHeap<State>((a, b) => a.cost - b.cost || a.steps.length - b.steps.length);
  heap.push({ at: target, reach: 1, cost: 0, steps: [] });
  let n = 0;
  while (heap.size > 0 && n++ < maxExpansions) {
    const s = heap.pop()!;
    if (s.at === start) {
      yield toRanked(s.steps, s.cost, targetValue);
      continue;
    }
    for (const e of into.get(s.at) ?? []) {
      if (s.steps.some((l) => l.edge.from === e.from || l.edge.to === e.from)) continue;
      const leg = catalogue.leg(e.legId)!;
      const est = estimator(e, leg);
      if (!est || !(est.yieldRate > 0)) continue;
      const reach = s.reach * est.yieldRate;
      heap.push({ at: e.from, reach, cost: s.cost + est.costPerAttempt / reach, steps: [{ edge: e, estimate: est }, ...s.steps] });
    }
  }
}

export function rankFunnels(
  catalogue: Catalogue,
  offerOutcomes: readonly OutcomeId[],
  target: OutcomeId,
  estimator: StepEstimator,
  targetValue: number,
  limit = 6,
  start: OutcomeId = START,
): RankedFunnel[] {
  const out: RankedFunnel[] = [];
  const seenLines = new Set<string>();
  for (const f of enumerateFunnels(catalogue, offerOutcomes, target, estimator, targetValue, start)) {
    const key = f.line.join(">");
    if (seenLines.has(key)) continue;
    seenLines.add(key);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

function toRanked(steps: { edge: StepEdge; estimate: StepFigures }[], cost: number, targetValue: number): RankedFunnel {
  const per = stepBreakdown(steps.map((l) => l.estimate));
  return {
    line: [steps[0]?.edge.from ?? START, ...steps.map((l) => l.edge.to)],
    steps: steps.map((l, i) => ({ ...l.edge, estimate: l.estimate, attemptsPerTarget: per[i]!.attemptsPerTarget, costPerTarget: per[i]!.costPerTarget })),
    costPerTarget: cost,
    valuePerDollar: cost > 0 ? targetValue / cost : Number.POSITIVE_INFINITY,
    label: steps.every((l) => l.estimate.label === "measured") ? "measured" : "expected",
  };
}

/** Per step: attempts per Target Unit and dollars per target outcome. */
export function stepBreakdown(steps: readonly { costPerAttempt: number; yieldRate: number }[]): { attemptsPerTarget: number; costPerTarget: number }[] {
  const out: { attemptsPerTarget: number; costPerTarget: number }[] = [];
  let reach = 1;
  for (let i = steps.length - 1; i >= 0; i--) {
    reach *= steps[i]!.yieldRate;
    const attemptsPerTarget = reach > 0 ? 1 / reach : Number.POSITIVE_INFINITY;
    out.unshift({ attemptsPerTarget, costPerTarget: steps[i]!.costPerAttempt * attemptsPerTarget });
  }
  return out;
}

/** Cost per target outcome of a line of steps: T = sum_i c_i / (y_i ... y_n). */
export function chainCostPerTarget(steps: readonly { costPerAttempt: number; yieldRate: number }[]): number {
  let reach = 1;
  let cost = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    reach *= steps[i]!.yieldRate;
    if (!(reach > 0)) return Number.POSITIVE_INFINITY;
    cost += steps[i]!.costPerAttempt / reach;
  }
  return cost;
}

/** Cost forward: the cost of one Unit at each step of a line, from its start. */
export function costForwardLine(steps: readonly { costPerAttempt: number; yieldRate: number }[]): number[] {
  const out: number[] = [];
  let c = 0;
  for (const l of steps) {
    c = (c + l.costPerAttempt) / l.yieldRate;
    out.push(c);
  }
  return out;
}

/**
 * Value backward along a line: V(target) = value, V(s) = max(0, y x V(next) - c).
 * Returns the net value at each step, start first, and the value per dollar of
 * each step (y x V(next) / c).
 */
export function valueBackwardLine(steps: readonly { costPerAttempt: number; yieldRate: number }[], value: number): { values: number[]; valuePerDollar: (number | null)[] } {
  const values = new Array<number>(steps.length + 1).fill(0);
  const vpd = new Array<number | null>(steps.length).fill(null);
  values[steps.length] = value;
  for (let i = steps.length - 1; i >= 0; i--) {
    const l = steps[i]!;
    const gross = l.yieldRate * values[i + 1]!;
    values[i] = Math.max(0, gross - l.costPerAttempt);
    vpd[i] = l.costPerAttempt > 0 ? gross / l.costPerAttempt : null;
  }
  return { values, valuePerDollar: vpd };
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
  /** Value of one more dollar: the marginal funded action's value per dollar when the budget binds, else 1. */
  dollarPrice: number;
}

/** Fund actions by value per dollar, only those returning more than they cost, until the budget. */
export function allocateBudget(actions: readonly FundableAction[], budget: number): BudgetAllocation {
  const sorted = [...actions].filter((a) => a.valuePerDollar > 1 && a.capacity > 0).sort((a, b) => b.valuePerDollar - a.valuePerDollar || (a.id < b.id ? -1 : 1));
  let left = budget;
  const funded: BudgetAllocation["funded"] = [];
  let dollarPrice = 1;
  for (const a of sorted) {
    if (left <= 0) break;
    const amount = Math.min(a.capacity, left);
    funded.push({ id: a.id, amount, valuePerDollar: a.valuePerDollar });
    left -= amount;
    if (left <= 0) dollarPrice = a.valuePerDollar;
  }
  return { funded, unspent: Math.max(0, left), dollarPrice };
}

/** A small binary heap. */
export class MinHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => number) {}
  get size(): number {
    return this.items.length;
  }
  push(x: T): void {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
