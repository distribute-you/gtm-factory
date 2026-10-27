/**
 * The evidence book: what the ledger and the traceability show at every
 * choice point, and the beliefs the Supplier rating reads from it (the
 * pooling, the delay censoring and the milestone estimates).
 *
 * Evidence is kept in cells: per (point, candidate, client) and per day of the
 * decision, the decisions made (t), those that reached the milestone they exist for (s),
 * those known not to (f) and the cents spent from the decision on (c).
 */

import type { Catalogue } from "./catalogue";
import { censoredCounts, delayCdfAt, geometricDelay, type Cohort, type DelayDistribution } from "./delay";
import type { CostBelief } from "./prioritizer";
import { betaMean, fitPoolingStrength, pooledPosterior, type BetaPosterior, type Counts } from "./stats";

export interface Cell {
  /** Decisions (or attempts). */
  t: number;
  /** Reached the milestone it exists for. */
  s: number;
  /** Known not to: the attempt ended without it. */
  f: number;
  /** Cents spent from the decision on. */
  c: number;
}

/** Trials a cohort is worth today: settled ones in full, pending ones for the share of outcomes already due. */
export function cellTrials(c: Cell, F: number): number {
  const pending = Math.max(0, c.t - c.s - c.f);
  return c.s + Math.min(c.f, c.t - c.s) + pending * F;
}

export const SEP = "\u0000";

export type CellStore = Map<string, Map<number, Cell>>;

export function bumpCell(store: CellStore, key: string, day: number, field: keyof Cell, by: number): void {
  let m = store.get(key);
  if (!m) store.set(key, (m = new Map()));
  let c = m.get(day);
  if (!c) m.set(day, (c = { t: 0, s: 0, f: 0, c: 0 }));
  c[field] += by;
}

/** What the book needs to know about the world around it. */
export interface EvidenceContext {
  catalogue: Catalogue;
  /** Every client, in a stable order. */
  brandIds(): readonly string[];
  /** The pooling group of a client (clients sharing its tactics). */
  groupOf(brandId: string): string;
  /** The parent dynasty of a forked candidate, if any. */
  parentOf(candidate: string): string | null;
  /** Half-life of evidence, days (0 or unset = never fade). */
  memoryHalfLifeDays?: number;
}

export interface CohortEstimate {
  attempts: number;
  reached: number;
  yieldRate: number | null;
  costPerAttempt: number | null;
  label: "expected" | "measured";
}

/**
 * A milestone's estimate from its cohorts: the censoring-corrected yield (pending
 * attempts count for the share of outcomes already due) and the measured cost
 * per attempt.
 */
export function cohortEstimateOf(cohort: ReadonlyMap<number, Cell> | undefined, day: number, delayMeanDays: number, fixedDays = 0): CohortEstimate {
  const delay = geometricDelay(delayMeanDays, Math.max(1, Math.ceil(delayMeanDays * 5)), fixedDays);
  const cohorts: Cohort[] = [];
  let attempts = 0;
  let reached = 0;
  let cost = 0;
  for (const [d, c] of cohort ?? []) {
    cohorts.push({ ageDays: day - d, trials: cellTrials(c, delayCdfAt(delay, day - d)), successes: c.s });
    attempts += c.t;
    reached += c.s;
    cost += c.c;
  }
  const cc = censoredCounts(cohorts, { cdf: [1] });
  const measured = attempts >= 20 && reached > 0;
  return {
    attempts,
    reached,
    yieldRate: cc.trials > 0 ? (cc.successes + 0.5) / (cc.trials + 1) : null,
    costPerAttempt: attempts > 0 ? cost / 100 / attempts : null,
    label: measured ? "measured" : "expected",
  };
}

