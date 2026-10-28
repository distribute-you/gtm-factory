/**
 * Read models over the running world: every figure a page shows is computed here from the
 * engine's own outputs (runs, Units, picks, beliefs). Pages divide nothing
 * themselves. Nothing here knows an outcome or a script by name: everything is read off
 * the catalogue.
 */

import {
  OURS,
  START,
  buildLedger,
  chanceOfBest,
  estimatedRegret,
  type LedgerReport,
  type Campaign,
  type Catalogue,
  type PickRecord,
  type Unit,
  type OutcomeId,
  type Person,
  type PlanNode,
  type Script,
  type SimulationSession,
  type WorldClient,
  type WorldSpec,
} from "@gtm-factory/core";
import { humanize } from "./format";

/** A milestone: an outcome of a Track, at its rank. */
export interface LeadStateDef {
  outcome: OutcomeId;
  label: string;
  rank: number;
  trackId: string;
}

export interface TrackDef {
  id: string;
  /** "CRM lifecycle track". */
  label: string;
  description: string | undefined;
  states: LeadStateDef[];
}

export interface Model {
  day: number;
  world: WorldSpec;
  session: SimulationSession;
  catalogue: Catalogue;
  clients: readonly WorldClient[];
  campaigns: Campaign[];
  tracks: TrackDef[];
  /** Cached per model (one simulated day): expensive reads computed once, on first use. */
  memo: Map<string, unknown>;
}

export function buildModel(world: WorldSpec, session: SimulationSession): Model {
  return {
    day: session.day,
    world,
    session,
    catalogue: world.catalogue,
    clients: session.clients,
    campaigns: session.campaigns(),
    tracks: leadTracks(world.catalogue),
    memo: new Map(),
  };
}

function memo<T>(model: Model, key: string, f: () => T): T {
  if (model.memo.has(key)) return model.memo.get(key) as T;
  const v = f();
  model.memo.set(key, v);
  return v;
}

// ---------------------------------------------------------------------------
// Vocabulary read off the catalogue
// ---------------------------------------------------------------------------

/** Every Track with its milestones in rank order. A track is never added to another. */
export function leadTracks(catalogue: Catalogue): TrackDef[] {
  return catalogue.tracks
    .filter((t) => !t.retired)
    .map((t) => ({
      id: t.id,
      label: `${t.name} track`,
      description: t.description,
      states: catalogue.outcomes
        .filter((o) => o.track?.track === t.id && !o.retired)
        .map((o) => ({ outcome: o.id, label: o.label, rank: o.track!.rank, trackId: t.id }))
        .sort((a, b) => a.rank - b.rank),
    }))
    .filter((t) => t.states.length > 0);
}

export function outcomeLabel(catalogue: Catalogue, id: OutcomeId): string {
  if (id === START) return "Start";
  return catalogue.outcome(id)?.label ?? humanize(id);
}

export function outcomePlural(catalogue: Catalogue, id: OutcomeId): string {
  const o = catalogue.outcome(id);
  return o?.plural ?? `${outcomeLabel(catalogue, id)}s`;
}

/** An Engine is named by the outcome it makes. */
export function engineName(catalogue: Catalogue, outcome: OutcomeId): string {
  return outcomeLabel(catalogue, outcome);
}

/** The Engines whose scripts call an outcome (its Provider's callers). */
export function callersOf(catalogue: Catalogue, outcome: OutcomeId): OutcomeId[] {
  return [...new Set(catalogue.scripts.filter((s) => s.status === "active" && s.materials.includes(outcome)).map((s) => s.outcome))];
}

/**
 * An Engine in one line: where its subject comes from, then what it makes. An
 * Engine that makes no subject of its own (a completion, a template) says who calls it.
 */
