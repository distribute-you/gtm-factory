/**
 * Funnel construction. For a client's offer and a target outcome: keep the
 * steps the offer has, keep the pipes between kept steps, then enumerate the
 * straight-line sales funnels (one play per leg) lazily, cheapest cost per
 * target outcome first. Never a full combinatorial expansion.
 *
 * Cost of a funnel per target outcome, legs 1..n, leg i with cost per input
 * processed c_i and yield y_i (share of inputs reaching the next step):
 *   T = sum_i c_i / (y_i x y_(i+1) x ... x y_n)
 * Value per dollar = value of the target / T.
 */

import { START, type Catalogue, type Pipe, type Play, type StepKey } from "./catalogue";
import type { Offer } from "./client";

/** What a choice reads about a play: its own cost per input processed and its yield. */
export interface LegEstimate {
  /** Dollars spent per input processed by the pipe (its own cost, never its inputs'). */
  costPerTrial: number;
  /** Share of inputs that reach the pipe's to step. */
  yieldRate: number;
  /** "measured" once the play has its own data, else "expected". */
  label: "expected" | "measured";
}

export type PlayEstimator = (play: Play, pipe: Pipe) => LegEstimate | null;

export interface FunnelLeg {
  playId: string;
  pipeId: string;
  from: StepKey;
  to: StepKey;
  estimate: LegEstimate;
  /** Leads needed: inputs this leg must process per target outcome. */
  leadsNeeded: number;
  /** Dollars this leg spends per target outcome. */
  costPerTarget: number;
}

export interface RankedFunnel {
  /** Plays joined by " > ", in order from Start. */
  id: string;
  steps: StepKey[];
  legs: FunnelLeg[];
  /** Dollars per target outcome, all legs. */
  costPerTarget: number;
  /** Target value / cost per target. A funnel is worth funding when above 1. */
  valuePerDollar: number;
  label: "expected" | "measured";
}

/** The steps a client can walk for this offer: the offer's steps, plus Start. */
export function keptSteps(offer: Offer): Set<StepKey> {
  return new Set([START, ...offer.steps]);
}

/** Live pipes whose both ends are steps the offer has. */
export function keptPipes(catalogue: Catalogue, offer: Offer): Pipe[] {
  const kept = keptSteps(offer);
  return catalogue.pipes.filter((p) => catalogue.isPipeLive(p) && kept.has(p.from) && kept.has(p.to));
}

export interface EnumerateOptions {
  /** Only funnels whose first pipe is proactive (runnable on a budget alone). */
  proactiveEntry?: boolean;
  /** Safety cap on search expansions. */
  maxExpansions?: number;
}

interface SearchState {
  step: StepKey;
  /** Product of yields from this step to the target. */
  reach: number;
  /** Cost per target outcome of the suffix. */
  cost: number;
  legs: { play: Play; pipe: Pipe; estimate: LegEstimate }[];
  visited: Set<StepKey>;
}

/**
 * Lazily enumerate sales funnels Start -> target, cheapest per target first.
 * Best-first search walking backward from the target: extending a suffix by a
 * leg only adds cost, so states pop in increasing cost order.
 */
export function* enumerateSalesFunnels(
  catalogue: Catalogue,
  offer: Offer,
  target: StepKey,
  estimator: PlayEstimator,
  targetValue: number,
  options: EnumerateOptions = {},
): Generator<RankedFunnel> {
  if (!offer.steps.includes(target)) return;
  const pipes = keptPipes(catalogue, offer);
  const into = new Map<StepKey, Pipe[]>();
  for (const p of pipes) into.set(p.to, [...(into.get(p.to) ?? []), p]);
  const estimates = new Map<string, LegEstimate | null>();
  const estimateOf = (play: Play, pipe: Pipe) => {
    if (!estimates.has(play.id)) estimates.set(play.id, estimator(play, pipe));
    return estimates.get(play.id) ?? null;
  };

  const heap = new MinHeap<SearchState>((a, b) => a.cost - b.cost || a.legs.length - b.legs.length);
  heap.push({ step: target, reach: 1, cost: 0, legs: [], visited: new Set([target]) });
  const maxExpansions = options.maxExpansions ?? 100_000;
  let expansions = 0;

  while (heap.size > 0 && expansions < maxExpansions) {
    const s = heap.pop()!;
    expansions++;
    if (s.step === START) {
      const first = s.legs[0];
      if (options.proactiveEntry && first && first.pipe.mode !== "proactive") continue;
      yield toRanked(s, targetValue);
      continue;
    }
    for (const pipe of into.get(s.step) ?? []) {
      if (s.visited.has(pipe.from)) continue;
      for (const play of catalogue.playsOf(pipe.id)) {
        const e = estimateOf(play, pipe);
        if (!e || !(e.yieldRate > 0) || !(e.costPerTrial >= 0)) continue;
        const reach = s.reach * e.yieldRate;
        heap.push({
          step: pipe.from,
          reach,
          cost: s.cost + e.costPerTrial / reach,
          legs: [{ play, pipe, estimate: e }, ...s.legs],
          visited: new Set([...s.visited, pipe.from]),
        });
      }
    }
  }
}

/** The first `limit` funnels of the lazy enumeration. */
export function rankSalesFunnels(
  catalogue: Catalogue,
  offer: Offer,
  target: StepKey,
  estimator: PlayEstimator,
  targetValue: number,
  limit = 10,
  options: EnumerateOptions = {},
): RankedFunnel[] {
  const out: RankedFunnel[] = [];
  for (const f of enumerateSalesFunnels(catalogue, offer, target, estimator, targetValue, options)) {
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/** Cost per target outcome of a chain of leg estimates (in order from Start). */
export function chainCostPerTarget(legs: readonly { costPerTrial: number; yieldRate: number }[]): number {
  let reach = 1;
  let cost = 0;
  for (let i = legs.length - 1; i >= 0; i--) {
    const leg = legs[i]!;
    reach *= leg.yieldRate;
    if (!(reach > 0)) return Number.POSITIVE_INFINITY;
    cost += leg.costPerTrial / reach;
  }
  return cost;
}

function toRanked(s: SearchState, targetValue: number): RankedFunnel {
  const legs: FunnelLeg[] = [];
  let reach = s.reach;
  for (const l of s.legs) {
    const leadsNeeded = 1 / reach;
    legs.push({
      playId: l.play.id,
      pipeId: l.pipe.id,
      from: l.pipe.from,
      to: l.pipe.to,
      estimate: l.estimate,
      leadsNeeded,
      costPerTarget: l.estimate.costPerTrial * leadsNeeded,
    });
    reach /= l.estimate.yieldRate;
  }
  const steps = [START, ...s.legs.map((l) => l.pipe.to)];
  return {
    id: s.legs.map((l) => l.play.id).join(" > "),
    steps,
    legs,
    costPerTarget: s.cost,
    valuePerDollar: s.cost > 0 ? targetValue / s.cost : Number.POSITIVE_INFINITY,
    label: s.legs.every((l) => l.estimate.label === "measured") ? "measured" : "expected",
  };
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
