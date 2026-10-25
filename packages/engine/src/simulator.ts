/**
 * The simulator: a synthetic world with HIDDEN true yields, delays and costs
 * per (workflow x slot options x segment x client). Day by day, under each
 * campaign's budget, the engine makes every choice with the universal
 * prioritizer, runs are produced, outcomes land after their delay, the ledger
 * fills, and the engine learns. Deterministic: one seed, one history.
 */

import { START, type Catalogue, type Pipe, type Play, type StepKey, type Workflow } from "./catalogue";
import {
  audiencesFromExpert,
  inAudience,
  targetValue,
  type Audience,
  type AudienceProposal,
  type Brand,
  type Campaign,
  type Lead,
  type Offer,
  type Org,
  type SegmentRule,
} from "./client";
import { censoredCounts, geometricDelay, maturityViews, type Cohort, type DelayDistribution, type MaturityViews } from "./delay";
import { measureReliability, attest, outcomeCoverage, type Evidence, type Reporter, type ReporterConnection, type EvidencePolicy, type ReporterReliability, type OutcomeCoverage, type AttestedOccurrence } from "./evidence";
import { rankSalesFunnels, type LegEstimate, type RankedFunnel } from "./funnels";
import { buildLedger, type LedgerOccurrence, type LedgerReport, type LedgerRun } from "./ledger";
import { prioritize, type ChoiceOption } from "./prioritizer";
import { createRng, type Rng } from "./rng";
import { discoverSegments, type SegmentFinding, type SegmentRecord } from "./segments";
import { betaMean, fitPoolingStrength, pooledPosterior, type BetaPosterior, type Counts } from "./stats";

// ---------------------------------------------------------------------------
// World specification
// ---------------------------------------------------------------------------

export interface SimClient {
  org: Org;
  brand: Brand;
  offer: Offer;
  campaign: Campaign;
  /** What the expert step proposed from the ICP. */
  expertAudiences: AudienceProposal[];
}

export interface SimAttribute {
  name: string;
  values: string[];
  weights?: number[];
}

export interface PipeTruth {
  pipeId: string;
  baseYield: number;
  delayMeanDays: number;
  maxDelayDays: number;
}

/** Everything the engine must NOT see: the real yields of the world. */
export interface WorldTruth {
  pipes: PipeTruth[];
  /** Yield multiplier per workflow id. */
  workflows: Record<string, number>;
  /** Yield multiplier per slot option id. */
  slotOptions: Record<string, number>;
  /** Yield multiplier per attribute value. */
  segments: { attribute: string; value: string; multiplier: number }[];
  /** Yield multiplier per client (brand id). */
  clients: Record<string, number>;
}

export interface SimReporter {
  reporter: Reporter;
  outcomes: StepKey[];
  /** Share of true outcomes it reports. */
  recall: number;
  /** Chance it reports an outcome that did not happen, per failed trial. */
  spuriousRate: number;
}

export interface WorldSpec {
  seed: number | string;
  catalogue: Catalogue;
  clients: SimClient[];
  attributes: SimAttribute[];
  truth: WorldTruth;
  reporters?: SimReporter[];
  evidencePolicy?: EvidencePolicy;
  settings?: {
    /** Sales funnels the prioritizer compares per campaign. */
    funnelCandidates?: number;
    /** Days between two funnel choices of a campaign. */
    funnelEveryDays?: number;
    /** Days between two segment discoveries. */
    discoverEveryDays?: number;
    /** One-off setup spend per client (support), cents. */
    setupCentsPerClient?: number;
    /** Yield a pipe is assumed to have before any data, when its workflows state none. */
    defaultExpectedYield?: number;
  };
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface ChoiceRecord {
  day: number;
  campaignId: string;
  /** "funnel", "audience", "workflow", or "slot:<name>". */
  node: string;
  pipeId: string | null;
  options: { id: string; meanScore: number; picks: number }[];
  chosenId: string;
  reason: string;
}

export interface DaySnapshot {
  day: number;
  spendCents: Record<string, number>;
  /** Spend per pipe, then per workflow. */
  spendByWorkflow: Record<string, Record<string, number>>;
  /** New occurrences per outcome today. */
  outcomes: Record<StepKey, number>;
  /** Value of target outcomes reached today, dollars. */
  valueRealized: number;
  funnelOf: Record<string, string>;
  leadsCreated: number;
}

export interface SimulationResult {
  days: DaySnapshot[];
  choices: ChoiceRecord[];
  runs: LedgerRun[];
  occurrences: LedgerOccurrence[];
  ledger: LedgerReport;
  audiences: Audience[];
  findings: { day: number; campaignId: string; kind: "winner" | "loser"; finding: SegmentFinding }[];
  evidence: Evidence[];
  reliability: ReporterReliability[];
  coverage: OutcomeCoverage[];
  attested: AttestedOccurrence[];
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** One thing that happened to a simulated lead: a trial of a pipe, or an outcome landing. */
export interface LeadEvent {
  day: number;
  kind: "trial" | "outcome";
  pipeId: string;
  runId: string;
  /** For a trial: the workflow and the slot options it ran with. */
  workflowId?: string;
  slotChoice?: Record<string, string>;
  /** For an outcome: the step reached and the occurrence it made (none when the lead was already past it). */
  step?: StepKey;
  occurrenceId?: string | null;
}

/** A lead of the simulated world, as the engine sees it, plus what happened to it. */
export interface SimLead extends Lead {
  campaignId: string;
  funnel: string[];
  audienceId: string | null;
  occurrenceByStep: Record<StepKey, string>;
  stateOccurrence: Record<string, string>;
  stepsReached: StepKey[];
  /** First day the lead was served. */
  createdDay: number;
  timeline: LeadEvent[];
}

interface SegmentRecordEntry {
  record: SegmentRecord;
  day: number;
}

interface Pending {
  day: number;
  leadId: string;
  runId: string;
  step: StepKey;
  learningKeys: string[];
  trialDay: number;
  segmentRecord: SegmentRecordEntry | null;
}

interface QueueItem {
  leadId: string;
  step: StepKey;
}

interface RunGroup {
  run: LedgerRun;
}

const PIPE_NODE = "pipe";

export class SimulationSession {
  readonly catalogue: Catalogue;
  private readonly world: WorldSpec;
  private readonly rng: Rng;
  private dayIndex = 0;
  private readonly leads_ = new Map<string, SimLead>();
  private readonly audiences: Audience[] = [];
  private readonly pending: Pending[] = [];
  private readonly queues = new Map<string, QueueItem[]>();
  private readonly runs: LedgerRun[] = [];
  private readonly runIndex = new Map<string, RunGroup>();
  private readonly runById = new Map<string, LedgerRun>();
  private readonly occurrences: LedgerOccurrence[] = [];
  private readonly evidence: Evidence[] = [];
  /** Cohorts per learning key: key -> day -> counts. */
  private readonly cohorts = new Map<string, Map<number, { trials: number; successes: number; spend: number }>>();
  private readonly segmentRecords = new Map<string, SegmentRecordEntry[]>();
  private readonly clientOfCampaign = new Map<string, SimClient>();
  private readonly spent = new Map<string, number>();
  private readonly funnelOf = new Map<string, string[]>();
  private readonly days: DaySnapshot[] = [];
  private readonly choices: ChoiceRecord[] = [];
  private readonly findings: SimulationResult["findings"] = [];
  private readonly fleetOffers: Offer[];
  private leadCounter = 0;
  private occCounter = 0;
  private runCounter = 0;