/** A milestone's raw counts from its cohorts: attempts, reached, censoring-corrected trials, cents spent. */
export function cohortCountsOf(cohort: ReadonlyMap<number, Cell> | undefined, day: number, delayMeanDays: number, fixedDays = 0): { attempts: number; reached: number; successes: number; trials: number; costCents: number } {
  const delay = geometricDelay(delayMeanDays, Math.max(1, Math.ceil(delayMeanDays * 5)), fixedDays);
  const cohorts: Cohort[] = [];
  let attempts = 0;
  let reached = 0;
  let costCents = 0;
  for (const [d, c] of cohort ?? []) {
    cohorts.push({ ageDays: day - d, trials: cellTrials(c, delayCdfAt(delay, day - d)), successes: c.s });
    attempts += c.t;
    reached += c.s;
    costCents += c.c;
  }
  const cc = censoredCounts(cohorts, { cdf: [1] });
  return { attempts, reached, successes: cc.successes, trials: cc.trials, costCents };
}

export class EvidenceBook {
  /** Per (point, candidate, client): cells by decision day. */
  readonly cohorts: CellStore = new Map();
  /** Candidates ever offered at a point, and points a candidate was ever offered at. */
  readonly pointCandidates = new Map<string, Set<string>>();
  readonly candidatePoints = new Map<string, Set<string>>();
  /** Mean delay and horizon from a point's decision to its milestone. */
  readonly pointDelay = new Map<string, { mean: number; horizon: number; fixed: number }>();
  private readonly beliefCache = new Map<string, { posterior: BetaPosterior; cost: CostBelief }>();
  private readonly baselineCache = new Map<string, { byDay: Map<number, number> }>();

  constructor(private readonly ctx: EvidenceContext) {}

  /** Forget what was computed for the previous day (the evidence stays). */
  newDay(): void {
    this.beliefCache.clear();
    this.baselineCache.clear();
  }

  static cellKey(point: string, candidate: string, brandId: string): string {
    return `${point}${SEP}${candidate}${SEP}${brandId}`;
  }

  bump(point: string, candidate: string, brandId: string, day: number, field: keyof Cell, by: number): void {
    bumpCell(this.cohorts, EvidenceBook.cellKey(point, candidate, brandId), day, field, by);
  }

  /** A choice point offered these candidates, with this delay from the decision to its milestone (`fixed` days of it certain). */
  offer(point: string, candidates: readonly string[], remDelay: number, horizon = 0, fixed = 0): void {
    if (!this.pointDelay.has(point)) this.pointDelay.set(point, { mean: remDelay, horizon: Math.max(horizon, Math.ceil(remDelay * 4)), fixed });
    let ps = this.pointCandidates.get(point);
    if (!ps) this.pointCandidates.set(point, (ps = new Set()));
    for (const o of candidates) {
      ps.add(o);
      let qs = this.candidatePoints.get(o);
      if (!qs) this.candidatePoints.set(o, (qs = new Set()));
      qs.add(point);
    }
  }

  delayOf(point: string): DelayDistribution {
    const d = this.pointDelay.get(point) ?? { mean: 0, horizon: 0, fixed: 0 };
    return geometricDelay(d.mean, Math.max(1, d.horizon), d.fixed);
  }

  /**
   * Counts of one candidate at one point, delay-corrected (pending decisions count
   * for the share of outcomes already due) and like-for-like in time: each
   * day's trials are weighted by how that day's decisions did at this point,
   * all candidates together, so a candidate tried mostly while the rest of the
   * rest of the production was still learning is not blamed for it.
   */
  counts(point: string, candidate: string, brands: readonly string[], day: number, delay: DelayDistribution): Counts & { cost: number; n: number } {
    return this.computeCounts(point, candidate, brands, day, delay);
  }

  private computeCounts(point: string, candidate: string, brands: readonly string[], day: number, delay: DelayDistribution): Counts & { cost: number; n: number } {
    const base = this.baselineOf(point, candidate, day, delay);
    let successes = 0;
    let trials = 0;
    let cost = 0;
    let n = 0;
    for (const b of brands) {
      const m = this.cohorts.get(EvidenceBook.cellKey(point, candidate, b));
      if (!m) continue;
      for (const [d, c] of m) {
        const w = this.memory(day - d);
        const eff = cellTrials(c, delayCdfAt(delay, day - d));
        successes += c.s * w;
        trials += eff * (base.byDay.get(d) ?? 1) * w;
        cost += c.c * w;
        n += c.t * w;
      }
    }
    return { successes, trials: Math.max(trials, successes), cost, n };
  }

