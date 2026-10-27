/**
 * A factory at work on a simulated world, tick by tick.
 *
 * Each outcome has one Engine (it makes the outcome: its scripts compete) and
 * one Provider (it serves the outcome: the stock, else an order to the
 * Engine). A Campaign fixes its Target, its start, its budget and a brief; at
 * every tick its Plan is recomputed from the Rating. A proactive Campaign
 * pulls on its Target: from the Target down, each needed outcome is served by
 * its Provider, else made by the best script of its Engine. A reactive
 * Campaign pushes each Unit of its start outcome that lands up toward the
 * Target. Scripts are code: they call `get(outcome)` on the Providers they
 * need, and a call to a piece still being made makes the run wait and run
 * again once it landed. Every Run performs one script and lands one Unit or
 * none, after its delay. Each Unit carries its traceability (the choices that
 * led to it), and when the next milestone lands every choice on its
 * traceability is credited. Deterministic: one seed, one history.
 */

import { OURS, PERFORMED_BY, START, defaultStrategyId, isOurs, type Catalogue, type OutcomeId, type Script, type Strategy } from "./catalogue";
import { chainCostPerTarget, costForwardLine, targetBreakdown, valueBackwardLine } from "./calculations";
import { EvidenceBook, SEP, bumpCell, cohortCountsOf, cohortEstimateOf, type Cell, type CellStore } from "./evidence";
import { buildLedger, type LedgerReport, type LedgerRun, type LedgerUnit } from "./ledger";
import { prioritize, type PricedCandidate } from "./prioritizer";
import { measureReliability, type Attestation, type ProducerReliability } from "./reliability";
import { createRng, type Rng } from "./rng";
import { Waiting, type ScriptCode, type ScriptContext, type ScriptResult, type UnitView, type Vendor, type VendorAnswer } from "./script";
import { studySplits, type SplitRecord, type SplitStudy } from "./splits";
import { betaMean, betaVariance } from "./stats";
import { StorageHouse, type StorageReport } from "./storage";
import { describeCondition, meetsAll, type Condition, type TacticValue } from "./tactics";
import { covers, personOf, segmentMultiplier, type Campaign, type Person, type ScriptTruth, type WorldClient, type WorldSpec } from "./world";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One Unit: one physical piece of an outcome, about one subject, produced by one Run. */
export interface Unit extends LedgerUnit {
  brandId: string;
  campaignId: string | null;
  /** Who performed the script that made it (its "Performed by"). */
  performedBy: string;
  scriptId: string | null;
  /** The Units it consumed, by Material. */
  materials: Record<OutcomeId, string>;
  /** Traceability: the choices that led to it (decision ids), its own included. */
  trace: number[];
  content?: Record<string, unknown>;
  /** Brand Units (an ICP, a template): their dynasty, version and text. */
  dynasty?: string;
  version?: number;
  parentDynasty?: string;
  name?: string;
  text?: string;
  conditions?: Condition[];
}

/** One choice: at a point (consuming Engine x Material), for a subject, the candidate picked. */
export interface Decision {
  id: number;
  point: string;
  candidate: string;
  campaignId: string;
  brandId: string;
  /** The milestone this decision exists for: the next one above it toward the Target. */
  milestone: OutcomeId;
  orderId: number;
  day: number;
  credited: boolean;
}

/** One Run: one script executed, one Unit or none. */
export interface Run extends LedgerRun {
  performedBy: string;
  scriptId?: string;
  subjects: number;
}

export interface ChoiceRecord {
  day: number;
  campaignId: string;
  point: string;
  candidates: { id: string; meanScore: number; picks: number }[];
  chosenId: string;
  bestId: string;
}

export interface DaySnapshot {
  day: number;
  /** Our spend per campaign, cents. */
  spendCents: Record<string, number>;
  /** Access cost paid to other parties per campaign, cents. */
  otherCents: Record<string, number>;
  /** New milestones reached per campaign per outcome (first time per subject). */
  outcomes: Record<string, Record<OutcomeId, number>>;
  /** Value of Target Units reached today per campaign, dollars, subjects we created. */
  valueOurs: Record<string, number>;
  /** Same, subjects another party brought (counted, never in our return). */
  valueOther: Record<string, number>;
  /** Orders a campaign opened today. */
  attempts: Record<string, number>;
  /** Units pushed into reactive campaigns today. */
  pushes: number;
}

export interface PushRecord {
  day: number;
  campaignId: string;
  unitId: string;
  subject: string;
}

export interface Proposal {
  day: number;
  kind: "audience" | "strategy";
  brandId: string | null;
  campaignId: string | null;
  point: string | null;
  conditions: Condition[];
  text: string;
  createdId: string;
  study: SplitStudy;
}

/** Reaching one milestone of a campaign's Routing from the one before, as the decisions read it. */
export interface MilestoneEstimate {
  from: OutcomeId;
  to: OutcomeId;
  attempts: number;
  reached: number;
  yieldRate: number | null;
  costPerAttempt: number | null;
  label: "expected" | "measured";
}

export interface CampaignEconomics {
  campaignId: string;
  spendCents: number;
  valueOurs: number;
  valueOther: number;
  targetsOurs: number;
  measured: { value: number | null; low: number | null; high: number | null; targets: number; spendCents: number; cutoffDay: number };
  expected: { value: number | null; low: number | null; high: number | null };
  milestones: MilestoneEstimate[];
  targetValue: number;
  valueLabel: "stated" | "expected";
}

/**
 * A node of a Plan: an outcome, the script its Engine would run now (the
 * Rating's best by mean value per dollar, its own choices at their best, among
 * the scripts the brief keeps),
 * and the Plan of each outcome that script calls. A leaf is served by its
 * Provider (a Unit of the brand in the stock, the start Unit, the Rating).
 */