export function engineLine(catalogue: Catalogue, outcome: OutcomeId): string {
  const scripts = catalogue.scriptsOf(outcome);
  const kind = catalogue.outcome(outcome)?.subject;
  if (kind === "lead" || kind === "company") {
    const froms = [...new Set(scripts.map((s) => (catalogue.subjectOf(s) ? outcomeLabel(catalogue, catalogue.subjectOf(s)!) : s.webhook ? "a report from another party" : "The market")))];
    const said = froms.length > 1 ? `${froms.slice(0, -1).join(", ")} or ${froms[froms.length - 1]}` : froms[0] ?? "The market";
    return `${said.charAt(0).toUpperCase()}${said.slice(1)} → ${outcomeLabel(catalogue, outcome)}`;
  }
  const callers = callersOf(catalogue, outcome);
  return callers.length > 0 ? `Called by ${callers.map((c) => outcomeLabel(catalogue, c)).join(", ")}` : `Made for the brand`;
}

/** One outcome a script calls: its Provider, and the pick made there. */
export interface MaterialRow {
  material: OutcomeId;
  label: string;
  /** The subject Material: the Unit the script works on. */
  subject: boolean;
  /** How the Provider serves it. */
  how: string;
  /** The candidate place (this Engine, this Material), when one was made. */
  point: string | null;
  /** The candidate picked most over the last 7 days, every campaign. */
  pick: string | null;
  picks: number;
}

/** The outcomes a script calls (read from its code, then measured), each with its Provider. */
export function materialsOfScript(model: Model, script: Script): { rows: MaterialRow[]; label: "judged" | "measured" } {
  const c = model.catalogue;
  const subject = c.subjectOf(script);
  const list = model.session.materialsOf(script);
  const measured = list.join() !== [...script.materials].join() || model.session.runs.some((r) => r.scriptId === script.id && r.consumed.length > 0);
  const rows = list.map((m) => {
    const o = c.outcome(m);
    const point = `${script.outcome}|${m}`;
    const series = model.session.pickSeries(point);
    let pick: string | null = null;
    let best = 0;
    let picks = 0;
    for (const [cand, arr] of series) {
      const recent = arr.slice(-7).reduce((x, y) => x + y, 0);
      picks += arr.reduce((x, y) => x + y, 0);
      if (recent > best) {
        best = recent;
        pick = cand;
      }
    }
    const how =
      o?.contentType === "rating"
        ? "Today's Rating"
        : o?.subject === "run"
          ? "A new one for each run"
          : o?.subject === "brand"
            ? "The brand's latest, else made"
            : m === subject
              ? "The Unit it works on: pulled or pushed"
              : "From the stock for this subject, else made";
    return { material: m, label: outcomeLabel(c, m), subject: m === subject, how, point: series.size > 0 && pick ? point : null, pick: pick ? candidateLabel(model, point, pick) : null, picks };
  });
  return { rows, label: measured ? "measured" : "judged" };
}

/** The script a dynasty runs today. */
export function headScript(catalogue: Catalogue, dynasty: string): Script | undefined {
  return catalogue.headOf(dynasty) ?? catalogue.versionsOf(dynasty).pop();
}

export type PointKind = "script" | "unit";

export interface PointInfo {
  key: string;
  kind: PointKind;
  /** The consuming Engine's outcome, or "campaign" (the Target itself). */
  consumer: string;
  /** The outcome called: its Engine's scripts (or the brand's Units) compete. */
  material: OutcomeId;
  /** Uniform: "<Engine> · scripts" or "<Outcome> · Units". */
  title: string;
  /** Who asks for it. */
  sub: string;
}

/** What a candidate place is, in words, from its key `consumer|material`. */
export function pointInfo(catalogue: Catalogue, key: string): PointInfo {
  const [consumer, material] = key.split("|") as [string, string];
  const out = catalogue.outcome(material);
  // A brand outcome (a template, an ICP) is picked among the brand's Units; every other among its Engine's scripts.
  const kind: PointKind = out?.subject === "brand" ? "unit" : "script";
  const asker = consumer === "campaign" ? "the campaign" : engineName(catalogue, consumer);
  return {
    key,
    kind,
    consumer,
    material,
    title: kind === "unit" ? `${outcomeLabel(catalogue, material)} · Units` : `${engineName(catalogue, material)} · scripts`,
    sub: `for ${asker}`,
  };
}

