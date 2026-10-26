/**
 * Read models over the running world: every figure a page shows is computed here from the
 * engine's own outputs (runs, Units, choices, beliefs). Pages divide nothing
 * themselves. Nothing here knows an outcome, a pipe or a script by name: everything is read
 * off the catalogue.
 */

import {
  START,
  convergence,
  hiddenBest,
  legConsumer,
  playPoint,
  rankFunnels,
  type Campaign,
  type Catalogue,
  type ChoiceRecord,
  type HiddenOption,
  type Unit,
  type OutcomeId,
  type Person,
  type Pipe,
  type PointConvergence,
  type Script,
  type SimulationSession,
  type WorldClient,
  type WorldSpec,
} from "@gtm-factory/engine";
import { humanize } from "./format";

export interface LeadStateDef {
  outcome: OutcomeId;
  label: string;
  rank: number;
  trackId: string;
}

export interface TrackDef {
  id: string;
  /** The owner's word: "CRM lifecycle track". */
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

/** Every lead track with its states in rank order. A track is never added to another. */
export function leadTracks(catalogue: Catalogue): TrackDef[] {
  return catalogue.leadTracks
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

export function pipeName(catalogue: Catalogue, id: string): string {
  return catalogue.pipe(id)?.name ?? humanize(id);
}

export function factoryName(catalogue: Catalogue, id: string): string {
  return catalogue.factory(id)?.name ?? humanize(id);
}

/** A pipe in one line: its Bill of materials, then what it makes. */
export function pipeLine(catalogue: Catalogue, pipe: Pipe): string {
  const ins = pipe.materials.length ? pipe.materials.map((i) => outcomeLabel(catalogue, i)).join(" + ") : pipe.webhook ? "A webhook call" : catalogue.createsSubjects(pipe) || catalogue.outcome(pipe.output)?.subject === "lead" ? "The market" : "An order";
  return `${ins} → ${outcomeLabel(catalogue, pipe.output)}`;
}

/** One line of a pipe's Bill of materials: the outcome it consumes per Unit produced, who makes it, and the choice made there. */
export interface MaterialRow {
  material: OutcomeId;
  label: string;
  /** The subject Material: the Unit the pipe works on. */
  subject: boolean;
  /** Pipes producing it (several share one stock). */
  producers: Pipe[];
  /** How the pipe gets it: served from the stock or ordered (a choice among producer scripts), the Unit it is pushed. */
  how: string;
  /** The choice point (this pipe, this Material), when one was made. */
  point: string | null;
  /** The option picked most over the last 7 days, every campaign. */
  choice: string | null;
  picks: number;
}

/** A pipe's Bill of materials, line by line (each line a Material). */
export function billOfMaterials(model: Model, pipe: Pipe): MaterialRow[] {
  const c = model.catalogue;
  const subject = c.subjectMaterial(pipe);
  return pipe.materials.map((m) => {
    const o = c.outcome(m);
    const point = `${pipe.id}|${m}`;
    const series = model.session.pickSeries(point);
    let choice: string | null = null;
    let best = 0;
    let picks = 0;
    for (const [opt, arr] of series) {
      const recent = arr.slice(-7).reduce((x, y) => x + y, 0);
      picks += arr.reduce((x, y) => x + y, 0);
      if (recent > best) {
        best = recent;
        choice = opt;
      }
    }
    const how =
      o?.contentType === "rating"
        ? "Today's Rating, from the stock"
        : o?.subject === "run"
          ? "Ordered for each run"
          : o?.subject === "brand"
            ? "From the stock when a Unit conforms, else ordered"
            : m === subject
              ? "The Unit it works on: pulled or pushed"
              : "From the stock for this subject, else ordered";
    return { material: m, label: outcomeLabel(c, m), subject: m === subject, producers: c.providersOf(m), how, point: series.size > 0 && choice ? point : null, choice: choice ? optionLabel(model, point, choice) : null, picks };
  });
}

/** The script a dynasty runs today. */
export function headScript(catalogue: Catalogue, dynasty: string): Script | undefined {
  return catalogue.headOf(dynasty) ?? catalogue.versionsOf(dynasty).pop();
}

export type PointKind = "play" | "script" | "unit";

export interface PointInfo {
  key: string;
  kind: PointKind;
  /** The consuming pipe, or null for a leg's own choice. */
  consumer: Pipe | null;
  /** The Material the choice is made at. */
  material: OutcomeId;
  /** "Message writer · LLM completion", "Lead interested → Meeting booked". */
  title: string;
  /** What the options are: scripts of these pipes, Units of an outcome, or plays. */
  sub: string;
}

/** What a choice point is, in words, from its key. */
export function pointInfo(catalogue: Catalogue, key: string): PointInfo {
  if (key.startsWith("play:")) {
    const [from, to] = key.slice(5).split(">") as [string, string];
    return { key, kind: "play", consumer: null, material: to, title: `${outcomeLabel(catalogue, from)} → ${outcomeLabel(catalogue, to)}`, sub: "Which pipe plays the leg" };
  }
  const [consumer, material] = key.split("|") as [string, string];
  const out = catalogue.outcome(material);
  if (consumer.startsWith("leg:")) {
    const [from, to] = consumer.slice(4).split(">") as [string, string];
    return { key, kind: "script", consumer: null, material, title: `${outcomeLabel(catalogue, from)} → ${outcomeLabel(catalogue, to)}`, sub: "Which script performs the leg" };
  }
  const pipe = catalogue.pipe(consumer) ?? null;
  // A brand Material is chosen among the Units in the stock (templates, ICPs); the others among producer scripts.
  const scripted = catalogue.providersOf(material).some((p) => catalogue.dynastiesOf(p.id).some((s) => s.dynasty !== "" && out?.subject !== "brand"));
  const kind: PointKind = out?.subject === "brand" && !scripted ? "unit" : "script";
  return {
    key,
    kind,
    consumer: pipe,
    material,
    title: `${pipe?.name ?? humanize(consumer)} · ${outcomeLabel(catalogue, material)}`,
    sub: kind === "unit" ? `Which ${outcomeLabel(catalogue, material).toLowerCase()} to serve from the stock` : `Which script produces it`,
  };
}

/** An option of a choice point in words: a script dynasty, an object dynasty, or a pipe. */
export function optionLabel(model: Model, point: string, option: string, brandId?: string): string {
  const s = headScript(model.catalogue, option);
  if (s) return s.name;
  const pipe = model.catalogue.pipe(option);
  if (pipe) return pipe.name;
  const info = pointInfo(model.catalogue, point);
  const brands = brandId ? [brandId] : model.clients.map((c) => c.brand.id);
  for (const b of brands) {
    const u = model.session.objectHead(b, info.material, option);
    if (u) return u.name ?? humanize(option);
  }
  return humanize(option);
}

// ---------------------------------------------------------------------------
// Clients, campaigns, value
// ---------------------------------------------------------------------------

export function clientOf(model: Model, campaignId: string): WorldClient | undefined {
  return model.clients.find((c) => c.campaigns.some((x) => x.id === campaignId));
}

/** Campaigns in scope: one brand, or every client. */
export function scopedCampaigns(model: Model, brandId: string | null): Campaign[] {
  return model.campaigns.filter((c) => !brandId || c.brandId === brandId);
}

/** Where a campaign's funnel starts: Start (it pulls), or the outcome whose Units it pushes. */
export function startOf(_model: Model, campaign: Campaign): OutcomeId {
  return campaign.start;
}

/** The line of a campaign's sales funnel: its start outcome, then each lead state. */
export function lineOf(model: Model, campaign: Campaign): OutcomeId[] {
  return [startOf(model, campaign), ...campaign.line];
}

export function targetOf(campaign: Campaign): OutcomeId {
  return campaign.line[campaign.line.length - 1]!;
}

export function campaignName(model: Model, campaign: Campaign): string {
  return campaign.name;
}

/** The pipe each leg plays most today (its current choice), by leg. */
export function legPlays(model: Model, campaign: Campaign): { from: OutcomeId; to: OutcomeId; pipeId: string | null; options: string[] }[] {
  const line = lineOf(model, campaign);
  return campaign.line.map((to, k) => {
    const from = line[k]!;
    const options = model.session.playsFor(campaign, from, to).map((p) => p.id);
    const series = model.session.pickSeries(playPoint(from, to), campaign.id);
    let best: string | null = options[0] ?? null;
    let bestN = -1;
    for (const [o, arr] of series) {
      const n = arr.slice(-7).reduce((x, y) => x + y, 0);
      if (n > bestN) {
        bestN = n;
        best = o;
      }
    }
    return { from, to, pipeId: best, options };
  });
}

export interface ScopeFigures {
  spendCents: number;
  dailySpendCents: number[];
  /** Access cost paid to other factories, per day. */
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
  const ours = new Set(model.catalogue.factories.filter((x) => x.ours).map((x) => x.id));
  const runBrand = memo(model, "runBrand", () => new Map(model.session.units.map((u) => [u.runId, u.brandId])));
  for (const r of model.session.runs) if (!r.campaignId && !r.support && ours.has(r.factory) && brands.has(runBrand.get(r.id) ?? "")) f.spendCents += r.spendCents;
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
// Choice points: beliefs, picks, hidden truth
// ---------------------------------------------------------------------------

export interface OptionRow {
  option: string;
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
  /** Hidden: true share reaching the leg's end, true cost, true value per dollar. */
  truth: HiddenOption | null;
  isHiddenBest: boolean;
  isBelievedBest: boolean;
}

export interface PointRow {
  info: PointInfo;
  campaignId: string;
  options: OptionRow[];
  picks: number;
}

/** The hidden best of every point of a campaign (cached per day). */
export function hiddenOf(model: Model, campaign: Campaign): Map<string, { best: string; options: HiddenOption[] }> {
  return memo(model, `hidden:${campaign.id}`, () => hiddenBest(model.session, campaign));
}

/** Every choice point a campaign used, in the order its decisions are made. */
export function pointsOf(model: Model, campaign: Campaign): PointRow[] {
  return memo(model, `points:${campaign.id}`, () => {
    const hidden = hiddenOf(model, campaign);
    const keys = model.session.choicePoints().filter((p) => p.campaignId === campaign.id).map((p) => p.point);
    const ordered = [...hidden.keys(), ...keys.filter((k) => !hidden.has(k))].filter((k) => keys.includes(k));
    return ordered.map((key) => pointRow(model, campaign, key, hidden.get(key) ?? null));
  });
}

export function pointRow(model: Model, campaign: Campaign, key: string, hidden: { best: string; options: HiddenOption[] } | null): PointRow {
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
  const bestBelief = [...beliefs].sort((a, b) => b.valuePerDollar - a.valuePerDollar)[0]?.option ?? null;
  const options: OptionRow[] = beliefs.map((b) => {
    const truth = hidden?.options.find((h) => h.option === b.option) ?? null;
    return {
      option: b.option,
      label: optionLabel(model, key, b.option, campaign.brandId),
      share: total > 0 ? (recent.get(b.option) ?? 0) / total : 0,
      picks: series.get(b.option)?.reduce((x, y) => x + y, 0) ?? 0,
      rate: b.rate,
      rateSd: b.rateSd,
      cost: b.cost,
      valuePerDollar: b.valuePerDollar,
      decisions: b.decisions,
      successes: b.successes,
      truth,
      isHiddenBest: hidden?.best === b.option,
      isBelievedBest: bestBelief === b.option,
    };
  });
  return { info, campaignId: campaign.id, options, picks: all };
}

/** Convergence of every choice point toward its hidden best (cached per day). */
export function convergenceOf(model: Model): PointConvergence[] {
  return memo(model, "convergence", () => convergence(model.session));
}

/** Share on the hidden best per day (null on a day without picks). */
export function shareSeries(pc: PointConvergence): (number | null)[] {
  return pc.daily.map((d) => (d.picks > 0 ? d.onBest / d.picks : null));
}

/** The latest choice records of a set of campaigns, newest first. */
export function recentChoices(model: Model, campaignIds: Set<string>, limit: number): ChoiceRecord[] {
  const out: ChoiceRecord[] = [];
  const all = model.session.choices;
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) if (campaignIds.has(all[i]!.campaignId)) out.push(all[i]!);
  return out;
}

/** Why a choice went the way it did, in plain words. */
export function explainChoice(model: Model, c: ChoiceRecord): string {
  const brandId = model.campaigns.find((x) => x.id === c.campaignId)?.brandId;
  const chosen = optionLabel(model, c.point, c.chosenId, brandId);
  const total = c.options.reduce((s, o) => s + o.picks, 0);
  const share = total > 0 ? Math.round((100 * (c.options.find((o) => o.id === c.chosenId)?.picks ?? 0)) / total) : 0;
  if (c.chosenId === c.bestId) return `${chosen} took ${share}% of picks: the best expected value per dollar.`;
  return `${chosen} took ${share}% of picks while ${optionLabel(model, c.point, c.bestId, brandId)} leads on expected value: still exploring.`;
}

// ---------------------------------------------------------------------------
// Pipes, scripts and where they are plugged
// ---------------------------------------------------------------------------

export interface PluggedInput {
  point: string;
  info: PointInfo;
  /** The script with the best expected value per dollar there, over every campaign that chose there. */
  bestScript: string | null;
  picks: number;
}

/** Every Material a pipe's scripts are offered at, and the best script at each. */
export function pluggedAt(model: Model, pipeId: string): PluggedInput[] {
  return memo(model, `plugged:${pipeId}`, () => {
    const dynasties = new Set(model.catalogue.scripts.filter((s) => s.pipeId === pipeId).map((s) => s.dynasty));
    const points = [...new Set(model.session.choicePoints().map((p) => p.point))].filter((p) => model.session.optionsAt(p).some((o) => dynasties.has(o)));
    return points.map((point) => {
      const score = new Map<string, number>();
      let picks = 0;
      for (const c of model.campaigns) {
        const series = model.session.pickSeries(point, c.id);
        if (series.size === 0) continue;
        for (const b of model.session.beliefsAt(point, c.id)) if (dynasties.has(b.option)) score.set(b.option, (score.get(b.option) ?? 0) + b.valuePerDollar);
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
  const consumerPoints = [...new Set(model.session.choicePoints().map((p) => p.point))].filter((p) => p.endsWith(`|${outcome}`));
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

/** A word diff between two texts: the parts kept, added and removed, in order. */
export function diffWords(a: string, b: string): { kind: "same" | "add" | "del"; text: string }[] {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  const push = (kind: "same" | "add" | "del", text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push("same", x[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push("del", x[i++]!);
    else push("add", y[j++]!);
  }
  while (i < n) push("del", x[i++]!);
  while (j < m) push("add", y[j++]!);
  return out;
}

/** The {{variables}} of a text with variables. */
export function variablesOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]!))];
}

// ---------------------------------------------------------------------------
// Leads and companies
// ---------------------------------------------------------------------------

export interface LeadRow {
  person: Person;
  /** Highest state reached per track. */
  states: Record<string, LeadStateDef | null>;
  /** The factory that brought the lead in. */
  root: string;
  firstDay: number;
  campaignIds: string[];
}

/** Every person the factory served, with the furthest state per track. */
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
// New campaign: funnels proposed by value per dollar
// ---------------------------------------------------------------------------

/** The best funnels from an entry to a target for an offer, priced on the fleet's measured legs. */
export function proposeFunnels(model: Model, offerOutcomes: OutcomeId[], target: OutcomeId, value: number, entry: OutcomeId = START) {
  return rankFunnels(
    model.catalogue,
    offerOutcomes,
    target,
    (edge) => model.session.fleetLegEstimate(edge.from, edge.to) ?? { costPerAttempt: 1, yieldRate: 0.1, label: "expected" },
    value,
    6,
    entry,
  );
}

export { legConsumer, playPoint };
