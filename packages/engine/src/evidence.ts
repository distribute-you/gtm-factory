/**
 * The evidence book: what the engine has seen at every choice point, and the
 * beliefs it reads from it. One book serves a simulated world (the simulator
 * fills it as runs land) and an observed one (a shadow session fills it from a
 * snapshot): the beliefs, the pooling and the leg estimates are the same code.
 *
 * Evidence is kept in cells: per (point, option, client) and per day of the
 * decision, the decisions made (t), those that reached the end of their leg (s),
 * those known not to (f) and the cents spent from the decision on (c).
 */

import type { Catalogue } from "./catalogue";
import { censoredCounts, delayCdfAt, geometricDelay, type Cohort, type DelayDistribution } from "./delay";
import type { CostBelief } from "./prioritizer";
import { betaMean, fitPoolingStrength, pooledPosterior, type BetaPosterior, type Counts } from "./stats";

export interface Cell {
  /** Decisions (or attempts). */
  t: number;
  /** Reached the leg's end. */
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
  /** The parent dynasty of a forked option, if any. */
  parentOf(option: string): string | null;
  /** Half-life of evidence, days (0 or unset = never fade). */
  memoryHalfLifeDays?: number;
  /**
   * The evidence no longer moves (an observed snapshot): every derived figure is
   * computed once and kept. A simulation leaves it off: its cells move during the day.
   */
  frozen?: boolean;
}

export interface LegEstimateRead {
  attempts: number;
  reached: number;
  yieldRate: number | null;
  costPerAttempt: number | null;
  label: "expected" | "measured";
}

/**
 * A leg's estimate from its cohorts: the censoring-corrected yield (pending
 * attempts count for the share of outcomes already due) and the measured cost
 * per attempt.
 */