/** The word a pick card's first column says: what competes there. */
export function candidateWord(kind: PointKind): string {
  return kind === "unit" ? "Unit" : "Script";
}

/** A candidate of a candidate place in words: a script dynasty or a brand Unit dynasty. */
export function candidateLabel(model: Model, point: string, candidate: string, brandId?: string): string {
  const s = headScript(model.catalogue, candidate);
  if (s) return s.name;
  const info = pointInfo(model.catalogue, point);
  const brands = brandId ? [brandId] : model.clients.map((c) => c.brand.id);
  for (const b of brands) {
    const u = model.session.objectHead(b, info.material, candidate);
    if (u) return u.name ?? humanize(candidate);
  }
  return humanize(candidate);
}

// ---------------------------------------------------------------------------
// Clients, campaigns, value
// ---------------------------------------------------------------------------

export function clientOf(model: Model, campaignId: string): WorldClient | undefined {
  return model.clients.find((c) => c.campaigns.some((x) => x.id === campaignId));
}

/** Campaigns in scope: one brand, or every client. */
export function scopedCampaigns(model: Model, brandId: string | null, offerId: string | null = null): Campaign[] {
  return model.campaigns.filter((c) => (!brandId || c.brandId === brandId) && (!offerId || c.offerId === offerId));
}

/** The runs of a scope: those of its campaigns, and the work for no campaign done for its brands. */
export function scopedRuns(model: Model, brandId: string | null, offerId: string | null = null): SimulationSession["runs"] {
  if (!brandId) return model.session.runs;
  const ids = new Set(scopedCampaigns(model, brandId, offerId).map((c) => c.id));
  const runBrand = memo(model, "runBrand", () => new Map(model.session.units.map((u) => [u.runId, u.brandId])));
  return model.session.runs.filter((r) => (r.campaignId ? ids.has(r.campaignId) : runBrand.get(r.id) === brandId));
}

/** The ledger of a scope, reconciled the same way as the whole one. */
export function scopedLedger(model: Model, brandId: string | null, offerId: string | null = null): LedgerReport {
  if (!brandId) return model.session.ledger();
  return memo(model, `ledger:${brandId}:${offerId ?? "*"}`, () => {
    const runs = scopedRuns(model, brandId, offerId);
    const ids = new Set(runs.map((r) => r.id));
    return buildLedger(runs, model.session.units.filter((u) => u.runId === null || ids.has(u.runId)));
  });
}

/** Where a campaign starts: Start (it pulls), or the outcome whose Units it pushes. */
export function startOf(_model: Model, campaign: Campaign): OutcomeId {
  return campaign.start;
}

export function targetOf(campaign: Campaign): OutcomeId {
  return campaign.target;
}

export function campaignName(_model: Model, campaign: Campaign): string {
  return campaign.name;
}

export interface ScopeFigures {
  spendCents: number;
  dailySpendCents: number[];
  /** Access cost paid to other parties, per day. */
  dailyOtherCents: number[];
  /** New lead states per outcome, per day. */
  dailyOutcomes: Record<string, number[]>;
  outcomes: Record<string, number>;
  dailyValueOurs: number[];
  dailyValueOther: number[];
  valueOurs: number;
  valueOther: number;
  attempts: number;
  dailyAttempts: number[];
  /** Units pushed into reactive campaigns. */
  pushes: number;
}

