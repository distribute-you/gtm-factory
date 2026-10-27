/**
 * The hidden truth, read the way a decision reads the world: for each candidate
 * at a candidate place, the true chance a decision there reaches its milestone and
 * the true cost from the decision to it, the other candidate places set at their
 * own hidden best. Used to grade the Supplier rating (the Research page, the
 * regret test), never by the picks.
 */

import { START, type OutcomeId, type Script } from "./catalogue";
import { CAMPAIGN, pointKey, type PlanNode, type SimulationSession } from "./simulator";
import { meetsAll, type Condition } from "./tactics";
import { marketSample, segmentMultiplier, type Campaign } from "./world";

type Op =
  | { kind: "decide"; point: string; candidates: string[] }
  | { kind: "run"; point: string; yieldRate: number; costCents: number; end: number; recall: number; falsePositive: number; final: boolean; segment: number };

interface Ctx {
  session: SimulationSession;
  campaign: Campaign;
  brandId: string;
  /** The milestone below (or the campaign's start): the subject comes from there. */
  from: OutcomeId;
  assign: Map<string, string>;
  ops: Op[];
  ends: number;
  segment: number;
  seenPoints: Set<string>;
  produced: Set<OutcomeId>;
  audience: Condition[];
}

function planProduce(c: Ctx, consumer: string, o: OutcomeId, final: boolean): boolean {
  const s = c.session;
  const out = s.catalogue.outcome(o);
  const scripts = s.allowedScripts(c.campaign, o, false).filter((x) => out?.subject !== "lead" || s.feasible(c.campaign, x, c.campaign.start, new Set(), false));
  const point = pointKey(consumer, o);
  if (scripts.length === 0) return false;
  const candidates = [...new Set(scripts.map((x) => x.dynasty))];
  if (!c.seenPoints.has(point)) c.ops.push({ kind: "decide", point, candidates });
  c.seenPoints.add(point);
  const assigned = c.assign.get(point);
  const dyn = assigned && candidates.includes(assigned) ? assigned : candidates[0]!;
  const script = s.catalogue.headOf(dyn);
  if (!script) return false;
  const truth = s.scriptTruth(script, point);
  c.ends *= truth.end ?? 1;
  let recall = truth.recall ?? 1;
  let fp = truth.falsePositive ?? 0;
  const bill = s.materialsOf(script);
  const subj = bill.find((m) => s.catalogue.outcome(m)?.subject === "lead") ?? null;
  for (const i of subj ? [subj, ...bill.filter((m) => m !== subj)] : bill) {
    const before = c.ops.length;
    if (!planObtain(c, script, i)) return false;
    // Recall at an attesting script comes from the scripts picked at its Materials.
    for (const st of c.ops.slice(before)) {
      if (st.kind !== "decide" || st.point !== pointKey(script.outcome, i)) continue;
      const t = s.candidateTruthAt(st.point, c.assign.get(st.point) ?? st.candidates[0]!);
      if (t.recall !== undefined) recall *= t.recall;
      if (t.falsePositive !== undefined) fp = Math.max(fp, t.falsePositive);
    }
  }
  // A script creating subjects finds someone only while its reserve lasts.
  const pick = !subj && out?.subject === "lead" ? s.pickChance(script, c.brandId, c.audience) : 1;
  c.produced.add(o);
  c.ops.push({ kind: "run", point, yieldRate: Math.min(1, (truth.base ?? 1) * (truth.ownYield ?? 1) * pick), costCents: truth.costCents, end: 1, recall, falsePositive: fp, final, segment: c.segment });
  return true;
}