  /** Weight of evidence of a given age: older days fade, so a world that changes is read again. */
  memory(ageDays: number): number {
    const h = this.ctx.memoryHalfLifeDays;
    return h && h > 0 ? Math.pow(0.5, Math.max(0, ageDays) / h) : 1;
  }

  /**
   * Per day, the point's rate (every OTHER candidate, every client), smoothed,
   * over its overall rate. The candidate read is left out: a candidate that
   * fills a day and fails would otherwise lower that day's baseline and excuse
   * its own failures.
   */
  private baselineOf(point: string, except: string, day: number, delay: DelayDistribution): { byDay: Map<number, number> } {
    const key = `${point}${SEP}${except}${SEP}${day}`;
    const hit = this.baselineCache.get(key);
    if (hit) return hit;
    const S = new Map<number, number>();
    const E = new Map<number, number>();
    for (const o of this.pointCandidates.get(point) ?? []) {
      if (o === except) continue;
      for (const b of this.ctx.brandIds()) {
        const m = this.cohorts.get(EvidenceBook.cellKey(point, o, b));
        if (!m) continue;
        for (const [d, c] of m) {
          S.set(d, (S.get(d) ?? 0) + c.s);
          E.set(d, (E.get(d) ?? 0) + cellTrials(c, delayCdfAt(delay, day - d)));
        }
      }
    }
    let sAll = 0;
    let eAll = 0;
    for (const v of S.values()) sAll += v;
    for (const v of E.values()) eAll += v;
    const all = eAll > 0 ? (sAll + 0.5) / (eAll + 1) : 0;
    const byDay = new Map<number, number>();
    const k = 300;
    for (const d of E.keys()) {
      let s = 0;
      let e = 0;
      for (let x = d - 3; x <= d + 3; x++) {
        s += S.get(x) ?? 0;
        e += E.get(x) ?? 0;
      }
      const r = (s + k * all) / (e + k);
      byDay.set(d, all > 0 ? r / all : 1);
    }
    const out = { byDay };
    this.baselineCache.set(key, out);
    return out;
  }

  /** Signature shared by candidates with the same tactic values (yes/no and lists): they share a prior level. */
  signatureOf(candidate: string): string {
    const catalogue = this.ctx.catalogue;
    const s = catalogue.headOf(candidate);
    if (!s) return "object";
    const parts = Object.entries(s.tactics)
      .filter(([k]) => catalogue.tactic(k)?.type.kind !== "number")
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort();
    return `${s.outcome}|${s.kind}|${parts.join(",")}`;
  }

  /** How much better than its points' average a candidate does everywhere it is offered (its overall level). */
  private liftOf(candidate: string, day: number): { lift: number; weight: number } {
    return this.computeLift(candidate, day);
  }

  private computeLift(candidate: string, day: number): { lift: number; weight: number } {
    let s = 0;
    let e = 0;
    const brands = this.ctx.brandIds();
    for (const q of this.candidatePoints.get(candidate) ?? []) {
      const delay = this.delayOf(q);
      const opts = [...(this.pointCandidates.get(q) ?? [])];
      const all = opts.map((o) => this.counts(q, o, brands, day, delay));
      const T = all.reduce((x, c) => x + c.trials, 0);
      const S = all.reduce((x, c) => x + c.successes, 0);
      if (T <= 0 || S <= 0) continue;
      const mine = this.counts(q, candidate, brands, day, delay);
      s += mine.successes;
      e += (mine.trials * S) / T;
    }
    return { lift: (s + 2) / (e + 2), weight: e };
  }