/** Money, value and outcomes of a set of campaigns, day by day. */
export function scopeFigures(model: Model, campaigns: readonly Campaign[]): ScopeFigures {
  const ids = new Set(campaigns.map((c) => c.id));
  const n = model.day;
  const z = () => new Array<number>(n).fill(0);
  const f: ScopeFigures = { spendCents: 0, dailySpendCents: z(), dailyOtherCents: z(), dailyOutcomes: {}, outcomes: {}, dailyValueOurs: z(), dailyValueOther: z(), valueOurs: 0, valueOther: 0, attempts: 0, dailyAttempts: z(), pushes: 0 };
  for (const d of model.session.days) {
    for (const [cid, v] of Object.entries(d.spendCents)) if (ids.has(cid)) f.dailySpendCents[d.day]! += v;
    for (const [cid, v] of Object.entries(d.otherCents)) if (ids.has(cid)) f.dailyOtherCents[d.day]! += v;
    for (const [cid, v] of Object.entries(d.valueOurs)) if (ids.has(cid)) f.dailyValueOurs[d.day]! += v;
    for (const [cid, v] of Object.entries(d.valueOther)) if (ids.has(cid)) f.dailyValueOther[d.day]! += v;
    for (const [cid, v] of Object.entries(d.attempts)) if (ids.has(cid)) f.dailyAttempts[d.day]! += v;
    for (const [cid, per] of Object.entries(d.outcomes)) {
      if (!ids.has(cid)) continue;
      for (const [o, v] of Object.entries(per)) {
        (f.dailyOutcomes[o] ??= z())[d.day]! += v;
        f.outcomes[o] = (f.outcomes[o] ?? 0) + v;
      }
    }
  }
  // Setup and other work billed to the campaigns outside a day's runs (seed Units, setup).
  f.spendCents = campaigns.reduce((s, c) => s + model.session.spentCents(c.id), 0);
  // Setup of the brands in scope (support work, no outcome): our spend too.
  for (const r of model.session.runs) if (r.support && r.campaignId && ids.has(r.campaignId)) f.spendCents += r.spendCents;
  // Auxiliary cost centers (the Supplier rating) of the brands in scope: our runs for no campaign, their cost reaching the campaigns through the Units consumed.
  const brands = new Set(campaigns.map((c) => c.brandId));
  const runBrand = memo(model, "runBrand", () => new Map(model.session.units.map((u) => [u.runId, u.brandId])));
  for (const r of model.session.runs) if (!r.campaignId && !r.support && r.performedBy === OURS && brands.has(runBrand.get(r.id) ?? "")) f.spendCents += r.spendCents;
  f.valueOurs = f.dailyValueOurs.reduce((s, x) => s + x, 0);
  f.valueOther = f.dailyValueOther.reduce((s, x) => s + x, 0);
  f.attempts = f.dailyAttempts.reduce((s, x) => s + x, 0);
  f.pushes = model.session.pushes.filter((p) => ids.has(p.campaignId)).length;
  return f;
}

export function cumulative(values: readonly number[]): number[] {
  let s = 0;
  return values.map((v) => (s += v));
}

/** Cost per outcome to date, day by day: cumulative spend / cumulative outcomes (null before the first). */
export function costPerOutcomeSeries(dailySpendCents: readonly number[], dailyOutcomes: readonly number[]): (number | null)[] {
  const spend = cumulative(dailySpendCents);
  const outs = cumulative(dailyOutcomes);
  return spend.map((s, i) => (outs[i]! > 0 ? s / 100 / outs[i]! : null));
}

/** Return of a set of campaigns: our value over our spend, and the expected one on the same formula, spend-weighted. */
export function scopeReturn(model: Model, campaigns: readonly Campaign[]): { measured: number | null; expected: number | null; low: number | null; high: number | null } {
  let spend = 0;
  let value = 0;
  let expW = 0;
  let expS = 0;
  let lo = 0;
  let hi = 0;
  for (const c of campaigns) {
    const e = model.session.economics(c.id);
    spend += e.spendCents;
    value += e.valueOurs;
    if (e.expected.value !== null && e.spendCents > 0) {
      expW += e.expected.value * e.spendCents;
      lo += (e.expected.low ?? e.expected.value) * e.spendCents;
      hi += (e.expected.high ?? e.expected.value) * e.spendCents;
      expS += e.spendCents;
    }
  }
  return { measured: spend > 0 ? value / (spend / 100) : null, expected: expS > 0 ? expW / expS : null, low: expS > 0 ? lo / expS : null, high: expS > 0 ? hi / expS : null };
}

// ---------------------------------------------------------------------------
// Candidate places: beliefs, picks, the chance each candidate is the best
// ---------------------------------------------------------------------------