export function legEstimateOf(cohort: ReadonlyMap<number, Cell> | undefined, day: number, delayMeanDays: number): LegEstimateRead {
  const delay = geometricDelay(delayMeanDays, Math.max(1, Math.ceil(delayMeanDays * 5)));
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

export class EvidenceBook {
  /** Per (point, option, client): cells by decision day. */
  readonly cohorts: CellStore = new Map();
  /** Options ever offered at a point, and points an option was ever offered at. */
  readonly pointOptions = new Map<string, Set<string>>();
  readonly optionPoints = new Map<string, Set<string>>();
  /** Mean delay and horizon from a point's decision to its leg's end. */
  readonly pointDelay = new Map<string, { mean: number; horizon: number }>();
  private readonly beliefCache = new Map<string, { posterior: BetaPosterior; cost: CostBelief }>();
  private readonly baselineCache = new Map<string, { byDay: Map<number, number> }>();

  constructor(private readonly ctx: EvidenceContext) {}

  /** Forget what was computed for the previous day (the evidence stays). */
  newDay(): void {
    this.beliefCache.clear();
    this.baselineCache.clear();
  }

  static cellKey(point: string, option: string, brandId: string): string {
    return `${point}${SEP}${option}${SEP}${brandId}`;
  }

  bump(point: string, option: string, brandId: string, day: number, field: keyof Cell, by: number): void {
    bumpCell(this.cohorts, EvidenceBook.cellKey(point, option, brandId), day, field, by);
  }

  /** A choice point offered these options, with this delay from the decision to its leg's end. */
  offer(point: string, options: readonly string[], remDelay: number, horizon = 0): void {
    if (!this.pointDelay.has(point)) this.pointDelay.set(point, { mean: remDelay, horizon: Math.max(horizon, Math.ceil(remDelay * 4)) });
    let ps = this.pointOptions.get(point);
    if (!ps) this.pointOptions.set(point, (ps = new Set()));
    for (const o of options) {
      ps.add(o);
      let qs = this.optionPoints.get(o);
      if (!qs) this.optionPoints.set(o, (qs = new Set()));
      qs.add(point);
    }
  }

  delayOf(point: string): DelayDistribution {
    const d = this.pointDelay.get(point) ?? { mean: 0, horizon: 0 };
    return geometricDelay(d.mean, Math.max(1, d.horizon));
  }

  /**
   * Counts of one option at one point, delay-corrected (pending decisions count
   * for the share of outcomes already due) and like-for-like in time: each
   * day's trials are weighted by how that day's decisions did at this point,
   * all options together, so an option tried mostly while the rest of the
   * factory was still learning is not blamed for it.
   */
  counts(point: string, option: string, brands: readonly string[], day: number, delay: DelayDistribution): Counts & { cost: number; n: number } {
    if (!this.ctx.frozen) return this.computeCounts(point, option, brands, day, delay);
    const key = `${point}${SEP}${option}${SEP}${day}${SEP}${brands.join(",")}`;
    const hit = this.countsCache.get(key);
    if (hit) return hit;
    const v = this.computeCounts(point, option, brands, day, delay);
    this.countsCache.set(key, v);
    return v;
  }

  private readonly countsCache = new Map<string, Counts & { cost: number; n: number }>();
  private readonly liftCache = new Map<string, { lift: number; weight: number }>();
  private readonly groupLiftCache = new Map<string, number>();

  private computeCounts(point: string, option: string, brands: readonly string[], day: number, delay: DelayDistribution): Counts & { cost: number; n: number } {
    const base = this.baselineOf(point, day, delay);
    let successes = 0;
    let trials = 0;
    let cost = 0;
    let n = 0;
    for (const b of brands) {
      const m = this.cohorts.get(EvidenceBook.cellKey(point, option, b));
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

  /** Per day, the point's rate (every option, every client), smoothed, over its overall rate. */
  private baselineOf(point: string, day: number, delay: DelayDistribution): { byDay: Map<number, number> } {
    const key = `${point}${SEP}${day}`;
    const hit = this.baselineCache.get(key);
    if (hit) return hit;
    const S = new Map<number, number>();
    const E = new Map<number, number>();
    for (const o of this.pointOptions.get(point) ?? []) {
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

  /** Signature shared by options with the same tactic values (yes/no and lists): they share a prior level. */
  signatureOf(option: string): string {
    const catalogue = this.ctx.catalogue;
    const s = catalogue.headOf(option);
    if (!s) return "object";
    const parts = Object.entries(s.tactics)
      .filter(([k]) => catalogue.tactic(k)?.type.kind !== "number")
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort();
    return `${s.pipeId}|${s.kind}|${parts.join(",")}`;
  }

  /** How much better than its points' average an option does everywhere it is offered (its overall level). */
  private liftOf(option: string, day: number): { lift: number; weight: number } {
    if (!this.ctx.frozen) return this.computeLift(option, day);
    const key = `${option}${SEP}${day}`;
    const hit = this.liftCache.get(key);
    if (hit) return hit;
    const v = this.computeLift(option, day);
    this.liftCache.set(key, v);
    return v;
  }

  private computeLift(option: string, day: number): { lift: number; weight: number } {
    let s = 0;
    let e = 0;
    const brands = this.ctx.brandIds();
    for (const q of this.optionPoints.get(option) ?? []) {
      const delay = this.delayOf(q);
      const opts = [...(this.pointOptions.get(q) ?? [])];
      const all = opts.map((o) => this.counts(q, o, brands, day, delay));
      const T = all.reduce((x, c) => x + c.trials, 0);
      const S = all.reduce((x, c) => x + c.successes, 0);
      if (T <= 0 || S <= 0) continue;
      const mine = this.counts(q, option, brands, day, delay);
      s += mine.successes;
      e += (mine.trials * S) / T;
    }
    return { lift: (s + 2) / (e + 2), weight: e };
  }

  /** The level of every option sharing a signature (their tactic group). */
  private groupLift(sig: string, day: number): number {
    const key = `${sig}${SEP}${day}`;
    if (this.ctx.frozen && this.groupLiftCache.has(key)) return this.groupLiftCache.get(key)!;
    const groupOpts = [...this.optionPoints.keys()].filter((o) => this.signatureOf(o) === sig);
    const g = groupOpts.reduce((acc, o) => {
      const l = this.liftOf(o, day);
      return { s: acc.s + l.lift * l.weight, w: acc.w + l.weight };
    }, { s: 0, w: 0 });
    const v = (g.s + 2) / (g.w + 2);
    if (this.ctx.frozen) this.groupLiftCache.set(key, v);
    return v;
  }

  /**
   * The belief about one option at one point for one client, pooled:
   * the option's level everywhere it is offered (its tactic group's, then its
   * own) -> this point (the fleet) -> clients sharing the client's tactics ->
   * the client. A fork starts from its parent's belief at this point.
   */
  belief(point: string, option: string, options: readonly string[], brandId: string, day: number): { posterior: BetaPosterior; cost: CostBelief } {
    const cacheKey = `${point}${SEP}${option}${SEP}${brandId}${SEP}${day}${SEP}${options.join(",")}`;
    const hit = this.beliefCache.get(cacheKey);
    if (hit) return hit;
    const brands = this.ctx.brandIds();
    const delay = this.delayOf(point);
    const fleet = options.map((o) => this.counts(point, o, brands, day, delay));
    const T = fleet.reduce((x, c) => x + c.trials, 0);
    const S = fleet.reduce((x, c) => x + c.successes, 0);
    const baseline = (S + 0.1) / (T + 2);
    // The option's overall level, pulled toward its tactic group's.
    const sig = this.signatureOf(option);
    const groupLift = this.groupLift(sig, day);
    const own = this.liftOf(option, day);
    const lift = (own.lift * own.weight + groupLift * 5) / (own.weight + 5);
    let prior = { rate: Math.min(0.95, baseline * lift), strength: Math.min(Math.max(fitPoolingStrength(fleet), 2), 400) };
    const parent = this.ctx.parentOf(option);
    if (parent && options.length > 0) {
      const p = this.belief(point, parent, [...new Set([...options, parent])], brandId, day);
      prior = { rate: betaMean(p.posterior), strength: Math.min(p.posterior.alpha + p.posterior.beta, 50) };
    }
    const mineFleet = this.counts(point, option, brands, day, delay);
    const fleetPost = pooledPosterior(mineFleet, prior);
    // Clients sharing the client's tactics, then the client.
    const groups = [...new Set(brands.map((b) => this.ctx.groupOf(b)))];
    const groupCounts = groups.map((gk) => this.counts(point, option, brands.filter((b) => this.ctx.groupOf(b) === gk), day, delay));
    const myGroup = this.ctx.groupOf(brandId);
    const groupPost = pooledPosterior(groupCounts[groups.indexOf(myGroup)] ?? { successes: 0, trials: 0 }, { rate: betaMean(fleetPost), strength: fitPoolingStrength(groupCounts) });
    const perBrand = brands.map((b) => this.counts(point, option, [b], day, delay));
    const mine = perBrand[brands.indexOf(brandId)] ?? { successes: 0, trials: 0, cost: 0, n: 0 };
    const posterior = pooledPosterior(mine, { rate: betaMean(groupPost), strength: Math.max(fitPoolingStrength(perBrand), 10) });
    // Cost: measured from the decision to the leg's end, for this option, pulled toward the point's average.
    const allCost = fleet.reduce((x, c) => x + c.cost, 0);
    const allN = fleet.reduce((x, c) => x + c.n, 0);
    const head = this.ctx.catalogue.headOf(option);
    const priorCost = allN > 0 ? allCost / allN / 100 : (head?.costCents ?? 10) / 100 + 0.2;
    const mean = (mineFleet.cost / 100 + 3 * priorCost) / (mineFleet.n + 3);
    const result = { posterior, cost: { mean, sd: (mean * 0.6) / Math.sqrt(mineFleet.n + 3) } };
    this.beliefCache.set(cacheKey, result);
    return result;
  }
}

