/**
 * The hidden truth, read the way a decision reads the world: for each option
 * at a choice point, the true chance a decision there reaches the end of its
 * leg and the true cost from the decision to that end, the other choice
 * points set at their own hidden best. Used to grade the prioritizer (the
 * Research page, the convergence test), never by the engine's choices.
 */

import { START, type OutcomeId, type Pipe, type Script } from "./catalogue";
import { legConsumer, playPoint, pointKey, type SimulationSession } from "./simulator";
import { meetsAll, type Condition } from "./tactics";
import { marketSample, segmentMultiplier, type Campaign } from "./world";

type Step =
  | { kind: "decide"; point: string; options: string[] }
  | { kind: "run"; point: string; yieldRate: number; costCents: number; end: number; recall: number; falsePositive: number; final: boolean; segment: number };

interface Ctx {
  session: SimulationSession;
  campaign: Campaign;
  brandId: string;
  from: OutcomeId;
  to: OutcomeId;
  assign: Map<string, string>;
  steps: Step[];
  ends: number;
  segment: number;
  seenPoints: Set<string>;
  produced: Set<OutcomeId>;
  audience: Condition[];
}

function headScript(s: SimulationSession, dynasty: string): Script | undefined {
  return s.catalogue.headOf(dynasty);
}

function planProduce(c: Ctx, consumer: string, o: OutcomeId, scripts: Script[], final: boolean): boolean {
  const point = pointKey(consumer, o);
  if (scripts.length === 0) return false;
  const options = [...new Set(scripts.map((x) => x.dynasty))];
  if (!c.seenPoints.has(point)) c.steps.push({ kind: "decide", point, options });
  c.seenPoints.add(point);
  const assigned = c.assign.get(point);
  const dyn = assigned && options.includes(assigned) ? assigned : options[0]!;
  const script = headScript(c.session, dyn);
  if (!script) return false;
  const pipe = c.session.catalogue.pipe(script.pipeId)!;
  const truth = c.session.scriptTruth(script, point);
  c.ends *= truth.end ?? 1;
  let recall = truth.recall ?? 1;
  let fp = truth.falsePositive ?? 0;
  const subj = c.session.catalogue.subjectMaterial(pipe);
  const order = subj ? [subj, ...pipe.materials.filter((i) => i !== subj)] : [...pipe.materials];
  for (const i of order) {
    const before = c.steps.length;
    if (!planObtain(c, pipe, i)) return false;
    // Recall at an attesting pipe comes from the scripts chosen at its Materials.
    for (const st of c.steps.slice(before)) {
      if (st.kind !== "decide" || st.point !== pointKey(pipe.id, i)) continue;
      const opt = c.assign.get(st.point) ?? st.options[0]!;
      const t = c.session.optionTruthAt(st.point, opt);
      if (t.recall !== undefined) recall *= t.recall;
      if (t.falsePositive !== undefined) fp = Math.max(fp, t.falsePositive);
    }
  }
  const pt = c.session.world.truth.pipes[pipe.id] ?? { base: 1, delayMeanDays: 0, horizonDays: 0 };
  // A script creating subjects finds someone only while its reserve lasts.
  const pick = c.session.catalogue.createsSubjects(pipe) ? c.session.pickChance(script, c.brandId, c.audience) : 1;
  c.produced.add(o);
  c.steps.push({ kind: "run", point, yieldRate: Math.min(1, pt.base * (truth.step ?? 1) * pick), costCents: truth.costCents, end: 1, recall, falsePositive: fp, final, segment: c.segment });
  return true;
}