export interface CandidateRow {
  candidate: string;
  label: string;
  /** Share of this campaign's picks over the last 7 days. */
  share: number;
  picks: number;
  /** The engine's belief today. */
  rate: number;
  rateSd: number;
  cost: number;
  valuePerDollar: number;
  decisions: number;
  successes: number;
  /** The chance it is the best here by value per dollar, read from the beliefs. */
  chanceBest: number;
  isBelievedBest: boolean;
}

export interface PointRow {
  info: PointInfo;
  campaignId: string;
  candidates: CandidateRow[];
  picks: number;
}

/** Every candidate place a campaign used, in the order its decisions are made. */
export function pointsOf(model: Model, campaign: Campaign): PointRow[] {
  return memo(model, `points:${campaign.id}`, () => {
    const keys = [...new Set(model.session.candidatePlaces().filter((p) => p.campaignId === campaign.id).map((p) => p.point))];
    // Brand inputs (ICPs, templates) are read on the row of the script that used them, never as a place of their own.
    return keys.filter((key) => pointInfo(model.catalogue, key).kind === "script").map((key) => pointRow(model, campaign, key));
  });
}

export function pointRow(model: Model, campaign: Campaign, key: string): PointRow {
  const info = pointInfo(model.catalogue, key);
  const series = model.session.pickSeries(key, campaign.id);
  const recent = new Map<string, number>();
  let total = 0;
  let all = 0;
  for (const [o, arr] of series) {
    const n = arr.slice(-7).reduce((x, y) => x + y, 0);
    recent.set(o, n);
    total += n;
    all += arr.reduce((x, y) => x + y, 0);
  }
  const beliefs = model.session.beliefsAt(key, campaign.id);
  const bestBelief = [...beliefs].sort((a, b) => b.valuePerDollar - a.valuePerDollar)[0]?.candidate ?? null;
  const chance = chanceOfBest(beliefs.map((b) => ({ id: b.candidate, rate: b.rate, rateSd: b.rateSd, cost: b.cost })));
  const candidates: CandidateRow[] = beliefs.map((b) => ({
    candidate: b.candidate,
    label: candidateLabel(model, key, b.candidate, campaign.brandId),
    share: total > 0 ? (recent.get(b.candidate) ?? 0) / total : 0,
    picks: series.get(b.candidate)?.reduce((x, y) => x + y, 0) ?? 0,
    rate: b.rate,
    rateSd: b.rateSd,
    cost: b.cost,
    valuePerDollar: b.valuePerDollar,
    decisions: b.decisions,
    successes: b.successes,
    chanceBest: chance[b.candidate] ?? 0,
    isBelievedBest: bestBelief === b.candidate,
  }));
  return { info, campaignId: campaign.id, candidates, picks: all };
}

/**
 * How the picks at a candidate place settled, day by day, read from the Rating's own beliefs:
 * the picks, those on the candidate it believed best that day, and the value lost on the
 * others (estimated regret). No hidden truth.
 */
export interface PointConvergence {
  point: string;
  picks: number;
  /** The candidate the Rating believes best now, per campaign. */
  bestByCampaign: Record<string, string>;
  daily: { picks: number; onBest: number; regretCents: number }[];
}

/** The settling of every candidate place (cached per day). */
export function convergenceOf(model: Model, campaignIds: ReadonlySet<string> | null = null): PointConvergence[] {
  const key = campaignIds ? [...campaignIds].sort().join(",") : "*";
  return memo(model, `convergence:${key}`, () => {
    const by = new Map<string, PointConvergence>();
    for (const r of model.session.pickLog) {
      if (campaignIds && !campaignIds.has(r.campaignId)) continue;
      let pc = by.get(r.point);
      if (!pc) by.set(r.point, (pc = { point: r.point, picks: 0, bestByCampaign: {}, daily: Array.from({ length: model.day }, () => ({ picks: 0, onBest: 0, regretCents: 0 })) }));
      const picks = r.candidates.reduce((x, c) => x + c.picks, 0);
      const d = pc.daily[r.day] ?? (pc.daily[r.day] = { picks: 0, onBest: 0, regretCents: 0 });
      d.picks += picks;
      d.onBest += r.candidates.find((c) => c.id === r.bestId)?.picks ?? 0;
      d.regretCents += estimatedRegret({ candidates: r.candidates }).regretCents;
      pc.picks += picks;
      pc.bestByCampaign[r.campaignId] = r.bestId;
    }
    return [...by.values()];
  });
}