function planObtain(c: Ctx, consumer: Script, i: OutcomeId): boolean {
  const s = c.session;
  const out = s.catalogue.outcome(i);
  if (!out) return false;
  if (i === c.from) return true;
  if (out.subject === "lead" || out.subject === "company") {
    // Made earlier for the same subject, or a milestone below this one: the subject brings it.
    if (c.produced.has(i) || s.catalogue.isMilestone(i)) return true;
    return planProduce(c, consumer.outcome, i, false);
  }
  if (out.subject === "run") return planProduce(c, consumer.outcome, i, false);
  // A brand Unit: picked among the ones the brand holds, else made by its Engine.
  const point = pointKey(consumer.outcome, i);
  const candidates = s.objectDynasties(c.brandId, i);
  if (candidates.length === 0) return planProduce(c, consumer.outcome, i, false);
  if (candidates.length > 1 && !c.seenPoints.has(point)) c.ops.push({ kind: "decide", point, candidates });
  c.seenPoints.add(point);
  const assigned = c.assign.get(point);
  const dyn = assigned && candidates.includes(assigned) ? assigned : candidates[0]!;
  const head = s.objectHead(c.brandId, i, dyn);
  if (head) {
    c.ends *= s.objectTruthEnd(head);
    if (head.conditions) {
      c.audience = head.conditions;
      if (c.from === START) c.segment = segmentAverage(s, c.brandId, head.conditions);
    }
  }
  return true;
}

const segmentCache = new WeakMap<SimulationSession, Map<string, number>>();

