/**
 * Shadow mode: the engine read on an OBSERVED world instead of a simulated one.
 *
 * A snapshot holds what a real factory did (its catalogue, its clients, what
 * each campaign runs today, and aggregated observations: leg cohorts, choices,
 * runs, lead states). A shadow session loads it into the same evidence book
 * the simulator uses and computes every recommendation the engine would make,
 * and the actions it would launch. Nothing runs: no hidden truth, no ticks, no
 * random draw that is not seeded. The same snapshot gives the same answer,
 * byte for byte.
 *
 * Before a client's recommendations are shown, the snapshot is reconciled with
 * the production figures it carries (spend, lead states). A client that does
 * not reconcile gets its gaps, never recommendations.
 */

import { Catalogue, START, defaultStrategyId, isOnDemand, type CatalogueData, type SalesFunnel, type SalesPath, type OutcomeId, type Pipe, type Script, type Strategy } from "./catalogue";
import { EvidenceBook, SEP, bumpCell, legEstimateOf, type CellStore, type LegEstimateRead } from "./evidence";
import { allocateBudget, chainCostPerTarget, enumerateFunnels, valueBackwardLine, type LegEdge, type LegEstimate, type RankedFunnel } from "./funnels";
import { buildLedger, type LedgerOccurrence, type LedgerReport, type LedgerRun } from "./ledger";
import { prioritize } from "./prioritizer";
import { createRng } from "./rng";
import { studySplits, type SplitRecord, type SplitStudy } from "./splits";
import { betaMean, betaVariance } from "./stats";
import { describeCondition, meetsAll, type Condition, type TacticValue } from "./tactics";
import { legConsumer, playPoint, pointKey } from "./simulator";
import type { Brand, Campaign, Offer, Org } from "./world";

export const SHADOW_FORMAT = "gtm-factory/shadow@1";

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/** A production figure the snapshot is reconciled against, and where it was read. */
export interface ProductionFigure {
  value: number;
  source: string;
  /** "org": production only knows the figure for the client's whole org (every brand of it). Default "brand". */
  scope?: "brand" | "org";
}

export interface ProductionFigures {
  /** Total spend of the client, cents. */
  spendCents?: ProductionFigure;
  /** Leads that reached each outcome (lead states), as production counts them. */
  outcomes?: Record<OutcomeId, ProductionFigure>;
}

/** An occurrence of an object outcome a client holds (an ICP, a template), one version of its dynasty. */
export interface ShadowObject {
  outcome: OutcomeId;
  dynasty: string;
  version: number;
  name: string;
  text: string;
  parentDynasty?: string;
  /** For an ICP: who it describes, as conditions on lead tactics (when known). */
  conditions?: Condition[];
  /** The script that produced it, when known. */
  scriptId?: string;
}

/** What a campaign runs today. */
export interface CampaignToday {
  /** The pipe playing each leg (null when the leg has no pipe today). */
  legPipes: (string | null)[];
  /** The option running at each choice point (point key -> option). */
  picks: Record<string, string>;
}

export interface ShadowCampaign extends Campaign {
  today: CampaignToday;
}

export interface ShadowClient {
  org: Org;
  brand: Brand;
  offers: Offer[];
  campaigns: ShadowCampaign[];
  objects: ShadowObject[];
  production: ProductionFigures;
  /** Plain notes on how this client's data was read (known gaps, approximations). */
  notes?: string[];
}

/** Per campaign leg and day of entry: attempts, those that reached the leg's end, settled failures, our spend. */
export interface LegCell {
  campaignId: string;
  legIndex: number;
  day: number;
  attempts: number;
  reached: number;
  failed?: number;
  costCents: number;
}

/** Per choice point, option, client (and campaign when known) and day of decision. */
export interface ChoiceCell {
  point: string;
  option: string;
  brandId: string;
  campaignId?: string | null;
  day: number;
  decisions: number;
  successes: number;
  failures?: number;
  costCents: number;
}

/** Runs aggregated per (pipe, script, campaign, day): production orders for the ledger. */
export interface RunCell {
  brandId: string;
  campaignId: string | null;
  pipeId: string | null;
  scriptId: string | null;
  day: number;
  runs: number;
  spendCents: number;
  /** Inputs processed. */
  inputs: number;
  /** Occurrences produced, of `outcome`. */
  outputs: number;
  outcome: OutcomeId | null;
  /** Work for no outcome (setup, experiments): its kind. */
  support?: string;
  factory?: string;
}

/**
 * Lead states first reached, per client, outcome and day. Each lead counts in
 * exactly one cell per outcome: the campaign that brought it, or `campaignId`
 * null when no campaign of ours did (another factory: the client's team, its
 * CRM, the organic market).
 */
export interface StateCell {
  brandId: string;
  campaignId: string | null;
  outcome: OutcomeId;
  day: number;
  leads: number;
}

/** Leads of a campaign leg's mature cohort grouped by their joint tactic values: served and reached. */
export interface LeadCell {
  campaignId: string;
  legIndex: number;
  values: Record<string, TacticValue>;
  /** Like-for-like stratum (e.g. a month). */
  stratum: string;
  served: number;
  reached: number;
}

/** A choice point as its producer offered it: its options and the delay from a decision to its leg's end. */
export interface PointCell {
  point: string;
  options: string[];
  delayMeanDays: number;
  horizonDays: number;
}

export interface ShadowObservations {
  /** Choice points offered, with their measured delays (optional: else the pipes' maturity is used). */
  points?: PointCell[];
  legs: LegCell[];
  choices: ChoiceCell[];
  runs: RunCell[];
  states: StateCell[];
  leads?: LeadCell[];
}

export interface ShadowSettings {
  /** Half-life of evidence, days (0 = never fade). */
  memoryHalfLifeDays?: number;
  /** Brand tactic grouping clients for pooling. */
  clientGroupTactic?: string;
  /** Most a budget may grow in one decision, as a multiple of today's (default 2). */
  maxBudgetMultiple?: number;
  /** Relative tolerance of the reconciliation (default 0.01). */
  tolerance?: number;
  /** Age, days, of a decision before a split study reads it (default 21). */
  splitMatureDays?: number;
  /** Thompson draws used to state the share of picks the engine would give each option (default 400). */
  draws?: number;
}