export interface PlanNode {
  outcome: OutcomeId;
  scriptId: string | null;
  /** Scripts that compete there. */
  candidates: number;
  materials: PlanNode[];
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** An order a campaign opened: the production it orders, for one subject, until its Target lands, or fails. */
interface Order {
  id: number;
  campaign: Campaign;
  client: WorldClient;
  /** START (made from the market) or the outcome of the Unit it was pushed. */
  from: OutcomeId;
  subject: string | null;
  person: Person | null;
  recontact: boolean;
  startUnit: string | null;
  choices: Map<string, string>;
  decisionAt: Map<string, number>;
  /** Units received, per Material of a run (several when a script calls `get` again). */
  got: Map<string, string[]>;
  pending: Set<string>;
  decisions: number[];
  startDay: number;
  status: "open" | "done" | "failed";
  spentCents: number;
  objects: Record<OutcomeId, string>;
  served: string[];
  wakeTick: number;
  /** Milestones it started working toward (a run happened under them), and those reached. */
  entered: Set<OutcomeId>;
  /** The milestone each run key works toward. */
  milestoneOf: Map<string, OutcomeId>;
  /** Milestones this order's subject was at or reached during the order. */
  passed: Set<OutcomeId>;
  /** Its subject was served from the stock at a milestone another campaign or party reached: not made from the start. */
  fromStock: boolean;
  /** Why it failed, when it did. */
  failReason?: string;
}

interface PendingLanding {
  tick: number;
  order: Order;
  key: string;
  unit: Unit;
  final: boolean;
  flight: string;
}

/** Days from a choice to its milestone: the mean, and the part of it that is certain (one tick per Engine). */
interface Rem {
  mean: number;
  fixed: number;
}

const NO_REM: Rem = { mean: 0, fixed: 0 };
const addRem = (a: Rem, b: Rem): Rem => ({ mean: a.mean + b.mean, fixed: a.fixed + b.fixed });

type Obtained = { kind: "ok"; unit: string } | { kind: "wait" } | { kind: "fail"; reason: string } | { kind: "blocked" };

/** Signals a run's code never sees: they stop it and tell the factory why. */
class Blocked extends Error {}
class Failed extends Error {}
class Ready extends Error {}

export function pointKey(consumer: string, material: OutcomeId): string {
  return `${consumer}|${material}`;
}

/** The consumer of a campaign's Target: the campaign itself. */
export const CAMPAIGN = "campaign";

/** The tactic a Unit carries from the ledger: its age in days. */
export const UNIT_AGE = "age_days";

/** Mean days a run takes to land, counting the tick it runs in. */
export function tickDelay(delayMeanDays: number, ticksPerDay = 1): number {
  return delayMeanDays + 1 / ticksPerDay / (1 + delayMeanDays);
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export class SimulationSession {
  readonly catalogue: Catalogue;
  readonly world: WorldSpec;
  private readonly rng: Rng;
  private dayIndex = 0;
  private readonly storage = new StorageHouse();

  readonly runs: Run[] = [];
  /** The ledger's common stock: every Unit, from every producer. */
  readonly units: Unit[] = [];
  readonly decisions: Decision[] = [];
  readonly choices: ChoiceRecord[] = [];
  readonly days: DaySnapshot[] = [];
  readonly pushes: PushRecord[] = [];
  readonly proposals: Proposal[] = [];
  readonly attestations: Attestation[] = [];

  private readonly unitById = new Map<string, Unit>();
  private readonly orders: Order[] = [];
  private readonly pendings: PendingLanding[] = [];
  private readonly open = new Map<string, Order[]>();
  /** The stock by subject and outcome, oldest first. */
  private readonly bySubject = new Map<string, Unit[]>();
  /** Lead Units by brand and outcome, in landing order. */
  private readonly byBrand = new Map<string, Unit[]>();
  private readonly stockRead = new Map<string, number>();
  private readonly brandUnits = new Map<string, Unit[]>();
  private readonly inFlight = new Set<string>();
  /** Milestones and lead outcomes reached: subject -> outcome -> first day. */
  private readonly reached = new Map<string, Map<OutcomeId, number>>();
  private readonly rawPerson = new Map<string, number>();
  private readonly rootParty = new Map<string, string>();
  private readonly enrolled = new Map<string, Set<string>>();
  private readonly valueCredited = new Set<string>();
  private readonly truePositive = new Map<string, number>();
  /** The campaign whose run made each true fact: a reference's later report is that campaign's. */
  private readonly factCause = new Map<string, { campaignId: string }>();
  private readonly persons = new Map<string, Person>();
  private readonly evidence: EvidenceBook;
  private readonly blind: EvidenceBook;
  /** Per campaign and milestone: orders that worked toward it, reached it, failed, and what they spent. */
  private readonly milestoneCohorts: CellStore = new Map();
  private readonly picks = new Map<string, Map<string, number[]>>();
  private readonly spent = new Map<string, number>();
  private readonly budgetLeft = new Map<string, number>();
  private readonly subjectsByCampaign = new Map<string, { entryDay: number; spendCents: number; value: number; fromStock: boolean }>();
  private readonly webhookCalls: { tick: number; scriptId: string; about: string }[] = [];
  private tickIndex = 0;
  private readonly spentToday = new Map<string, number>();
  /** Runs today per script, and per campaign and Engine (capacity, caps). */
  private readonly runsToday = new Map<string, number>();
  private readonly brandIds: string[];
  private ledgerCache: { day: number; runs: number; units: number; report: LedgerReport } | null = null;
  private unitCounter = 0;
  private runCounter = 0;
  private rawCounter = 0;
  private today: DaySnapshot | null = null;
  private dayPicks = new Map<string, Map<string, number>>();
  private readonly dayPicksAll = new Map<string, Set<string>>();
  private readonly madePerDay = new Map<string, number[]>();
  private readonly plans = new Map<string, PlanNode | null>();
  private readonly routingsUsed = new Map<string, Map<string, number>[]>();
  /** What each script's runs consumed: the Materials the ledger measured. */
  private readonly measured = new Map<string, Set<OutcomeId>>();
  private readonly decisionObject = new Map<number, string>();
  private readonly unitTruth = new Map<string, number>();
  private readonly orderOf = new Map<string, Order>();
  private readonly milestoneValueCache = new Map<string, number>();
  private milestoneValueDay = -1;
  private readonly parentDynasty = new Map<string, string>();
  private readonly pickChanceCache = new Map<string, number>();
  private readonly feasibleCache = new Map<string, boolean>();

  constructor(world: WorldSpec) {
    this.world = world;
    this.catalogue = world.catalogue;
    this.rng = createRng(world.seed);
    this.brandIds = [...new Set(world.clients.map((c) => c.brand.id))];
    const ctx = {
      catalogue: this.catalogue,
      brandIds: () => this.brandIds,
      groupOf: (b: string) => this.groupOf(b),
      parentOf: (o: string) => this.parentOf(o),
      ...(world.settings.memoryHalfLifeDays !== undefined ? { memoryHalfLifeDays: world.settings.memoryHalfLifeDays } : {}),
    };
    this.evidence = new EvidenceBook(ctx);
    this.blind = new EvidenceBook(ctx);
    for (const c of world.clients) this.register(c);
  }

  get day(): number {
    return this.dayIndex;
  }

  get ticksPerDay(): number {
    return Math.max(1, Math.round(this.world.settings.ticksPerDay ?? 1));
  }

  get clients(): readonly WorldClient[] {
    return this.world.clients;
  }

  campaigns(): Campaign[] {
    return this.world.clients.flatMap((c) => c.campaigns);
  }

  campaign(id: string): Campaign | undefined {
    return this.campaigns().find((c) => c.id === id);
  }

  clientOf(campaignId: string): WorldClient | undefined {
    return this.world.clients.find((c) => c.campaigns.some((x) => x.id === campaignId));
  }

  storageReport(engine: OutcomeId): StorageReport {
    return this.storage.report(engine);
  }

  unit(id: string): Unit | undefined {
    return this.unitById.get(id);
  }

  person(id: string): Person | undefined {
    return this.persons.get(id);
  }

  reachedBy(subject: string): ReadonlyMap<OutcomeId, number> {
    return this.reached.get(subject) ?? new Map();
  }

  /** Who brought a subject in: "Ours", or another party (the organic market). */
  rootOf(subject: string): string | undefined {
    return this.rootParty.get(subject);
  }

  campaignsOfSubject(subject: string): string[] {
    return [...(this.enrolled.get(subject) ?? [])];
  }

  spentCents(campaignId: string): number {
    return this.spent.get(campaignId) ?? 0;
  }

  isProactive(campaign: Campaign): boolean {
    return campaign.start === START;
  }

  /** Who performs a script: its "Performed by". */
  performerOf(script: Script): string {
    return String(script.tactics[PERFORMED_BY] ?? OURS);
  }

  // ---- setup -----------------------------------------------------------------

  private register(c: WorldClient): void {
    if (!this.brandIds.includes(c.brand.id)) this.brandIds.push(c.brand.id);
    const setupId = `run:setup:${c.brand.id}`;
    if (this.world.settings.setupCentsPerBrand > 0 && !this.runs.some((r) => r.id === setupId)) {
      this.runs.push({ id: setupId, engine: null, target: null, day: this.dayIndex, spendCents: this.world.settings.setupCentsPerBrand, consumed: [], support: { kind: "brand_setup", reason: "first setup of the brand" }, performedBy: OURS, subjects: 0, campaignId: c.campaigns[0]?.id });
    }
    for (const s of c.seeds) {
      if (this.units.some((o) => o.brandId === c.brand.id && o.dynasty === s.dynasty && o.version === s.version)) continue;
      const script = this.catalogue.script(s.scriptId);
      if (!script) throw new Error(`seed Unit names unknown script "${s.scriptId}"`);
      const cost = Math.round(this.truthOf(script, null).costCents);
      const run = this.newRun(this.dayIndex, c.campaigns[0]?.id ?? null, script);
      run.spendCents += cost;
      if (isOurs(script) && c.campaigns[0]) this.spent.set(c.campaigns[0].id, (this.spent.get(c.campaigns[0].id) ?? 0) + cost);
      const u = this.makeUnit(run, s.outcome, `${c.brand.id}:${s.dynasty}:v${s.version}`, c.brand.id, null, {}, []);
      Object.assign(u, { dynasty: s.dynasty, version: s.version, name: s.name, text: s.text, content: { text: s.text }, ...(s.parentDynasty ? { parentDynasty: s.parentDynasty } : {}), ...(s.conditions ? { conditions: s.conditions } : {}) });
      this.addUnit(u);
    }
    for (const camp of c.campaigns) {
      this.spent.set(camp.id, this.spent.get(camp.id) ?? 0);
      this.judgeBrief(camp);
    }
  }

  /**
   * What a judge reads in a campaign's brief (in the simulator, the hidden
   * truth; in a factory, Jev): per Engine, the strategy it keeps or none, the
   * daily caps, and the test length. Read once, stored on the campaign.
   */
  private judgeBrief(c: Campaign): void {
    const read = this.world.truth.briefs?.[c.id];
    if (!read) return;
    c.verdicts ??= { ...(read.verdicts ?? {}) };
    c.caps ??= { ...(read.caps ?? {}) };
    if (read.days !== undefined && c.endDay === undefined) c.endDay = this.dayIndex + read.days;
  }

  addClient(client: WorldClient): void {
    for (const c of client.campaigns) if (this.campaign(c.id)) throw new Error(`campaign "${c.id}" already exists`);
    const known = this.world.clients.find((c) => c.brand.id === client.brand.id);
    if (known) {
      known.campaigns.push(...client.campaigns);
      for (const s of client.seeds) known.seeds.push(s);
      this.register(known);
    } else {
      this.world.clients.push(client);
      this.register(client);
    }
  }

  addObjectVersion(brandId: string, outcome: OutcomeId, dynasty: string, change: { text: string; name?: string; conditions?: Condition[] }): Unit {
    const head = this.objectHead(brandId, outcome, dynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${dynasty}" for ${brandId}`);
    return this.newObject(head, { dynasty, version: (head.version ?? 1) + 1, ...change });
  }

  forkObject(brandId: string, outcome: OutcomeId, parentDynasty: string, change: { dynasty: string; text: string; name?: string; conditions?: Condition[] }): Unit {
    const head = this.objectHead(brandId, outcome, parentDynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${parentDynasty}" for ${brandId}`);
    if (this.objectHead(brandId, outcome, change.dynasty)) throw new Error(`dynasty "${change.dynasty}" already exists`);
    return this.newObject(head, { ...change, version: 1, parentDynasty });
  }

  private newObject(from: Unit, v: { dynasty: string; version: number; text: string; name?: string; conditions?: Condition[]; parentDynasty?: string }): Unit {
    const script = from.scriptId ? this.catalogue.script(from.scriptId) : undefined;
    if (!script) throw new Error("the previous version names no script");
    const run = this.newRun(this.dayIndex, from.campaignId, script);
    run.consumed.push(from.id);
    const u = this.makeUnit(run, from.outcome, `${from.brandId}:${v.dynasty}:v${v.version}`, from.brandId, from.campaignId, { [from.outcome]: from.id }, []);
    Object.assign(u, { dynasty: v.dynasty, version: v.version, name: v.name ?? from.name, text: v.text, content: { text: v.text }, ...((v.conditions ?? from.conditions) ? { conditions: v.conditions ?? from.conditions } : {}), ...(v.parentDynasty ? { parentDynasty: v.parentDynasty } : {}) });
    const r = createRng(`${this.world.seed}|edit|${u.subject}`);
    this.unitTruth.set(u.id, this.objectTruthEnd(from) * (0.85 + 0.4 * r.next()));
    this.addUnit(u);
    return u;
  }

  setCampaignStatus(campaignId: string, status: Campaign["status"]): void {
    const c = this.campaign(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    c.status = status;
  }

  setCampaignBudget(campaignId: string, dailyBudgetCents: number): void {
    const c = this.campaign(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    c.dailyBudgetCents = Math.max(0, Math.round(dailyBudgetCents));
  }

  /** Keep one strategy of an Engine for a campaign ("none": the Plan routes around that Engine). */
  setVerdict(campaignId: string, outcome: OutcomeId, strategyId: string): void {
    const c = this.campaign(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    if (strategyId !== "none" && this.catalogue.strategy(strategyId)?.outcome !== outcome) throw new Error(`strategy "${strategyId}" is not a strategy of ${outcome}`);
    c.verdicts = { ...(c.verdicts ?? {}) };
    if (strategyId === defaultStrategyId(outcome)) delete c.verdicts[outcome];
    else c.verdicts[outcome] = strategyId;
    this.feasibleCache.clear();
  }

  // ---- the tick ---------------------------------------------------------------

  step(): DaySnapshot {
    const day = this.dayIndex;
    this.evidence.newDay();
    this.blind.newDay();
    this.dayPicks = new Map();
    this.runsToday.clear();
    this.feasibleCache.clear();
    const snap: DaySnapshot = { day, spendCents: {}, otherCents: {}, outcomes: {}, valueOurs: {}, valueOther: {}, attempts: {}, pushes: 0 };
    this.today = snap;
    this.spentToday.clear();
    for (const c of this.campaigns()) if (c.endDay !== undefined && day >= c.endDay) c.status = "paused";
    const tpd = this.ticksPerDay;
    this.rate(day);
    const order = this.campaigns().filter((c) => c.status === "running");
    for (let t = 0; t < tpd; t++) {
      this.tickIndex = day * tpd + t;
      for (const c of this.campaigns()) this.budgetLeft.set(c.id, c.status === "running" ? Math.round((c.dailyBudgetCents * (t + 1)) / tpd) - (this.spentToday.get(c.id) ?? 0) : 0);
      this.deliver(day);
      this.webhooks(day, t === 0);
      for (const campaign of order) {
        this.replan(campaign, day);
        if (this.isProactive(campaign)) this.pull(campaign, day);
        else for (const o of this.openOrders(campaign)) this.advance(o, day);
      }
    }
    if (day > 0 && day % this.world.settings.splitEveryDays === 0) this.studyAndPropose(day);
    this.logChoices(day);
    for (const c of this.campaigns()) if (c.status === "running") this.routingOf(c, true);
    this.days.push(snap);
    this.today = null;
    this.dayIndex++;
    return snap;
  }

  run(days: number): DaySnapshot[] {
    const out: DaySnapshot[] = [];
    for (let i = 0; i < days; i++) out.push(this.step());
    return out;
  }

  // ---- the Plan ---------------------------------------------------------------------

  /**
   * The scripts a campaign may run at an Engine: its active heads, kept by the
   * strategy the judge read in the brief (none: no script), within their
   * capacity and the brief's daily cap today.
   */
  allowedScripts(campaign: Campaign, outcome: OutcomeId, today = true): Script[] {
    const verdict = campaign.verdicts?.[outcome];
    if (verdict === "none") return [];
    const strategy = verdict ? this.catalogue.strategy(verdict) : undefined;
    const cap = campaign.caps?.[outcome];
    if (today && cap !== undefined && (this.runsToday.get(`${campaign.id}${SEP}${outcome}`) ?? 0) >= cap) return [];
    return this.catalogue
      .scriptsOf(outcome)
      .filter((s) => !s.webhook && meetsAll(s.tactics, strategy?.conditions ?? []))
      .filter((s) => !today || s.capacity?.perDay === undefined || (this.runsToday.get(s.id) ?? 0) < s.capacity.perDay);
  }

  /** Runs a script made today (for its capacity), or a campaign at an Engine (for the brief's cap). */
  runsTodayOf(scriptId: string, campaignId?: string): number {
    return this.runsToday.get(campaignId ? `${campaignId}${SEP}${scriptId}` : scriptId) ?? 0;
  }

  /** The strategy kept at an Engine for a campaign. */
  strategyOf(campaign: Campaign, outcome: OutcomeId): Strategy | null {
    const id = campaign.verdicts?.[outcome];
    if (id === "none") return null;
    return (id ? this.catalogue.strategy(id) : null) ?? this.catalogue.strategy(defaultStrategyId(outcome)) ?? null;
  }

  /** The Materials of a script: measured on its runs once it has run, else what the judge read in its code. */
  materialsOf(script: Script): OutcomeId[] {
    const m = this.measured.get(script.id);
    return m && m.size > 0 ? [...m] : script.materials;
  }

  private subjectMaterialOf(script: Script): OutcomeId | null {
    for (const m of this.materialsOf(script)) if (this.catalogue.outcome(m)?.subject === "lead") return m;
    return null;
  }

  private creates(script: Script): boolean {
    return this.subjectMaterialOf(script) === null && this.catalogue.outcome(script.outcome)?.subject === "lead";
  }

  /**
   * Can a script make its Unit for an order started at `from`: its subject
   * comes from `from` itself, from a script it can be made by (down to Start
   * for a script creating subjects), or from a milestone (served from the stock).
   */
  feasible(campaign: Campaign, script: Script, from: OutcomeId, seen = new Set<string>(), today = true): boolean {
    const k = `${campaign.id}${SEP}${script.id}${SEP}${from}${SEP}${today}`;
    const hit = this.feasibleCache.get(k);
    if (hit !== undefined) return hit;
    if (seen.has(script.id)) return false;
    seen.add(script.id);
    const m = this.subjectMaterialOf(script);
    let v: boolean;
    if (!m) v = from === START && this.creates(script);
    else if (m === from) v = true;
    else v = this.allowedScripts(campaign, m, today).some((s) => this.feasible(campaign, s, from, new Set(seen), today));
    this.feasibleCache.set(k, v);
    return v;
  }

  /**
   * Recompute a campaign's Plan for this tick: from the Target down, each
   * outcome's Engine and the script the Rating ranks best now (mean value per
   * dollar), and the Plan of each outcome that script calls.
   */
  private replan(campaign: Campaign, day: number): void {
    this.plans.set(campaign.id, this.planNode(campaign, CAMPAIGN, campaign.target, day, new Set()));
    const line = this.routingOfPlan(campaign);
    if (line.length === 0) return;
    let days = this.routingsUsed.get(campaign.id);
    if (!days) this.routingsUsed.set(campaign.id, (days = []));
    const m = (days[day] ??= new Map<string, number>());
    const key = line.join(">");
    m.set(key, (m.get(key) ?? 0) + 1);
  }

  private planNode(campaign: Campaign, consumer: string, o: OutcomeId, day: number, seen: Set<OutcomeId>): PlanNode {
    const out = this.catalogue.outcome(o);
    if (o === campaign.start || seen.has(o) || out?.contentType === "rating" || out?.subject === "brand") return { outcome: o, scriptId: null, candidates: out?.subject === "brand" ? this.objectDynasties(campaign.brandId, o).length : 0, materials: [] };
    // The Plan is what the factory runs when every script has its capacity: today's limits only route one tick.
    const scripts = this.allowedScripts(campaign, o, false).filter((s) => out?.subject !== "lead" || this.feasible(campaign, s, campaign.start, new Set(), false));
    if (scripts.length === 0) return { outcome: o, scriptId: null, candidates: 0, materials: [] };
    const point = pointKey(consumer, o);
    const dynasties = scripts.map((s) => s.dynasty);
    let best = scripts[0]!;
    if (scripts.length > 1) {
      let bestScore = -Infinity;
      const book = this.bookOf(campaign.brandId);
      for (const s of scripts) {
        const b = book.belief(point, s.dynasty, dynasties, campaign.brandId, day);
        const score = (betaMean(b.posterior) * this.uplift(book, point, s.dynasty, campaign.brandId, day)) / Math.max(b.cost.mean, 1e-6);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }
    const next = new Set(seen).add(o);
    return { outcome: o, scriptId: best.id, candidates: scripts.length, materials: this.materialsOf(best).map((m) => this.planNode(campaign, o, m, day, next)) };
  }

  /** A campaign's Plan for this tick (null before its first tick). */
  planOf(campaign: Campaign): PlanNode | null {
    if (!this.plans.has(campaign.id)) this.plans.set(campaign.id, this.planNode(campaign, CAMPAIGN, campaign.target, this.dayIndex, new Set()));
    return this.plans.get(campaign.id) ?? null;
  }

  /** The milestones the Plan passes through, along the chain that carries the subject, up to the Target. */
  private routingOfPlan(campaign: Campaign): OutcomeId[] {
    const line: OutcomeId[] = [];
    let node: PlanNode | undefined = this.planOf(campaign) ?? undefined;
    while (node && node.outcome !== campaign.start) {
      if (this.catalogue.isMilestone(node.outcome) || node.outcome === campaign.target) line.unshift(node.outcome);
      node = node.materials.find((m) => this.catalogue.outcome(m.outcome)?.subject === "lead");
    }
    return line;
  }

  /**
   * The Routing of a campaign (a view): the milestones its Plan went through
   * most over the last 7 days, start excluded, Target last. `name` stores its
   * name (on first sight, kept).
   */
  routingOf(campaign: Campaign, name = false) {
    const days = this.routingsUsed.get(campaign.id) ?? [];
    const n = new Map<string, number>();
    for (let d = Math.max(0, this.dayIndex - 7); d <= this.dayIndex; d++) for (const [k, v] of days[d] ?? []) n.set(k, (n.get(k) ?? 0) + v);
    let best: string | null = null;
    for (const [k, v] of n) if (best === null || v > n.get(best)! || (v === n.get(best)! && k < best)) best = k;
    const line = best ? best.split(">") : this.routingOfPlan(campaign);
    return name ? this.catalogue.nameRouting(campaign.start, line) : this.catalogue.peekRouting(campaign.start, line);
  }

  // ---- pull and push ----------------------------------------------------------------

  /**
   * A proactive campaign pulls on its Target: open orders first, then new
   * orders, each served from the stock when a Unit waits at a milestone below
   * the Target, else made down to the market, with the budget left.
   */
  private pull(campaign: Campaign, day: number): void {
    for (const o of this.openOrders(campaign)) if (this.advance(o, day) === "blocked") return;
    for (let guard = 0; guard < 20_000; guard++) {
      if ((this.budgetLeft.get(campaign.id) ?? 0) <= 0) break;
      const o = this.newOrder(campaign, START, null, day);
      const r = this.advance(o, day);
      // Out of budget: the order stays open and moves first at the next tick.
      if (r === "blocked") break;
      // Nothing could start (a script out of capacity, a cap reached, a piece in flight): the order is undone, the next tick asks again.
      if (o.status === "open" && !o.subject && o.entered.size === 0) {
        this.undo(o);
        break;
      }
      if (!o.subject && o.status !== "open" && o.entered.size === 0) break;
    }
  }

  /** Open orders of a campaign that can move now, oldest first. */
  private openOrders(campaign: Campaign): Order[] {
    const all = (this.open.get(campaign.id) ?? []).filter((o) => o.status === "open");
    this.open.set(campaign.id, all);
    return all.filter((o) => o.pending.size === 0 && o.wakeTick <= this.tickIndex);
  }

  private volumeReached(campaign: Campaign, day: number): boolean {
    const v = campaign.volume;
    if (!v) return false;
    const made = this.madePerDay.get(campaign.id) ?? [];
    let n = 0;
    for (let d = Math.max(0, day - v.periodDays + 1); d <= day; d++) n += made[d] ?? 0;
    return n >= v.units;
  }

  madeFromMarket(campaignId: string): number[] {
    const made = this.madePerDay.get(campaignId) ?? [];
    return Array.from({ length: this.dayIndex }, (_, d) => made[d] ?? 0);
  }

  /** A reactive campaign's push: a Unit of its start outcome landed for its brand; an order takes it up toward the Target. */
  private push(campaign: Campaign, unit: Unit, day: number): void {
    const person = this.persons.get(unit.subject);
    if (!person || this.reached.get(person.id)?.has(campaign.target)) return;
    const prior = this.orderOf.get(`${campaign.id}${SEP}${person.id}`);
    if (prior && prior.status === "open") return;
    this.newOrder(campaign, campaign.start, person, day, unit.id);
    this.pushes.push({ day, campaignId: campaign.id, unitId: unit.id, subject: person.id });
    if (this.today) this.today.pushes++;
  }

  private newOrder(campaign: Campaign, from: OutcomeId, person: Person | null, day: number, startUnit: string | null = null): Order {
    const o: Order = {
      id: this.orders.length,
      campaign,
      client: this.clientOf(campaign.id)!,
      from,
      subject: person?.id ?? null,
      person,
      recontact: false,
      startUnit,
      choices: new Map(),
      decisionAt: new Map(),
      got: new Map(),
      pending: new Set(),
      decisions: [],
      startDay: day,
      status: "open",
      spentCents: 0,
      objects: {},
      served: [],
      wakeTick: 0,
      entered: new Set(),
      milestoneOf: new Map(),
      passed: new Set(from === START ? [] : [from]),
      fromStock: false,
    };
    this.orders.push(o);
    const list = this.open.get(campaign.id) ?? [];
    list.push(o);
    this.open.set(campaign.id, list);
    if (person) this.setPerson(o, person);
    if (this.today) this.today.attempts[campaign.id] = (this.today.attempts[campaign.id] ?? 0) + 1;
    return o;
  }

  /** Undo the last order, which ran nothing: its choices leave the evidence and the pick counts. */
  private undo(o: Order): void {
    if (this.orders[this.orders.length - 1] !== o) throw new Error("only the last order can be undone");
    for (const id of [...o.decisions].sort((a, b) => b - a)) {
      if (this.decisions.length - 1 !== id) throw new Error("an undone order's choices are the last ones");
      const d = this.decisions.pop()!;
      this.decisionObject.delete(id);
      this.evidence.bump(d.point, d.candidate, d.brandId, d.day, "t", -1);
      const pk = `${d.point}${SEP}${d.campaignId}`;
      const dp = this.dayPicks.get(pk);
      if (dp) dp.set(d.candidate, (dp.get(d.candidate) ?? 1) - 1);
      const series = this.picks.get(pk)?.get(d.candidate);
      if (series && series[d.day]) series[d.day]! -= 1;
    }
    this.orders.pop();
    const list = this.open.get(o.campaign.id) ?? [];
    if (list[list.length - 1] === o) list.pop();
    if (this.today) this.today.attempts[o.campaign.id] = (this.today.attempts[o.campaign.id] ?? 1) - 1;
  }

  /** Move an order as far as it can go now. */
  private advance(o: Order, day: number): "done" | "wait" | "fail" | "blocked" {
    if (o.status !== "open") return o.status === "done" ? "done" : "fail";
    if (o.subject && this.reached.get(o.subject)?.has(o.campaign.target)) {
      this.finish(o, "done");
      return "done";
    }
    const r = this.produce(o, CAMPAIGN, o.campaign.target, o.campaign.target, NO_REM, day);
    if (r.kind === "ok") {
      this.finish(o, "done");
      return "done";
    }
    if (r.kind === "fail") {
      o.failReason = r.reason;
      this.finish(o, "failed");
      return "fail";
    }
    return r.kind === "wait" ? "wait" : "blocked";
  }

  private finish(o: Order, status: "done" | "failed"): void {
    if (o.status !== "open") return;
    o.status = status;
    for (const d of o.decisions) {
      const dec = this.decisions[d]!;
      if (dec.credited) continue;
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "f", 1);
    }
    if (status === "failed") for (const m of o.entered) if (!(o.subject && this.reached.get(o.subject)?.has(m))) bumpCell(this.milestoneCohorts, `${o.campaign.id}${SEP}${m}`, o.startDay, "f", 1);
    o.choices.clear();
    o.got.clear();
  }

  // ---- the Engine and the Provider --------------------------------------------------

  /**
   * An Engine makes one Unit for an order: the best script (the Rating's pick
   * among those the brief keeps and that can be fed from the order's start),
   * run once every outcome its code calls is served.
   */
  private produce(o: Order, consumer: string, outcome: OutcomeId, milestone: OutcomeId, remAbove: Rem, day: number, slot = ""): Obtained {
    const point = pointKey(consumer, outcome);
    const key = `${point}${slot}`;
    const have = o.got.get(key);
    if (have?.length) return { kind: "ok", unit: have[have.length - 1]! };
    if (o.pending.has(key)) return { kind: "wait" };
    const out = this.catalogue.outcome(outcome);
    const ms = this.catalogue.isMilestone(outcome) || outcome === o.campaign.target ? outcome : milestone;
    const rem0 = ms === outcome ? NO_REM : remAbove;
    let dynasty = o.choices.get(key);
    if (!dynasty) {
      const scripts = this.allowedScripts(o.campaign, outcome, false).filter((s) => out?.subject !== "lead" || this.feasible(o.campaign, s, o.from, new Set(), false));
      if (scripts.length === 0) return { kind: "fail", reason: `no script at ${key}` };
      // Decide as late as possible: when every candidate works on the same input, that input is pulled first and the choice is made once it is here.
      const inputs = new Set(scripts.map((s) => this.subjectMaterialOf(s)));
      const shared = inputs.size === 1 ? [...inputs][0] : null;
      if (shared) {
        const r = this.get(o, scripts[0]!, shared, 0, ms, addRem(rem0, this.scriptTicks(scripts[0]!)), day);
        if (r.kind !== "ok") return r;
      }
      // Today's capacity (and the brief's daily cap) only delays: a script out of it waits for tomorrow, the others compete now.
      const today = scripts.filter((s) => this.allowedScripts(o.campaign, outcome).some((x) => x.id === s.id));
      if (today.length === 0) return this.tomorrow(o);
      const longest = scripts.map((s) => addRem(this.scriptTicks(s), this.ticksBelow(s, o))).reduce((x, y) => (y.mean > x.mean ? y : x));
      const rem = addRem(rem0, longest);
      const horizon = Math.max(...scripts.map((s) => (this.truthOf(s, null).horizonDays ?? 0) + 1)) + rem.mean * 3;
      dynasty = this.decide(o, point, today.map((s) => s.dynasty), day, rem, Math.ceil(horizon), ms, key);
      o.choices.set(key, dynasty);
    }
    const script = this.catalogue.headOf(dynasty);
    if (!script) return { kind: "fail", reason: `dynasty ${dynasty} has no active version` };
    o.milestoneOf.set(key, ms);
    return this.runCode(o, key, script, ms, addRem(rem0, this.scriptTicks(script)), outcome === o.campaign.target || this.catalogue.isMilestone(outcome), day);
  }

  /**
   * The Provider of an outcome serves one Unit to a run: the most recent one
   * this run has not received yet for its context (the subject, its company,
   * the brand, the run itself), from the stock, else made by the Engine. A
   * subject the order does not hold yet is the next one waiting at that
   * milestone that this campaign has not taken.
   */
  private get(o: Order, consumer: Script, m: OutcomeId, nth: number, milestone: OutcomeId, rem: Rem, day: number): Obtained {
    const key = `${pointKey(consumer.outcome, m)}#${nth}`;
    const have = o.got.get(key);
    if (have?.length) return { kind: "ok", unit: have[have.length - 1]! };
    if (o.pending.has(key)) return { kind: "wait" };
    const out = this.catalogue.outcome(m);
    if (!out) return { kind: "fail", reason: `unknown outcome ${m}` };
    const received = new Set(o.got.get(`${pointKey(consumer.outcome, m)}#all`) ?? []);
    const take = (id: string): Obtained => {
      o.got.set(key, [id]);
      const all = o.got.get(`${pointKey(consumer.outcome, m)}#all`) ?? [];
      all.push(id);
      o.got.set(`${pointKey(consumer.outcome, m)}#all`, all);
      return { kind: "ok", unit: id };
    };
    if (o.startUnit && m === o.from && !received.has(o.startUnit)) return take(o.startUnit);
    const brandId = o.client.brand.id;
    if (out.subject === "lead" || out.subject === "company") {
      const subject = o.person ? (out.subject === "company" ? o.person.companyId : o.person.id) : null;
      if (subject) {
        const list = this.bySubject.get(`${subject}${SEP}${m}`) ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
          const u = list[i]!;
          if (u.brandId !== brandId || received.has(u.id)) continue;
          // A lead outcome below a milestone continues this order's story: made since it began.
          if (out.subject === "lead" && !this.catalogue.isMilestone(m) && u.day < o.startDay) continue;
          // Since the order began, another campaign's work in progress is that campaign's: never served here.
          if (out.subject === "lead" && u.day >= o.startDay && u.campaignId !== null && u.campaignId !== o.campaign.id && u.id !== o.startUnit) continue;
          if (out.subject === "company") o.served.push(u.id);
          return take(u.id);
        }
        if (this.inFlight.has(`${m}${SEP}${subject}`)) return { kind: "wait" };
      } else if (this.catalogue.isMilestone(m) && m !== o.from) {
        // Most advanced first: a subject waiting at this milestone, oldest first, not taken by this campaign yet.
        const readKey = `${o.campaign.id}${SEP}${consumer.outcome}${SEP}${m}`;
        const stock = this.byBrand.get(`${brandId}${SEP}${m}`) ?? [];
        for (let i = this.stockRead.get(readKey) ?? 0; i < stock.length; i++) {
          const u = stock[i]!;
          const person = this.persons.get(u.subject);
          this.stockRead.set(readKey, i + 1);
          if (!person || this.reached.get(person.id)?.has(consumer.outcome) || this.reached.get(person.id)?.has(o.campaign.target)) continue;
          const busy = this.orderOf.get(`${o.campaign.id}${SEP}${person.id}`);
          if (busy && busy.status === "open" && busy !== o) continue;
          this.setPerson(o, person);
          o.passed.add(m);
          o.fromStock = true;
          return take(u.id);
        }
      }
      return this.made(o, consumer, m, nth, milestone, rem, day, take);
    }
    if (out.subject === "run") return this.made(o, consumer, m, nth, milestone, rem, day, take);
    // A brand Unit: chosen among the brand's dynasties in the stock (a decision), its head served; called again, a fresh one is made.
    const units = (this.brandUnits.get(`${brandId}${SEP}${m}`) ?? []).filter((u) => !received.has(u.id));
    const held: string[] = [];
    for (const u of units) {
      const c = this.candidateOf(u);
      if (!held.includes(c)) held.push(c);
    }
    if (held.length > 0) {
      const pk = pointKey(consumer.outcome, m);
      let dynasty = o.choices.get(pk);
      if (!dynasty || !held.includes(dynasty)) {
        dynasty = held.length > 1 ? this.decide(o, pk, held, day, rem, 0, milestone) : held[0]!;
        o.choices.set(pk, dynasty);
      }
      const u = this.latestOf(units.filter((x) => this.candidateOf(x) === dynasty));
      if (!u) return { kind: "fail", reason: `no Unit of ${dynasty}` };
      const dec = o.decisionAt.get(pk);
      if (dec !== undefined && this.decisions[dec]!.candidate === dynasty) this.decisionObject.set(dec, u.id);
      else o.served.push(u.id);
      o.objects[m] = dynasty;
      return take(u.id);
    }
    if (this.inFlight.has(`${m}${SEP}${brandId}`)) return { kind: "wait" };
    return this.made(o, consumer, m, nth, milestone, rem, day, take);
  }

  /** The Provider orders a piece from the Engine of its outcome (a later call of the same run orders another). */
  private made(o: Order, consumer: Script, m: OutcomeId, nth: number, milestone: OutcomeId, rem: Rem, day: number, take: (id: string) => Obtained): Obtained {
    const r = this.produce(o, consumer.outcome, m, milestone, rem, day, nth > 0 ? `#${nth}` : "");
    return r.kind === "ok" ? take(r.unit) : r;
  }

  /** Out of capacity today: the order comes back at tomorrow's first tick. */
  private tomorrow(o: Order): Obtained {
    o.wakeTick = Math.max(o.wakeTick, (this.dayIndex + 1) * this.ticksPerDay);
    return { kind: "wait" };
  }

  /** Ticks one run of a script takes (one at least), counting the tick its run-ordered Materials take to land. */
  scriptTicks(script: Script): Rem {
    const ordered = this.materialsOf(script).some((m) => this.catalogue.outcome(m)?.subject === "run") ? 1 : 0;
    const tick = 1 / this.ticksPerDay;
    return { mean: tickDelay(this.truthOf(script, null).delayMeanDays ?? 0, this.ticksPerDay) + ordered * tick, fixed: (1 + ordered) * tick };
  }

  /** Ticks before a script has its subject Material in hand, down to the order's start or a milestone. */
  ticksBelow(script: Script, o: Order | null = null, seen = new Set<string>()): Rem {
    const s = this.subjectMaterialOf(script);
    if (!s || (o && s === o.from) || this.catalogue.isMilestone(s) || seen.has(script.id)) return NO_REM;
    if (o?.person && (this.bySubject.get(`${o.person.id}${SEP}${s}`)?.length ?? 0) > 0) return NO_REM;
    seen.add(script.id);
    let most = NO_REM;
    for (const p of this.catalogue.scriptsOf(s)) {
      if (p.webhook) continue;
      const r = addRem(this.scriptTicks(p), this.ticksBelow(p, o, new Set(seen)));
      if (r.mean > most.mean) most = r;
    }
    return most;
  }

  // ---- running a script's code ---------------------------------------------------------

  /** A script's context: its subject, its Engine's storage, `get` on the Providers, the vendor. */
  private contextFor(o: Order, script: Script, milestone: OutcomeId, rem: Rem, day: number, vendor: Vendor, consumed: Record<OutcomeId, string>): ScriptContext & { wait(days: number): never } {
    const nth = new Map<OutcomeId, number>();
    const self = this;
    return {
      get subject() {
        return o.person?.id ?? o.subject;
      },
      brand: o.client.brand.id,
      day,
      tactics: script.tactics,
      storage: this.storage.forEngine(script.outcome),
      vendor,
      get(m: OutcomeId): UnitView {
        const n = nth.get(m) ?? 0;
        nth.set(m, n + 1);
        const r = self.get(o, script, m, n, milestone, rem, day);
        if (r.kind === "wait") throw new Waiting(m);
        if (r.kind === "blocked") throw new Blocked();
        if (r.kind === "fail") throw new Failed(r.reason);
        const u = self.unitById.get(r.unit)!;
        consumed[m] = u.id;
        // The subject is checked against the strategy kept for this Engine at every run: a person may have asked to stop since the order began.
        if (m === self.subjectMaterialOf(script) && o.person) {
          const cond = self.strategyOf(o.campaign, script.outcome)?.subject ?? [];
          if (cond.length > 0 && !meetsAll(o.person.values, cond, new Set(self.reached.get(o.person.id)?.keys() ?? []))) throw new Failed("excluded by the strategy kept for this Engine");
        }
        return { id: u.id, outcome: u.outcome, subject: u.subject, ageDays: day - u.day, content: u.content ?? (u.text ? { text: u.text } : {}) };
      },
      wait(days: number): never {
        o.wakeTick = self.tickIndex + Math.max(1, Math.ceil(days * self.ticksPerDay));
        throw new Waiting(script.outcome);
      },
    };
  }

  /**
   * Run a script's code for an order. A first pass with a vendor that answers
   * nothing tells whether every Material is in hand; then the budget is
   * checked; then the code runs for real, its vendor answering from the
   * hidden truth, and its Unit lands after its delay.
   */
  private runCode(o: Order, key: string, script: Script, milestone: OutcomeId, rem: Rem, final: boolean, day: number): Obtained {
    const code: ScriptCode | undefined = this.world.library[script.code];
    if (!code) return { kind: "fail", reason: `no code "${script.code}"` };
    const dry: Vendor = {
      call() {
        throw new Ready();
      },
    };
    const consumed: Record<OutcomeId, string> = {};
    const outcome = this.signal(() => code(this.contextFor(o, script, milestone, rem, day, dry, consumed)));
    if (outcome.kind !== "ready") return outcome;
    // Every Material is in hand: the run happens today if the script has capacity left, and if the budget allows it.
    if (!this.allowedScripts(o.campaign, script.outcome).some((x) => x.id === script.id)) return this.tomorrow(o);
    const truth = this.truthOf(script, key);
    const ours = isOurs(script);
    const cost = Math.max(0, Math.round(truth.costCents * (0.85 + 0.3 * this.rng.next())));
    if (ours && cost > (this.budgetLeft.get(o.campaign.id) ?? 0)) return { kind: "blocked" };
    if (o.subject === null && this.creates(script) && this.volumeReached(o.campaign, day)) return { kind: "blocked" };
    const run = this.newRun(day, o.campaign.id, script);
    run.spendCents += cost;
    this.runsToday.set(script.id, (this.runsToday.get(script.id) ?? 0) + 1);
    this.runsToday.set(`${o.campaign.id}${SEP}${script.outcome}`, (this.runsToday.get(`${o.campaign.id}${SEP}${script.outcome}`) ?? 0) + 1);
    if (!o.entered.has(milestone)) {
      o.entered.add(milestone);
      bumpCell(this.milestoneCohorts, `${o.campaign.id}${SEP}${milestone}`, o.startDay, "t", 1);
    }
    this.charge(o, milestone, cost, ours);
    // The real run: the vendor answers from the hidden truth.
    let fact: boolean | null = null;
    const consumedReal: Record<OutcomeId, string> = {};
    // The trace: this choice, the choices made at this script's Materials, and what its Materials carried.
    const traceNow = () => {
      const trace = new Set<number>();
      const own = o.decisionAt.get(key);
      if (own !== undefined) trace.add(own);
      for (const [mat, id] of Object.entries(consumedReal)) {
        const d = o.decisionAt.get(pointKey(script.outcome, mat));
        if (d !== undefined) trace.add(d);
        for (const t of this.unitById.get(id)?.trace ?? []) trace.add(t);
      }
      return trace;
    };
    const factNow = () => {
      if (fact === null) fact = this.fact(o, script, truth, traceNow(), final);
      return fact;
    };
    const vendor: Vendor = {
      call: (name: string): VendorAnswer => {
        if (name === "market.draw") return this.marketDraw(o, script, truth);
        if (name === "market.fits") return { ok: this.marketFits(o), data: {} };
        return { ok: factNow(), data: {} };
      },
    };
    let result: ScriptResult = null;
    try {
      result = code(this.contextFor(o, script, milestone, rem, day, vendor, consumedReal));
    } catch (e) {
      if (!(e instanceof Waiting || e instanceof Blocked || e instanceof Failed)) throw e;
      result = null;
    }
    for (const id of Object.values(consumedReal)) run.consumed.push(id);
    let m = this.measured.get(script.id);
    if (!m) this.measured.set(script.id, (m = new Set()));
    for (const k of Object.keys(consumedReal)) m.add(k);
    const trace = traceNow();
    let made = result !== null;
    if (made && result?.found !== undefined) made = this.found(o, script, result.found, result.content?.recontact === true, final, truth, trace);
    else if (made && fact === null) made = factNow();
    const subjectKey = o.person?.id ?? o.subject ?? "";
    const kind = this.catalogue.outcome(script.outcome)?.subject;
    const attested = this.attest(o, script, truth, made, final, day);
    if (kind !== "run" && subjectKey) this.storage.forEngine(script.outcome).set("served", subjectKey, { day, ok: attested });
    if (!attested) return { kind: "fail", reason: `no outcome at ${script.outcome}` };
    const subject = this.subjectOf(o, script, run);
    const u = this.makeUnit(run, script.outcome, subject, o.client.brand.id, o.campaign.id, consumedReal, [...trace].sort((x, y) => x - y));
    if (result?.content) u.content = result.content;
    const pt = this.truthOf(script, null);
    const delay = this.delayTicks(pt.delayMeanDays ?? 0, pt.horizonDays ?? 0);
    const flight = `${script.outcome}${SEP}${kind === "brand" ? o.client.brand.id : subject}`;
    if (kind === "brand" || kind === "company") this.inFlight.add(flight);
    o.pending.add(key);
    this.pendings.push({ tick: this.tickIndex + delay, order: o, key, unit: u, final, flight });
    return { kind: "wait" };
  }

  /** Run a script's code, turning what stopped it into what the order does next. */
  private signal(f: () => ScriptResult): Obtained | { kind: "ready" } {
    try {
      f();
      return { kind: "ready" };
    } catch (e) {
      if (e instanceof Ready) return { kind: "ready" };
      if (e instanceof Waiting) return { kind: "wait" };
      if (e instanceof Blocked) return { kind: "blocked" };
      if (e instanceof Failed) return { kind: "fail", reason: e.message };
      throw e;
    }
  }

  /** The market as the vendor of a script creating subjects: someone its source covers. */
  private marketDraw(o: Order, script: Script, truth: ScriptTruth): VendorAnswer {
    const brandId = o.client.brand.id;
    for (let k = 0; k < 50; k++) {
      const i = this.rng.int(this.world.settings.marketSize);
      if (covers(this.world, script.dynasty, brandId, i, truth.coverage ?? 1)) {
        this.drawn = i;
        return { ok: true, data: { key: `${brandId}:p${i}` } };
      }
    }
    return { ok: false, data: {} };
  }

  private drawn = -1;

  /** The ICP judge: does the person last drawn fit the ICP the run was served? */
  private marketFits(o: Order): boolean {
    const icp = o.served.map((id) => this.unitById.get(id)).find((u) => u?.conditions) ?? [...o.got.values()].flat().map((id) => this.unitById.get(id)).find((u) => u?.conditions);
    return meetsAll(personOf(this.world, o.client.brand.id, this.drawn).values, icp?.conditions ?? []);
  }

  /** A script creating subjects found someone: a raw record, or a person at once when it makes a milestone. */
  private found(o: Order, script: Script, key: string, recontact: boolean, final: boolean, truth: ScriptTruth, trace: Set<number>): boolean {
    const brandId = o.client.brand.id;
    const index = Number(key.split(":p").pop());
    const raw = `${brandId}:r${++this.rawCounter}`;
    this.rawPerson.set(raw, index);
    this.rootParty.set(raw, this.performerOf(script));
    o.subject = raw;
    o.recontact = recontact;
    const made = this.madePerDay.get(o.campaign.id) ?? [];
    made[this.dayIndex] = (made[this.dayIndex] ?? 0) + 1;
    this.madePerDay.set(o.campaign.id, made);
    let p = (truth.base ?? 1) * (truth.ownYield ?? 1);
    if (final) {
      p *= this.endProduct(o, trace, o.campaign.target);
      const person = personOf(this.world, brandId, index);
      p *= (o.client.truthMultiplier ?? 1) * segmentMultiplier(this.world, person.values) * (recontact ? this.world.truth.recontactMult : 1);
    }
    const ok = this.rng.next() < Math.min(0.97, p);
    if (ok && final) {
      const person = personOf(this.world, brandId, index);
      this.persons.set(person.id, person);
      if (!this.rootParty.has(person.id)) this.rootParty.set(person.id, this.performerOf(script));
      this.setPerson(o, person);
    }
    return ok;
  }

  /** Hidden: did the world make the outcome for this run? */
  private fact(o: Order, script: Script, truth: ScriptTruth, trace: Set<number>, final: boolean): boolean {
    let p = (truth.base ?? 1) * (truth.ownYield ?? 1);
    if (final) {
      p *= this.endProduct(o, trace, script.outcome);
      if (o.person) {
        p *= o.client.truthMultiplier ?? 1;
        if (o.from === START && this.firstMilestone(o, script.outcome)) p *= segmentMultiplier(this.world, o.person.values) * (o.recontact ? this.world.truth.recontactMult : 1);
      }
      if (truth.onFalseInput !== undefined && o.person && !this.truePositive.has(o.person.id) && this.rootParty.get(o.person.id) === OURS && !this.firstMilestone(o, script.outcome)) p *= truth.onFalseInput;
    }
    return p >= 1 || this.rng.next() < Math.min(0.97, p);
  }

  /** Is this the first milestone the order reaches from Start (no milestone passed before it)? */
  private firstMilestone(o: Order, outcome: OutcomeId): boolean {
    return o.from === START && ![...o.passed].some((m) => m !== outcome);
  }

  /** Attestation: a judge says the fact (with its recall) or a non-fact (its false positives). */
  private attest(o: Order, script: Script, truth: ScriptTruth, fact: boolean, final: boolean, day: number): boolean {
    let recall = truth.recall ?? 1;
    let fp = truth.falsePositive ?? 0;
    for (const [k, d] of o.decisionAt) {
      if (!k.startsWith(`${script.outcome}|`)) continue;
      const t = this.candidateTruth(this.decisions[d]!.point, this.decisions[d]!.candidate);
      if (t.recall !== undefined) recall *= t.recall;
      if (t.falsePositive !== undefined) fp = Math.max(fp, t.falsePositive);
    }
    const attested = fact ? this.rng.next() < recall : this.rng.next() < fp;
    const out = this.catalogue.outcome(script.outcome);
    if (final && fact && o.person && out?.reference) {
      this.truePositive.set(o.person.id, day);
      this.factCause.set(o.person.id, { campaignId: o.campaign.id });
    }
    if (out?.reference && o.person) this.attestations.push({ producer: script.dynasty, outcome: script.outcome, brandId: o.client.brand.id, subject: o.person.id, attested });
    return attested;
  }

  /** Who the new Unit is about: a person once identified, the company, the brand, or the run. */
  private subjectOf(o: Order, script: Script, run: Run): string {
    const kind = this.catalogue.outcome(script.outcome)?.subject;
    const raw = o.subject && this.rawPerson.has(o.subject) && !o.person ? o.subject : null;
    if (raw && kind === "lead" && !this.creates(script)) {
      const person = personOf(this.world, o.client.brand.id, this.rawPerson.get(raw)!);
      this.persons.set(person.id, person);
      if (!this.rootParty.has(person.id)) this.rootParty.set(person.id, this.rootParty.get(raw) ?? OURS);
      this.setPerson(o, person);
      return person.id;
    }
    if (kind === "company" && o.person) return o.person.companyId;
    if (kind === "brand") return o.client.brand.id;
    if (kind === "run") return run.id;
    return o.person?.id ?? o.subject ?? run.id;
  }

  /** Hidden: the product of the end effects of this order's choices for a milestone, and of the Units it was served. */
  private endProduct(o: Order, trace: Iterable<number>, milestone: OutcomeId): number {
    let p = 1;
    for (const d of trace) {
      const dec = this.decisions[d]!;
      if (dec.milestone !== milestone || dec.orderId !== o.id) continue;
      const obj = this.decisionObject.get(d);
      p *= obj ? this.objectTruthEnd(this.unitById.get(obj)!) : (this.candidateTruth(dec.point, dec.candidate).end ?? 1);
    }
    for (const id of o.served) p *= this.objectTruthEnd(this.unitById.get(id)!);
    return p;
  }

  objectTruthEnd(u: Unit): number {
    const drawn = this.unitTruth.get(u.id);
    if (drawn !== undefined) return drawn;
    const seed = this.world.clients.find((c) => c.brand.id === u.brandId)?.seeds.find((s) => s.dynasty === u.dynasty && s.version === u.version);
    if (seed) return seed.truthEnd ?? 1;
    const script = u.scriptId ? this.catalogue.script(u.scriptId) : undefined;
    return script && !u.dynasty ? (this.truthOf(script, null).end ?? 1) : 1;
  }

  private charge(o: Order, milestone: OutcomeId, cents: number, ours: boolean): void {
    if (ours) {
      this.budgetLeft.set(o.campaign.id, (this.budgetLeft.get(o.campaign.id) ?? 0) - cents);
      this.spentToday.set(o.campaign.id, (this.spentToday.get(o.campaign.id) ?? 0) + cents);
      this.spent.set(o.campaign.id, (this.spent.get(o.campaign.id) ?? 0) + cents);
      if (this.today) this.today.spendCents[o.campaign.id] = (this.today.spendCents[o.campaign.id] ?? 0) + cents;
      bumpCell(this.milestoneCohorts, `${o.campaign.id}${SEP}${milestone}`, o.startDay, "c", cents);
      const k = `${o.campaign.id}${SEP}${o.id}`;
      const s = this.subjectsByCampaign.get(k) ?? { entryDay: o.startDay, spendCents: 0, value: 0, fromStock: false };
      s.spendCents += cents;
      s.fromStock = o.fromStock;
      this.subjectsByCampaign.set(k, s);
    } else if (this.today) this.today.otherCents[o.campaign.id] = (this.today.otherCents[o.campaign.id] ?? 0) + cents;
    o.spentCents += cents;
    for (const d of o.decisions) {
      const dec = this.decisions[d]!;
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "c", cents);
    }
  }

  private delayTicks(meanDays: number, horizonDays: number): number {
    return Math.max(1, this.sampleDelay(meanDays, horizonDays) * this.ticksPerDay);
  }

  private sampleDelay(mean: number, horizon: number): number {
    if (mean <= 0) return 0;
    const q = 1 / (1 + mean);
    const u = 1 - this.rng.next();
    return Math.min(horizon, Math.floor(Math.log(u) / Math.log(1 - q)));
  }

  private newRun(day: number, campaignId: string | null, script: Script): Run {
    const r: Run = { id: `run:${++this.runCounter}`, engine: script.outcome, target: script.outcome, day, spendCents: 0, consumed: [], inputs: 1, performedBy: this.performerOf(script), scriptId: script.id, subjects: 1, ...(campaignId ? { campaignId } : {}) };
    this.runs.push(r);
    return r;
  }

  private makeUnit(run: Run, outcome: OutcomeId, subject: string, brandId: string, campaignId: string | null, materials: Record<OutcomeId, string>, trace: number[]): Unit {
    return { id: `unit:${++this.unitCounter}`, outcome, subject, runId: run.id, day: run.day, brandId, campaignId, performedBy: run.performedBy, scriptId: run.scriptId ?? null, materials, trace };
  }

  // ---- landing ------------------------------------------------------------------------

  private addUnit(u: Unit): void {
    this.units.push(u);
    this.unitById.set(u.id, u);
    if (u.dynasty && u.parentDynasty && !this.parentDynasty.has(u.dynasty)) this.parentDynasty.set(u.dynasty, u.parentDynasty);
    if (this.catalogue.outcome(u.outcome)?.subject === "brand") {
      const k = `${u.brandId}${SEP}${u.outcome}`;
      const list = this.brandUnits.get(k);
      if (list) list.push(u);
      else this.brandUnits.set(k, [u]);
    }
  }

  private deliver(day: number): void {
    const due = this.pendings.filter((p) => p.tick <= this.tickIndex);
    if (due.length === 0) return;
    const rest = this.pendings.filter((p) => p.tick > this.tickIndex);
    this.pendings.length = 0;
    this.pendings.push(...rest);
    for (const p of due) {
      p.unit.day = day;
      this.inFlight.delete(p.flight);
      this.land(p.unit, day);
      p.order.pending.delete(p.key);
      if (p.order.status !== "open") continue;
      p.order.got.set(p.key, [p.unit.id]);
      if (p.final) p.order.passed.add(p.unit.outcome);
      if (p.final && p.unit.outcome === p.order.campaign.target) this.finish(p.order, "done");
    }
  }

  /** A Unit lands in the stock: record it, credit the trace, push reactive campaigns, call the webhooks that report on it. */
  private land(u: Unit, day: number): void {
    this.addUnit(u);
    const out = this.catalogue.outcome(u.outcome);
    if (out?.subject === "lead" || out?.subject === "company") {
      const k = `${u.subject}${SEP}${u.outcome}`;
      const list = this.bySubject.get(k);
      if (list) list.push(u);
      else this.bySubject.set(k, [u]);
    }
    for (const s of this.catalogue.scripts) {
      const on = this.world.truth.scripts[s.id]?.webhook?.on;
      if (!s.webhook || on !== u.outcome || s.status !== "active") continue;
      const client = this.world.clients.find((c) => c.brand.id === u.brandId);
      if (!client?.connected.includes(s.id)) continue;
      const pt = this.truthOf(s, null);
      if (this.rng.next() >= (pt.base ?? 1)) continue;
      this.webhookCalls.push({ tick: this.tickIndex + this.delayTicks(pt.delayMeanDays ?? 0, pt.horizonDays ?? 0), scriptId: s.id, about: u.id });
    }
    if (out?.subject !== "lead") return;
    const bk = `${u.brandId}${SEP}${u.outcome}`;
    const bl = this.byBrand.get(bk);
    if (bl) bl.push(u);
    else this.byBrand.set(bk, [u]);
    let m = this.reached.get(u.subject);
    if (!m) this.reached.set(u.subject, (m = new Map()));
    const first = !m.has(u.outcome);
    if (first) m.set(u.outcome, day);

    // Credit every choice on the trace that exists for this milestone, for this subject.
    for (const d of u.trace) {
      const dec = this.decisions[d]!;
      if (dec.credited || dec.milestone !== u.outcome) continue;
      // Credited by its own campaign's Unit, or by another party's report (a CRM import): never by another campaign's work.
      if (u.campaignId !== null && u.campaignId !== dec.campaignId) continue;
      const order = this.orders[dec.orderId]!;
      if (order.person?.id !== u.subject) continue;
      dec.credited = true;
      if (order.status !== "open") this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "f", -1);
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "s", 1);
    }
    for (const c of this.campaigns()) if (c.status === "running" && c.start === u.outcome && c.brandId === u.brandId) this.push(c, u, day);

    if (!first) return;
    for (const cid of this.enrolled.get(u.subject) ?? []) {
      const campaign = this.campaign(cid);
      if (!campaign || (u.campaignId !== null && u.campaignId !== cid)) continue;
      const order = this.orderOf.get(`${cid}${SEP}${u.subject}`);
      if (!order || !order.entered.has(u.outcome)) {
        if (u.outcome !== campaign.target) continue;
      }
      if (this.today && (this.catalogue.isMilestone(u.outcome) || u.outcome === campaign.target)) {
        const o = (this.today.outcomes[cid] ??= {});
        o[u.outcome] = (o[u.outcome] ?? 0) + 1;
      }
      if (order && order.entered.has(u.outcome)) bumpCell(this.milestoneCohorts, `${cid}${SEP}${u.outcome}`, order.startDay, "s", 1);
      if (u.outcome === campaign.target) this.creditValue(campaign, u.subject);
    }
  }

  private setPerson(o: Order, person: Person): void {
    o.person = person;
    o.subject = person.id;
    this.orderOf.set(`${o.campaign.id}${SEP}${person.id}`, o);
    let s = this.enrolled.get(person.id);
    if (!s) this.enrolled.set(person.id, (s = new Set()));
    s.add(o.campaign.id);
  }

  private creditValue(campaign: Campaign, subject: string): void {
    const key = `${campaign.id}${SEP}${subject}`;
    if (this.valueCredited.has(key)) return;
    this.valueCredited.add(key);
    const v = this.targetValue(campaign).amount;
    const ours = this.rootParty.get(subject) === OURS;
    if (this.today) {
      const bucket = ours ? this.today.valueOurs : this.today.valueOther;
      bucket[campaign.id] = (bucket[campaign.id] ?? 0) + v;
    }
    if (ours) {
      const order = this.orderOf.get(`${campaign.id}${SEP}${subject}`);
      if (order) {
        const s = this.subjectsByCampaign.get(`${campaign.id}${SEP}${order.id}`);
        if (s) {
          s.value += v;
          s.fromStock = order.fromStock;
        }
      }
    }
  }

  // ---- the Supplier rating, webhooks ---------------------------------------------------

  ratingOutcome(): OutcomeId | null {
    return this.catalogue.outcomes.find((o) => o.contentType === "rating" && !o.retired)?.id ?? null;
  }

  /** The Supplier rating: each day it makes today's Rating for each brand with a running campaign; every choosing script consumes it. */
  private rate(day: number): void {
    const outcome = this.ratingOutcome();
    if (!outcome) return;
    const script = this.catalogue.scriptsOf(outcome)[0];
    if (!script) return;
    for (const brandId of this.brandIds) {
      if (!this.campaigns().some((c) => c.brandId === brandId && c.status === "running")) continue;
      const run = this.newRun(day, null, script);
      run.spendCents += Math.round(this.truthOf(script, null).costCents);
      this.land(this.makeUnit(run, outcome, brandId, brandId, null, {}, []), day);
    }
  }

  ratingOf(brandId: string): Unit | null {
    const outcome = this.ratingOutcome();
    if (!outcome) return null;
    const list = this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? [];
    return list[list.length - 1] ?? null;
  }

  /** Webhooks: scripts another party runs on its own (the organic market, the CRM, the mailbox). Their Units land in the stock. */
  private webhooks(day: number, firstTick: boolean): void {
    const calls = this.webhookCalls.filter((c) => c.tick <= this.tickIndex);
    if (calls.length > 0) {
      const rest = this.webhookCalls.filter((c) => c.tick > this.tickIndex);
      this.webhookCalls.length = 0;
      this.webhookCalls.push(...rest);
      for (const c of calls) {
        const script = this.catalogue.script(c.scriptId);
        const about = this.unitById.get(c.about);
        if (!script || !about) continue;
        const run = this.newRun(day, null, script);
        this.land(this.makeUnit(run, script.outcome, about.subject, about.brandId, null, {}, about.trace), day);
      }
    }
    if (!firstTick) return;
    for (const script of this.catalogue.scripts) {
      if (!script.webhook || script.status !== "active") continue;
      const wh = this.world.truth.scripts[script.id]?.webhook;
      if (!wh || wh.on) continue;
      const truth = this.truthOf(script, null);
      for (const client of this.world.clients) {
        if (wh.creates) {
          const n = this.rng.binomial(Math.round(client.organicPerDay * 4), 0.25);
          for (let i = 0; i < n; i++) {
            const index = this.rng.int(this.world.settings.marketSize);
            const person = personOf(this.world, client.brand.id, index);
            if (this.reached.get(person.id)?.has(script.outcome)) continue;
            this.persons.set(person.id, person);
            if (!this.rootParty.has(person.id)) this.rootParty.set(person.id, this.performerOf(script));
            const run = this.newRun(day, null, script);
            this.land(this.makeUnit(run, script.outcome, person.id, client.brand.id, null, {}, []), day);
          }
          continue;
        }
        if (!wh.attests || !client.connected.includes(script.id)) continue;
        for (const [personId, factDay] of this.truePositive) {
          if (factDay + (truth.delayMeanDays ?? 0) !== day) continue;
          const person = this.persons.get(personId);
          if (!person || person.brandId !== client.brand.id) continue;
          const attested = this.rng.next() < (truth.recall ?? 1);
          this.attestations.push({ producer: script.dynasty, outcome: script.outcome, brandId: client.brand.id, subject: personId, attested });
          if (!attested) continue;
          // The report is about a fact one of our runs made: its value goes to that run's campaign. It credits no choice:
          // a choice is credited by what its own run attested (a judge that missed the fact missed it).
          const cause = this.factCause.get(personId);
          const run = this.newRun(day, null, script);
          this.land(this.makeUnit(run, script.outcome, personId, client.brand.id, cause?.campaignId ?? null, {}, []), day);
        }
      }
    }
  }

  // ---- decisions and beliefs -----------------------------------------------------------

  private decide(o: Order, point: string, candidates: string[], day: number, remDelay: Rem, horizon: number, milestone: OutcomeId, slot = point): string {
    this.evidence.offer(point, candidates, remDelay.mean, horizon, remDelay.fixed);
    this.blind.offer(point, candidates, remDelay.mean, horizon, remDelay.fixed);
    const pk = `${point}${SEP}${o.campaign.id}`;
    const offered = this.dayPicksAll.get(pk) ?? new Set<string>();
    for (const c of candidates) offered.add(c);
    this.dayPicksAll.set(pk, offered);
    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      const value = this.milestoneValue(o.campaign, milestone);
      const book = this.bookOf(o.client.brand.id);
      const priced: PricedCandidate[] = candidates.map((c) => ({ id: c, ...book.belief(point, c, candidates, o.client.brand.id, day), uplift: this.uplift(book, point, c, o.client.brand.id, day) }));
      chosen = prioritize(priced, value, this.rng).chosenId;
    }
    this.pointMilestone.set(pk, milestone);
    // This choice is under every choice this order made before it toward the same milestone.
    for (const d of o.decisions) {
      const up = this.decisions[d]!;
      if (up.milestone !== milestone || up.point === point) continue;
      const k = `${up.point}${SEP}${up.candidate}`;
      let set = this.under.get(k);
      if (!set) this.under.set(k, (set = new Set()));
      set.add(point);
    }
    const id = this.decisions.length;
    this.decisions.push({ id, point, candidate: chosen, campaignId: o.campaign.id, brandId: o.client.brand.id, milestone, orderId: o.id, day, credited: false });
    o.decisions.push(id);
    o.decisionAt.set(slot, id);
    this.evidence.bump(point, chosen, o.client.brand.id, day, "t", 1);
    let dp = this.dayPicks.get(pk);
    if (!dp) this.dayPicks.set(pk, (dp = new Map()));
    dp.set(chosen, (dp.get(chosen) ?? 0) + 1);
    let series = this.picks.get(pk);
    if (!series) this.picks.set(pk, (series = new Map()));
    let s = series.get(chosen);
    if (!s) series.set(chosen, (s = []));
    while (s.length <= day) s.push(0);
    s[day]! += 1;
    return chosen;
  }

  private readonly pointMilestone = new Map<string, OutcomeId>();
  /** Per choice (point and candidate), the points chosen after it toward the same milestone. */
  private readonly under = new Map<string, Set<string>>();
  private readonly gapCache = new Map<string, number>();

  /**
   * The uplift of a candidate: the product, over the points chosen under it, of
   * the best candidate's value per dollar over the value per dollar of the mix
   * picked there this last week. A branch whose own choices are still being
   * learned is rated as it will be once they are (the Plan reads the tree the
   * same way: each Engine at its best script).
   */
  private uplift(book: EvidenceBook, point: string, candidate: string, brandId: string, day: number): number {
    let u = 1;
    for (const q of this.under.get(`${point}${SEP}${candidate}`) ?? []) u *= this.gapAt(book, q, brandId, day);
    return Math.min(u, 4);
  }

  private gapAt(book: EvidenceBook, point: string, brandId: string, day: number): number {
    const ck = `${book === this.blind ? "b" : "e"}${SEP}${point}${SEP}${brandId}${SEP}${this.tickIndex}`;
    const hit = this.gapCache.get(ck);
    if (hit !== undefined) return hit;
    if (this.gapCache.size > 50000) this.gapCache.clear();
    const weights = new Map<string, number>();
    for (const c of this.campaigns()) {
      if (c.brandId !== brandId) continue;
      for (const [cand, arr] of this.picks.get(`${point}${SEP}${c.id}`) ?? []) {
        let n = 0;
        for (let d = Math.max(0, day - 7); d <= day && d < arr.length; d++) n += arr[d]!;
        if (n > 0) weights.set(cand, (weights.get(cand) ?? 0) + n);
      }
    }
    let gap = 1;
    if (weights.size > 1) {
      const cands = [...weights.keys()];
      const pd = new Map(cands.map((c) => {
        const b = book.belief(point, c, cands, brandId, day);
        return [c, betaMean(b.posterior) / Math.max(b.cost.mean, 1e-6)] as const;
      }));
      let total = 0;
      let mix = 0;
      for (const [c, w] of weights) {
        total += w;
        mix += w * pd.get(c)!;
      }
      const best = Math.max(...pd.values());
      gap = mix > 0 ? best / (mix / total) : 1;
    }
    this.gapCache.set(ck, gap);
    return gap;
  }

  private bookOf(brandId: string): EvidenceBook {
    const r = this.ratingOf(brandId);
    const script = r?.scriptId ? this.catalogue.script(r.scriptId) : undefined;
    return script?.tactics.reads_evidence === false ? this.blind : this.evidence;
  }

  private groupOf(brandId: string): string {
    const b = this.world.clients.find((c) => c.brand.id === brandId)?.brand;
    return String(b?.tactics[this.world.settings.clientGroupTactic] ?? "");
  }

  belief(point: string, candidate: string, candidates: readonly string[], brandId: string, day: number) {
    return this.bookOf(brandId).belief(point, candidate, candidates, brandId, day);
  }

  private parentOf(candidate: string): string | null {
    const s = this.catalogue.versionsOf(candidate)[0];
    if (s?.parentDynasty) return s.parentDynasty;
    return this.parentDynasty.get(candidate) ?? null;
  }

  /** Value of one Unit of a milestone for a campaign: backward from its Target, along its Routing. */
  milestoneValue(campaign: Campaign, milestone: OutcomeId): number {
    if (this.milestoneValueDay !== this.dayIndex) {
      this.milestoneValueCache.clear();
      this.milestoneValueDay = this.dayIndex;
    }
    const ck = `${campaign.id}${SEP}${milestone}`;
    const hit = this.milestoneValueCache.get(ck);
    if (hit !== undefined) return hit;
    const target = this.targetValue(campaign).amount;
    const rows = this.milestoneEstimates(campaign);
    const i = rows.findIndex((r) => r.to === milestone);
    const above = i < 0 ? [] : rows.slice(i + 1);
    const { values } = valueBackwardLine(above.map((r) => ({ costPerAttempt: r.costPerAttempt ?? 0, yieldRate: r.yieldRate ?? 0.5 })), target);
    const v = Math.max(values[0] ?? target, target * 0.01);
    this.milestoneValueCache.set(ck, v);
    return v;
  }

  // ---- reports ---------------------------------------------------------------------------

  /** The value of one Target Unit of a campaign: stated, else the fleet median of stated ones. */
  targetValue(campaign: Campaign): { amount: number; label: "stated" | "expected" } {
    const offer = this.world.clients.find((c) => c.offer.id === campaign.offerId)?.offer;
    const target = campaign.target;
    const stated = offer?.outcomeValues?.[target] ?? (this.isTop(target) ? offer?.lifetimeRevenue : undefined);
    if (stated !== undefined) return { amount: stated, label: "stated" };
    const all = this.world.clients.map((c) => c.offer.outcomeValues?.[target] ?? (this.isTop(target) ? c.offer.lifetimeRevenue : undefined)).filter((x): x is number => x !== undefined && x > 0).sort((x, y) => x - y);
    const mid = all.length === 0 ? 0 : all.length % 2 ? all[(all.length - 1) / 2]! : (all[all.length / 2 - 1]! + all[all.length / 2]!) / 2;
    return { amount: mid, label: "expected" };
  }

  private isTop(outcome: OutcomeId): boolean {
    const t = this.catalogue.outcome(outcome)?.track;
    if (!t) return false;
    return !this.catalogue.outcomes.some((o) => o.track?.track === t.track && o.track.rank > t.rank);
  }

  /** Reaching each milestone of a campaign's Routing from the one before: censoring-corrected yield and measured cost per attempt. */
  milestoneEstimates(campaign: Campaign, day = this.dayIndex): MilestoneEstimate[] {
    const routing = this.routingOf(campaign);
    return routing.line.map((to, k) => {
      const from = k === 0 ? campaign.start : routing.line[k - 1]!;
      const scripts = this.catalogue.scriptsOf(to);
      const mean = Math.max(0, ...scripts.map((s) => this.chainDelay(s, from)));
      const fixed = Math.max(0, ...scripts.map((s) => this.scriptTicks(s).fixed));
      return { from, to, ...cohortEstimateOf(this.milestoneCohorts.get(`${campaign.id}${SEP}${to}`), day, mean, fixed) };
    });
  }

  /** Mean days from the milestone below to a script's outcome: its delay and those of the scripts that carry the subject up to it. */
  private chainDelay(script: Script, from: OutcomeId, seen = new Set<string>()): number {
    if (seen.has(script.id)) return 0;
    seen.add(script.id);
    const own = tickDelay(this.truthOf(script, null).delayMeanDays ?? 0, this.ticksPerDay);
    const s = this.subjectMaterialOf(script);
    if (!s || s === from || this.catalogue.isMilestone(s)) return own;
    return own + Math.max(0, ...this.catalogue.scriptsOf(s).filter((p) => !p.webhook).map((p) => this.chainDelay(p, from, new Set(seen))));
  }

  /**
   * The rows of a campaign page, per milestone of its Routing: attempts per
   * Target Unit, the cost of this outcome (its own production) and its cost
   * from Start (cumulative: the one the return reads).
   */
  milestoneCosts(campaign: Campaign): { from: OutcomeId; to: OutcomeId; attemptsPerTarget: number | null; costOfOutcome: number | null; costFromStart: number | null }[] {
    const rows = this.milestoneEstimates(campaign);
    const ok = rows.length > 0 && rows.every((l) => l.yieldRate !== null && l.costPerAttempt !== null && l.yieldRate > 0);
    const chain = ok ? rows.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! })) : [];
    const forward = ok ? costForwardLine(chain) : [];
    const per = ok ? targetBreakdown(chain) : [];
    return rows.map((l, k) => ({
      from: l.from,
      to: l.to,
      attemptsPerTarget: ok ? per[k]!.attemptsPerTarget : null,
      costOfOutcome: l.yieldRate && l.costPerAttempt !== null ? l.costPerAttempt / l.yieldRate : null,
      costFromStart: ok ? forward[k]! : null,
    }));
  }

  /** Expected and measured return of a campaign, on the same formula: value / cost per Target Unit. */
  economics(campaignId: string): CampaignEconomics {
    const campaign = this.campaign(campaignId)!;
    const tv = this.targetValue(campaign);
    const milestones = this.milestoneEstimates(campaign);
    let spendCents = 0;
    let valueOurs = 0;
    let valueOther = 0;
    for (const d of this.days) {
      spendCents += d.spendCents[campaignId] ?? 0;
      valueOurs += d.valueOurs[campaignId] ?? 0;
      valueOther += d.valueOther[campaignId] ?? 0;
    }
    let expected: CampaignEconomics["expected"] = { value: null, low: null, high: null };
    if (milestones.length > 0 && milestones.every((l) => l.yieldRate !== null && l.costPerAttempt !== null)) {
      const t = chainCostPerTarget(milestones.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! })));
      if (Number.isFinite(t) && t > 0) {
        const v = tv.amount / t;
        let rel2 = 0;
        for (const l of milestones) if (l.attempts > 0 && l.yieldRate) rel2 += (1 - l.yieldRate) / (l.attempts * l.yieldRate);
        const rel = Math.sqrt(rel2);
        expected = { value: v, low: v * Math.exp(-1.96 * rel), high: v * Math.exp(1.96 * rel) };
      }
    }
    const routing = this.routingOf(campaign);
    const horizon = Math.ceil(routing.line.reduce((s, to, k) => s + Math.max(0, ...this.catalogue.scriptsOf(to).map((x) => this.chainDelay(x, k === 0 ? campaign.start : routing.line[k - 1]!))) * 3, 0));
    const cutoffDay = this.dayIndex - horizon;
    let mSpend = 0;
    let mValue = 0;
    for (const [k, s] of this.subjectsByCampaign) {
      // The same basis as the expected figure: subjects this campaign made from its start, not taken from the stock.
      if (!k.startsWith(`${campaignId}${SEP}`) || s.entryDay > cutoffDay || s.fromStock) continue;
      mSpend += s.spendCents;
      mValue += s.value;
    }
    const targets = tv.amount > 0 ? Math.round(mValue / tv.amount) : 0;
    const mv = mSpend > 0 ? mValue / (mSpend / 100) : null;
    const rel = targets > 0 ? 1 / Math.sqrt(targets) : null;
    const measured = { value: mv, low: mv !== null && rel !== null ? mv * Math.exp(-1.96 * rel) : null, high: mv !== null && rel !== null ? mv * Math.exp(1.96 * rel) : null, targets, spendCents: mSpend, cutoffDay };
    return { campaignId, spendCents, valueOurs, valueOther, targetsOurs: tv.amount > 0 ? Math.round(valueOurs / tv.amount) : 0, measured, expected, milestones, targetValue: tv.amount, valueLabel: tv.label };
  }

  /**
   * The Plan a campaign actually ran over the last 7 days, per outcome it
   * made: each branch (the script that made it), its share of the Units and
   * its cost per Unit.
   */
  productionTree(campaignId: string, days = 7): { outcome: OutcomeId; units: number; branches: { scriptId: string; units: number; share: number; costPerUnit: number | null }[] }[] {
    const since = this.dayIndex - days;
    const made = new Map<OutcomeId, Map<string, number>>();
    const spend = new Map<string, number>();
    for (const u of this.units) {
      if (u.campaignId !== campaignId || u.day < since || !u.scriptId) continue;
      const m = made.get(u.outcome) ?? new Map<string, number>();
      m.set(u.scriptId, (m.get(u.scriptId) ?? 0) + 1);
      made.set(u.outcome, m);
    }
    for (const r of this.runs) if (r.campaignId === campaignId && r.day >= since && r.scriptId) spend.set(r.scriptId, (spend.get(r.scriptId) ?? 0) + r.spendCents);
    const out: { outcome: OutcomeId; units: number; branches: { scriptId: string; units: number; share: number; costPerUnit: number | null }[] }[] = [];
    for (const [outcome, byScript] of made) {
      const total = [...byScript.values()].reduce((x, y) => x + y, 0);
      out.push({
        outcome,
        units: total,
        branches: [...byScript].map(([scriptId, units]) => ({ scriptId, units, share: units / total, costPerUnit: units > 0 ? (spend.get(scriptId) ?? 0) / 100 / units : null })).sort((x, y) => y.units - x.units || (x.scriptId < y.scriptId ? -1 : 1)),
      });
    }
    return out;
  }

  pickSeries(point: string, campaignId?: string): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const [k, series] of this.picks) {
      const [p, c] = k.split(SEP) as [string, string];
      if (p !== point || (campaignId && c !== campaignId)) continue;
      for (const [o, s] of series) {
        const acc = out.get(o) ?? [];
        for (let d = 0; d < s.length; d++) acc[d] = (acc[d] ?? 0) + s[d]!;
        out.set(o, acc);
      }
    }
    for (const s of out.values()) for (let d = 0; d < this.dayIndex; d++) s[d] ??= 0;
    return out;
  }

  choicePoints(): { point: string; campaignId: string }[] {
    return [...this.picks.keys()].map((k) => {
      const [point, campaignId] = k.split(SEP) as [string, string];
      return { point, campaignId };
    });
  }

  candidatesFor(point: string, campaign: Campaign): string[] {
    const material = point.split("|")[1] ?? "";
    if (this.catalogue.outcome(material)?.subject === "brand") {
      const held = this.objectDynasties(campaign.brandId, material);
      if (held.length > 0) return held;
    }
    const seen = new Set(this.dayPicksAll.get(`${point}${SEP}${campaign.id}`) ?? []);
    const offered = this.candidatesAt(point).filter((o) => seen.has(o));
    return offered.length > 0 ? offered : this.candidatesAt(point);
  }

  candidatesAt(point: string): string[] {
    return [...(this.evidence.pointCandidates.get(point) ?? [])];
  }

  beliefsAt(point: string, campaignId: string): { candidate: string; rate: number; rateSd: number; cost: number; valuePerDollar: number; decisions: number; successes: number }[] {
    const campaign = this.campaign(campaignId);
    if (!campaign) return [];
    const candidates = this.candidatesFor(point, campaign);
    const delay = this.evidence.delayOf(point);
    const value = this.milestoneValue(campaign, this.pointMilestone.get(`${point}${SEP}${campaignId}`) ?? campaign.target);
    return candidates.map((o) => {
      const b = this.belief(point, o, candidates, campaign.brandId, this.dayIndex);
      const c = this.evidence.counts(point, o, [campaign.brandId], this.dayIndex, delay);
      return { candidate: o, rate: betaMean(b.posterior), rateSd: Math.sqrt(betaVariance(b.posterior)), cost: b.cost.mean, valuePerDollar: (betaMean(b.posterior) * value) / Math.max(b.cost.mean, 1e-6), decisions: c.n, successes: c.successes };
    });
  }

  /** The milestone a point's decisions are credited at, for a campaign. */
  milestoneOfPoint(point: string, campaignId: string): OutcomeId | null {
    return this.pointMilestone.get(`${point}${SEP}${campaignId}`) ?? null;
  }

  private logChoices(day: number): void {
    for (const [k, picks] of this.dayPicks) {
      const [point, campaignId] = k.split(SEP) as [string, string];
      const candidates = [...(this.dayPicksAll.get(k) ?? [])];
      if (candidates.length < 2) continue;
      const brandId = this.campaign(campaignId)!.brandId;
      const scored = candidates.map((o) => {
        const b = this.belief(point, o, candidates, brandId, day);
        return { id: o, meanScore: betaMean(b.posterior) / Math.max(b.cost.mean, 1e-6), picks: picks.get(o) ?? 0 };
      });
      const chosenId = [...scored].sort((x, y) => y.picks - x.picks || (x.id < y.id ? -1 : 1))[0]!.id;
      const bestId = [...scored].sort((x, y) => y.meanScore - x.meanScore || (x.id < y.id ? -1 : 1))[0]!.id;
      this.choices.push({ day, campaignId, point, candidates: scored, chosenId, bestId });
    }
  }

  // ---- brand Units -------------------------------------------------------------------

  candidateOf(u: Unit): string {
    return u.dynasty ?? (u.scriptId ? this.catalogue.script(u.scriptId)?.dynasty : undefined) ?? u.id;
  }

  private latestOf(units: readonly Unit[]): Unit | undefined {
    let head: Unit | undefined;
    for (const u of units) if (!head || (u.version ?? 0) >= (head.version ?? 0)) head = u;
    return head;
  }

  objectDynasties(brandId: string, outcome: OutcomeId): string[] {
    const out: string[] = [];
    for (const o of this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []) {
      const c = this.candidateOf(o);
      if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  objectVersions(brandId: string, outcome: OutcomeId): Unit[] {
    return [...(this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? [])];
  }

  objectHead(brandId: string, outcome: OutcomeId, dynasty: string): Unit | undefined {
    return this.latestOf((this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []).filter((o) => this.candidateOf(o) === dynasty));
  }

  // ---- hidden truth, for grading only ---------------------------------------------------

  pickChance(script: Script, brandId: string, conditions: readonly Condition[], tries = 60): number {
    const ck = `${this.dayIndex}|${script.id}|${brandId}|${JSON.stringify(conditions)}`;
    const hit = this.pickChanceCache.get(ck);
    if (hit !== undefined) return hit;
    const coverage = this.truthOf(script, null).coverage ?? 1;
    const window = Number(script.tactics.recontact_days ?? 365);
    const store = this.storage.forEngine(script.outcome);
    const stride = Math.max(1, Math.floor(this.world.settings.marketSize / 3000));
    let covered = 0;
    let ok = 0;
    for (let i = 0; i < this.world.settings.marketSize; i += stride) {
      if (!covers(this.world, script.dynasty, brandId, i, coverage)) continue;
      covered++;
      if (!meetsAll(personOf(this.world, brandId, i).values, conditions)) continue;
      const last = store.get(`picked:${script.dynasty}`, `${brandId}:p${i}`) ?? store.get("picked", `${brandId}:p${i}`);
      if (typeof last === "number" && this.dayIndex - last < window) continue;
      ok++;
    }
    const v = covered === 0 ? 0 : 1 - Math.pow(1 - ok / covered, tries);
    this.pickChanceCache.set(ck, v);
    return v;
  }

  scriptTruth(script: Script, point: string | null): ScriptTruth {
    return this.truthOf(script, point);
  }

  candidateTruthAt(point: string, candidate: string): Partial<ScriptTruth> {
    return this.candidateTruth(point, candidate);
  }

  private truthOf(script: Script, point: string | null): ScriptTruth {
    const base = this.world.truth.scripts[script.id] ?? this.world.truth.scripts[script.dynasty] ?? { costCents: script.costCents };
    const at = point ? this.world.truth.at[point.split("#")[0]!]?.[script.dynasty] : undefined;
    return { ...base, ...(at ?? {}) };
  }

  private candidateTruth(point: string, candidate: string): Partial<ScriptTruth> {
    const s = this.catalogue.headOf(candidate);
    if (s) return this.truthOf(s, point);
    return this.world.truth.at[point]?.[candidate] ?? {};
  }

  // ---- splits: finer ICPs and proposed strategies --------------------------------------

  private studyAndPropose(day: number): void {
    const mature = day - this.world.settings.splitMatureDays;
    const leadTactics = this.catalogue.tactics.filter((t) => !t.retired && (t.describes.includes("lead") || t.describes.includes("company")));
    const audience = this.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired)?.id;
    for (const campaign of this.campaigns()) {
      if (!audience || !this.isProactive(campaign) || campaign.status !== "running") continue;
      const brandId = campaign.brandId;
      if (this.objectVersions(brandId, audience).filter((o) => o.parentDynasty).length >= this.world.settings.maxProposedIcps) continue;
      const first = this.routingOf(campaign).line[0];
      if (!first) continue;
      const icpCount = new Map<string, number>();
      for (const o of this.orders) {
        if (o.campaign.id !== campaign.id || o.from !== START) continue;
        const dyn = o.objects[audience];
        if (dyn) icpCount.set(dyn, (icpCount.get(dyn) ?? 0) + 1);
      }
      const parentDyn = [...icpCount].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
      const parent = parentDyn ? this.objectHead(brandId, audience, parentDyn) : undefined;
      if (!parentDyn || !parent) continue;
      const records: SplitRecord[] = [];
      for (const o of this.orders) {
        if (o.campaign.id !== campaign.id || o.from !== START || !o.person || o.startDay > mature || o.objects[audience] !== parentDyn) continue;
        records.push({ values: o.person.values, success: this.reached.get(o.person.id)?.has(first) ?? false, stratum: `${brandId}|month-${Math.floor(o.startDay / 30)}` });
      }
      const study = studySplits(records, leadTactics);
      if (!study.proposal) continue;
      const conditions = mergeConditions(parent.conditions ?? [], study.proposal.conditions);
      const key = JSON.stringify(conditions);
      if (this.units.some((o) => o.brandId === brandId && o.outcome === audience && JSON.stringify(o.conditions ?? []) === key)) continue;
      const finder = this.catalogue.script(this.world.settings.icpFinderScript);
      if (!finder) continue;
      const cost = Math.round(this.truthOf(finder, null).costCents);
      const run = this.newRun(day, campaign.id, finder);
      run.spendCents += cost;
      run.consumed.push(parent.id);
      this.spent.set(campaign.id, (this.spent.get(campaign.id) ?? 0) + cost);
      if (this.today) this.today.spendCents[campaign.id] = (this.today.spendCents[campaign.id] ?? 0) + cost;
      const dynasty = `${parentDyn}-fork-${day}`;
      const text = `${parent.text ?? ""} ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue).toLowerCase()).join(", ")}.`.replace(/\.\s/, ", ").trim();
      const u = this.makeUnit(run, audience, `${brandId}:${dynasty}:v1`, brandId, campaign.id, { [audience]: parent.id }, []);
      Object.assign(u, { dynasty, version: 1, parentDynasty: parentDyn, name: `Finer (day ${day})`, text, content: { text }, conditions });
      this.addUnit(u);
      this.proposals.push({ day, kind: "audience", brandId, campaignId: campaign.id, point: null, conditions, text, createdId: u.id, study });
    }
    // Splits on scripts: per point, the tactic values of the script chosen; a split proposes a strategy of the producing Engine.
    for (const point of this.evidence.pointCandidates.keys()) {
      const material = point.split("|")[1];
      if (!material || !this.catalogue.scriptsOf(material).length) continue;
      const scriptTactics = this.catalogue.tactics.filter((t) => t.describes.includes("script"));
      const records: SplitRecord[] = [];
      for (const d of this.decisions) {
        if (d.point !== point || d.day > mature) continue;
        const s = this.catalogue.headOf(d.candidate);
        if (s) records.push({ values: s.tactics, success: d.credited, stratum: `${d.brandId}|month-${Math.floor(d.day / 30)}` });
      }
      const study = studySplits(records, scriptTactics, { maxDepth: 1 });
      if (!study.proposal) continue;
      const sid = `${material}#proposed-${study.proposal.conditions.map((c) => JSON.stringify(c)).join("")}`.replace(/[^a-zA-Z0-9#|:_-]/g, "");
      if (this.catalogue.strategy(sid)) continue;
      this.catalogue.add("strategies", { id: sid, name: study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", "), outcome: material, conditions: study.proposal.conditions, proposed: { day, reason: `split on ${records.length} decisions at ${point}` } });
      this.proposals.push({ day, kind: "strategy", brandId: null, campaignId: null, point, conditions: study.proposal.conditions, text: "", createdId: sid, study });
    }
  }

  // ---- results -----------------------------------------------------------------------

  ledger(): LedgerReport {
    const c = this.ledgerCache;
    if (c && c.day === this.dayIndex && c.runs === this.runs.length && c.units === this.units.length) return c.report;
    const report = buildLedger(this.runs, this.units);
    this.ledgerCache = { day: this.dayIndex, runs: this.runs.length, units: this.units.length, report };
    return report;
  }

  reliability(): ProducerReliability[] {
    const reference: Record<string, string> = {};
    const covered: Record<string, Set<string>> = {};
    for (const o of this.catalogue.outcomes) {
      if (!o.reference) continue;
      reference[o.id] = o.reference;
      const ids = this.catalogue.versionsOf(o.reference).map((s) => s.id);
      covered[o.id] = new Set(this.world.clients.filter((c) => c.connected.some((x) => ids.includes(x))).map((c) => c.brand.id));
    }
    return measureReliability(this.attestations, reference, covered);
  }

  /** The orders a subject was in. */
  ordersOf(subject: string): { campaignId: string; from: OutcomeId; startDay: number; status: string; spentCents: number }[] {
    return this.orders.filter((o) => o.person?.id === subject).map((o) => ({ campaignId: o.campaign.id, from: o.from, startDay: o.startDay, status: o.status, spentCents: o.spentCents }));
  }

  /** A campaign's orders: where each started, the Unit it was pushed, when, how it ended, and the milestones it worked toward. */
  campaignOrders(campaignId: string): { from: OutcomeId; startUnit: string | null; startDay: number; status: string; subject: string | null; milestones: OutcomeId[] }[] {
    return this.orders.filter((o) => o.campaign.id === campaignId).map((o) => ({ from: o.from, startUnit: o.startUnit, startDay: o.startDay, status: o.status, subject: o.person?.id ?? null, milestones: [...o.entered] }));
  }

  orderCount(campaignId?: string): number {
    return campaignId ? this.orders.filter((o) => o.campaign.id === campaignId).length : this.orders.length;
  }

  people(): Person[] {
    return [...this.persons.values()];
  }
}

export function mergeConditions(a: readonly Condition[], b: readonly Condition[]): Condition[] {
  return [...a, ...b];
}

export function simulate(world: WorldSpec, days: number): SimulationSession {
  const s = new SimulationSession(world);
  s.run(days);
  return s;
}

// Values read from the ledger's cohorts (exported for the dashboard and tests).
export { cohortCountsOf };
export type { Cell, TacticValue };