/** Mean hidden multiplier of the people an audience describes. */
export function segmentAverage(s: SimulationSession, brandId: string, conditions: Parameters<typeof meetsAll>[1]): number {
  let m = segmentCache.get(s);
  if (!m) segmentCache.set(s, (m = new Map()));
  const key = `${brandId}|${JSON.stringify(conditions)}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  const people = marketSample(s.world, brandId, 2000).filter((p) => meetsAll(p.values, conditions));
  const v = people.length === 0 ? 0 : people.reduce((x, p) => x + segmentMultiplier(s.world, p.values), 0) / people.length;
  m.set(key, v);
  return v;
}

/** The plan of one milestone: made from the milestone below it (or the start), asked by its consumer. */
function plan(s: SimulationSession, campaign: Campaign, consumer: string, milestone: OutcomeId, from: OutcomeId, assign: Map<string, string>): Ctx | null {
  const c: Ctx = { session: s, campaign, brandId: campaign.brandId, from, assign, ops: [], ends: 1, segment: 1, seenPoints: new Set(), produced: new Set(), audience: [] };
  return planProduce(c, consumer, milestone, true) ? c : null;
}

/** True chance to reach the milestone and true cost to get there, from the first decision at `point`. */
function fromPoint(c: Ctx, point: string): { p: number; cost: number } | null {
  const k = c.ops.findIndex((st) => st.kind === "decide" && st.point === point);
  if (k < 0) return null;
  let reach = 1;
  let cost = 0;
  let p = 0;
  for (const st of c.ops.slice(k + 1)) {
    if (st.kind !== "run") continue;
    cost += reach * st.costCents;
    if (st.final) {
      const fact = Math.min(0.97, st.yieldRate * c.ends * (c.from === START ? c.segment : 1));
      p = reach * (fact * st.recall + (1 - fact) * st.falsePositive);
    } else reach *= st.yieldRate;
  }
  return { p, cost };
}

export interface HiddenCandidate {
  candidate: string;
  /** True share of decisions reaching their milestone, from this point. */
  rate: number;
  /** True cents from the decision to its milestone. */
  costCents: number;
  /** rate / dollar: the value per dollar up to the milestone's value. */
  perDollar: number;
}

/**
 * Hidden truth of every candidate place credited at one milestone of a
 * campaign: per point, each candidate's true rate and cost, the other points
 * at their own hidden best (found by coordinate ascent).
 */
export function hiddenTruth(s: SimulationSession, campaign: Campaign, consumer: string, milestone: OutcomeId, from: OutcomeId): Map<string, HiddenCandidate[]> {
  const score = (assign: Map<string, string>, point: string): number => {
    const c = plan(s, campaign, consumer, milestone, from, assign);
    const r = c ? fromPoint(c, point) : null;
    return r && r.cost > 0 ? r.p / r.cost : 0;
  };
  // Coordinate ascent: every point of the plan at its best, the points in `fixed` kept.
  const optimize = (start: Map<string, string>, fixed: ReadonlySet<string>): Map<string, string> => {
    const assign = new Map(start);
    for (let round = 0; round < 4; round++) {
      const ctx = plan(s, campaign, consumer, milestone, from, assign);
      if (!ctx) return assign;
      let changed = false;
      for (const st of ctx.ops) {
        if (st.kind !== "decide" || st.candidates.length < 2 || fixed.has(st.point)) continue;
        let best = assign.get(st.point) ?? st.candidates[0]!;
        let bestScore = -1;
        for (const o of st.candidates) {
          const v = score(new Map(assign).set(st.point, o), st.point);
          if (v > bestScore + 1e-15) {
            bestScore = v;
            best = o;
          }
        }
        if (assign.get(st.point) !== best) changed = true;
        assign.set(st.point, best);
      }
      if (!changed) break;
    }
    return assign;
  };
  const assign = optimize(new Map(), new Set());
  const ctx = plan(s, campaign, consumer, milestone, from, assign);
  if (!ctx) return new Map();
  const out = new Map<string, HiddenCandidate[]>();
  for (const st of ctx.ops) {
    if (st.kind !== "decide") continue;
    out.set(
      st.point,
      st.candidates.map((o) => {
        // Each candidate graded with the picks under it at their own best.
        const mine = optimize(new Map(assign).set(st.point, o), new Set([st.point]));
        const c = plan(s, campaign, consumer, milestone, from, mine);
        const r = c ? fromPoint(c, st.point) : null;
        const rate = r?.p ?? 0;
        const costCents = r?.cost ?? 0;
        return { candidate: o, rate, costCents, perDollar: costCents > 0 ? rate / (costCents / 100) : 0 };
      }),
    );
  }
  return out;
}

/** The hidden best candidate at every candidate place of a campaign. */
export function hiddenBest(s: SimulationSession, campaign: Campaign): Map<string, { best: string; candidates: HiddenCandidate[] }> {
  const out = new Map<string, { best: string; candidates: HiddenCandidate[] }>();
  for (const { consumer, milestone, from } of milestonesOf(s, campaign)) {
    for (const [point, candidates] of hiddenTruth(s, campaign, consumer, milestone, from)) {
      if (out.has(point)) continue;
      const best = [...candidates].sort((a, b) => b.perDollar - a.perDollar || (a.candidate < b.candidate ? -1 : 1))[0];
      if (best) out.set(point, { best: best.candidate, candidates });
    }
  }
  return out;
}

/** Each milestone of a campaign's Plan, the outcome that asks for it, and the milestone below it (or the start). */
function milestonesOf(s: SimulationSession, campaign: Campaign): { consumer: string; milestone: OutcomeId; from: OutcomeId }[] {
  const out: { consumer: string; milestone: OutcomeId; from: OutcomeId }[] = [];
  const isMilestone = (o: OutcomeId) => s.catalogue.isMilestone(o) || o === campaign.target;
  // Walk the chain that carries the subject: each milestone, the consumer above it, and the milestone below.
  const chain: { node: PlanNode; consumer: string }[] = [];
  let node: PlanNode | undefined = s.planOf(campaign) ?? undefined;
  let consumer = CAMPAIGN;
  while (node && node.outcome !== campaign.start) {
    chain.push({ node, consumer });
    consumer = node.outcome;
    node = node.materials.find((m) => s.catalogue.outcome(m.outcome)?.subject === "lead");
  }
  const milestones = chain.filter((c) => isMilestone(c.node.outcome));
  milestones.forEach((m, k) => out.push({ consumer: m.consumer, milestone: m.node.outcome, from: milestones[k + 1]?.node.outcome ?? campaign.start }));
  return out;
}

/** The hidden best of every campaign, per day: what each day's picks are graded against. */
export type TruthLog = Map<number, Map<string, Map<string, { best: string; candidates: HiddenCandidate[] }>>>;

/**
 * Run a session `days` days, reading the hidden truth at the start of each
 * day (a source runs dry, a fork appears: the best changes over time).
 */
export function runGraded(s: SimulationSession, days: number, log: TruthLog = new Map()): TruthLog {
  for (let k = 0; k < days; k++) {
    const today = new Map<string, Map<string, { best: string; candidates: HiddenCandidate[] }>>();
    for (const campaign of s.campaigns()) today.set(campaign.id, hiddenBest(s, campaign));
    log.set(s.day, today);
    s.run(1);
  }
  return log;
}

/**
 * Regret: per day, the share of each dollar's value the picks lost against
 * always picking the hidden best (1 - its value per dollar / the best's),
 * weighted by picks, over every candidate place of every campaign. Each day is
 * graded against that day's truth when a log is given, else today's.
 */
export function regretByDay(s: SimulationSession, log?: TruthLog): (number | null)[] {
  const lost = Array.from({ length: s.day }, () => 0);
  const picks = Array.from({ length: s.day }, () => 0);
  const now = new Map(s.campaigns().map((c) => [c.id, hiddenBest(s, c)] as const));
  for (const campaign of s.campaigns()) {
    const points = new Set<string>();
    for (const day of log?.values() ?? [now]) for (const p of day.get(campaign.id)?.keys() ?? []) points.add(p);
    for (const point of points) {
      const series = s.pickSeries(point, campaign.id);
      for (let d = 0; d < s.day; d++) {
        const h = (log?.get(d) ?? now).get(campaign.id)?.get(point);
        if (!h || h.candidates.length < 2) continue;
        const best = h.candidates.find((c) => c.candidate === h.best)!.perDollar;
        if (!(best > 0)) continue;
        for (const [candidate, arr] of series) {
          const n = arr[d] ?? 0;
          if (n === 0) continue;
          const pd = h.candidates.find((c) => c.candidate === candidate)?.perDollar ?? 0;
          lost[d]! += n * Math.max(0, 1 - pd / best);
          picks[d]! += n;
        }
      }
    }
  }
  return lost.map((l, d) => (picks[d]! > 0 ? l / picks[d]! : null));
}

/** Mean regret over days [from, to). */
export function meanRegret(byDay: readonly (number | null)[], from: number, to: number): number | null {
  const xs = byDay.slice(from, to).filter((x): x is number => x !== null);
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface PointConvergence {
  point: string;
  /** Picks over every campaign, to date. */
  picks: number;
  /** The hidden best candidate per campaign (they may differ: a campaign's brief can rule candidates out). */
  bestByCampaign: Record<string, string>;
  /** Per day: picks, and picks on the campaign's hidden best. */
  daily: { picks: number; onBest: number }[];
}

/**
 * How the prioritizer converged at every candidate place: per day, the share of
 * picks that went to the hidden best candidate (today's truth), over every
 * campaign that chose there.
 */
export function convergence(s: SimulationSession): PointConvergence[] {
  const byPoint = new Map<string, PointConvergence>();
  for (const campaign of s.campaigns()) {
    const best = hiddenBest(s, campaign);
    for (const [point, h] of best) {
      if (h.candidates.length < 2) continue;
      const series = s.pickSeries(point, campaign.id);
      let pc = byPoint.get(point);
      if (!pc) byPoint.set(point, (pc = { point, picks: 0, bestByCampaign: {}, daily: Array.from({ length: s.day }, () => ({ picks: 0, onBest: 0 })) }));
      pc.bestByCampaign[campaign.id] = h.best;
      for (const [candidate, arr] of series) {
        for (let d = 0; d < arr.length && d < s.day; d++) {
          pc.daily[d]!.picks += arr[d]!;
          if (candidate === h.best) pc.daily[d]!.onBest += arr[d]!;
          pc.picks += arr[d]!;
        }
      }
    }
  }
  return [...byPoint.values()];
}

/** Share of picks on the hidden best over days [from, to). */
export function shareOnBest(pc: PointConvergence, from: number, to: number): number | null {
  let p = 0;
  let b = 0;
  for (let d = Math.max(0, from); d < Math.min(to, pc.daily.length); d++) {
    p += pc.daily[d]!.picks;
    b += pc.daily[d]!.onBest;
  }
  return p > 0 ? b / p : null;
}