export interface ShadowSnapshot {
  format: typeof SHADOW_FORMAT;
  name: string;
  description?: string;
  /** When the snapshot was taken (ISO timestamp). */
  takenAt: string;
  /** The date of day 0 (ISO date): day d is firstDay + d. */
  firstDay: string;
  /** The day index of today (the last day the snapshot covers). */
  today: number;
  catalogue: CatalogueData;
  clients: ShadowClient[];
  observations: ShadowObservations;
  settings?: ShadowSettings;
}

// ---------------------------------------------------------------------------
// What the shadow session answers
// ---------------------------------------------------------------------------

export interface ReconciliationLine {
  /** "spend" or an outcome id. */
  key: string;
  snapshot: number;
  production: number;
  source: string;
  gap: number;
  /** gap / production (null when production is 0). */
  relativeGap: number | null;
  matches: boolean;
}

export interface ClientReconciliation {
  brandId: string;
  lines: ReconciliationLine[];
  /** Every figure present matches within the tolerance. */
  reconciles: boolean;
  /** Figures missing from production (nothing to reconcile against). */
  missing: string[];
  notes: string[];
}

export interface OptionView {
  option: string;
  rate: number;
  rateSd: number;
  /** Dollars from the decision to the leg's end. */
  cost: number;
  valuePerDollar: number;
  decisions: number;
  successes: number;
  /** Share of picks the engine would give it (seeded Thompson draws). */
  pickShare: number;
}

export interface PointView {
  point: string;
  kind: "play" | "script" | "occurrence";
  /** The consuming pipe (null for a leg's own choices). */
  consumer: string | null;
  input: OutcomeId;
  legIndex: number;
  today: string | null;
  /** The option with the best expected value per dollar. */
  engine: string;
  options: OptionView[];
}

export interface LegView {
  from: OutcomeId;
  to: OutcomeId;
  todayPipe: string | null;
  /** Every pipe the leg runs through today, in the order they run (the inputs' providers, then the play). */
  pipes: string[];
  enginePipe: string | null;
  estimate: LegEstimateRead;
}

export interface BudgetView {
  todayCents: number;
  engineCents: number;
  /** Expected value per dollar of the campaign's line (null when a leg is not measured). */
  valuePerDollar: number | null;
}

export interface CampaignView {
  campaignId: string;
  brandId: string;
  name: string;
  status: Campaign["status"];
  entry: OutcomeId;
  line: OutcomeId[];
  targetValue: { amount: number; label: "stated" | "expected" };
  legs: LegView[];
  points: PointView[];
  /** The sales path it runs and the named sales funnel it runs today (null while a leg has no pipe). */
  salesPath: SalesPath;
  salesFunnel: SalesFunnel | null;
  /** Today's line priced on the fleet's leg estimates, and the best lines the engine finds, each with its funnel's name. */
  funnels: { today: RankedFunnel | null; engine: (RankedFunnel & { name: string; id: string })[]; unmeasuredLegs: number };
  budget: BudgetView;
  spendCents: number;
}

export interface ShadowProposal {
  kind: "audience" | "strategy";
  brandId: string | null;
  campaignId: string | null;
  point: string | null;
  conditions: Condition[];
  /** The ICP sentence (audience) or the strategy name. */
  text: string;
  parentDynasty: string | null;
  study: SplitStudy;
}

export type ShadowActionKind = "switch_pipe" | "switch_script" | "switch_occurrence" | "set_budget" | "pause_campaign" | "switch_funnel" | "propose_icp" | "propose_strategy";

/** One action the engine would launch. Read-only: nothing executes it. */
export interface ShadowAction {
  id: string;
  kind: ShadowActionKind;
  brandId: string | null;
  campaignId: string | null;
  point: string | null;
  from: string | null;
  to: string | null;
  /** Plain words. */
  label: string;
  reason: string;
}

export interface ClientView {
  brandId: string;
  reconciliation: ClientReconciliation;
  /** Empty when the client does not reconcile. */
  campaigns: CampaignView[];
}

export interface ShadowReport {
  day: number;
  clients: ClientView[];
  proposals: ShadowProposal[];
  actions: ShadowAction[];
  ledger: LedgerReport;
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

const DEFAULTS: Required<ShadowSettings> = {
  memoryHalfLifeDays: 0,
  clientGroupTactic: "",
  maxBudgetMultiple: 2,
  tolerance: 0.01,
  splitMatureDays: 21,
  draws: 400,
};

export class ShadowSession {
  readonly catalogue: Catalogue;
  readonly snapshot: ShadowSnapshot;
  readonly settings: Required<ShadowSettings>;
  readonly day: number;
  private readonly evidence: EvidenceBook;
  private readonly legCohorts: CellStore = new Map();
  private readonly brandIds: string[];
  private readonly campaignById = new Map<string, { campaign: ShadowCampaign; client: ShadowClient }>();
  private report: ShadowReport | null = null;

  constructor(snapshot: ShadowSnapshot) {
    if (snapshot.format !== SHADOW_FORMAT) throw new Error(`not a shadow snapshot (format "${String(snapshot.format)}")`);
    this.snapshot = snapshot;
    this.settings = { ...DEFAULTS, ...(snapshot.settings ?? {}) };
    this.catalogue = new Catalogue(snapshot.catalogue);
    this.day = snapshot.today;
    this.brandIds = snapshot.clients.map((c) => c.brand.id);
    for (const client of snapshot.clients) for (const c of client.campaigns) this.campaignById.set(c.id, { campaign: c, client });
    this.evidence = new EvidenceBook({
      catalogue: this.catalogue,
      brandIds: () => this.brandIds,
      groupOf: (b) => this.groupOf(b),
      parentOf: (o) => this.parentOf(o),
      memoryHalfLifeDays: this.settings.memoryHalfLifeDays,
      frozen: true,
    });
    this.load();
    // Name the sales funnel each campaign runs today, in campaign order: one snapshot, one set of names.
    for (const c of this.campaigns()) {
      const entry = this.entryOf(c);
      this.catalogue.nameSalesPath(entry, c.line);
      if (c.today.legPipes.every((p) => p)) this.catalogue.nameSalesFunnel(entry, c.line, c.today.legPipes as string[]);
    }
  }