/** Share of picks on the candidate believed best that day (null on a day without picks). */
export function shareSeries(pc: PointConvergence): (number | null)[] {
  return pc.daily.map((d) => (d.picks > 0 ? d.onBest / d.picks : null));
}

/** The chance the favourite of a place is the best, over the campaigns that use it. */
export function placeChance(model: Model, point: string, campaignIds: ReadonlySet<string> | null = null): number | null {
  let best: number | null = null;
  for (const c of model.campaigns) {
    if (campaignIds && !campaignIds.has(c.id)) continue;
    if (!model.session.candidatePlaces().some((p) => p.campaignId === c.id && p.point === point)) continue;
    const top = Math.max(0, ...pointRow(model, c, point).candidates.map((x) => x.chanceBest));
    best = best === null ? top : Math.max(best, top);
  }
  return best;
}

/** The latest pick records of a set of campaigns, newest first. */
export function recentPicks(model: Model, campaignIds: Set<string>, limit: number): PickRecord[] {
  const out: PickRecord[] = [];
  const all = model.session.pickLog;
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) if (campaignIds.has(all[i]!.campaignId)) out.push(all[i]!);
  return out;
}

/** Why a pick went the way it did, in plain words. */
export function explainPick(model: Model, c: PickRecord): string {
  const brandId = model.campaigns.find((x) => x.id === c.campaignId)?.brandId;
  const picked = candidateLabel(model, c.point, c.pickedId, brandId);
  const total = c.candidates.reduce((s, o) => s + o.picks, 0);
  const share = total > 0 ? Math.round((100 * (c.candidates.find((o) => o.id === c.pickedId)?.picks ?? 0)) / total) : 0;
  if (c.pickedId === c.bestId) return `${picked} took ${share}% of picks: the best expected value per dollar.`;
  return `${picked} took ${share}% of picks while ${candidateLabel(model, c.point, c.bestId, brandId)} leads on expected value: still exploring.`;
}

// ---------------------------------------------------------------------------
// Engines, scripts and who calls them
// ---------------------------------------------------------------------------

export interface PluggedInput {
  point: string;
  info: PointInfo;
  /** The script with the best expected value per dollar there, over every campaign that chose there. */
  bestScript: string | null;
  picks: number;
}

/** Every caller of an Engine (a point `consumer|outcome`), and the best script at each. */
export function pluggedAt(model: Model, outcome: OutcomeId): PluggedInput[] {
  return memo(model, `plugged:${outcome}`, () => {
    const dynasties = new Set(model.catalogue.scripts.filter((s) => s.outcome === outcome).map((s) => s.dynasty));
    const points = [...new Set(model.session.candidatePlaces().map((p) => p.point))].filter((p) => p.endsWith(`|${outcome}`) && model.session.candidatesAt(p).some((o) => dynasties.has(o)));
    return points.map((point) => {
      const score = new Map<string, number>();
      let picks = 0;
      for (const c of model.campaigns) {
        const series = model.session.pickSeries(point, c.id);
        if (series.size === 0) continue;
        for (const b of model.session.beliefsAt(point, c.id)) if (dynasties.has(b.candidate)) score.set(b.candidate, (score.get(b.candidate) ?? 0) + b.valuePerDollar);
        for (const arr of series.values()) picks += arr.reduce((x, y) => x + y, 0);
      }
      const best = [...score].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { point, info: pointInfo(model.catalogue, point), bestScript: best, picks };
    });
  });
}

export interface ScriptFigures {
  runs: number;
  subjects: number;
  produced: number;
  spendCents: number;
  yieldRate: number | null;
  costPerRun: number | null;
}