  constructor(world: WorldSpec) {
    this.world = world;
    this.catalogue = world.catalogue;
    this.rng = createRng(world.seed);
    this.fleetOffers = world.clients.map((c) => c.offer);
    for (const c of world.clients) this.register(c);
  }

  private register(c: SimClient): void {
    const known = this.audiences.some((a) => a.brandId === c.brand.id);
    if (!known && c.expertAudiences.length > 0) this.audiences.push(...audiencesFromExpert(c.brand, () => c.expertAudiences));
    this.spent.set(c.campaign.id, 0);
    this.clientOfCampaign.set(c.campaign.id, c);
    const setup = this.world.settings?.setupCentsPerClient ?? 0;
    if (setup > 0 && !this.runs.some((r) => r.id === `run:setup:${c.brand.id}`)) {
      this.runs.push({
        id: `run:setup:${c.brand.id}`,
        pipeId: null,
        target: null,
        day: this.dayIndex,
        spendCents: setup,
        consumed: [],
        support: { kind: "brand_setup", reason: "first setup of the brand" },
      });
    }
  }

  /** The clients (one per campaign) of the world, in launch order. */
  get clients(): readonly SimClient[] {
    return this.world.clients;
  }

  /**
   * Launch a campaign while the world runs: a new client, or a new campaign of a
   * known brand. A brand seen for the first time gets its expert audiences and its
   * setup run. `truthMultiplier` is the new brand's hidden yield multiplier.
   */
  addClient(client: SimClient, truthMultiplier = 1): void {
    if (this.clientOfCampaign.has(client.campaign.id)) throw new Error(`campaign "${client.campaign.id}" already exists`);
    if (this.world.truth.clients[client.brand.id] === undefined) this.world.truth.clients[client.brand.id] = truthMultiplier;
    this.world.clients.push(client);
    if (!this.fleetOffers.some((o) => o.id === client.offer.id)) this.fleetOffers.push(client.offer);
    this.register(client);
  }