  get clients(): readonly ShadowClient[] {
    return this.snapshot.clients;
  }

  campaigns(): ShadowCampaign[] {
    return this.snapshot.clients.flatMap((c) => c.campaigns);
  }

  campaign(id: string): ShadowCampaign | undefined {
    return this.campaignById.get(id)?.campaign;
  }

  clientOf(campaignId: string): ShadowClient | undefined {
    return this.campaignById.get(campaignId)?.client;
  }

  /** The date of a day index (ISO date). */
  dateOf(day: number): string {
    const d = new Date(`${this.snapshot.firstDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + day);
    return d.toISOString().slice(0, 10);
  }

  // ---- loading the observations ---------------------------------------------

  private load(): void {
    const obs = this.snapshot.observations;
    for (const l of obs.legs) {
      if (!this.campaignById.has(l.campaignId)) continue;
      const key = `${l.campaignId}${SEP}${l.legIndex}`;
      bumpCell(this.legCohorts, key, l.day, "t", l.attempts);
      bumpCell(this.legCohorts, key, l.day, "s", l.reached);
      bumpCell(this.legCohorts, key, l.day, "f", l.failed ?? 0);
      bumpCell(this.legCohorts, key, l.day, "c", l.costCents);
    }
    for (const p of obs.points ?? []) this.evidence.offer(p.point, p.options, p.delayMeanDays, p.horizonDays);
    // Every point a campaign meets is offered with its catalogue options, so never-tried options compete too.
    for (const c of this.campaigns()) for (const p of this.pointsOfCampaign(c)) this.evidence.offer(p.point, p.options, p.delay, p.horizon);
    const known = new Set(this.brandIds);
    for (const ch of obs.choices) {
      if (!known.has(ch.brandId)) continue;
      if (!this.evidence.pointOptions.get(ch.point)?.has(ch.option)) this.evidence.offer(ch.point, [ch.option], 0);
      const b = ch.brandId;
      this.evidence.bump(ch.point, ch.option, b, ch.day, "t", ch.decisions);
      this.evidence.bump(ch.point, ch.option, b, ch.day, "s", ch.successes);
      this.evidence.bump(ch.point, ch.option, b, ch.day, "f", ch.failures ?? 0);
      this.evidence.bump(ch.point, ch.option, b, ch.day, "c", ch.costCents);
    }
  }

  private groupOf(brandId: string): string {
    const t = this.settings.clientGroupTactic;
    const b = this.snapshot.clients.find((c) => c.brand.id === brandId)?.brand;
    return t ? String(b?.tactics[t] ?? "") : "";
  }

  private parentOf(option: string): string | null {
    const s = this.catalogue.versionsOf(option)[0];
    if (s?.parentDynasty) return s.parentDynasty;
    for (const c of this.snapshot.clients) for (const o of c.objects) if (o.dynasty === option && o.parentDynasty) return o.parentDynasty;
    return null;
  }

  // ---- the catalogue read for one campaign --------------------------------------

  /** Where a campaign's line starts: Start or its trigger's event. */
  entryOf(campaign: Campaign): OutcomeId {
    if (campaign.entry.kind === "start") return START;
    return this.catalogue.trigger(campaign.entry.triggerId)?.event ?? START;
  }

  private legFrom(campaign: Campaign, k: number): OutcomeId {
    return k === 0 ? this.entryOf(campaign) : campaign.line[k - 1]!;
  }

  /** Live pipes producing a leg's end whose subject comes from the leg's start (and that have a script). */
  playsFor(from: OutcomeId, to: OutcomeId): Pipe[] {
    const roots = this.entryRoots(from);
    return this.catalogue
      .providersOf(to)
      .filter((p) => !isOnDemand(p) && !p.reports && roots.some((r) => this.catalogue.rootsOf(p).has(r)))
      .filter((p) => this.catalogue.dynastiesOf(p.id).length > 0);
  }

  /**
   * Where a leg's subject may come from: its start, and for the event of a
   * trigger fired the moment a state is reached (no delay, no "unless"), that
   * state too: a funnel opened by "a reply came" plays pipes that start from
   * the interested lead.
   */
  entryRoots(from: OutcomeId): OutcomeId[] {
    const t = this.catalogue.triggers.find((x) => x.event === from && !x.retired);
    if (t && t.when.length > 0 && !t.delayDays && t.unless.length === 0) return [from, ...t.when];
    return [from];
  }

  strategyOf(campaign: Campaign, pipeId: string): Strategy | null {
    const id = campaign.strategies[pipeId];
    return (id ? this.catalogue.strategy(id) : null) ?? this.catalogue.strategy(defaultStrategyId(pipeId)) ?? null;
  }

  private rulesAt(campaign: Campaign, consumer: Pipe | null, input: OutcomeId | null, providers: Pipe[]): Condition[] {
    if (consumer && input) return (this.strategyOf(campaign, consumer.id)?.rules ?? []).filter((r) => r.input === input).flatMap((r) => r.conditions);
    if (providers[0]) return (this.strategyOf(campaign, providers[0].id)?.rules ?? []).filter((r) => !r.input).flatMap((r) => r.conditions);
    return [];
  }

  private allowed(campaign: Campaign, consumer: Pipe | null, input: OutcomeId | null, providers: Pipe[]): Script[] {
    const rules = this.rulesAt(campaign, consumer, input, providers);
    return providers.flatMap((p) => this.catalogue.dynastiesOf(p.id)).filter((s) => meetsAll(s.tactics, rules));
  }

  private readonly legPipeRuns = new Map<string, string[]>();

  /** Every pipe each leg of a campaign runs through today, in the order they run. */
  legPipesOf(campaign: ShadowCampaign): string[][] {
    this.pointsOfCampaign(campaign);
    return campaign.line.map((_, k) => this.legPipeRuns.get(`${campaign.id}${SEP}${k}`) ?? (campaign.today.legPipes[k] ? [campaign.today.legPipes[k]!] : []));
  }

  /** Object dynasties a client holds for an outcome (each serves its head version). */
  objectDynasties(brandId: string, outcome: OutcomeId): string[] {
    const client = this.snapshot.clients.find((c) => c.brand.id === brandId);
    const out: string[] = [];
    for (const o of client?.objects ?? []) if (o.outcome === outcome && !out.includes(o.dynasty)) out.push(o.dynasty);
    return out;
  }

  /** The head (latest version) of a client's object dynasty. */
  objectHead(brandId: string, outcome: OutcomeId, dynasty: string): ShadowObject | undefined {
    const client = this.snapshot.clients.find((c) => c.brand.id === brandId);
    let head: ShadowObject | undefined;
    for (const o of client?.objects ?? []) if (o.outcome === outcome && o.dynasty === dynasty && (!head || o.version > head.version)) head = o;
    return head;
  }

  /**
   * Every choice point a campaign meets, with its options: the play of each
   * leg, the script of the leg's pipe, and the inputs of every pipe the
   * campaign runs today (walked through today's picks).
   */
  pointsOfCampaign(campaign: ShadowCampaign): { point: string; kind: PointView["kind"]; consumer: string | null; input: OutcomeId; legIndex: number; options: string[]; delay: number; horizon: number }[] {
    const out: ReturnType<ShadowSession["pointsOfCampaign"]> = [];
    const seen = new Set<string>();
    const add = (p: (typeof out)[number]) => {
      if (seen.has(p.point) || p.options.length === 0) return;
      seen.add(p.point);
      out.push(p);
    };
    campaign.line.forEach((to, k) => {
      const from = this.legFrom(campaign, k);
      const plays = this.playsFor(from, to);
      const todayPipe = campaign.today.legPipes[k] ?? null;
      const pipe = (todayPipe ? this.catalogue.pipe(todayPipe) : undefined) ?? plays[0];
      const delay = pipe?.maturity.delayMeanDays ?? 0;
      const horizon = pipe?.maturity.horizonDays ?? 0;
      add({ point: playPoint(from, to), kind: "play", consumer: null, input: to, legIndex: k, options: plays.map((p) => p.id), delay, horizon });
      if (!pipe) return;
      add({ point: pointKey(legConsumer(from, to), to), kind: "script", consumer: null, input: to, legIndex: k, options: this.allowed(campaign, null, null, [pipe]).map((s) => s.dynasty), delay, horizon });
      const ran: string[] = [];
      this.walkInputs(campaign, pipe, from, k, delay, horizon, add, new Set([pipe.id]), ran);
      ran.push(pipe.id);
      this.legPipeRuns.set(`${campaign.id}${SEP}${k}`, ran);
    });
    return out;
  }

  private walkInputs(campaign: ShadowCampaign, pipe: Pipe, from: OutcomeId, k: number, delay: number, horizon: number, add: (p: ReturnType<ShadowSession["pointsOfCampaign"]>[number]) => void, visiting: Set<string>, ran: string[] = []): void {
    for (const i of pipe.inputs) {
      const out = this.catalogue.outcome(i);
      if (!out || out.subject === "event") continue;
      if (out.track) continue; // a lead state is the leg's start, never a choice
      const providers = this.catalogue.providersOf(i).filter((p) => !p.reports);
      const point = pointKey(pipe.id, i);
      const onDemand = providers.filter((p) => isOnDemand(p));
      let options: string[];
      let kind: PointView["kind"] = "script";
      if (out.subject === "object" && onDemand.length === 0) {
        kind = "occurrence";
        options = this.objectDynasties(campaign.brandId, i);
      } else if (out.subject === "object") {
        options = this.allowed(campaign, pipe, i, onDemand).map((s) => s.dynasty);
      } else {
        const roots = this.entryRoots(from);
        const rooted = providers.filter((p) => isOnDemand(p) || roots.some((r) => this.catalogue.rootsOf(p).has(r)));
        options = this.allowed(campaign, pipe, i, rooted).map((s) => s.dynasty);
      }
      add({ point, kind, consumer: pipe.id, input: i, legIndex: k, options, delay, horizon });
      if (kind === "occurrence") continue;
      // Walk into the provider running today (or the first option), once.
      const pick = campaign.today.picks[point] ?? options[0];
      const script = pick ? this.catalogue.headOf(pick) : undefined;
      const provider = script ? this.catalogue.pipe(script.pipeId) : undefined;
      if (!provider || visiting.has(provider.id)) continue;
      this.walkInputs(campaign, provider, from, k, delay, horizon, add, new Set([...visiting, provider.id]), ran);
      if (!ran.includes(provider.id)) ran.push(provider.id);
    }
  }

  // ---- values and estimates -------------------------------------------------------

  private isTop(outcome: OutcomeId): boolean {
    const t = this.catalogue.outcome(outcome)?.track;
    if (!t) return false;
    return !this.catalogue.outcomes.some((o) => o.track?.track === t.track && o.track.rank > t.rank);
  }

  private statedValue(offer: Offer | undefined, target: OutcomeId): number | undefined {
    return offer?.outcomeValues?.[target] ?? (this.isTop(target) ? offer?.lifetimeRevenue : undefined);
  }

  /** The value of one target outcome of a campaign: stated by its offer, else the fleet median of stated ones. */
  targetValue(campaign: Campaign): { amount: number; label: "stated" | "expected" } {
    const target = campaign.line[campaign.line.length - 1]!;
    const offer = this.clientOf(campaign.id)?.offers.find((o) => o.id === campaign.offerId);
    const stated = this.statedValue(offer, target);
    if (stated !== undefined && stated > 0) return { amount: stated, label: "stated" };
    const all = this.snapshot.clients
      .flatMap((c) => c.offers)
      .map((o) => this.statedValue(o, target))
      .filter((x): x is number => x !== undefined && x > 0)
      .sort((x, y) => x - y);
    const mid = all.length === 0 ? 0 : all.length % 2 ? all[(all.length - 1) / 2]! : (all[all.length / 2 - 1]! + all[all.length / 2]!) / 2;
    return { amount: mid, label: "expected" };
  }

  /** Each leg of a campaign as decisions read it: censoring-corrected yield, measured cost per attempt. */
  legEstimates(campaign: ShadowCampaign): (LegEstimateRead & { from: OutcomeId; to: OutcomeId })[] {
    return campaign.line.map((to, k) => {
      const from = this.legFrom(campaign, k);
      const pipeId = campaign.today.legPipes[k];
      const pipe = pipeId ? this.catalogue.pipe(pipeId) : undefined;
      return { from, to, ...legEstimateOf(this.legCohorts.get(`${campaign.id}${SEP}${k}`), this.day, pipe?.maturity.delayMeanDays ?? 0) };
    });
  }

  /** What a leg costs and yields through one pipe across the fleet (every campaign playing it there). */
  fleetLegEstimate(from: OutcomeId, to: OutcomeId, pipeId: string): LegEstimate | null {
    const key = `${from}${SEP}${to}${SEP}${pipeId}`;
    if (this.fleetLegCache.has(key)) return this.fleetLegCache.get(key)!;
    const v = this.computeFleetLegEstimate(from, to, pipeId);
    this.fleetLegCache.set(key, v);
    return v;
  }

  private readonly fleetLegCache = new Map<string, LegEstimate | null>();

  private computeFleetLegEstimate(from: OutcomeId, to: OutcomeId, pipeId: string): LegEstimate | null {
    const merged = new Map<number, { t: number; s: number; f: number; c: number }>();
    let delay = this.catalogue.pipe(pipeId)?.maturity.delayMeanDays ?? 0;
    for (const c of this.campaigns()) {
      c.line.forEach((t, k) => {
        if (t !== to || this.legFrom(c, k) !== from || c.today.legPipes[k] !== pipeId) return;
        for (const [d, cell] of this.legCohorts.get(`${c.id}${SEP}${k}`) ?? []) {
          const m = merged.get(d) ?? { t: 0, s: 0, f: 0, c: 0 };
          m.t += cell.t;
          m.s += cell.s;
          m.f += cell.f;
          m.c += cell.c;
          merged.set(d, m);
        }
      });
    }
    if (merged.size === 0) return null;
    delay = Math.max(delay, 0);
    const e = legEstimateOf(merged, this.day, delay);
    if (e.yieldRate === null || e.costPerAttempt === null || e.reached === 0) return null;
    return { costPerAttempt: e.costPerAttempt, yieldRate: e.yieldRate, label: e.label };
  }

  /** The 3 cheapest distinct lines to a target (a bounded search: a real catalogue has many legs). */
  private bestLines(outcomes: OutcomeId[], target: OutcomeId, estimator: (e: LegEdge) => LegEstimate | null, value: number, entry: OutcomeId): RankedFunnel[] {
    const out: RankedFunnel[] = [];
    const seen = new Set<string>();
    for (const f of enumerateFunnels(this.catalogue, outcomes, target, (e) => estimator(e), value, entry, 3000)) {
      const k = f.line.join(">");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
      if (out.length >= 3) break;
    }
    return out;
  }

  /** Value of one occurrence at the end of a campaign's leg (backward from its target). */
  legValue(campaign: ShadowCampaign, legIndex: number): number {
    const target = this.targetValue(campaign).amount;
    const legs = this.legEstimates(campaign);
    const { values } = valueBackwardLine(legs.map((l) => ({ costPerAttempt: l.costPerAttempt ?? 0, yieldRate: l.yieldRate ?? 0.5 })), target);
    return Math.max(values[legIndex + 1] ?? target, target * 0.01);
  }

  // ---- reconciliation -------------------------------------------------------------

  reconcile(client: ShadowClient): ClientReconciliation {
    const b = client.brand.id;
    const tol = this.settings.tolerance;
    const lines: ReconciliationLine[] = [];
    const missing: string[] = [];
    const line = (key: string, snapshot: number, fig: ProductionFigure | undefined) => {
      if (!fig) {
        missing.push(key);
        return;
      }
      const gap = snapshot - fig.value;
      const rel = fig.value !== 0 ? gap / fig.value : null;
      lines.push({ key, snapshot, production: fig.value, source: fig.source, gap, relativeGap: rel, matches: fig.value === 0 ? Math.abs(gap) < 1e-9 : Math.abs(gap) <= tol * Math.abs(fig.value) });
    };
    const orgBrands = new Set(this.snapshot.clients.filter((c) => c.org.id === client.org.id).map((c) => c.brand.id));
    const spendBrands = client.production.spendCents?.scope === "org" ? orgBrands : new Set([b]);
    const spend = this.snapshot.observations.runs.filter((r) => spendBrands.has(r.brandId)).reduce((s, r) => s + r.spendCents, 0);
    line("spend", spend, client.production.spendCents);
    const outcomes = new Set([...Object.keys(client.production.outcomes ?? {})]);
    for (const o of [...outcomes].sort()) {
      const brands = client.production.outcomes?.[o]?.scope === "org" ? orgBrands : new Set([b]);
      const n = this.snapshot.observations.states.filter((s) => brands.has(s.brandId) && s.outcome === o).reduce((x, s) => x + s.leads, 0);
      line(o, n, client.production.outcomes?.[o]);
    }
    return { brandId: b, lines, reconciles: lines.length > 0 && lines.every((l) => l.matches), missing, notes: client.notes ?? [] };
  }

  // ---- recommendations ----------------------------------------------------------

  /** Every recommendation the engine would make, and the actions it would launch. Computed once. */
  compute(): ShadowReport {
    if (this.report) return this.report;
    const clients: ClientView[] = [];
    const actions: ShadowAction[] = [];
    const proposals: ShadowProposal[] = [];
    for (const client of this.snapshot.clients) {
      const reconciliation = this.reconcile(client);
      if (!reconciliation.reconciles) {
        clients.push({ brandId: client.brand.id, reconciliation, campaigns: [] });
        continue;
      }
      const views = client.campaigns.map((c) => this.campaignView(c));
      this.allocate(client, views);
      clients.push({ brandId: client.brand.id, reconciliation, campaigns: views });
      for (const v of views) actions.push(...this.actionsOf(client, v));
      for (const c of client.campaigns) {
        const p = this.proposeIcp(client, c);
        if (!p) continue;
        proposals.push(p);
        actions.push({ id: `propose_icp:${c.id}`, kind: "propose_icp", brandId: client.brand.id, campaignId: c.id, point: null, from: p.parentDynasty, to: null, label: `Write a finer ICP: ${p.text}`, reason: reasonOf(p.study) });
      }
    }
    const reconciled = new Set(clients.filter((c) => c.reconciliation.reconciles).map((c) => c.brandId));
    for (const p of this.proposeStrategies(reconciled)) {
      proposals.push(p);
      actions.push({ id: `propose_strategy:${p.point}:${p.text}`, kind: "propose_strategy", brandId: null, campaignId: null, point: p.point, from: null, to: null, label: `Offer the strategy "${p.text}"`, reason: reasonOf(p.study) });
    }
    this.report = { day: this.day, clients, proposals, actions, ledger: this.ledger() };
    return this.report;
  }

  private campaignView(campaign: ShadowCampaign): CampaignView {
    const estimates = this.legEstimates(campaign);
    const points: PointView[] = [];
    const rng = createRng(`shadow|${campaign.id}`);
    for (const p of this.pointsOfCampaign(campaign)) {
      const value = this.legValue(campaign, p.legIndex);
      const delay = this.evidence.delayOf(p.point);
      const options = p.options;
      const beliefs = options.map((o) => ({ id: o, ...this.evidence.belief(p.point, o, options, campaign.brandId, this.day) }));
      const picks = new Map<string, number>();
      if (options.length > 1) for (let i = 0; i < this.settings.draws; i++) {
        const id = prioritize(beliefs, value, rng).chosenId;
        picks.set(id, (picks.get(id) ?? 0) + 1);
      }
      const views: OptionView[] = beliefs.map((b) => {
        const c = this.evidence.counts(p.point, b.id, [campaign.brandId], this.day, delay);
        const rate = betaMean(b.posterior);
        return {
          option: b.id,
          rate,
          rateSd: Math.sqrt(betaVariance(b.posterior)),
          cost: b.cost.mean,
          valuePerDollar: (rate * value) / Math.max(b.cost.mean, 1e-6),
          decisions: c.n,
          successes: c.successes,
          pickShare: options.length > 1 ? (picks.get(b.id) ?? 0) / this.settings.draws : 1,
        };
      });
      const engine = [...views].sort((x, y) => y.valuePerDollar - x.valuePerDollar || (x.option < y.option ? -1 : 1))[0]!.option;
      points.push({ point: p.point, kind: p.kind, consumer: p.consumer, input: p.input, legIndex: p.legIndex, today: campaign.today.picks[p.point] ?? (p.kind === "play" ? campaign.today.legPipes[p.legIndex] ?? null : null), engine, options: views });
    }
    const runs = this.legPipesOf(campaign);
    const legs: LegView[] = estimates.map((e, k) => ({
      from: e.from,
      to: e.to,
      todayPipe: campaign.today.legPipes[k] ?? null,
      pipes: runs[k] ?? [],
      enginePipe: points.find((p) => p.kind === "play" && p.legIndex === k)?.engine ?? campaign.today.legPipes[k] ?? null,
      estimate: { attempts: e.attempts, reached: e.reached, yieldRate: e.yieldRate, costPerAttempt: e.costPerAttempt, label: e.label },
    }));
    const tv = this.targetValue(campaign);
    const target = campaign.line[campaign.line.length - 1]!;
    const entry = this.entryOf(campaign);
    const offerOutcomes = this.clientOf(campaign.id)?.offers.find((o) => o.id === campaign.offerId)?.outcomes ?? campaign.line;
    let unmeasured = 0;
    const estimator = (e: LegEdge): LegEstimate | null => {
      const est = this.fleetLegEstimate(e.from, e.to, e.pipeId);
      if (!est) unmeasured++;
      return est;
    };
    const outcomes = [...new Set([...offerOutcomes, ...campaign.line])];
    const engine =
      tv.amount > 0
        ? this.entryRoots(entry)
            .flatMap((root) => this.bestLines(outcomes, target, estimator, tv.amount, root).map((f) => ({ ...f, line: [entry, ...f.line.slice(1)] })))
            .sort((a, b) => a.costPerTarget - b.costPerTarget || a.line.join(">").localeCompare(b.line.join(">")))
            .slice(0, 3)
        : [];
    const todayLegs = campaign.line.map((to, k) => {
      const pipe = campaign.today.legPipes[k];
      return pipe ? this.fleetLegEstimate(this.legFrom(campaign, k), to, pipe) : null;
    });
    let today: RankedFunnel | null = null;
    if (todayLegs.every((l) => l)) {
      const chain = todayLegs as LegEstimate[];
      const cost = chainCostPerTarget(chain);
      if (Number.isFinite(cost)) {
        const per = chain.map((l, i) => ({ ...l, i }));
        let reach = 1;
        const needs = new Array<number>(per.length);
        for (let i = per.length - 1; i >= 0; i--) {
          reach *= per[i]!.yieldRate;
          needs[i] = reach > 0 ? 1 / reach : Number.POSITIVE_INFINITY;
        }
        today = {
          line: [entry, ...campaign.line],
          legs: chain.map((l, k) => ({ from: this.legFrom(campaign, k), to: campaign.line[k]!, pipeId: campaign.today.legPipes[k]!, estimate: l, leadsNeeded: needs[k]!, costPerTarget: l.costPerAttempt * needs[k]! })),
          costPerTarget: cost,
          valuePerDollar: cost > 0 ? tv.amount / cost : Number.POSITIVE_INFINITY,
          label: chain.every((l) => l.label === "measured") ? "measured" : "expected",
        };
      }
    }
    const spendCents = this.snapshot.observations.runs.filter((r) => r.campaignId === campaign.id).reduce((s, r) => s + r.spendCents, 0);
    let vpd: number | null = null;
    if (estimates.every((l) => l.yieldRate !== null && l.costPerAttempt !== null && l.reached > 0)) {
      const t = chainCostPerTarget(estimates.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! })));
      if (Number.isFinite(t) && t > 0) vpd = tv.amount / t;
    }
    const named = engine.map((f) => {
      const n = this.catalogue.peekSalesFunnel(f.line[0] ?? entry, f.line.slice(1), f.legs.map((l) => l.pipeId));
      return { ...f, name: n.name, id: n.id };
    });
    return {
      campaignId: campaign.id,
      brandId: campaign.brandId,
      name: campaign.name,
      status: campaign.status,
      entry,
      line: campaign.line,
      targetValue: tv,
      legs,
      points,
      salesPath: this.catalogue.peekSalesPath(entry, campaign.line),
      salesFunnel: campaign.today.legPipes.every((p) => p) ? this.catalogue.peekSalesFunnel(entry, campaign.line, campaign.today.legPipes as string[]) : null,
      funnels: { today, engine: named, unmeasuredLegs: unmeasured },
      budget: { todayCents: campaign.status === "running" ? campaign.dailyBudgetCents : 0, engineCents: campaign.status === "running" ? campaign.dailyBudgetCents : 0, valuePerDollar: vpd },
      spendCents,
    };
  }

  /**
   * The client's daily budget, spread again by value per dollar: the same
   * total, each campaign at most `maxBudgetMultiple` x today's, a campaign
   * returning less than it costs funded with nothing. A campaign whose line is
   * not measured keeps today's budget.
   */
  private allocate(client: ShadowClient, views: CampaignView[]): void {
    const running = views.filter((v) => v.status === "running" && v.budget.todayCents > 0);
    const priced = running.filter((v) => v.budget.valuePerDollar !== null);
    const total = priced.reduce((s, v) => s + v.budget.todayCents, 0);
    if (priced.length === 0) return;
    const alloc = allocateBudget(priced.map((v) => ({ id: v.campaignId, valuePerDollar: v.budget.valuePerDollar!, capacity: (v.budget.todayCents * this.settings.maxBudgetMultiple) / 100 })), total / 100);
    for (const v of priced) v.budget.engineCents = Math.round((alloc.funded.find((f) => f.id === v.campaignId)?.amount ?? 0) * 100);
    void client;
  }

  private actionsOf(client: ShadowClient, v: CampaignView): ShadowAction[] {
    const out: ShadowAction[] = [];
    const b = client.brand.id;
    for (const p of v.points) {
      if (!p.today || p.today === p.engine) continue;
      const kind: ShadowActionKind = p.kind === "play" ? "switch_pipe" : p.kind === "occurrence" ? "switch_occurrence" : "switch_script";
      const best = p.options.find((o) => o.option === p.engine)!;
      const now = p.options.find((o) => o.option === p.today);
      out.push({
        id: `${kind}:${v.campaignId}:${p.point}`,
        kind,
        brandId: b,
        campaignId: v.campaignId,
        point: p.point,
        from: p.today,
        to: p.engine,
        label: `${this.pointTitle(p)}: from ${this.optionName(p, p.today, b)} to ${this.optionName(p, p.engine, b)}`,
        reason: `${fmt(best.valuePerDollar)} expected per dollar against ${now ? fmt(now.valuePerDollar) : "no measure"} today; the engine would give it ${Math.round(best.pickShare * 100)}% of the picks.`,
      });
    }
    if (v.budget.engineCents !== v.budget.todayCents && v.status === "running") {
      const kind: ShadowActionKind = v.budget.engineCents === 0 ? "pause_campaign" : "set_budget";
      out.push({
        id: `${kind}:${v.campaignId}`,
        kind,
        brandId: b,
        campaignId: v.campaignId,
        point: null,
        from: String(v.budget.todayCents),
        to: String(v.budget.engineCents),
        label: kind === "pause_campaign" ? "Fund nothing more on this campaign" : `Daily budget from ${money(v.budget.todayCents)} to ${money(v.budget.engineCents)}`,
        reason: v.budget.valuePerDollar !== null ? `${fmt(v.budget.valuePerDollar)} expected per dollar on its measured legs.` : "Not measured.",
      });
    }
    const best = v.funnels.engine[0];
    if (best && v.funnels.today && best.line.join(">") !== v.funnels.today.line.join(">") && best.costPerTarget < v.funnels.today.costPerTarget) {
      out.push({
        id: `switch_funnel:${v.campaignId}`,
        kind: "switch_funnel",
        brandId: b,
        campaignId: v.campaignId,
        point: null,
        from: v.funnels.today.line.join(">"),
        to: best.line.join(">"),
        label: `Run the sales funnel "${best.name}"`,
        reason: `${money(best.costPerTarget * 100)} per target outcome against ${money(v.funnels.today.costPerTarget * 100)} today, on the fleet's measured legs.`,
      });
    }
    return out;
  }

  /** A choice point in words: "Lead found → Lead interested" or "Cold email · Template". */
  pointTitle(p: Pick<PointView, "point" | "consumer" | "input" | "kind">): string {
    const label = (o: OutcomeId) => (o === START ? "Start" : this.catalogue.outcome(o)?.label ?? o);
    if (p.point.startsWith("play:")) {
      const [from, to] = p.point.slice(5).split(">") as [string, string];
      return `Pipe of ${label(from)} → ${label(to)}`;
    }
    if (!p.consumer) {
      const [from, to] = p.point.slice(4).split("|")[0]!.split(">") as [string, string];
      return `Script of ${label(from)} → ${label(to)}`;
    }
    return `${this.catalogue.pipe(p.consumer)?.name ?? p.consumer} · ${label(p.input)}`;
  }

  /** An option of a point in words: a script dynasty's head, a pipe, or a client's object. */
  optionName(p: Pick<PointView, "input">, option: string, brandId: string): string {
    const s = this.catalogue.headOf(option) ?? this.catalogue.versionsOf(option).pop();
    if (s) return s.name;
    const pipe = this.catalogue.pipe(option);
    if (pipe) return pipe.name;
    return this.objectHead(brandId, p.input, option)?.name ?? option;
  }

  // ---- splits ----------------------------------------------------------------------

  private proposeIcp(client: ShadowClient, campaign: ShadowCampaign): ShadowProposal | null {
    if (campaign.entry.kind !== "start") return null;
    const cells = (this.snapshot.observations.leads ?? []).filter((c) => c.campaignId === campaign.id && c.legIndex === 0);
    if (cells.length === 0) return null;
    const records: SplitRecord[] = [];
    for (const c of cells) {
      for (let i = 0; i < c.served; i++) records.push({ values: c.values, success: i < c.reached, stratum: c.stratum });
    }
    const tactics = this.catalogue.tactics.filter((t) => !t.retired && (t.describes.includes("lead") || t.describes.includes("company")));
    const study = studySplits(records, tactics);
    if (!study.proposal) return null;
    const audience = this.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired)?.id;
    const point = audience ? Object.keys(campaign.today.picks).find((p) => p.endsWith(`|${audience}`)) : undefined;
    const parentDynasty = point ? campaign.today.picks[point] ?? null : null;
    const parent = parentDynasty && audience ? this.objectHead(client.brand.id, audience, parentDynasty) : undefined;
    const words = study.proposal.conditions.map((c) => describeCondition(c, this.catalogue).toLowerCase()).join(", ");
    const text = parent ? `${parent.text.replace(/\.\s*$/, "")}, ${words}.` : `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
    return { kind: "audience", brandId: client.brand.id, campaignId: campaign.id, point: point ?? null, conditions: [...(parent?.conditions ?? []), ...study.proposal.conditions], text, parentDynasty, study };
  }

  private proposeStrategies(reconciled: ReadonlySet<string>): ShadowProposal[] {
    const out: ShadowProposal[] = [];
    const mature = this.day - this.settings.splitMatureDays;
    const scriptTactics = this.catalogue.tactics.filter((t) => !t.retired && t.describes.includes("script"));
    if (scriptTactics.length === 0) return out;
    const byPoint = new Map<string, SplitRecord[]>();
    for (const ch of this.snapshot.observations.choices) {
      if (ch.day > mature) continue;
      if (!reconciled.has(ch.brandId)) continue;
      const s = this.catalogue.headOf(ch.option);
      if (!s) continue;
      const list = byPoint.get(ch.point) ?? [];
      for (let i = 0; i < ch.decisions; i++) list.push({ values: s.tactics, success: i < ch.successes, stratum: `${ch.brandId}|${this.dateOf(ch.day).slice(0, 7)}` });
      byPoint.set(ch.point, list);
    }
    for (const point of [...byPoint.keys()].sort()) {
      const study = studySplits(byPoint.get(point)!, scriptTactics, { maxDepth: 1 });
      if (!study.proposal) continue;
      const [consumer, input] = point.split("|") as [string, string];
      const name = `At ${this.catalogue.outcome(input)?.label ?? input}: ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", ")}`;
      out.push({ kind: "strategy", brandId: null, campaignId: null, point, conditions: study.proposal.conditions, text: name, parentDynasty: null, study });
      void consumer;
    }
    return out;
  }

  // ---- the ledger -----------------------------------------------------------------

  /** The ledger of the observed runs (decide: each pipe's own cost; report: every-path unit costs). */
  ledger(): LedgerReport {
    const runs: LedgerRun[] = [];
    const occ: LedgerOccurrence[] = [];
    this.snapshot.observations.runs.forEach((r, i) => {
      const id = `run:${i}`;
      runs.push({ id, pipeId: r.pipeId, target: r.outcome, day: r.day, spendCents: Math.round(r.spendCents), consumed: [], inputs: r.inputs, ...(r.support && r.outputs === 0 ? { support: { kind: r.support, reason: r.support } } : {}), ...(r.factory ? { factory: r.factory } : {}), ...(r.campaignId ? { campaignId: r.campaignId } : {}), ...(r.scriptId ? { scriptId: r.scriptId } : {}) });
      if (r.outputs > 0 && r.outcome) occ.push({ id: `occ:${i}`, outcome: r.outcome, subject: `${r.brandId}:${i}`, runId: id, day: r.day, quantity: r.outputs });
    });
    return buildLedger(runs, occ);
  }
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return "unbounded";
  return `$${x >= 10 ? x.toFixed(0) : x.toFixed(2)}`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function reasonOf(study: SplitStudy): string {
  const p = study.proposal;
  if (!p) return "";
  const r = (c: { successes: number; trials: number }) => (c.trials > 0 ? `${((100 * c.successes) / c.trials).toFixed(1)}%` : "n/a");
  return `${r(p.branch)} of ${p.branch.trials} reach the leg's end inside, against ${r(p.all)} of ${p.all.trials} overall (conclusion: the exact and like-for-like tests agree).`;
}

/** Load a snapshot into a shadow session. */
export function shadowFromSnapshot(snapshot: ShadowSnapshot): ShadowSession {
  return new ShadowSession(snapshot);
}

/** Check a snapshot's shape before loading it (a list of plain problems, empty when fine). */
export function validateSnapshot(x: unknown): string[] {
  const problems: string[] = [];
  const s = x as Partial<ShadowSnapshot> | null;
  if (!s || typeof s !== "object") return ["not an object"];
  if (s.format !== SHADOW_FORMAT) problems.push(`format must be "${SHADOW_FORMAT}"`);
  if (typeof s.today !== "number") problems.push("today must be a day index");
  if (typeof s.firstDay !== "string") problems.push("firstDay must be an ISO date");
  if (!s.catalogue || !Array.isArray(s.catalogue.pipes)) problems.push("catalogue missing");
  if (!Array.isArray(s.clients)) problems.push("clients missing");
  const o = s.observations;
  if (!o || !Array.isArray(o.legs) || !Array.isArray(o.choices) || !Array.isArray(o.runs) || !Array.isArray(o.states)) problems.push("observations must hold legs, choices, runs and states");
  return problems;
}