/** What a script's runs did: subjects processed, outcomes produced, spend (every version of a dynasty pooled). */
export function scriptFigures(model: Model, dynasty: string): ScriptFigures {
  const all = memo(model, "scriptFigures", () => {
    const byScript = new Map<string, ScriptFigures>();
    const produced = new Map<string, number>();
    for (const o of model.session.units) produced.set(o.runId, (produced.get(o.runId) ?? 0) + 1);
    for (const r of model.session.runs) {
      if (!r.scriptId) continue;
      const s = model.catalogue.script(r.scriptId);
      if (!s) continue;
      const f = byScript.get(s.dynasty) ?? { runs: 0, subjects: 0, produced: 0, spendCents: 0, yieldRate: null, costPerRun: null };
      f.runs += 1;
      f.subjects += r.subjects;
      f.produced += produced.get(r.id) ?? 0;
      f.spendCents += r.spendCents;
      byScript.set(s.dynasty, f);
    }
    for (const f of byScript.values()) {
      f.yieldRate = f.subjects > 0 ? f.produced / f.subjects : null;
      f.costPerRun = f.subjects > 0 ? f.spendCents / 100 / f.subjects : null;
    }
    return byScript;
  });
  return all.get(dynasty) ?? { runs: 0, subjects: 0, produced: 0, spendCents: 0, yieldRate: null, costPerRun: null };
}

// ---------------------------------------------------------------------------
// Object outcomes: dynasties, versions, the brand holding them
// ---------------------------------------------------------------------------

export interface ObjectDynasty {
  brandId: string;
  dynasty: string;
  name: string;
  parentDynasty: string | null;
  versions: Unit[];
  head: Unit;
  /** Picks over every Material that consumes it, every campaign of the brand. */
  picks: number;
  /** Share of the brand's picks at those Materials over the last 7 days. */
  share: number;
}

/** Every dynasty of an object outcome, per brand (scope = one brand or all). */
export function objectDynasties(model: Model, outcome: OutcomeId, brandId: string | null): ObjectDynasty[] {
  const consumerPoints = [...new Set(model.session.candidatePlaces().map((p) => p.point))].filter((p) => p.endsWith(`|${outcome}`));
  const out: ObjectDynasty[] = [];
  for (const client of model.clients) {
    if (brandId && client.brand.id !== brandId) continue;
    const versions = model.session.objectVersions(client.brand.id, outcome);
    const dyns = [...new Set(versions.map((v) => v.dynasty!))];
    const picks = new Map<string, number>();
    const recent = new Map<string, number>();
    let recentTotal = 0;
    for (const c of client.campaigns) {
      for (const p of consumerPoints) {
        for (const [o, arr] of model.session.pickSeries(p, c.id)) {
          picks.set(o, (picks.get(o) ?? 0) + arr.reduce((x, y) => x + y, 0));
          const r = arr.slice(-7).reduce((x, y) => x + y, 0);
          recent.set(o, (recent.get(o) ?? 0) + r);
          recentTotal += r;
        }
      }
    }
    for (const d of dyns) {
      const vs = versions.filter((v) => v.dynasty === d).sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
      const head = vs[vs.length - 1]!;
      out.push({ brandId: client.brand.id, dynasty: d, name: head.name ?? humanize(d), parentDynasty: vs[0]!.parentDynasty ?? null, versions: vs, head, picks: picks.get(d) ?? 0, share: recentTotal > 0 ? (recent.get(d) ?? 0) / recentTotal : 0 });
    }
  }
  return out;
}

/** Object outcomes of the catalogue (what a pin on an outcome can list). */
export function objectOutcomes(catalogue: Catalogue): OutcomeId[] {
  return catalogue.outcomes.filter((o) => o.subject === "brand" && !o.retired).map((o) => o.id);
}

export { diffWords, variablesOf } from "./diff";

// ---------------------------------------------------------------------------
// Leads and companies
// ---------------------------------------------------------------------------

export interface LeadRow {
  person: Person;
  /** Highest milestone reached per track. */
  states: Record<string, LeadStateDef | null>;
  /** Who brought the person in (the "Performed by" of the script that found them). */
  root: string;
  firstDay: number;
  campaignIds: string[];
}