  /** Turn a campaign on or off. */
  setCampaignStatus(campaignId: string, status: Campaign["status"]): void {
    const c = this.clientOfCampaign.get(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    c.campaign.status = status;
  }

  /** Change a campaign's daily budget (cents) and volume cap. */
  setCampaignBudget(campaignId: string, dailyBudgetCents: number, maxVolume?: number): void {
    const c = this.clientOfCampaign.get(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    c.campaign.dailyBudgetCents = Math.max(0, Math.round(dailyBudgetCents));
    if (maxVolume === undefined) delete c.campaign.maxVolume;
    else c.campaign.maxVolume = maxVolume;
  }

  /** Every lead served so far, in creation order. */
  leads(): SimLead[] {
    return [...this.leads_.values()];
  }

  lead(id: string): SimLead | undefined {
    return this.leads_.get(id);
  }

  /** Total spent by a campaign so far, cents. */
  spentCents(campaignId: string): number {
    return this.spent.get(campaignId) ?? 0;
  }

  /** The plays a campaign runs now (its sales funnel), from Start. */
  funnelOfCampaign(campaignId: string): string[] | null {
    return this.funnelOf.get(campaignId) ?? null;
  }

  /**
   * What the engine would propose today for an offer and a target outcome:
   * the value of one target outcome and the best sales funnels by value per
   * dollar, on the leg estimates a choice reads (the brand's own data pooled
   * with the fleet; a new brand reads the fleet).
   */
  proposeFunnels(offer: Offer, target: StepKey, options: { brandId?: string; limit?: number; value?: number } = {}): { value: number | null; valueLabel: "stated" | "expected" | null; funnels: RankedFunnel[] } {
    const tv = options.value !== undefined ? { amount: options.value, label: "stated" as const } : targetValue(offer, target, this.fleetOffers, this.catalogue);
    const brandId = options.brandId ?? offer.brandId;
    const funnels = rankSalesFunnels(
      this.catalogue,
      offer,
      target,
      (play, pipe) => this.legEstimate(pipe, play, brandId, this.dayIndex),
      tv?.amount ?? 0,
      options.limit ?? 6,
      { proactiveEntry: true },
    );
    return { value: tv?.amount ?? null, valueLabel: tv?.label ?? null, funnels };
  }

  /** The leg estimate a choice reads for a play today (null when the play cannot run). */
  estimateLeg(playId: string, brandId: string): LegEstimate | null {
    const play = this.catalogue.play(playId);
    const pipe = play ? this.catalogue.pipe(play.pipeId) : undefined;
    if (!play || !pipe) return null;
    return this.legEstimate(pipe, play, brandId, this.dayIndex);
  }

  /** Unique brand ids of the world. */
  private brandIds(): string[] {
    return [...new Set(this.world.clients.map((c) => c.brand.id))];
  }

  get day(): number {
    return this.dayIndex;
  }

  /** Simulate one day. */
  step(): DaySnapshot {
    const day = this.dayIndex;
    const snap: DaySnapshot = { day, spendCents: {}, spendByWorkflow: {}, outcomes: {}, valueRealized: 0, funnelOf: {}, leadsCreated: 0 };

    this.deliverArrivals(day, snap);

    for (const client of [...this.world.clients]) {
      const campaign = client.campaign;
      if (campaign.status !== "running") continue;
      const every = this.world.settings?.funnelEveryDays ?? 7;
      if (campaign.salesFunnel && campaign.salesFunnel.length > 0) this.funnelOf.set(campaign.id, [...campaign.salesFunnel]);
      else if (!this.funnelOf.has(campaign.id) || day % every === 0) this.chooseFunnel(day, client);
      const funnel = this.funnelOf.get(campaign.id);
      if (!funnel) continue;
      snap.funnelOf[campaign.id] = funnel.join(" > ");

      let budget = campaign.dailyBudgetCents;
      if (campaign.maxBudgetCents !== undefined) budget = Math.min(budget, campaign.maxBudgetCents - (this.spent.get(campaign.id) ?? 0));
      if (budget <= 0) continue;

      budget = this.processReactive(day, client, budget, snap);
      this.processEntry(day, client, funnel, budget, snap);
    }

    const discoverEvery = this.world.settings?.discoverEveryDays ?? 15;
    if (day > 0 && day % discoverEvery === 0) for (const c of [...this.world.clients]) this.discover(day, c);

    this.days.push(snap);
    this.dayIndex++;
    return snap;
  }

  run(days: number): DaySnapshot[] {
    const out: DaySnapshot[] = [];
    for (let i = 0; i < days; i++) out.push(this.step());
    return out;
  }

  result(): SimulationResult {
    const ledger = buildLedger(this.runs, this.occurrences);
    const reporters = this.world.reporters ?? [];
    const connections: ReporterConnection[] = [];
    for (const r of reporters)
      for (const b of this.brandIds()) connections.push({ reporterId: r.reporter.id, clientId: b, outcomes: r.outcomes });
    const policy = this.world.evidencePolicy ?? { referenceReporter: {}, minReliability: 0.8 };
    const reliability = measureReliability(this.evidence, connections, policy);
    const outcomes = [...new Set(reporters.flatMap((r) => r.outcomes))];
    return {
      days: this.days,
      choices: this.choices,
      runs: this.runs,
      occurrences: this.occurrences,
      ledger,
      audiences: this.audiences,
      findings: this.findings,
      evidence: this.evidence,
      reliability,
      coverage: outcomeCoverage(this.brandIds(), outcomes, connections, reliability, policy),
      attested: attest(this.evidence, reliability),
    };
  }

  /**
   * Flash (all to date) and mature (cohorts past the pipe's maturity window)
   * views of a pipe's yield and spend, for one client or the whole fleet.
   * Reporting only: choices read the censoring-corrected posteriors.
   */
  pipeMaturity(pipeId: string, brandId?: string): MaturityViews | null {
    const pipe = this.catalogue.pipe(pipeId);
    if (!pipe) return null;
    const brands = brandId ? [brandId] : this.brandIds();
    const cohorts = brands.flatMap((b) =>
      [...(this.cohorts.get(lk(pipeId, PIPE_NODE, "*", b)) ?? new Map<number, { trials: number; successes: number; spend: number }>())].map(([d, c]) => ({
        ageDays: this.dayIndex - d,
        trials: c.trials,
        successes: c.successes,
        spend: c.spend,
      })),
    );
    return maturityViews(cohorts, pipe.maturity);
  }

  // ---- learning reads ------------------------------------------------------

  private delayOf(pipe: Pipe): DelayDistribution {
    return geometricDelay(pipe.maturity.delayMeanDays, Math.max(1, Math.ceil(pipe.maturity.durationDays || pipe.maturity.delayMeanDays * 4)));
  }

  private countsOf(key: string, day: number, delay: DelayDistribution): Counts {
    const m = this.cohorts.get(key);
    if (!m) return { successes: 0, trials: 0 };
    const cohorts: Cohort[] = [];
    for (const [d, c] of m) cohorts.push({ ageDays: day - d, trials: c.trials, successes: c.successes });
    return censoredCounts(cohorts, delay);
  }

  private expectedYieldOf(pipe: Pipe): number {
    const ws = this.catalogue.workflows.filter((w) => w.pipeId === pipe.id && w.status === "active" && w.expectedYield !== undefined);
    if (ws.length === 0) return this.world.settings?.defaultExpectedYield ?? 0.05;
    return ws.reduce((s, w) => s + (w.expectedYield ?? 0), 0) / ws.length;
  }

  /** Pipe-level yield for a client: pipe fleet -> client, k fitted across clients. */
  private pipePosterior(pipe: Pipe, brandId: string, day: number): BetaPosterior {
    const delay = this.delayOf(pipe);
    const perClient = this.brandIds().map((b) => this.countsOf(lk(pipe.id, PIPE_NODE, "*", b), day, delay));
    const fleet = sumCounts(perClient);
    const root = pooledPosterior(fleet, { rate: this.expectedYieldOf(pipe), strength: 2 });
    const mine = this.countsOf(lk(pipe.id, PIPE_NODE, "*", brandId), day, delay);
    return pooledPosterior(mine, { rate: betaMean(root), strength: fitPoolingStrength(perClient) });
  }

  /**
   * Yield of one option at one choice node for a client:
   * pipe (client) -> option fleet (k fitted across options) -> option client (k fitted across clients).
   */
  private optionPosterior(pipe: Pipe, node: string, optionIds: readonly string[], optionId: string, brandId: string, day: number, scopeAllClients = true): BetaPosterior {
    const delay = this.delayOf(pipe);
    const base = this.pipePosterior(pipe, brandId, day);
    const clients = scopeAllClients ? this.brandIds() : [brandId];
    const fleetOf = (id: string) => sumCounts(clients.map((b) => this.countsOf(lk(pipe.id, node, id, b), day, delay)));
    const optionFleet = fleetOf(optionId);
    const kOptions = fitPoolingStrength(optionIds.map(fleetOf));
    const fleetPosterior = pooledPosterior(optionFleet, { rate: betaMean(base), strength: kOptions });
    if (!scopeAllClients) return fleetPosterior;
    const perClient = clients.map((b) => this.countsOf(lk(pipe.id, node, optionId, b), day, delay));
    const mine = this.countsOf(lk(pipe.id, node, optionId, brandId), day, delay);
    return pooledPosterior(mine, { rate: betaMean(fleetPosterior), strength: fitPoolingStrength(perClient) });
  }

  private pipeCostDollars(pipe: Pipe): number {
    const ws = this.catalogue.workflows.filter((w) => w.pipeId === pipe.id && w.status === "active");
    if (ws.length === 0) return 0;
    return ws.reduce((s, w) => s + this.workflowCostCents(w), 0) / ws.length / 100;
  }

  private workflowCostCents(w: Workflow): number {
    let cost = w.costPerTrialCents;
    for (const slot of w.slots) {
      const opts = this.catalogue.slotOptions.filter((o) => o.slot === slot && o.status === "active" && (o.pipeId === null || o.pipeId === w.pipeId));
      if (opts.length > 0) cost += opts.reduce((s, o) => s + o.costPerTrialCents, 0) / opts.length;
    }
    return cost;
  }

  private legEstimate(pipe: Pipe, play: Play, brandId: string, day: number): LegEstimate | null {
    if (this.catalogue.workflowsFor(play).length === 0) return null;
    const truthed = this.world.truth.pipes.some((t) => t.pipeId === pipe.id);
    if (!truthed) return null;
    const posterior = this.pipePosterior(pipe, brandId, day);
    const measured = (this.cohorts.get(lk(pipe.id, PIPE_NODE, "*", brandId))?.size ?? 0) > 0;
    return { costPerTrial: this.pipeCostDollars(pipe), yieldRate: betaMean(posterior), label: measured ? "measured" : "expected" };
  }

  private valueOf(client: SimClient): number {
    return targetValue(client.offer, client.campaign.target, this.fleetOffers, this.catalogue)?.amount ?? 0;
  }

  /** Net value of an occurrence at each step of a funnel, backward from its target. */
  private funnelStepValues(funnel: readonly string[], client: SimClient, day: number): Map<StepKey, number> {
    const values = new Map<StepKey, number>();
    let v = this.valueOf(client);
    const plays = funnel.map((id) => this.catalogue.play(id)!);
    const last = plays[plays.length - 1];
    if (last) values.set(this.catalogue.pipe(last.pipeId)!.to, v);
    for (let i = plays.length - 1; i >= 0; i--) {
      const pipe = this.catalogue.pipe(plays[i]!.pipeId)!;
      const y = betaMean(this.pipePosterior(pipe, client.brand.id, day));
      v = Math.max(0, y * v - this.pipeCostDollars(pipe));
      values.set(pipe.from, v);
    }
    return values;
  }

  // ---- choices -----------------------------------------------------------

  private chooseFunnel(day: number, client: SimClient): void {
    const value = this.valueOf(client);
    const candidates: RankedFunnel[] = rankSalesFunnels(
      this.catalogue,
      client.offer,
      client.campaign.target,
      (play, pipe) => this.legEstimate(pipe, play, client.brand.id, day),
      value,
      this.world.settings?.funnelCandidates ?? 4,
      { proactiveEntry: true },
    );
    if (candidates.length === 0) return;
    const options: ChoiceOption[] = candidates.map((f) => ({
      id: f.id,
      value,
      legs: f.legs.map((l) => ({
        posterior: this.pipePosterior(this.catalogue.pipe(l.pipeId)!, client.brand.id, day),
        costPerTrial: Math.max(l.estimate.costPerTrial, 1e-6),
      })),
    }));
    const r = prioritize(options, this.rng);
    this.funnelOf.set(client.campaign.id, candidates.find((f) => f.id === r.chosenId)!.legs.map((l) => l.playId));
    this.choices.push({
      day,
      campaignId: client.campaign.id,
      node: "funnel",
      pipeId: null,
      options: r.options.map((o) => ({ id: o.id, meanScore: o.meanScore, picks: o.id === r.chosenId ? 1 : 0 })),
      chosenId: r.chosenId,
      reason: r.reason,
    });
  }

  /** Build the options of one choice node for today (posteriors are fixed within a day). */
  private nodeOptions(pipe: Pipe, node: string, ids: string[], costCents: (id: string) => number, value: number, brandId: string, day: number, allClients = true): ChoiceOption[] {
    return ids.map((id) => ({
      id,
      value,
      legs: [{ posterior: this.optionPosterior(pipe, node, ids, id, brandId, day, allClients), costPerTrial: Math.max(costCents(id), 1) / 100 }],
    }));
  }

  private makeChooser(day: number, client: SimClient, pipe: Pipe, play: Play, value: number, withAudience: boolean) {
    const workflows = this.catalogue.workflowsFor(play);
    const wfOptions = this.nodeOptions(pipe, "workflow", workflows.map((w) => w.id), (id) => this.workflowCostCents(this.catalogue.workflow(id)!), value, client.brand.id, day);
    const slots = [...new Set(workflows.flatMap((w) => w.slots))];
    const avgWf = workflows.reduce((s, w) => s + w.costPerTrialCents, 0) / Math.max(1, workflows.length);
    const slotOptions = new Map<string, ChoiceOption[]>();
    for (const slot of slots) {
      const opts = this.catalogue.slotOptionsFor(play, slot);
      if (opts.length === 0) continue;
      slotOptions.set(slot, this.nodeOptions(pipe, `slot:${slot}`, opts.map((o) => o.id), (id) => avgWf + this.catalogue.slotOption(id)!.costPerTrialCents, value, client.brand.id, day));
    }
    const audiences = withAudience ? this.audiences.filter((a) => a.brandId === client.brand.id) : [];
    const audOptions = audiences.length > 0
      ? this.nodeOptions(pipe, "audience", audiences.map((a) => a.id), () => this.pipeCostDollars(pipe) * 100, value, client.brand.id, day, false)
      : [];
    const tally = new Map<string, Map<string, number>>();
    const pick = (node: string, options: ChoiceOption[]) => {
      const r = prioritize(options, this.rng);
      const m = tally.get(node) ?? new Map<string, number>();
      m.set(r.chosenId, (m.get(r.chosenId) ?? 0) + 1);
      tally.set(node, m);
      return r.chosenId;
    };
    const choose = () => {
      const workflowId = wfOptions.length > 0 ? pick("workflow", wfOptions) : null;
      const workflow = workflowId ? this.catalogue.workflow(workflowId)! : null;
      const slotChoice: Record<string, string> = {};
      for (const slot of workflow?.slots ?? []) {
        const opts = slotOptions.get(slot);
        if (opts) slotChoice[slot] = pick(`slot:${slot}`, opts);
      }
      const audienceId = audOptions.length > 0 ? pick("audience", audOptions) : null;
      return { workflow, slotChoice, audienceId };
    };
    const log = () => {
      const nodes: [string, ChoiceOption[]][] = [["workflow", wfOptions], ...[...slotOptions].map(([s, o]) => [`slot:${s}`, o] as [string, ChoiceOption[]]), ["audience", audOptions]];
      for (const [node, options] of nodes) {
        const picks = tally.get(node);
        if (!picks || options.length === 0) continue;
        const scored = options.map((o) => ({ id: o.id, meanScore: meanScoreOf(o), picks: picks.get(o.id) ?? 0 }));
        const chosen = [...scored].sort((a, b) => b.picks - a.picks || (a.id < b.id ? -1 : 1))[0]!;
        const bestMean = [...scored].sort((a, b) => b.meanScore - a.meanScore || (a.id < b.id ? -1 : 1))[0]!;
        this.choices.push({
          day,
          campaignId: client.campaign.id,
          node,
          pipeId: pipe.id,
          options: scored,
          chosenId: chosen.id,
          reason:
            chosen.id === bestMean.id
              ? `most picks went to the highest expected value per dollar ($${bestMean.meanScore.toFixed(2)})`
              : `exploring: ${chosen.id} drew higher more often than ${bestMean.id} (best expected, $${bestMean.meanScore.toFixed(2)} per dollar)`,
        });
      }
    };
    return { choose, log };
  }

  // ---- production ----------------------------------------------------------

  private processReactive(day: number, client: SimClient, budget: number, snap: DaySnapshot): number {
    const queue = this.queues.get(client.campaign.id) ?? [];
    const keep: QueueItem[] = [];
    const choosers = new Map<string, ReturnType<SimulationSession["makeChooser"]>>();
    for (const item of queue) {
      const lead = this.leads_.get(item.leadId)!;
      const playId = lead.funnel.find((id) => this.catalogue.pipe(this.catalogue.play(id)!.pipeId)!.from === item.step);
      if (!playId) continue;
      const play = this.catalogue.play(playId)!;
      const pipe = this.catalogue.pipe(play.pipeId)!;
      if (!this.catalogue.isPipeLive(pipe)) continue;
      let chooser = choosers.get(playId);
      if (!chooser) {
        const values = this.funnelStepValues(lead.funnel, client, day);
        chooser = this.makeChooser(day, client, pipe, play, values.get(pipe.to) ?? 0, false);
        choosers.set(playId, chooser);
      }
      const c = chooser.choose();
      if (!c.workflow) continue;
      const cost = this.trialCostCents(c.workflow, c.slotChoice);
      if (cost > budget) {
        keep.push(item);
        continue;
      }
      budget -= cost;
      this.trial(day, client, lead, pipe, c.workflow, c.slotChoice, null, cost, snap);
    }
    this.queues.set(client.campaign.id, keep);
    for (const ch of choosers.values()) ch.log();
    return budget;
  }

  private processEntry(day: number, client: SimClient, funnel: string[], budget: number, snap: DaySnapshot): void {
    const play = this.catalogue.play(funnel[0]!)!;
    const pipe = this.catalogue.pipe(play.pipeId)!;
    if (!this.catalogue.isPipeLive(pipe)) return;
    const values = this.funnelStepValues(funnel, client, day);
    const chooser = this.makeChooser(day, client, pipe, play, values.get(pipe.to) ?? 0, true);
    const maxVolume = client.campaign.maxVolume ?? Number.POSITIVE_INFINITY;
    let created = [...this.leads_.values()].filter((l) => l.campaignId === client.campaign.id).length;
    for (let guard = 0; guard < 100_000 && created < maxVolume; guard++) {
      const c = chooser.choose();
      if (!c.workflow) break;
      const cost = this.trialCostCents(c.workflow, c.slotChoice);
      if (cost > budget) break;
      budget -= cost;
      const audience = this.audiences.find((a) => a.id === c.audienceId) ?? null;
      const lead = this.newLead(client, funnel, audience);
      created++;
      snap.leadsCreated++;
      this.trial(day, client, lead, pipe, c.workflow, c.slotChoice, audience, cost, snap);
    }
    chooser.log();
  }

  private trialCostCents(workflow: Workflow, slotChoice: Record<string, string>): number {
    let cost = workflow.costPerTrialCents;
    for (const id of Object.values(slotChoice)) cost += this.catalogue.slotOption(id)?.costPerTrialCents ?? 0;
    return cost;
  }

  private newLead(client: SimClient, funnel: string[], audience: Audience | null): SimLead {
    const id = `lead:${++this.leadCounter}`;
    let attributes: Record<string, string> = {};
    for (let attempt = 0; attempt < 20; attempt++) {
      attributes = {};
      for (const a of this.world.attributes) {
        const allowed = audience?.rule[a.name];
        const values = a.values.filter((v) => !allowed || allowed.includes(v));
        const pool = values.length > 0 ? values : a.values;
        const weights = pool.map((v) => a.weights?.[a.values.indexOf(v)] ?? 1);
        attributes[a.name] = pool[this.rng.weighted(weights)]!;
      }
      if (!audience || inAudience(attributes, audience)) break;
    }
    const lead: SimLead = {
      id,
      brandId: client.brand.id,
      attributes,
      states: {},
      campaignId: client.campaign.id,
      funnel,
      audienceId: audience?.id ?? null,
      occurrenceByStep: {},
      stateOccurrence: {},
      stepsReached: [],
      createdDay: this.dayIndex,
      timeline: [],
    };
    this.leads_.set(id, lead);
    return lead;
  }

  private trueYield(client: SimClient, lead: SimLead, pipe: Pipe, workflow: Workflow, slotChoice: Record<string, string>): number {
    const t = this.world.truth;
    let y = t.pipes.find((p) => p.pipeId === pipe.id)?.baseYield ?? 0;
    y *= t.workflows[workflow.id] ?? 1;
    for (const id of Object.values(slotChoice)) y *= t.slotOptions[id] ?? 1;
    for (const s of t.segments) if (lead.attributes[s.attribute] === s.value) y *= s.multiplier;
    y *= t.clients[client.brand.id] ?? 1;
    return Math.min(0.95, Math.max(0, y));
  }

  private runFor(day: number, client: SimClient, pipe: Pipe, workflow: Workflow, slotChoice: Record<string, string>, audienceId: string | null): LedgerRun {
    const key = [day, client.campaign.id, pipe.id, workflow.id, JSON.stringify(slotChoice), audienceId ?? ""].join("|");
    let g = this.runIndex.get(key);
    if (!g) {
      const target = this.catalogue.step(pipe.to)?.leadState?.state ?? pipe.to;
      const run: LedgerRun = {
        id: `run:${++this.runCounter}`,
        pipeId: pipe.id,
        target,
        day,
        spendCents: 0,
        consumed: [],
        inputs: 0,
        campaignId: client.campaign.id,
        workflowId: workflow.id,
        slotChoice: { ...slotChoice },
        audienceId,
      };
      this.runs.push(run);
      this.runById.set(run.id, run);
      g = { run };
      this.runIndex.set(key, g);
    }
    return g.run;
  }

  private trial(day: number, client: SimClient, lead: SimLead, pipe: Pipe, workflow: Workflow, slotChoice: Record<string, string>, audience: Audience | null, costCents: number, snap: DaySnapshot): void {
    const run = this.runFor(day, client, pipe, workflow, slotChoice, audience?.id ?? null);
    run.spendCents += costCents;
    run.inputs = (run.inputs ?? 0) + 1;
    const input = pipe.from === START ? undefined : lead.occurrenceByStep[pipe.from];
    // The pipe's to step, read as a lead state when it is one (what reporters attest).
    const toOutcome = this.catalogue.step(pipe.to)?.leadState?.state ?? pipe.to;
    if (input) run.consumed.push(input);
    lead.timeline.push({ day, kind: "trial", pipeId: pipe.id, runId: run.id, workflowId: workflow.id, slotChoice: { ...slotChoice } });
    this.spent.set(client.campaign.id, (this.spent.get(client.campaign.id) ?? 0) + costCents);
    snap.spendCents[client.campaign.id] = (snap.spendCents[client.campaign.id] ?? 0) + costCents;
    const byWf = (snap.spendByWorkflow[pipe.id] ??= {});
    byWf[workflow.id] = (byWf[workflow.id] ?? 0) + costCents;

    const keys = [lk(pipe.id, PIPE_NODE, "*", client.brand.id), lk(pipe.id, "workflow", workflow.id, client.brand.id)];
    for (const [slot, id] of Object.entries(slotChoice)) keys.push(lk(pipe.id, `slot:${slot}`, id, client.brand.id));
    if (audience) keys.push(lk(pipe.id, "audience", audience.id, client.brand.id));
    for (const k of keys) this.bump(k, day, "trials");
    this.cohorts.get(keys[0]!)!.get(day)!.spend += costCents / 100;

    const success = this.rng.bernoulli(this.trueYield(client, lead, pipe, workflow, slotChoice));
    let segmentRecord: SegmentRecordEntry | null = null;
    if (audience) {
      segmentRecord = { record: { attributes: lead.attributes, success: false, stratum: `${client.brand.id}|month-${Math.floor(day / 30)}` }, day };
      const list = this.segmentRecords.get(client.campaign.id) ?? [];
      list.push(segmentRecord);
      this.segmentRecords.set(client.campaign.id, list);
    }
    if (success) {
      const truth = this.world.truth.pipes.find((p) => p.pipeId === pipe.id);
      const delay = truth ? this.sampleDelay(truth) : 0;
      this.pending.push({ day: day + delay, leadId: lead.id, runId: run.id, step: pipe.to, learningKeys: keys, trialDay: day, segmentRecord });
    } else {
      for (const r of this.world.reporters ?? []) {
        if (r.outcomes.includes(toOutcome) && this.rng.bernoulli(r.spuriousRate))
          this.evidence.push({ reporterId: r.reporter.id, clientId: client.brand.id, subject: lead.id, outcome: toOutcome, day: day + 1 });
      }
    }
  }

  private runIndexById(runId: string): LedgerRun | undefined {
    return this.runById.get(runId);
  }

  private sampleDelay(t: PipeTruth): number {
    if (t.delayMeanDays <= 0) return 0;
    const q = 1 / (1 + t.delayMeanDays);
    const u = 1 - this.rng.next();
    return Math.min(t.maxDelayDays, Math.floor(Math.log(u) / Math.log(1 - q)));
  }

  private bump(key: string, day: number, field: "trials" | "successes"): void {
    let m = this.cohorts.get(key);
    if (!m) this.cohorts.set(key, (m = new Map()));
    const c = m.get(day) ?? { trials: 0, successes: 0, spend: 0 };
    c[field] += 1;
    m.set(day, c);
  }

  private deliverArrivals(day: number, snap: DaySnapshot): void {
    const due = this.pending.filter((p) => p.day <= day);
    if (due.length === 0) return;
    const rest = this.pending.filter((p) => p.day > day);
    this.pending.length = 0;
    this.pending.push(...rest);
    for (const p of due) {
      const lead = this.leads_.get(p.leadId)!;
      const client = this.clientOfCampaign.get(lead.campaignId)!;
      for (const k of p.learningKeys) this.bump(k, p.trialDay, "successes");
      if (p.segmentRecord) p.segmentRecord.record = { ...p.segmentRecord.record, success: true };
      if (lead.stepsReached.includes(p.step)) continue;
      lead.stepsReached.push(p.step);
      const event: LeadEvent = { day, kind: "outcome", pipeId: this.runIndexById(p.runId)?.pipeId ?? "", runId: p.runId, step: p.step, occurrenceId: null };
      lead.timeline.push(event);

      const state = this.catalogue.step(p.step)?.leadState ?? null;
      if (this.advance(lead, p.step)) {
        // A new lead state (or a new object step): one occurrence, paid by the run.
        const occ: LedgerOccurrence = { id: `occ:${++this.occCounter}`, outcome: state?.state ?? p.step, subject: lead.id, runId: p.runId, day };
        this.occurrences.push(occ);
        lead.occurrenceByStep[p.step] = occ.id;
        event.occurrenceId = occ.id;
        if (state) lead.stateOccurrence[state.leadTrack] = occ.id;
        snap.outcomes[occ.outcome] = (snap.outcomes[occ.outcome] ?? 0) + 1;
        for (const r of this.world.reporters ?? []) {
          if (r.outcomes.includes(occ.outcome) && this.rng.bernoulli(r.recall))
            this.evidence.push({ reporterId: r.reporter.id, clientId: client.brand.id, subject: lead.id, outcome: occ.outcome, day });
        }
      } else if (state) {
        // Same state again on its lead track: a by-product, no new occurrence.
        const current = lead.stateOccurrence[state.leadTrack];
        if (current) lead.occurrenceByStep[p.step] = current;
      }
      if (p.step === client.campaign.target) {
        snap.valueRealized += this.valueOf(client);
        continue;
      }
      const q = this.queues.get(lead.campaignId) ?? [];
      q.push({ leadId: lead.id, step: p.step });
      this.queues.set(lead.campaignId, q);
    }
  }

  /** Move a lead forward; true when it reaches a new state on its lead track (or a new object step). */
  private advance(lead: SimLead, step: StepKey): boolean {
    const state = this.catalogue.step(step)?.leadState;
    if (!state) return true;
    const current = lead.states[state.leadTrack] ?? 0;
    if (state.rank <= current) return false;
    lead.states[state.leadTrack] = state.rank;
    return true;
  }

  // ---- segment discovery -----------------------------------------------------

  private discover(day: number, client: SimClient): void {
    const entry = this.funnelOf.get(client.campaign.id)?.[0];
    const pipe = entry ? this.catalogue.pipe(this.catalogue.play(entry)!.pipeId) : undefined;
    const matureAge = pipe ? Math.max(pipe.maturity.durationDays, 1) : 1;
    const records = (this.segmentRecords.get(client.campaign.id) ?? []).filter((r) => day - r.day >= matureAge).map((r) => r.record);
    if (records.length === 0) return;
    const result = discoverSegments(records, { maxDepth: 2 });
    const mine = this.audiences.filter((a) => a.brandId === client.brand.id);
    for (const w of result.winners) {
      const rule = mergeRules(mine[0]?.rule ?? {}, w.rule);
      const key = JSON.stringify(rule);
      if (mine.some((a) => JSON.stringify(a.rule) === key)) continue;
      const audience: Audience = {
        id: `${client.brand.id}:audience:${mine.length + 1}`,
        brandId: client.brand.id,
        name: describeRule(w.rule),
        description: `Found by the data on day ${day}: ${(rate(w.split.inside) * 100).toFixed(1)}% vs ${(rate(w.split.outside) * 100).toFixed(1)}% for the rest.`,
        rule,
        source: "discovered",
        exclusions: [],
      };
      this.audiences.push(audience);
      mine.push(audience);
      this.findings.push({ day, campaignId: client.campaign.id, kind: "winner", finding: w });
    }
    for (const l of result.losers) {
      const key = JSON.stringify(l.rule);
      let added = false;
      for (const a of mine) {
        if (a.exclusions.some((x) => JSON.stringify(x) === key)) continue;
        a.exclusions.push(l.rule);
        added = true;
      }
      if (added) this.findings.push({ day, campaignId: client.campaign.id, kind: "loser", finding: l });
    }
  }
}

/** Run a world for a number of days and return everything that happened. */
export function simulate(world: WorldSpec, days: number): SimulationResult {
  const s = new SimulationSession(world);
  s.run(days);
  return s.result();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function lk(pipeId: string, node: string, optionId: string, brandId: string): string {
  return `${pipeId}\u0000${node}\u0000${optionId}\u0000${brandId}`;
}

function sumCounts(list: readonly Counts[]): Counts {
  return list.reduce((s, c) => ({ successes: s.successes + c.successes, trials: s.trials + c.trials }), { successes: 0, trials: 0 });
}

function rate(c: Counts): number {
  return c.trials > 0 ? c.successes / c.trials : 0;
}

function meanScoreOf(o: ChoiceOption): number {
  const leg = o.legs[0]!;
  return (betaMean(leg.posterior) * o.value) / Math.max(leg.costPerTrial, 1e-9);
}

function mergeRules(a: SegmentRule, b: SegmentRule): SegmentRule {
  const out: SegmentRule = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = out[k] ? out[k]!.filter((x) => v.includes(x)) : [...v];
  return out;
}

function describeRule(rule: SegmentRule): string {
  return Object.entries(rule)
    .map(([k, v]) => `${k}: ${v.join(" or ")}`)
    .join(", ");
}