function planObtain(c: Ctx, consumer: Pipe, i: OutcomeId): boolean {
  const s = c.session;
  const out = s.catalogue.outcome(i);
  if (!out) return false;
  if (i === c.from) return true;
  const providers = s.catalogue.providersOf(i).filter((p) => !p.webhook);
  const starts = c.campaign.start === START ? new Set<OutcomeId>() : new Set([c.campaign.start]);
  if (out.subject === "lead" || out.subject === "company") {
    // Produced earlier in this leg for the same subject: reused, no choice.
    if (c.produced.has(i)) return true;
    const rooted = providers.filter((p) => s.catalogue.rootsOf(p, starts).has(c.from) || (c.from === START && s.catalogue.rootsOf(p).has(START)));
    // Nothing on this leg can make it: the subject brings it from before.
    if (rooted.length === 0) return true;
    return planProduce(c, consumer.id, i, s.allowedScripts(c.campaign, consumer, i, rooted), false);
  }
  if (out.subject === "run") return planProduce(c, consumer.id, i, s.allowedScripts(c.campaign, consumer, i, providers), false);
  // A brand Unit: chosen among the ones the brand holds, else ordered from a producer.
  const point = pointKey(consumer.id, i);
  const options = s.objectDynasties(c.brandId, i);
  if (options.length === 0) return providers.length === 0 || planProduce(c, consumer.id, i, s.allowedScripts(c.campaign, consumer, i, providers), false);
  if (options.length > 1 && !c.seenPoints.has(point)) c.steps.push({ kind: "decide", point, options });
  c.seenPoints.add(point);
  const assigned = c.assign.get(point);
  const dyn = assigned && options.includes(assigned) ? assigned : options[0]!;
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

function plan(s: SimulationSession, campaign: Campaign, legIndex: number, assign: Map<string, string>): Ctx | null {
  const from = legIndex === 0 ? campaign.start : campaign.line[legIndex - 1]!;
  const to = campaign.line[legIndex]!;
  const c: Ctx = { session: s, campaign, brandId: campaign.brandId, from, to, assign, steps: [], ends: 1, segment: 1, seenPoints: new Set(), produced: new Set(), audience: [] };
  const plays = s.playsFor(campaign, from, to);
  if (plays.length === 0) return null;
  const pp = playPoint(from, to);
  if (plays.length > 1) c.steps.push({ kind: "decide", point: pp, options: plays.map((p) => p.id) });
  const pipeId = assign.get(pp) ?? plays[0]!.id;
  const pipe = s.catalogue.pipe(pipeId)!;
  if (!planProduce(c, legConsumer(from, to), to, s.allowedScripts(campaign, null, null, [pipe]), true)) return null;
  return c;
}

/** True chance to reach the leg's end and true cost to get there, from the first decision at `point`. */
function fromPoint(c: Ctx, point: string): { p: number; cost: number } | null {
  const k = c.steps.findIndex((st) => st.kind === "decide" && st.point === point);
  if (k < 0) return null;
  let reach = 1;
  let cost = 0;
  let p = 0;
  for (const st of c.steps.slice(k + 1)) {
    if (st.kind !== "run") continue;
    cost += reach * st.costCents;
    if (st.final) {
      const fact = Math.min(0.97, st.yieldRate * c.ends * (c.from === START ? c.segment : 1));
      p = reach * (fact * st.recall + (1 - fact) * st.falsePositive);
    } else reach *= st.yieldRate;
  }
  return { p, cost };
}

export interface HiddenOption {
  option: string;
  /** True share of decisions reaching the leg's end, from this point. */
  rate: number;
  /** True cents from the decision to the leg's end. */
  costCents: number;
  /** rate / dollar: the value per dollar up to the leg's value. */
  perDollar: number;
}

/**
 * Hidden truth of every choice point of a campaign's leg: per point, each
 * option's true rate and cost, the other points at their own hidden best
 * (found by coordinate ascent).
 */
export function hiddenTruth(s: SimulationSession, campaign: Campaign, legIndex: number): Map<string, HiddenOption[]> {
  const assign = new Map<string, string>();
  let ctx = plan(s, campaign, legIndex, assign);
  if (!ctx) return new Map();
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const st of ctx.steps) {
      if (st.kind !== "decide" || st.options.length < 2) continue;
      let best = assign.get(st.point) ?? st.options[0]!;
      let bestScore = -1;
      for (const o of st.options) {
        const trial = new Map(assign).set(st.point, o);
        const c = plan(s, campaign, legIndex, trial);
        const r = c ? fromPoint(c, st.point) : null;
        const score = r && r.cost > 0 ? r.p / r.cost : 0;
        if (score > bestScore + 1e-15) {
          bestScore = score;
          best = o;
        }
      }
      if (assign.get(st.point) !== best) changed = true;
      assign.set(st.point, best);
    }
    ctx = plan(s, campaign, legIndex, assign)!;
    if (!changed) break;
  }
  const out = new Map<string, HiddenOption[]>();
  for (const st of ctx.steps) {
    if (st.kind !== "decide") continue;
    out.set(
      st.point,
      st.options.map((o) => {
        const c = plan(s, campaign, legIndex, new Map(assign).set(st.point, o));
        const r = c ? fromPoint(c, st.point) : null;
        const rate = r?.p ?? 0;
        const costCents = r?.cost ?? 0;
        return { option: o, rate, costCents, perDollar: costCents > 0 ? rate / (costCents / 100) : 0 };
      }),
    );
  }
  return out;
}

/** The hidden best option at every point of every leg of a campaign. */
export function hiddenBest(s: SimulationSession, campaign: Campaign): Map<string, { best: string; options: HiddenOption[] }> {
  const out = new Map<string, { best: string; options: HiddenOption[] }>();
  for (let k = 0; k < campaign.line.length; k++) {
    for (const [point, options] of hiddenTruth(s, campaign, k)) {
      if (out.has(point)) continue;
      const best = [...options].sort((a, b) => b.perDollar - a.perDollar || (a.option < b.option ? -1 : 1))[0];
      if (best) out.set(point, { best: best.option, options });
    }
  }
  return out;
}

export interface PointConvergence {
  point: string;
  /** Picks over every campaign, to date. */
  picks: number;
  /** The hidden best option per campaign (they may differ: a campaign's play can rule options out). */
  bestByCampaign: Record<string, string>;
  /** Per day: picks, and picks on the campaign's hidden best. */
  daily: { picks: number; onBest: number }[];
}

/**
 * How the prioritizer converged at every choice point: per day, the share of
 * picks that went to the hidden best option (today's truth), over every
 * campaign that chose there.
 */
export function convergence(s: SimulationSession): PointConvergence[] {
  const byPoint = new Map<string, PointConvergence>();
  for (const campaign of s.campaigns()) {
    const best = hiddenBest(s, campaign);
    for (const [point, h] of best) {
      if (h.options.length < 2) continue;
      const series = s.pickSeries(point, campaign.id);
      let pc = byPoint.get(point);
      if (!pc) byPoint.set(point, (pc = { point, picks: 0, bestByCampaign: {}, daily: Array.from({ length: s.day }, () => ({ picks: 0, onBest: 0 })) }));
      pc.bestByCampaign[campaign.id] = h.best;
      for (const [option, arr] of series) {
        for (let d = 0; d < arr.length && d < s.day; d++) {
          pc.daily[d]!.picks += arr[d]!;
          if (option === h.best) pc.daily[d]!.onBest += arr[d]!;
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