/** Every person served, with the furthest milestone per track. */
export function leadRows(model: Model, brandId: string | null): LeadRow[] {
  return memo(model, `leads:${brandId ?? "all"}`, () => {
    const rows: LeadRow[] = [];
    for (const p of model.session.people()) {
      if (brandId && p.brandId !== brandId) continue;
      const reached = model.session.reachedBy(p.id);
      const states: Record<string, LeadStateDef | null> = {};
      let first = Number.POSITIVE_INFINITY;
      for (const d of reached.values()) first = Math.min(first, d);
      for (const t of model.tracks) {
        let best: LeadStateDef | null = null;
        for (const s of t.states) if (reached.has(s.outcome) && (!best || s.rank > best.rank)) best = s;
        states[t.id] = best;
      }
      rows.push({ person: p, states, root: model.session.rootOf(p.id) ?? "", firstDay: Number.isFinite(first) ? first : 0, campaignIds: model.session.campaignsOfSubject(p.id) });
    }
    return rows;
  });
}

/** Everything that happened to one person (and to its company): Units, newest last. */
export function timelineOf(model: Model, personId: string): Unit[] {
  const p = model.session.person(personId);
  const company = p?.companyId;
  return model.session.units.filter((o) => o.subject === personId || (company && o.subject === company)).sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
}

/** A fictional name for a person, drawn from its id (the same on every reload). */
export function personName(id: string): string {
  const FIRST = ["Ava", "Liam", "Noor", "Mateo", "Ines", "Owen", "Sofia", "Ravi", "Lena", "Hugo", "Maya", "Felix", "Zoe", "Arjun", "Clara", "Theo", "Amara", "Jonas", "Elif", "Marco", "Nadia", "Oscar", "Priya", "Leo", "Iris", "Samir", "Hana", "Pablo", "Freya", "Malik"];
  const LAST = ["Moreau", "Becker", "Okafor", "Lindqvist", "Rossi", "Tanaka", "Novak", "Haddad", "Silva", "Kowalski", "Dubois", "Meyer", "Nguyen", "Fischer", "Costa", "Larsen", "Varga", "Ahmed", "Keller", "Romero", "Brennan", "Sato", "Petrov", "Laine", "Duarte"];
  const h = hash(id);
  return `${FIRST[h % FIRST.length]} ${LAST[Math.floor(h / 31) % LAST.length]}`;
}

export function companyName(companyId: string): string {
  const A = ["Blue", "North", "Silver", "Bright", "Clear", "Oak", "Swift", "Stone", "Maple", "Iron", "Coral", "Amber", "Cedar", "Lark", "Pine", "Sun", "River", "Fern", "Echo", "Atlas"];
  const B = ["field", "gate", "line", "works", "path", "point", "bridge", "craft", "loop", "yard", "forge", "harbor", "nest", "grid", "wave", "stack"];
  const C = ["Systems", "Labs", "Group", "Partners", "Studio", "Logistics", "Health", "Software", "Foods", "Capital", "Clinics", "Freight"];
  const h = hash(companyId);
  return `${A[h % A.length]}${B[Math.floor(h / 23) % B.length]} ${C[Math.floor(h / 389) % C.length]}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s&.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

// ---------------------------------------------------------------------------
// A new campaign: the Plan it would run today
// ---------------------------------------------------------------------------

/** The Plan a new campaign of a brand would run this tick, from a start to a Target, and the milestones it passes through. */
export function previewPlan(model: Model, brandId: string, start: OutcomeId, target: OutcomeId): { plan: PlanNode | null; line: OutcomeId[] } {
  const draft: Campaign = { id: `draft:${brandId}:${start}:${target}:${model.day}`, brandId, offerId: "", name: "", start, target, dailyBudgetCents: 0, status: "paused", brief: "" };
  const plan = model.session.planOf(draft);
  const line: OutcomeId[] = [];
  let node: PlanNode | undefined = plan ?? undefined;
  while (node && node.outcome !== start) {
    if (model.catalogue.isMilestone(node.outcome) || node.outcome === target) line.unshift(node.outcome);
    node = node.materials.find((m) => model.catalogue.outcome(m.outcome)?.subject === "lead");
  }
  return { plan, line };
}