  /** The level of every candidate sharing a signature (their tactic group). */
  private groupLift(sig: string, day: number): number {
    const groupOpts = [...this.candidatePoints.keys()].filter((o) => this.signatureOf(o) === sig);
    const g = groupOpts.reduce((acc, o) => {
      const l = this.liftOf(o, day);
      return { s: acc.s + l.lift * l.weight, w: acc.w + l.weight };
    }, { s: 0, w: 0 });
    const v = (g.s + 2) / (g.w + 2);
    return v;
  }

  /**
   * The belief about one candidate at one point for one client, pooled:
   * the candidate's level everywhere it is offered (its tactic group's, then its
   * own) -> this point (the fleet) -> clients sharing the client's tactics ->
   * the client. A fork starts from its parent's belief at this point.
   */
  belief(point: string, candidate: string, candidates: readonly string[], brandId: string, day: number): { posterior: BetaPosterior; cost: CostBelief } {
    const cacheKey = `${point}${SEP}${candidate}${SEP}${brandId}${SEP}${day}${SEP}${candidates.join(",")}`;
    const hit = this.beliefCache.get(cacheKey);
    if (hit) return hit;
    const brands = this.ctx.brandIds();
    const delay = this.delayOf(point);
    const fleet = candidates.map((o) => this.counts(point, o, brands, day, delay));
    const T = fleet.reduce((x, c) => x + c.trials, 0);
    const S = fleet.reduce((x, c) => x + c.successes, 0);
    const baseline = (S + 0.1) / (T + 2);
    // The candidate's overall level, pulled toward its tactic group's.
    const sig = this.signatureOf(candidate);
    const groupLift = this.groupLift(sig, day);
    const own = this.liftOf(candidate, day);
    const lift = (own.lift * own.weight + groupLift * 5) / (own.weight + 5);
    let prior = { rate: Math.min(0.95, baseline * lift), strength: Math.min(Math.max(fitPoolingStrength(fleet), 2), 400) };
    const parent = this.ctx.parentOf(candidate);
    if (parent && candidates.length > 0) {
      const p = this.belief(point, parent, [...new Set([...candidates, parent])], brandId, day);
      prior = { rate: betaMean(p.posterior), strength: Math.min(p.posterior.alpha + p.posterior.beta, 50) };
    }
    const mineFleet = this.counts(point, candidate, brands, day, delay);
    const fleetPost = pooledPosterior(mineFleet, prior);
    // Clients sharing the client's tactics, then the client.
    const groups = [...new Set(brands.map((b) => this.ctx.groupOf(b)))];
    const groupCounts = groups.map((gk) => this.counts(point, candidate, brands.filter((b) => this.ctx.groupOf(b) === gk), day, delay));
    const myGroup = this.ctx.groupOf(brandId);
    const groupPost = pooledPosterior(groupCounts[groups.indexOf(myGroup)] ?? { successes: 0, trials: 0 }, { rate: betaMean(fleetPost), strength: fitPoolingStrength(groupCounts) });
    const perBrand = brands.map((b) => this.counts(point, candidate, [b], day, delay));
    const mine = perBrand[brands.indexOf(brandId)] ?? { successes: 0, trials: 0, cost: 0, n: 0 };
    const posterior = pooledPosterior(mine, { rate: betaMean(groupPost), strength: Math.max(fitPoolingStrength(perBrand), 10) });
    // Cost: measured from the decision to the milestone, for this candidate, pulled toward the point's average.
    const allCost = fleet.reduce((x, c) => x + c.cost, 0);
    const allN = fleet.reduce((x, c) => x + c.n, 0);
    const head = this.ctx.catalogue.headOf(candidate);
    const priorCost = allN > 0 ? allCost / allN / 100 : (head?.costCents ?? 10) / 100 + 0.2;
    const mean = (mineFleet.cost / 100 + 3 * priorCost) / (mineFleet.n + 3);
    const result = { posterior, cost: { mean, sd: (mean * 0.6) / Math.sqrt(mineFleet.n + 3) } };
    this.beliefCache.set(cacheKey, result);
    return result;
  }
}

