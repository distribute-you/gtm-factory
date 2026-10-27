/**
 * A factory at work on a simulated world, tick by tick.
 *
 * The Campaign orders production and fixes only its Target, its budget, its
 * start and its strategy. The production tree is rebuilt at every tick from
 * performance. A proactive Campaign (started from Start) pulls on its Target:
 * the most advanced Units in the stock are served first, then new subjects are
 * made from the market with what is left of its budget. A reactive Campaign
 * (started from any other outcome) pushes each landed Unit of its start
 * outcome up toward the Target, as far as its budget allows.
 *
 * Every leg runs the same generic code. It picks its script with the Supplier
 * rating, filtered by the strategy; for each Material of that script's Bill of
 * materials it looks up the ledger with the Material's Specification; if none
 * conforms it pulls the OUTCOME: the best producer is picked then and receives
 * the Specification. The script runs once all its Materials are there. Every
 * Run performs one script and lands one Unit or none, after its delay: a Unit
 * advances one leg per tick. Each Unit carries its traceability (the choices
 * that led to it), and when the next lead state lands every choice on its
 * traceability is credited. Deterministic: one seed, one history.
 */

import { START, billOf, defaultStrategyId, type Catalogue, type Leg, type OutcomeId, type Script, type Specification, type Strategy } from "./catalogue";
import { EvidenceBook, SEP, bumpCell, stepCountsOf, stepEstimateOf, type Cell, type CellStore } from "./evidence";
import { chainCostPerTarget, costForwardLine, stepBreakdown, valueBackwardLine } from "./funnels";
import { buildLedger, type LedgerReport, type LedgerRun, type LedgerUnit } from "./ledger";
import { prioritize, type PricedCandidate } from "./prioritizer";
import { measureReliability, type Attestation, type ProducerReliability } from "./reliability";
import { createRng, type Rng } from "./rng";
import { studySplits, type SplitRecord, type SplitStudy } from "./splits";
import { betaMean, betaVariance } from "./stats";
import { StorageHouse, type LegStorage, type StorageReport } from "./storage";
import { describeCondition, meetsAll, type Condition, type TacticValue } from "./tactics";
import { covers, personOf, segmentMultiplier, type Campaign, type Person, type ScriptTruth, type WorldClient, type WorldSpec } from "./world";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One Unit: one physical piece of an outcome, about one subject, produced by one Run. */
export interface Unit extends LedgerUnit {
  brandId: string;
  campaignId: string | null;
  factory: string;
  legId: string | null;
  scriptId: string | null;
  /** The Units it consumed, by Material. */
  materials: Record<OutcomeId, string>;
  /** Traceability: the choices that led to it (decision ids), its own included. */
  trace: number[];
  /** Brand Units (an ICP, a template): their dynasty, version and text. */
  dynasty?: string;
  version?: number;
  parentDynasty?: string;
  name?: string;
  text?: string;
  conditions?: Condition[];
}

/** One choice: at a point (consuming leg x Material), for a subject, the candidate picked. */
export interface Decision {
  id: number;
  point: string;
  candidate: string;
  campaignId: string;
  brandId: string;
  /** The outcome this decision exists for: the next lead state of its campaign's sales path (or its Target). */
  stepEnd: OutcomeId;
  attemptId: number;
  day: number;
  credited: boolean;
}

/** One Run: one script executed, one Unit or none. */
export interface Run extends LedgerRun {
  factory: string;
  scriptId?: string;
  /** Subjects processed (1 for a script run). */
  subjects: number;
}

/** What the factory logs per day, per choice point and campaign: the picks and why. */
export interface ChoiceRecord {
  day: number;
  campaignId: string;
  point: string;
  candidates: { id: string; meanScore: number; picks: number }[];
  /** The candidate with the most picks today. */
  chosenId: string;
  /** The candidate with the best expected value per dollar today. */
  bestId: string;
}

export interface DaySnapshot {
  day: number;
  /** Our spend per campaign, cents. */
  spendCents: Record<string, number>;
  /** Access cost paid to other factories per campaign, cents. */
  otherCents: Record<string, number>;
  /** New lead states reached per campaign per outcome (first time per subject). */
  outcomes: Record<string, Record<OutcomeId, number>>;
  /** Value of target outcomes reached today per campaign, dollars, subjects we created. */
  valueOurs: Record<string, number>;
  /** Same, subjects another factory brought (counted, never in our return). */
  valueOther: Record<string, number>;
  /** Units a campaign took into a leg today (pulled from the stock, made from the market, or pushed). */
  attempts: Record<string, number>;
  /** Units pushed into reactive campaigns today. */
  pushes: number;
}

/** A Unit a reactive Campaign pushed into its first leg. */
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
  /** The ICP Unit or the strategy it became. */
  createdId: string;
  study: SplitStudy;
}

export interface CampaignEconomics {
  campaignId: string;
  spendCents: number;
  valueOurs: number;
  valueOther: number;
  targetsOurs: number;
  /** Measured return on the mature basis: value won / spend, subjects entered before the cutoff. */
  measured: { value: number | null; low: number | null; high: number | null; targets: number; spendCents: number; cutoffDay: number };
  /** Expected return: value / cost per target on the decision estimates (censoring-corrected leg rates, measured costs). */
  expected: { value: number | null; low: number | null; high: number | null };
  /** Each step of the sales path the tree runs today, from one lead state to the next. */
  steps: StepEstimate[];
  targetValue: number;
  valueLabel: "stated" | "expected";
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** One step of a sales path as the decisions read it: from one lead state to the next. */
export interface StepEstimate {
  from: OutcomeId;
  to: OutcomeId;
  attempts: number;
  reached: number;
  yieldRate: number | null;
  costPerAttempt: number | null;
  label: "expected" | "measured";
}

/** A Unit a campaign took toward the next lead state: the production it orders until that state lands, or fails. */
interface Attempt {
  id: number;
  campaign: Campaign;
  client: WorldClient;
  from: OutcomeId;
  to: OutcomeId;
  /** Raw record before identity, then the person. */
  subject: string | null;
  person: Person | null;
  recontact: boolean;
  /** The Unit the step starts from (pulled from the stock or pushed), none from Start. */
  startUnit: string | null;
  choices: Map<string, string>;
  /** Decision id per point. */
  decisionAt: Map<string, number>;
  got: Map<string, string>;
  pending: Set<string>;
  decisions: number[];
  startDay: number;
  status: "open" | "done" | "failed";
  checkedSubject: boolean;
  spentCents: number;
  /** The brand dynasty consumed per outcome (kept after the attempt ends, for studies). */
  objects: Record<OutcomeId, string>;
  /** Units served from the stock (not ordered by this attempt): their hidden effect applies to its end. */
  served: string[];
  /** The first tick it can move at (a script waiting its days). */
  wakeTick: number;
}

/** Who consumes a Material: a leg running one of its scripts (the script's Bill of materials names the Material). */
interface Consumer {
  leg: Leg;
  script: Script;
}

interface PendingLanding {
  tick: number;
  attempt: Attempt;
  key: string;
  unit: Unit;
  final: boolean;
  /** The stock key it fills (outcome and subject), while it is in flight. */
  flight: string;
}

/** Days from a choice to the next lead state: the mean, and the part of it that is certain (one tick per leg). */
interface Rem {
  mean: number;
  fixed: number;
}

const NO_REM: Rem = { mean: 0, fixed: 0 };

function addRem(a: Rem, b: Rem): Rem {
  return { mean: a.mean + b.mean, fixed: a.fixed + b.fixed };
}

type Obtained = { kind: "ok"; unit: string } | { kind: "wait" } | { kind: "fail"; reason: string } | { kind: "blocked" };

export function pointKey(consumer: string, material: OutcomeId): string {
  return `${consumer}|${material}`;
}

/** The consumer of a step's end: the Campaign ordering the next lead state. */
export function stepConsumer(from: OutcomeId, to: OutcomeId): string {
  return `step:${from}>${to}`;
}

/** The key of a step of a sales path. */
export function stepKey(from: OutcomeId, to: OutcomeId): string {
  return `${from}>${to}`;
}

export function playPoint(from: OutcomeId, to: OutcomeId): string {
  return `play:${from}>${to}`;
}

/** The tactic a Unit carries from the ledger: its age in days. */
export const UNIT_AGE = "age_days";

/** Mean days a run takes to land, counting the tick it runs in (a Unit advances one leg per tick, `ticksPerDay` ticks a day). */
export function tickDelay(delayMeanDays: number, ticksPerDay = 1): number {
  return delayMeanDays + 1 / ticksPerDay / (1 + delayMeanDays);
}

// ---------------------------------------------------------------------------
// Script business logic: generic, read off the script's tactics, kept in its leg storage
// ---------------------------------------------------------------------------

/** What a running script is handed: its own leg's storage, the day, its tactics. Nothing else. */
export interface ScriptContext {
  readonly storage: LegStorage;
  readonly day: number;
  readonly tactics: Readonly<Record<string, TacticValue>>;
}

/** The market as a script creating subjects sees it: draw someone its source covers, ask the ICP judge. */
export interface MarketView {
  draw(): number | null;
  inIcp(index: number): boolean;
  /** The key a script stores a person under (the market is per brand). */
  keyOf(index: number): string;
}

/**
 * Pick one person from the market: the script's own rule on reuse (its
 * "days before recontact" tactic) read against its leg storage.
 */
export function pickFromMarket(ctx: ScriptContext, market: MarketView, tries = 60): { index: number; recontact: boolean } | null {
  const window = Number(ctx.tactics.recontact_days ?? 365);
  for (let k = 0; k < tries; k++) {
    const index = market.draw();
    if (index === null) return null;
    const key = market.keyOf(index);
    const last = ctx.storage.get("picked", key);
    if (typeof last === "number" && ctx.day - last < window) continue;
    if (!market.inIcp(index)) continue;
    ctx.storage.set("picked", key, ctx.day);
    return { index, recontact: typeof last === "number" };
  }
  return null;
}

/** A script's rule before it runs on a subject (its "days before retry" tactic). */
export function scriptAccepts(ctx: ScriptContext, subject: string): boolean {
  const retry = ctx.tactics.retry_days;
  if (retry === undefined) return true;
  const failed = ctx.storage.get("failed", subject);
  return !(typeof failed === "number" && ctx.day - failed < Number(retry));
}

/**
 * A script's rule on when to run (its "days since last message" tactic): it
 * keeps a reference to the Unit it waits on in its leg storage and runs once
 * that many days have passed since the Unit landed.
 */
export function scriptReady(ctx: ScriptContext, subject: string, unit: { id: string; day: number }): boolean {
  const wait = ctx.tactics.wait_days;
  if (wait === undefined) return true;
  if (ctx.day - unit.day >= Number(wait)) {
    ctx.storage.delete("waiting", subject);
    return true;
  }
  ctx.storage.set("waiting", subject, unit.id);
  return false;
}

/** What a script keeps after a run: failures it will not retry soon, and each subject it served. */
export function scriptRecords(ctx: ScriptContext, subject: string, ok: boolean): void {
  if (ctx.tactics.retry_days !== undefined && !ok) ctx.storage.set("failed", subject, ctx.day);
  ctx.storage.set("served", subject, { day: ctx.day, ok });
}

/** Does a Unit conform to a Specification's conditions (its producer script's tactics, its age)? */
export function conforms(values: Readonly<Record<string, TacticValue>>, conditions: readonly Condition[]): boolean {
  return meetsAll(values, conditions);
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
  private readonly attempts: Attempt[] = [];
  private readonly pendings: PendingLanding[] = [];
  /** Open attempts per campaign. */
  private readonly open = new Map<string, Attempt[]>();
  /** The stock by subject and outcome, oldest first. */
  private readonly bySubject = new Map<string, Unit[]>();
  /** Lead Units by brand and outcome, in landing order (what a pull serves from). */
  private readonly byBrand = new Map<string, Unit[]>();
  /** How far each campaign leg has read its stock list. */
  private readonly stockRead = new Map<string, number>();
  /** Brand Units by brand and outcome (ICPs, templates, brand contexts, Ratings). */
  private readonly brandUnits = new Map<string, Unit[]>();
  /** Stock keys (outcome and subject) with a Unit in flight. */
  private readonly inFlight = new Set<string>();
  /** Lead states reached: subject -> outcome -> first day. */
  private readonly reached = new Map<string, Map<OutcomeId, number>>();
  private readonly rawPerson = new Map<string, number>();
  private readonly rootFactory = new Map<string, string>();
  private readonly enrolled = new Map<string, Set<string>>();
  private readonly valueCredited = new Set<string>();
  private readonly truePositive = new Map<string, number>();
  private readonly persons = new Map<string, Person>();
  private readonly evidence: EvidenceBook;
  /** What a Rating that reads no evidence sees: every candidate at its prior. */
  private readonly blind: EvidenceBook;
  private readonly stepCohorts: CellStore = new Map();
  private readonly picks = new Map<string, Map<string, number[]>>();
  private readonly spent = new Map<string, number>();
  private readonly budgetLeft = new Map<string, number>();
  private readonly subjectsByCampaign = new Map<string, { entryDay: number; spendCents: number; value: number }>();
  /** Webhook calls another factory will make: at a tick, about a Unit. */
  private readonly webhookCalls: { tick: number; legId: string; about: string }[] = [];
  private tickIndex = 0;
  /** Our spend per campaign since the day started, cents. */
  private readonly spentToday = new Map<string, number>();
  private readonly brandIds: string[];
  private ledgerCache: { day: number; runs: number; units: number; report: LedgerReport } | null = null;
  private unitCounter = 0;
  private runCounter = 0;
  private rawCounter = 0;
  private today: DaySnapshot | null = null;
  private dayPicks = new Map<string, Map<string, number>>();
  /** Candidates offered per (point, campaign), ever. */
  private readonly dayPicksAll = new Map<string, Set<string>>();
  /** New subjects made per campaign per day (for a volume per period). */
  private readonly madePerDay = new Map<string, number[]>();

  constructor(world: WorldSpec) {
    this.world = world;
    this.catalogue = world.catalogue;
    this.rng = createRng(world.seed);
    this.treeRng = createRng(`${world.seed}|tree`);
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

  /** Ticks per simulated day: at each tick every campaign pulls or pushes, and a Unit advances one leg. */
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

  /** Read-only report of one leg's storage (row counts and a sample): what the dashboard shows. */
  storageReport(legId: string): StorageReport {
    return this.storage.report(legId);
  }

  unit(id: string): Unit | undefined {
    return this.unitById.get(id);
  }

  person(id: string): Person | undefined {
    return this.persons.get(id);
  }

  /** Lead states (and every lead outcome) a subject reached, with the first day. */
  reachedBy(subject: string): ReadonlyMap<OutcomeId, number> {
    return this.reached.get(subject) ?? new Map();
  }

  /** The factory that brought a subject in: ours, or another factory (organic). */
  rootOf(subject: string): string | undefined {
    return this.rootFactory.get(subject);
  }

  campaignsOfSubject(subject: string): string[] {
    return [...(this.enrolled.get(subject) ?? [])];
  }

  spentCents(campaignId: string): number {
    return this.spent.get(campaignId) ?? 0;
  }

  /** Is a campaign proactive (started from Start: it pulls) or reactive (started from an outcome: it pushes)? */
  isProactive(campaign: Campaign): boolean {
    return campaign.start === START;
  }

  // ---- setup -----------------------------------------------------------------

  private register(c: WorldClient): void {
    if (!this.brandIds.includes(c.brand.id)) this.brandIds.push(c.brand.id);
    const setupId = `run:setup:${c.brand.id}`;
    if (this.world.settings.setupCentsPerBrand > 0 && !this.runs.some((r) => r.id === setupId)) {
      this.runs.push({ id: setupId, legId: null, target: null, day: this.dayIndex, spendCents: this.world.settings.setupCentsPerBrand, consumed: [], support: { kind: "brand_setup", reason: "first setup of the brand" }, factory: this.ourFactory(), subjects: 0, campaignId: c.campaigns[0]?.id });
    }
    for (const s of c.seeds) {
      if (this.units.some((o) => o.brandId === c.brand.id && o.dynasty === s.dynasty && o.version === s.version)) continue;
      const script = this.catalogue.script(s.scriptId);
      const leg = script ? this.catalogue.leg(script.legId) : undefined;
      if (!script || !leg) throw new Error(`seed Unit names unknown script "${s.scriptId}"`);
      const cost = Math.round(this.truthOf(script, null).costCents);
      const run = this.newRun(this.dayIndex, c.campaigns[0]?.id ?? null, leg, script);
      run.spendCents += cost;
      if (this.catalogue.isOurs(leg) && c.campaigns[0]) this.spent.set(c.campaigns[0].id, (this.spent.get(c.campaigns[0].id) ?? 0) + cost);
      const u = this.makeUnit(run, s.outcome, `${c.brand.id}:${s.dynasty}:v${s.version}`, c.brand.id, null, {}, []);
      Object.assign(u, { dynasty: s.dynasty, version: s.version, name: s.name, text: s.text, ...(s.parentDynasty ? { parentDynasty: s.parentDynasty } : {}), ...(s.conditions ? { conditions: s.conditions } : {}) });
      this.addUnit(u);
    }
    for (const camp of c.campaigns) {
      this.spent.set(camp.id, this.spent.get(camp.id) ?? 0);
      this.salesFunnelOf(camp, true);
    }
  }

  private ourFactory(): string {
    return this.catalogue.factories.find((f) => f.ours)?.id ?? "ours";
  }

  /** Launch a client (or new campaigns of a known brand) while the world runs. */
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

  /**
   * A new version of a brand dynasty (an edit): from now on the choice that
   * picks this dynasty serves the new head; the dynasty keeps its stats. Made
   * by the script that made the previous head, by hand (no cost).
   */
  addObjectVersion(brandId: string, outcome: OutcomeId, dynasty: string, change: { text: string; name?: string; conditions?: Condition[] }): Unit {
    const head = this.objectHead(brandId, outcome, dynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${dynasty}" for ${brandId}`);
    return this.newObject(head, { dynasty, version: (head.version ?? 1) + 1, ...change });
  }

  /** A fork of a brand dynasty: a new dynasty that starts from its parent's posterior. */
  forkObject(brandId: string, outcome: OutcomeId, parentDynasty: string, change: { dynasty: string; text: string; name?: string; conditions?: Condition[] }): Unit {
    const head = this.objectHead(brandId, outcome, parentDynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${parentDynasty}" for ${brandId}`);
    if (this.objectHead(brandId, outcome, change.dynasty)) throw new Error(`dynasty "${change.dynasty}" already exists`);
    return this.newObject(head, { ...change, version: 1, parentDynasty });
  }

  private newObject(from: Unit, v: { dynasty: string; version: number; text: string; name?: string; conditions?: Condition[]; parentDynasty?: string }): Unit {
    const script = from.scriptId ? this.catalogue.script(from.scriptId) : undefined;
    const leg = from.legId ? this.catalogue.leg(from.legId) : undefined;
    if (!script || !leg) throw new Error("the previous version names no script");
    const run = this.newRun(this.dayIndex, from.campaignId, leg, script);
    run.consumed.push(from.id);
    const u = this.makeUnit(run, from.outcome, `${from.brandId}:${v.dynasty}:v${v.version}`, from.brandId, from.campaignId, { [from.outcome]: from.id }, []);
    Object.assign(u, { dynasty: v.dynasty, version: v.version, name: v.name ?? from.name, text: v.text, ...(v.conditions ?? from.conditions ? { conditions: v.conditions ?? from.conditions } : {}), ...(v.parentDynasty ? { parentDynasty: v.parentDynasty } : {}) });
    // Hidden: an edit moves the effect a little, either way.
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

  /** Choose a campaign's strategy for one leg (its play on that leg). */
  setCampaignStrategy(campaignId: string, legId: string, strategyId: string): void {
    const c = this.campaign(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    const s = this.catalogue.strategy(strategyId);
    if (!s || s.legId !== legId) throw new Error(`strategy "${strategyId}" is not a strategy of ${legId}`);
    if (strategyId === defaultStrategyId(legId)) delete c.strategies[legId];
    else c.strategies[legId] = strategyId;
  }

  // ---- the tick ---------------------------------------------------------------

  step(): DaySnapshot {
    const day = this.dayIndex;
    this.evidence.newDay();
    this.blind.newDay();
    this.dayPicks = new Map();
    const snap: DaySnapshot = { day, spendCents: {}, otherCents: {}, outcomes: {}, valueOurs: {}, valueOther: {}, attempts: {}, pushes: 0 };
    this.today = snap;
    this.spentToday.clear();
    const tpd = this.ticksPerDay;
    this.rate(day);
    const order = this.campaigns().filter((c) => c.status === "running");
    for (let t = 0; t < tpd; t++) {
      this.tickIndex = day * tpd + t;
      // The daily budget is spread over the day's ticks; what a tick leaves is there for the next one.
      for (const c of this.campaigns()) this.budgetLeft.set(c.id, c.status === "running" ? Math.round((c.dailyBudgetCents * (t + 1)) / tpd) - (this.spentToday.get(c.id) ?? 0) : 0);
      this.deliver(day);
      this.webhooks(day, t === 0);
      // All campaigns run each tick, each on its own budget, each on the tree rebuilt for this tick.
      for (const campaign of order) {
        this.rebuildTree(campaign);
        this.notePath(campaign, day);
        if (this.isProactive(campaign)) this.pull(campaign, day);
        else this.advanceOpen(campaign, day);
      }
    }

    if (day > 0 && day % this.world.settings.splitEveryDays === 0) this.studyAndPropose(day);
    this.logChoices(day);
    for (const c of this.campaigns()) if (c.status === "running") this.salesFunnelOf(c, true);
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

  // ---- the production tree ---------------------------------------------------------

  /**
   * The lead states a campaign's tree can pass through: its start, Start, the
   * lead states its offer has, and its Target.
   */
  private treeNodes(campaign: Campaign): OutcomeId[] {
    const offer = this.clientOf(campaign.id)?.offer;
    const kept = new Set<OutcomeId>([campaign.start, campaign.target]);
    for (const o of this.catalogue.outcomes) if (o.track && !o.retired && (offer?.outcomes ?? []).includes(o.id)) kept.add(o.id);
    return [...kept];
  }

  /**
   * The steps out of a lead state toward the Target: every next lead state a
   * leg can make from it with the scripts the campaign's strategy allows.
   */
  stepsFrom(campaign: Campaign, from: OutcomeId): OutcomeId[] {
    const k = `${campaign.id}${SEP}${from}${SEP}${this.dayIndex}`;
    const hit = this.stepsCache.get(k);
    if (hit) return hit;
    const out = this.treeNodes(campaign).filter((to) => to !== from && to !== START && to !== campaign.start && this.playsFor(campaign, from, to).length > 0);
    this.stepsCache.set(k, out);
    return out;
  }

  private readonly stepsCache = new Map<string, OutcomeId[]>();

  /** Cohorts with old evidence faded by the world's half-life, so a world that changes is read again. */
  private faded(cohort: ReadonlyMap<number, Cell> | undefined): Map<number, Cell> | undefined {
    const half = this.world.settings.memoryHalfLifeDays ?? 0;
    if (!cohort || half <= 0) return cohort as Map<number, Cell> | undefined;
    const out = new Map<number, Cell>();
    for (const [d, c] of cohort) {
      const w = Math.pow(0.5, Math.max(0, this.dayIndex - d) / half);
      out.set(d, { t: c.t * w, s: c.s * w, f: c.f * w, c: c.c * w });
    }
    return out;
  }

  /** A step's figures for a campaign: its own cohorts, the fleet's while it has fewer than 20 attempts of its own. */
  private stepCounts(campaign: Campaign, from: OutcomeId, to: OutcomeId): { successes: number; trials: number; costCents: number; attempts: number } {
    const plays = this.playsFor(campaign, from, to);
    const mean = Math.max(...plays.map((p) => this.legDelayMean(p, campaign)), 0);
    const fixed = Math.max(...plays.map((p) => this.legFixedDays(p, campaign)), 0);
    const own = stepCountsOf(this.faded(this.stepCohorts.get(`${campaign.id}${SEP}${stepKey(from, to)}`)), this.dayIndex, mean, fixed);
    if (own.attempts >= 20) return own;
    let acc = { successes: 0, trials: 0, costCents: 0, attempts: 0 };
    for (const c of this.campaigns()) {
      const x = stepCountsOf(this.faded(this.stepCohorts.get(`${c.id}${SEP}${stepKey(from, to)}`)), this.dayIndex, mean, fixed);
      acc = { successes: acc.successes + x.successes, trials: acc.trials + x.trials, costCents: acc.costCents + x.costCents, attempts: acc.attempts + x.attempts };
    }
    return acc;
  }

  /**
   * Rebuild a campaign's production tree for this tick. Pull starts from the
   * Target and goes down, push starts from the start outcome and goes up; both
   * read the same tree: from each lead state, the next one toward the Target
   * worth the most, value flowing backward from the Target (V = y x V(next) - c,
   * section 8; with no value stated, the most Target Units per dollar). A step's yield is drawn from its belief when several steps
   * compete, so a step with little data gets tried; a lead state with a single
   * way up is not drawn.
   */
  private rebuildTree(campaign: Campaign): void {
    const value = this.targetValue(campaign).amount;
    const next = new Map<OutcomeId, OutcomeId>();
    // Per lead state: the chance one attempt reaches the Target, and what it spends on the way.
    const memo = new Map<OutcomeId, { p: number; k: number } | null>();
    // No value stated anywhere: the most Target Units per dollar.
    const worth = (x: { p: number; k: number }) => (value > 0 ? x.p * value - x.k : x.p / Math.max(x.k, 1e-9));
    const visit = (x: OutcomeId, seen: Set<OutcomeId>): { p: number; k: number } | null => {
      if (x === campaign.target) return { p: 1, k: 0 };
      if (memo.has(x)) return memo.get(x)!;
      if (seen.has(x)) return null;
      seen.add(x);
      let best: { p: number; k: number; to: OutcomeId } | null = null;
      const outs = this.stepsFrom(campaign, x);
      for (const to of outs) {
        const up = visit(to, new Set(seen));
        if (!up) continue;
        const c = this.stepCounts(campaign, x, to);
        const yieldMean = (c.successes + 1) / (c.trials + 2);
        const y = outs.length > 1 ? this.treeRng.beta(c.successes + 1, Math.max(0, c.trials - c.successes) + 1) : yieldMean;
        const cost = c.attempts > 0 ? c.costCents / 100 / c.attempts : 0;
        const here = { p: y * up.p, k: cost + y * up.k };
        if (!best || worth(here) > worth(best)) best = { ...here, to };
      }
      if (best) next.set(x, best.to);
      const v = best ? { p: best.p, k: best.k } : null;
      memo.set(x, v);
      return v;
    };
    for (const x of this.treeNodes(campaign)) visit(x, new Set());
    if (this.isProactive(campaign)) visit(START, new Set());
    this.trees.set(campaign.id, next);
  }

  private readonly trees = new Map<string, Map<OutcomeId, OutcomeId>>();
  private readonly treeRng: Rng;

  /** The next lead state toward the Target from a lead state, on this tick's tree (null at the Target or when none leads there). */
  nextOf(campaign: Campaign, from: OutcomeId): OutcomeId | null {
    if (!this.trees.has(campaign.id)) this.rebuildTree(campaign);
    return this.trees.get(campaign.id)!.get(from) ?? null;
  }

  /** Count the path this tick's tree runs, per day: the view reads the one used most. */
  private notePath(campaign: Campaign, day: number): void {
    const key = this.treePath(campaign).join(">");
    if (!key) return;
    let days = this.pathsUsed.get(campaign.id);
    if (!days) this.pathsUsed.set(campaign.id, (days = []));
    const m = (days[day] ??= new Map<string, number>());
    m.set(key, (m.get(key) ?? 0) + 1);
  }

  private readonly pathsUsed = new Map<string, Map<string, number>[]>();

  /**
   * The sales path of a campaign (a view): the lead states its tree went
   * through most over the last 7 days, else the path of this tick's tree.
   */
  pathOf(campaign: Campaign): OutcomeId[] {
    const days = this.pathsUsed.get(campaign.id) ?? [];
    const n = new Map<string, number>();
    for (let d = Math.max(0, this.dayIndex - 7); d <= this.dayIndex; d++) for (const [k, v] of days[d] ?? []) n.set(k, (n.get(k) ?? 0) + v);
    let best: string | null = null;
    for (const [k, v] of n) if (best === null || v > n.get(best)! || (v === n.get(best)! && k < best)) best = k;
    return best ? best.split(">") : this.treePath(campaign);
  }

  /** The lead states this tick's tree runs, from the start to the Target. */
  treePath(campaign: Campaign): OutcomeId[] {
    const line: OutcomeId[] = [];
    let x: OutcomeId | null = campaign.start;
    while (x && x !== campaign.target && line.length < 20) {
      x = this.nextOf(campaign, x);
      if (x) line.push(x);
    }
    return line[line.length - 1] === campaign.target ? line : [];
  }

  /** Steps from a lead state to the Target on this tick's tree (0 at the Target): the most advanced work is served first. */
  private depthOf(campaign: Campaign, x: OutcomeId): number {
    let n = 0;
    for (let y: OutcomeId | null = x; y && y !== campaign.target && n < 20; n++) y = this.nextOf(campaign, y);
    return n;
  }

  /**
   * A proactive Campaign pulls on its Target, down its tree: the most advanced
   * Units first (open work nearest the Target, then Units waiting in the stock
   * at a lead state of the tree), and only then new subjects from the market,
   * with the budget left. Upstream makes nothing downstream did not ask for.
   */
  private pull(campaign: Campaign, day: number): void {
    const client = this.clientOf(campaign.id)!;
    let blocked = false;
    const nodes = this.treeNodes(campaign)
      .filter((x) => x !== campaign.target && x !== START && this.nextOf(campaign, x))
      .sort((x, y) => this.depthOf(campaign, x) - this.depthOf(campaign, y) || this.rankOf(y) - this.rankOf(x));
    // Open work nearest the Target first.
    for (const a of this.openOf(campaign)) if (this.advance(a, day) === "blocked") blocked = true;
    if (blocked) return;
    for (const x of nodes) {
      const to = this.nextOf(campaign, x)!;
      // Units waiting in the stock at this lead state, oldest first.
      const key = `${campaign.id}${SEP}${x}`;
      const list = this.byBrand.get(`${campaign.brandId}${SEP}${x}`) ?? [];
      let i = this.stockRead.get(key) ?? 0;
      for (; i < list.length; i++) {
        const u = list[i]!;
        const person = this.persons.get(u.subject);
        if (!person || this.attemptFrom.has(`${campaign.id}${SEP}${x}${SEP}${person.id}`) || this.reached.get(person.id)?.has(to) || this.reached.get(person.id)?.has(campaign.target)) continue;
        const a = this.newAttempt(campaign, client, x, to, person, day, u.id);
        if (this.advance(a, day) === "blocked") {
          blocked = true;
          i++;
          break;
        }
      }
      this.stockRead.set(key, i);
      if (blocked) return;
    }
    // New subjects from the market, with the budget left (and within the volume per period).
    const first = this.nextOf(campaign, START);
    if (!first) return;
    for (let guard = 0; guard < 20_000; guard++) {
      if ((this.budgetLeft.get(campaign.id) ?? 0) <= 0 || this.volumeReached(campaign, day)) break;
      const a = this.newAttempt(campaign, client, START, first, null, day);
      const made = this.madePerDay.get(campaign.id) ?? [];
      made[day] = (made[day] ?? 0) + 1;
      this.madePerDay.set(campaign.id, made);
      if (this.advance(a, day) === "blocked") break;
    }
  }

  private rankOf(o: OutcomeId): number {
    return this.catalogue.outcome(o)?.track?.rank ?? 0;
  }

  /** A reactive Campaign moves what it pushed, most advanced first, as far as its budget allows. */
  private advanceOpen(campaign: Campaign, day: number): void {
    for (const a of this.openOf(campaign)) this.advance(a, day);
  }

  /** Open attempts of a campaign that can move now (none waiting on a landing), nearest the Target first, oldest first. */
  private openOf(campaign: Campaign): Attempt[] {
    const all = (this.open.get(campaign.id) ?? []).filter((a) => a.status === "open");
    this.open.set(campaign.id, all);
    const ready = all.filter((a) => a.pending.size === 0 && a.wakeTick <= this.tickIndex);
    const depth = new Map<OutcomeId, number>();
    const d = (o: OutcomeId) => {
      let v = depth.get(o);
      if (v === undefined) depth.set(o, (v = o === campaign.target ? 0 : this.depthOf(campaign, o)));
      return v;
    };
    return ready.map((a, i) => ({ a, i })).sort((x, y) => d(x.a.to) - d(y.a.to) || x.i - y.i).map((x) => x.a);
  }

  private volumeReached(campaign: Campaign, day: number): boolean {
    const v = campaign.volume;
    if (!v) return false;
    const made = this.madePerDay.get(campaign.id) ?? [];
    let n = 0;
    for (let d = Math.max(0, day - v.periodDays + 1); d <= day; d++) n += made[d] ?? 0;
    return n >= v.units;
  }

  /** New subjects a campaign made from the market, per day. */
  madeFromMarket(campaignId: string): number[] {
    const made = this.madePerDay.get(campaignId) ?? [];
    return Array.from({ length: this.dayIndex }, (_, d) => made[d] ?? 0);
  }

  /**
   * A reactive Campaign's push: a Unit landed for its brand; it goes up the
   * tree, into the step toward the Target from that outcome (moved this tick
   * if the budget allows, kept open otherwise).
   */
  private push(campaign: Campaign, unit: Unit, day: number): void {
    const person = this.persons.get(unit.subject);
    if (!person || this.reached.get(person.id)?.has(campaign.target)) return;
    const to = this.nextOf(campaign, unit.outcome);
    if (!to || this.reached.get(person.id)?.has(to)) return;
    const prior = this.attemptFrom.get(`${campaign.id}${SEP}${unit.outcome}${SEP}${person.id}`);
    if (prior && prior.status === "open") return;
    this.newAttempt(campaign, this.clientOf(campaign.id)!, unit.outcome, to, person, day, unit.id);
    if (unit.outcome !== campaign.start) return;
    this.pushes.push({ day, campaignId: campaign.id, unitId: unit.id, subject: person.id });
    if (this.today) this.today.pushes++;
  }

  // ---- attempts ----------------------------------------------------------------

  private newAttempt(campaign: Campaign, client: WorldClient, from: OutcomeId, to: OutcomeId, person: Person | null, day: number, startUnit: string | null = null): Attempt {
    const a: Attempt = {
      id: this.attempts.length,
      campaign,
      client,
      from,
      to,
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
      checkedSubject: false,
      spentCents: 0,
      objects: {},
      served: [],
      wakeTick: 0,
    };
    this.attempts.push(a);
    const list = this.open.get(campaign.id) ?? [];
    list.push(a);
    this.open.set(campaign.id, list);
    if (person) {
      this.setPerson(a, person);
      this.enroll(person.id, campaign.id);
    }
    bumpCell(this.stepCohorts, `${campaign.id}${SEP}${stepKey(from, to)}`, day, "t", 1);
    if (this.today) this.today.attempts[campaign.id] = (this.today.attempts[campaign.id] ?? 0) + 1;
    return a;
  }

  /** Move an attempt as far as it can go now. */
  private advance(a: Attempt, day: number): "done" | "wait" | "fail" | "blocked" {
    if (a.status !== "open") return a.status === "done" ? "done" : "fail";
    if (a.subject && this.reached.get(a.subject)?.has(a.to)) {
      this.finish(a, "done");
      return "done";
    }
    const consumer = stepConsumer(a.from, a.to);
    // The play of the step: which leg makes its end, picked by the Supplier rating.
    let legId = a.choices.get(playPoint(a.from, a.to));
    if (!legId) {
      const plays = this.playsFor(a.campaign, a.from, a.to);
      if (plays.length === 0) return this.fail(a, "no play");
      const rem = plays.map((p) => addRem(this.legTicks(p), this.ticksBelow(p, a.from, a))).reduce((x, y) => (y.mean > x.mean ? y : x));
      legId = this.decide(a, playPoint(a.from, a.to), plays.map((p) => p.id), day, rem, Math.ceil(rem.mean * 4));
      a.choices.set(playPoint(a.from, a.to), legId);
    }
    const leg = this.catalogue.leg(legId)!;
    const scripts = this.allowedScripts(a.campaign, null, null, [leg]).filter((s) => this.feasible(a.campaign, s, a.from));
    const r = this.produce(a, consumer, a.to, scripts, NO_REM, true, day);
    if (r.kind === "ok") {
      this.finish(a, "done");
      return "done";
    }
    if (r.kind === "fail") return this.fail(a, r.reason);
    return r.kind === "wait" ? "wait" : "blocked";
  }

  private fail(a: Attempt, _reason: string): "fail" {
    this.finish(a, "failed");
    return "fail";
  }

  private finish(a: Attempt, status: "done" | "failed"): void {
    if (a.status !== "open") return;
    a.status = status;
    // Every choice of the attempt is now settled: those not credited by the end are known failures.
    for (const d of a.decisions) {
      const dec = this.decisions[d]!;
      if (dec.credited) continue;
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "f", 1);
    }
    if (status === "failed") bumpCell(this.stepCohorts, `${a.campaign.id}${SEP}${stepKey(a.from, a.to)}`, a.startDay, "f", 1);
    a.choices.clear();
    a.got.clear();
  }

  /** The outcomes a campaign may start from besides Start (its own start outcome). */
  private startsOf(campaign: Campaign): Set<OutcomeId> {
    return campaign.start === START ? new Set() : new Set([campaign.start]);
  }

  /** Live legs making a step's end whose subject comes from the step's start, with a script the campaign's strategy allows on the way. */
  playsFor(campaign: Campaign, from: OutcomeId, to: OutcomeId): Leg[] {
    const starts = this.startsOf(campaign);
    return this.catalogue
      .providersOf(to)
      .filter((p) => !p.webhook && this.catalogue.rootsOf(p, starts).has(from))
      .filter((p) => this.allowedScripts(campaign, null, null, [p]).some((s) => this.feasible(campaign, s, from)));
  }

  /**
   * Can a script make its Unit from a step's start: its subject Material is the
   * start itself, or a producer its strategy allows can make it from there
   * (down to Start for a script creating subjects).
   */
  feasible(campaign: Campaign, script: Script, from: OutcomeId, seen = new Set<string>()): boolean {
    const k = `${campaign.id}${SEP}${script.id}${SEP}${from}${SEP}${this.dayIndex}`;
    const hit = this.feasibleCache.get(k);
    if (hit !== undefined) return hit;
    if (seen.has(script.id)) return false;
    seen.add(script.id);
    const leg = this.catalogue.leg(script.legId)!;
    const m = this.catalogue.subjectOf(script);
    let v: boolean;
    if (!m) v = from === START && this.catalogue.createsSubjects(leg);
    else if (m === from) v = true;
    else if (this.catalogue.outcome(m)?.track) v = false;
    else {
      const starts = this.startsOf(campaign);
      const rooted = this.catalogue.providersOf(m).filter((p) => !p.webhook && this.catalogue.rootsOf(p, starts).has(from));
      v = this.allowedScripts(campaign, { leg, script }, m, rooted).some((s) => this.feasible(campaign, s, from, new Set(seen)));
    }
    this.feasibleCache.set(k, v);
    return v;
  }

  private readonly feasibleCache = new Map<string, boolean>();

  /** The campaign's strategy on a leg (its play on that leg). */
  strategyOf(campaign: Campaign, legId: string): Strategy | null {
    const id = campaign.strategies[legId];
    return (id ? this.catalogue.strategy(id) : null) ?? this.catalogue.strategy(defaultStrategyId(legId)) ?? null;
  }

  /**
   * The conditions of one Material's Specification: those the consuming
   * script declares in its Bill of materials, and those the campaign's play on
   * the consuming leg states at that Material.
   */
  materialConditions(campaign: Campaign, consumer: Consumer, material: OutcomeId): Condition[] {
    const own = consumer.script.materials.find((m) => m.outcome === material)?.conditions ?? [];
    const play = (this.strategyOf(campaign, consumer.leg.id)?.rules ?? []).filter((r) => r.material === material).flatMap((r) => r.conditions);
    return [...own, ...play];
  }

  /** The conditions of a list a script can be read against (tactics describing scripts). */
  private scriptConditions(conditions: readonly Condition[]): Condition[] {
    return conditions.filter((c) => c.op !== "notReached" && c.tactic !== UNIT_AGE && (this.catalogue.tactic(c.tactic)?.describes.includes("script") ?? true));
  }

  /**
   * The scripts allowed to make a Material: the producers' active dynasty
   * heads, filtered by the Specification's conditions (the consumer's Bill of
   * materials and play at this Material) and by the campaign's strategy (on
   * every script carrying its tactic). `consumer` null = the step's own play,
   * filtered by its leg's rules without a Material.
   */
  allowedScripts(campaign: Campaign, consumer: Consumer | null, material: OutcomeId | null, providers: Leg[]): Script[] {
    let rules: Condition[] = [];
    if (consumer && material) rules = this.materialConditions(campaign, consumer, material);
    else if (providers[0]) rules = (this.strategyOf(campaign, providers[0].id)?.rules ?? []).filter((r) => !r.material).flatMap((r) => r.conditions);
    const conds = this.scriptConditions(rules);
    const campaignWide = this.scriptConditions(campaign.conditions ?? []);
    return providers
      .flatMap((p) => this.catalogue.dynastiesOf(p.id))
      .filter((s) => meetsAll(s.tactics, conds) && campaignWide.every((c) => c.op === "notReached" || s.tactics[c.tactic] === undefined || meetsAll(s.tactics, [c])));
  }

  // ---- the stock and Specifications ------------------------------------------------

  /** The tactic values a Unit is read with: its producer script's tactics and its age. */
  unitValues(u: Unit, day = this.dayIndex): Record<string, TacticValue> {
    const s = u.scriptId ? this.catalogue.script(u.scriptId) : undefined;
    return { ...(s?.tactics ?? {}), [UNIT_AGE]: day - u.day };
  }

  /** The Units in the stock conforming to a Specification, newest first. */
  stock(spec: Specification, day = this.dayIndex): Unit[] {
    const list = spec.subject ? this.bySubject.get(`${spec.subject}${SEP}${spec.outcome}`) : this.brandUnits.get(`${spec.brandId}${SEP}${spec.outcome}`);
    const out: Unit[] = [];
    for (let i = (list?.length ?? 0) - 1; i >= 0 && out.length < spec.quantity; i--) {
      const u = list![i]!;
      if (u.brandId === spec.brandId && conforms(this.unitValues(u, day), spec.conditions)) out.push(u);
    }
    return out;
  }

  /** The candidate a brand Unit stands for at a choice: its dynasty, else its producer script's dynasty. */
  candidateOf(u: Unit): string {
    return u.dynasty ?? (u.scriptId ? this.catalogue.script(u.scriptId)?.dynasty : undefined) ?? u.id;
  }

  // ---- orchestration: the generic code of every leg ------------------------------------

  /**
   * A leg's pull for one Unit: pick the producer (a script of one of the legs
   * making the outcome, rated by the Supplier rating and filtered by the
   * strategy and the Specification), then serve that script its Bill of
   * materials and run it. `consumer` names who asked (the step, or the
   * consuming leg): the choice lives on the Material.
   */
  private produce(a: Attempt, consumer: string, o: OutcomeId, scripts: Script[], remDelay: Rem, final: boolean, day: number): Obtained {
    const key = pointKey(consumer, o);
    const have = a.got.get(key);
    if (have) return { kind: "ok", unit: have };
    if (a.pending.has(key)) return { kind: "wait" };
    let dynasty = a.choices.get(key);
    if (!dynasty) {
      if (scripts.length === 0) return { kind: "fail", reason: `no script at ${key}` };
      // From this choice to the next lead state: what is left to run below it, its own leg, then what is above.
      const legs = scripts.map((s) => this.catalogue.leg(s.legId)!);
      const longest = legs.map((p) => addRem(this.legTicks(p), this.ticksBelow(p, a.from, a))).reduce((x, y) => (y.mean > x.mean ? y : x));
      const rem = addRem(remDelay, longest);
      const horizon = Math.max(...legs.map((p) => p.maturity.horizonDays + 1)) + rem.mean * 3;
      dynasty = this.decide(a, key, scripts.map((s) => s.dynasty), day, rem, Math.ceil(horizon));
      a.choices.set(key, dynasty);
    }
    const script = this.catalogue.headOf(dynasty);
    if (!script) return { kind: "fail", reason: `dynasty ${dynasty} has no active version` };
    const leg = this.catalogue.leg(script.legId)!;
    const me: Consumer = { leg, script };
    const rem = addRem(remDelay, this.legTicks(leg));

    // The subject Material first: nothing else is asked for before the subject is there.
    const subjectMaterial = this.catalogue.subjectOf(script);
    const materials: Record<OutcomeId, string> = {};
    if (subjectMaterial) {
      const r = this.obtain(a, me, subjectMaterial, rem, day);
      if (r.kind !== "ok") return r;
      materials[subjectMaterial] = r.unit;
      if (a.person && !a.checkedSubject) {
        a.checkedSubject = true;
        if (!this.subjectAllowed(a)) return { kind: "fail", reason: "excluded by the play's strategy" };
      }
      // The script decides when to run (a follow-up waits its days since the last message).
      const u = this.unitById.get(r.unit)!;
      const ctx: ScriptContext = { storage: this.storage.forLeg(leg.id), day, tactics: script.tactics };
      if (!scriptReady(ctx, a.person?.id ?? a.subject ?? u.subject, u)) {
        a.wakeTick = (u.day + Number(script.tactics.wait_days)) * this.ticksPerDay;
        return { kind: "wait" };
      }
    }
    // The other Materials of its Bill of materials, asked for together. A Material
    // that takes time leaves the subject waiting; the next tick retries.
    let waiting = false;
    for (const i of billOf(script)) {
      if (i === subjectMaterial) continue;
      const r = this.obtain(a, me, i, rem, day);
      if (r.kind === "fail" || r.kind === "blocked") return r;
      if (r.kind === "wait") waiting = true;
      else materials[i] = r.unit;
    }
    if (waiting) return { kind: "wait" };
    return this.runScript(a, key, leg, script, materials, o, final, day);
  }

  /**
   * One Material of a script's Bill of materials: from the stock when a Unit
   * conforms to its Specification (its subject, the conditions the script
   * declares, the play's), else the OUTCOME is pulled: the best producer is
   * picked and receives the Specification.
   */
  private obtain(a: Attempt, consumer: Consumer, i: OutcomeId, rem: Rem, day: number): Obtained {
    const key = pointKey(consumer.leg.id, i);
    const have = a.got.get(key);
    if (have) return { kind: "ok", unit: have };
    if (a.pending.has(key)) return { kind: "wait" };
    const out = this.catalogue.outcome(i);
    if (!out) return { kind: "fail", reason: `unknown Material ${i}` };
    // The Unit the step started from.
    if (a.startUnit && i === a.from) {
      a.got.set(key, a.startUnit);
      return { kind: "ok", unit: a.startUnit };
    }
    const brandId = a.client.brand.id;
    const conditions = this.materialConditions(a.campaign, consumer, i);
    const providers = this.catalogue.providersOf(i).filter((p) => !p.webhook);
    if (out.subject === "lead" || out.subject === "company") {
      const subject = a.person ? (out.subject === "company" ? a.person.companyId : a.person.id) : null;
      if (subject) {
        // A lead Material continues this subject's story: made since the campaign took it in.
        const since: Condition[] = out.subject === "lead" ? [{ op: "range", tactic: UNIT_AGE, max: day - a.startDay + 1 }] : [];
        const spec: Specification = { outcome: i, subject, brandId, conditions: [...conditions, ...since], quantity: 1 };
        const found = this.stock(spec, day)[0];
        if (found) {
          a.got.set(key, found.id);
          if (out.subject === "company") a.served.push(found.id);
          return { kind: "ok", unit: found.id };
        }
        if (this.inFlight.has(`${i}${SEP}${subject}`)) return { kind: "wait" };
      }
      const starts = this.startsOf(a.campaign);
      const rooted = providers.filter((p) => this.catalogue.rootsOf(p, starts).has(a.from) || (a.from === START && this.catalogue.rootsOf(p).has(START)));
      const scripts = this.allowedScripts(a.campaign, consumer, i, rooted).filter((s) => out.subject !== "lead" || this.feasible(a.campaign, s, a.from));
      return this.produce(a, consumer.leg.id, i, scripts, rem, false, day);
    }
    // A Unit about the run that asks for it (an LLM completion): never in the stock, always ordered.
    if (out.subject === "run") return this.produce(a, consumer.leg.id, i, this.allowedScripts(a.campaign, consumer, i, providers), rem, false, day);
    // A brand Unit: chosen among the conforming ones in the stock, else ordered.
    const conformingUnits = this.stock({ outcome: i, subject: null, brandId, conditions, quantity: Number.MAX_SAFE_INTEGER }, day).reverse();
    const held: string[] = [];
    for (const u of conformingUnits) {
      const c = this.candidateOf(u);
      if (!held.includes(c)) held.push(c);
    }
    if (held.length > 0) {
      let dynasty = a.choices.get(key);
      if (!dynasty || !held.includes(dynasty)) {
        dynasty = held.length > 1 ? this.decide(a, key, held, day, rem) : held[0]!;
        a.choices.set(key, dynasty);
      }
      const u = this.latestOf(conformingUnits.filter((x) => this.candidateOf(x) === dynasty));
      if (!u) return { kind: "fail", reason: `no Unit of ${dynasty}` };
      const dec = a.decisionAt.get(key);
      if (dec !== undefined && this.decisions[dec]!.candidate === dynasty) this.decisionObject.set(dec, u.id);
      else a.served.push(u.id);
      a.objects[i] = dynasty;
      a.got.set(key, u.id);
      return { kind: "ok", unit: u.id };
    }
    if (this.inFlight.has(`${i}${SEP}${brandId}`)) return { kind: "wait" };
    return this.produce(a, consumer.leg.id, i, this.allowedScripts(a.campaign, consumer, i, providers), rem, false, day);
  }

  /** Ticks one run of a leg takes (one at least), counting the tick its ordered Materials take to land (an LLM completion). */
  legTicks(leg: Leg): Rem {
    const ordered = this.catalogue.materialsOf(leg).some((m) => this.catalogue.outcome(m)?.subject === "run") ? 1 : 0;
    const tick = 1 / this.ticksPerDay;
    return { mean: tickDelay(leg.maturity.delayMeanDays, this.ticksPerDay) + ordered * tick, fixed: (1 + ordered) * tick };
  }

  /** Ticks before a leg has its subject Material in hand, from a step's start (none once the attempt holds its subject there). */
  ticksBelow(leg: Leg, from: OutcomeId, a: Attempt | null = null, seen = new Set<string>()): Rem {
    const s = this.catalogue.subjectMaterial(leg);
    if (!s || s === from || this.catalogue.outcome(s)?.track || seen.has(leg.id)) return NO_REM;
    if (a?.person && (this.bySubject.get(`${a.person.id}${SEP}${s}`)?.length ?? 0) > 0) return NO_REM;
    seen.add(leg.id);
    let most = NO_REM;
    for (const p of this.catalogue.providersOf(s)) {
      if (p.webhook) continue;
      const r = addRem(this.legTicks(p), this.ticksBelow(p, from, a, new Set(seen)));
      if (r.mean > most.mean) most = r;
    }
    return most;
  }

  /** The head of a list of brand Units: the highest version, else the latest made. */
  private latestOf(units: readonly Unit[]): Unit | undefined {
    let head: Unit | undefined;
    for (const u of units) if (!head || (u.version ?? 0) >= (head.version ?? 0)) head = u;
    return head;
  }

  /** Dynasties (candidates) of a brand outcome a brand holds in the stock. */
  objectDynasties(brandId: string, outcome: OutcomeId): string[] {
    const out: string[] = [];
    for (const o of this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []) {
      const opt = this.candidateOf(o);
      if (!out.includes(opt)) out.push(opt);
    }
    return out;
  }

  /** Every Unit of a brand outcome a brand holds, oldest first. */
  objectVersions(brandId: string, outcome: OutcomeId): Unit[] {
    return [...(this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? [])];
  }

  /** The head (latest version) of a brand dynasty. */
  objectHead(brandId: string, outcome: OutcomeId, dynasty: string): Unit | undefined {
    return this.latestOf((this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []).filter((o) => this.candidateOf(o) === dynasty));
  }

  /** The play's conditions on its subject (lead tactics, end states reached). */
  private subjectAllowed(a: Attempt): boolean {
    const legId = a.choices.get(playPoint(a.from, a.to));
    if (!legId || !a.person) return true;
    const cond = this.strategyOf(a.campaign, legId)?.subject ?? [];
    if (cond.length === 0) return true;
    return meetsAll(a.person.values, cond, new Set(this.reached.get(a.person.id)?.keys() ?? []));
  }

  // ---- runs ------------------------------------------------------------------------

  /**
   * Hidden: the chance a script creating subjects finds someone today for an
   * audience (its source's coverage, the audience, who it may not pick again
   * yet). For grading only: a script never sees another leg's storage.
   */
  pickChance(script: Script, brandId: string, conditions: readonly Condition[], tries = 60): number {
    const ck = `${this.dayIndex}|${script.id}|${brandId}|${JSON.stringify(conditions)}`;
    const hit = this.pickChanceCache.get(ck);
    if (hit !== undefined) return hit;
    const v = this.computePickChance(script, brandId, conditions, tries);
    this.pickChanceCache.set(ck, v);
    return v;
  }

  private readonly pickChanceCache = new Map<string, number>();

  private computePickChance(script: Script, brandId: string, conditions: readonly Condition[], tries: number): number {
    const coverage = this.truthOf(script, null).coverage ?? 1;
    const window = Number(script.tactics.recontact_days ?? 365);
    const store = this.storage.forLeg(script.legId);
    const step = Math.max(1, Math.floor(this.world.settings.marketSize / 3000));
    let covered = 0;
    let ok = 0;
    for (let i = 0; i < this.world.settings.marketSize; i += step) {
      if (!covers(this.world, script.dynasty, brandId, i, coverage)) continue;
      covered++;
      if (!meetsAll(personOf(this.world, brandId, i).values, conditions)) continue;
      const last = store.get("picked", `${brandId}:p${i}`);
      if (typeof last === "number" && this.dayIndex - last < window) continue;
      ok++;
    }
    if (covered === 0) return 0;
    return 1 - Math.pow(1 - ok / covered, tries);
  }

  /** Hidden truth of a script (at one Material when it differs there). For grading only. */
  scriptTruth(script: Script, point: string | null): ScriptTruth {
    return this.truthOf(script, point);
  }

  /** Hidden truth of a candidate at a point. For grading only. */
  candidateTruthAt(point: string, candidate: string): Partial<ScriptTruth> {
    return this.candidateTruth(point, candidate);
  }

  private truthOf(script: Script, point: string | null): ScriptTruth {
    const base = this.world.truth.scripts[script.id] ?? this.world.truth.scripts[script.dynasty] ?? { costCents: script.costCents };
    const at = point ? this.world.truth.at[point]?.[script.dynasty] : undefined;
    return { ...base, ...(at ?? {}) };
  }

  private candidateTruth(point: string, candidate: string): Partial<ScriptTruth> {
    const s = this.catalogue.headOf(candidate);
    if (s) return this.truthOf(s, point);
    const at = this.world.truth.at[point]?.[candidate];
    if (at) return at;
    return {};
  }

  /** Open a Run: one script on one subject. */
  private newRun(day: number, campaignId: string | null, leg: Leg, script: Script): Run {
    const r: Run = { id: `run:${++this.runCounter}`, legId: leg.id, target: leg.output, day, spendCents: 0, consumed: [], inputs: 1, factory: leg.factory, scriptId: script.id, subjects: 1, ...(campaignId ? { campaignId } : {}) };
    this.runs.push(r);
    return r;
  }

  private makeUnit(run: Run, outcome: OutcomeId, subject: string, brandId: string, campaignId: string | null, materials: Record<OutcomeId, string>, trace: number[]): Unit {
    return { id: `unit:${++this.unitCounter}`, outcome, subject, runId: run.id, day: run.day, brandId, campaignId, factory: run.factory, legId: run.legId, scriptId: run.scriptId ?? null, materials, trace };
  }

  private runScript(a: Attempt, key: string, leg: Leg, script: Script, materials: Record<OutcomeId, string>, o: OutcomeId, final: boolean, day: number): Obtained {
    const ctx: ScriptContext = Object.freeze({ storage: this.storage.forLeg(leg.id), day, tactics: script.tactics });
    const truth = this.truthOf(script, key);
    const ours = this.catalogue.isOurs(leg);
    const creates = this.catalogue.createsSubjects(leg);
    const subjectKey = a.person?.id ?? a.subject ?? "";
    if (!creates && subjectKey && !scriptAccepts(ctx, subjectKey)) return { kind: "fail", reason: "the script does not retry yet" };
    const cost = Math.max(0, Math.round(truth.costCents * (0.85 + 0.3 * this.rng.next())));
    if (ours && cost > (this.budgetLeft.get(a.campaign.id) ?? 0)) return { kind: "blocked" };

    const run = this.newRun(day, a.campaign.id, leg, script);
    run.spendCents += cost;
    for (const id of Object.values(materials)) run.consumed.push(id);
    this.charge(a, cost, ours);

    const pt = this.world.truth.legs[leg.id] ?? { base: 1, delayMeanDays: 0, horizonDays: 0 };
    // The trace: this choice, the choices made at this leg's Materials, and what its Materials carried.
    const trace = new Set<number>();
    const own = a.decisionAt.get(key);
    if (own !== undefined) trace.add(own);
    if (final) {
      const play = a.decisionAt.get(playPoint(a.from, a.to));
      if (play !== undefined) trace.add(play);
    }
    for (const i of billOf(script)) {
      const d = a.decisionAt.get(pointKey(leg.id, i));
      if (d !== undefined) trace.add(d);
      const u = this.unitById.get(materials[i]!);
      if (u) for (const t of u.trace) trace.add(t);
    }

    let subject = a.subject ?? "";
    let fact: boolean;
    let recall = truth.recall ?? 1;
    let fp = truth.falsePositive ?? 0;
    for (const i of billOf(script)) {
      const d = a.decisionAt.get(pointKey(leg.id, i));
      if (d === undefined) continue;
      const t = this.candidateTruth(this.decisions[d]!.point, this.decisions[d]!.candidate);
      if (t.recall !== undefined) recall *= t.recall;
      if (t.falsePositive !== undefined) fp = Math.max(fp, t.falsePositive);
    }
    const kind = this.catalogue.outcome(o)?.subject;
    if (creates) {
      const icp = Object.values(materials).map((id) => this.unitById.get(id)).find((x) => x?.conditions);
      const brandId = a.client.brand.id;
      const coverage = truth.coverage ?? 1;
      const market: MarketView = {
        draw: () => {
          for (let k = 0; k < 50; k++) {
            const i = this.rng.int(this.world.settings.marketSize);
            if (covers(this.world, script.dynasty, brandId, i, coverage)) return i;
          }
          return null;
        },
        inIcp: (i) => meetsAll(personOf(this.world, brandId, i).values, icp?.conditions ?? []),
        keyOf: (i) => `${brandId}:p${i}`,
      };
      const pick = pickFromMarket(ctx, market);
      fact = false;
      if (pick) {
        subject = `${brandId}:r${++this.rawCounter}`;
        this.rawPerson.set(subject, pick.index);
        this.rootFactory.set(subject, leg.factory);
        a.subject = subject;
        a.recontact = pick.recontact;
        let p = pt.base * (truth.step ?? 1);
        if (final) {
          p *= this.endProduct(a, trace);
          const person = personOf(this.world, brandId, pick.index);
          p *= (this.world.clients.find((c) => c.brand.id === brandId)?.truthMultiplier ?? 1) * segmentMultiplier(this.world, person.values) * (pick.recontact ? this.world.truth.recontactMult : 1);
        }
        fact = this.rng.next() < Math.min(0.97, p);
        if (fact && final) {
          // A subject created at the end of its leg is a person at once.
          const person = personOf(this.world, brandId, pick.index);
          this.persons.set(person.id, person);
          if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, leg.factory);
          this.setPerson(a, person);
          this.enroll(person.id, a.campaign.id);
          subject = person.id;
        }
      }
    } else {
      let p = pt.base * (truth.step ?? 1);
      const raw = a.subject && this.rawPerson.has(a.subject) && !a.person ? a.subject : null;
      if (final) {
        p *= this.endProduct(a, trace);
        if (a.person) {
          p *= this.world.clients.find((c) => c.brand.id === a.person!.brandId)?.truthMultiplier ?? 1;
          if (a.from === START) p *= segmentMultiplier(this.world, a.person.values) * (a.recontact ? this.world.truth.recontactMult : 1);
        }
        if (a.from !== a.campaign.start && pt.onFalseInput !== undefined && a.person && !this.truePositive.has(a.person.id) && this.catalogue.factory(this.rootFactory.get(a.person.id) ?? "")?.ours !== false) p *= pt.onFalseInput;
      }
      fact = p >= 1 || this.rng.next() < Math.min(0.97, p);
      if (raw && fact && kind === "lead") {
        // Identity: the raw record becomes a person, the one id space every leg shares.
        const index = this.rawPerson.get(raw)!;
        const person = personOf(this.world, a.client.brand.id, index);
        this.persons.set(person.id, person);
        if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, this.rootFactory.get(raw) ?? leg.factory);
        this.setPerson(a, person);
        this.enroll(person.id, a.campaign.id);
        subject = person.id;
      } else if (kind === "company" && a.person) subject = a.person.companyId;
      else if (kind === "brand") subject = a.client.brand.id;
      else if (kind === "run") subject = run.id;
      else if (a.person) subject = a.person.id;
    }
    const attested = fact ? this.rng.next() < recall : this.rng.next() < fp;
    if (final && fact && a.person && this.catalogue.outcome(o)?.referenceLeg) this.truePositive.set(a.person.id, day);
    if (this.catalogue.outcome(o)?.referenceLeg && a.person) {
      this.attestations.push({ producer: leg.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
      this.attestations.push({ producer: script.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
    }
    if (kind !== "run" && subjectKey) scriptRecords(ctx, subjectKey, attested);
    if (!attested) return { kind: "fail", reason: `no outcome at ${leg.id}` };

    const u = this.makeUnit(run, o, subject, a.client.brand.id, a.campaign.id, materials, [...trace].sort((x, y) => x - y));
    // A Unit advances one leg per tick: it lands at the next tick at the earliest.
    const delay = this.delayTicks(pt.delayMeanDays, pt.horizonDays);
    const flight = `${o}${SEP}${kind === "brand" ? a.client.brand.id : subject}`;
    if (kind === "brand" || kind === "company") this.inFlight.add(flight);
    a.pending.add(key);
    this.pendings.push({ tick: this.tickIndex + delay, attempt: a, key, unit: u, final, flight });
    return { kind: "wait" };
  }

  /** Hidden: the product of the end effects of this attempt's choices on a trace, and of the Units it was served. */
  private endProduct(a: Attempt, trace: Iterable<number>): number {
    let p = 1;
    for (const d of trace) {
      const dec = this.decisions[d]!;
      if (dec.stepEnd !== a.to || dec.attemptId !== a.id) continue;
      const obj = this.decisionObject.get(d);
      p *= obj ? this.objectTruthEnd(this.unitById.get(obj)!) : (this.candidateTruth(dec.point, dec.candidate).end ?? 1);
    }
    for (const id of a.served) p *= this.objectTruthEnd(this.unitById.get(id)!);
    return p;
  }

  /** Hidden: how much a Unit changes the end of the leg it serves (a template's effect, a research's depth). */
  objectTruthEnd(u: Unit): number {
    const drawn = this.unitTruth.get(u.id);
    if (drawn !== undefined) return drawn;
    const seed = this.world.clients.find((c) => c.brand.id === u.brandId)?.seeds.find((s) => s.dynasty === u.dynasty && s.version === u.version);
    if (seed) return seed.truthEnd ?? 1;
    const script = u.scriptId ? this.catalogue.script(u.scriptId) : undefined;
    return script && !u.dynasty ? (this.truthOf(script, null).end ?? 1) : 1;
  }

  private charge(a: Attempt, cents: number, ours: boolean): void {
    if (ours) {
      this.budgetLeft.set(a.campaign.id, (this.budgetLeft.get(a.campaign.id) ?? 0) - cents);
      this.spentToday.set(a.campaign.id, (this.spentToday.get(a.campaign.id) ?? 0) + cents);
      this.spent.set(a.campaign.id, (this.spent.get(a.campaign.id) ?? 0) + cents);
      if (this.today) this.today.spendCents[a.campaign.id] = (this.today.spendCents[a.campaign.id] ?? 0) + cents;
    } else if (this.today) this.today.otherCents[a.campaign.id] = (this.today.otherCents[a.campaign.id] ?? 0) + cents;
    a.spentCents += cents;
    for (const d of a.decisions) {
      const dec = this.decisions[d]!;
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "c", cents);
    }
    // Leg economics read our own spend: what another factory charges is its cost, not ours.
    if (ours) bumpCell(this.stepCohorts, `${a.campaign.id}${SEP}${stepKey(a.from, a.to)}`, a.startDay, "c", cents);
    const root = a.from === a.campaign.start ? a : a.person ? this.attemptFrom.get(`${a.campaign.id}${SEP}${a.campaign.start}${SEP}${a.person.id}`) : undefined;
    if (root && ours) {
      const k = `${a.campaign.id}${SEP}${root.id}`;
      const s = this.subjectsByCampaign.get(k) ?? { entryDay: root.startDay, spendCents: 0, value: 0 };
      s.spendCents += cents;
      this.subjectsByCampaign.set(k, s);
    }
  }

  /** A run's delay in ticks: its days, at least the next tick. */
  private delayTicks(meanDays: number, horizonDays: number): number {
    return Math.max(1, this.sampleDelay(meanDays, horizonDays) * this.ticksPerDay);
  }

  private sampleDelay(mean: number, horizon: number): number {
    if (mean <= 0) return 0;
    const q = 1 / (1 + mean);
    const u = 1 - this.rng.next();
    return Math.min(horizon, Math.floor(Math.log(u) / Math.log(1 - q)));
  }

  // ---- landing ------------------------------------------------------------------------

  private addUnit(u: Unit): void {
    this.units.push(u);
    this.unitById.set(u.id, u);
    if (u.dynasty && u.parentDynasty && !this.parentDynasty.has(u.dynasty)) this.parentDynasty.set(u.dynasty, u.parentDynasty);
    const kind = this.catalogue.outcome(u.outcome)?.subject;
    if (kind === "brand") {
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
      p.attempt.pending.delete(p.key);
      if (p.attempt.status !== "open") continue;
      p.attempt.got.set(p.key, p.unit.id);
      if (p.final) this.finish(p.attempt, "done");
    }
  }

  /** A Unit lands in the stock: record it, credit the trace, push reactive campaigns, call webhooks that report on it. */
  private land(u: Unit, day: number): void {
    this.addUnit(u);
    const out = this.catalogue.outcome(u.outcome);
    if (out?.subject === "lead" || out?.subject === "company") {
      const k = `${u.subject}${SEP}${u.outcome}`;
      const list = this.bySubject.get(k);
      if (list) list.push(u);
      else this.bySubject.set(k, [u]);
    }
    for (const p of this.catalogue.legs) {
      const on = this.world.truth.legs[p.id]?.webhook?.on;
      if (!p.webhook || on !== u.outcome || !this.catalogue.isLegLive(p)) continue;
      const client = this.world.clients.find((c) => c.brand.id === u.brandId);
      if (!client?.connected.includes(p.id)) continue;
      const pt = this.world.truth.legs[p.id]!;
      if (this.rng.next() >= pt.base) continue;
      this.webhookCalls.push({ tick: this.tickIndex + this.delayTicks(pt.delayMeanDays, pt.horizonDays), legId: p.id, about: u.id });
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

    // Credit every choice on the trace that exists for this outcome, for this subject.
    for (const d of u.trace) {
      const dec = this.decisions[d]!;
      if (dec.credited || dec.stepEnd !== u.outcome) continue;
      const at = this.attempts[dec.attemptId]!;
      if (at.person?.id !== u.subject) continue;
      dec.credited = true;
      // Settled as a failure when its attempt ended, and reached after all (another producer attested it).
      if (at.status !== "open") this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "f", -1);
      this.evidence.bump(dec.point, dec.candidate, dec.brandId, dec.day, "s", 1);
    }

    // Reactive campaigns starting from this outcome: the Unit is pushed into their first leg.
    for (const c of this.campaigns()) if (c.status === "running" && c.start === u.outcome && c.brandId === u.brandId) this.push(c, u, day);

    if (!first) return;
    for (const cid of this.enrolled.get(u.subject) ?? []) {
      const campaign = this.campaign(cid);
      // A campaign counts what its own runs made, and what another factory brought or attested.
      if (!campaign || (u.campaignId !== null && u.campaignId !== cid)) continue;
      // The step of this campaign that just reached its end.
      const done = this.attemptTo.get(`${cid}${SEP}${u.outcome}${SEP}${u.subject}`);
      if (!done && !this.pathOf(campaign).includes(u.outcome)) continue;
      if (this.today) {
        const o = (this.today.outcomes[cid] ??= {});
        o[u.outcome] = (o[u.outcome] ?? 0) + 1;
      }
      if (done && !this.legDone.has(done.id)) {
        this.legDone.add(done.id);
        bumpCell(this.stepCohorts, `${cid}${SEP}${stepKey(done.from, done.to)}`, done.startDay, "s", 1);
      }
      if (u.outcome === campaign.target) this.creditValue(campaign, u.subject);
      // A reactive campaign pushes the Unit on up its tree; a proactive one pulls it from the stock.
      else if (!this.isProactive(campaign) && campaign.status === "running" && done) this.push(campaign, u, day);
    }
  }

  private readonly legDone = new Set<number>();

  private setPerson(a: Attempt, person: Person): void {
    a.person = person;
    a.subject = person.id;
    this.attemptFrom.set(`${a.campaign.id}${SEP}${a.from}${SEP}${person.id}`, a);
    this.attemptTo.set(`${a.campaign.id}${SEP}${a.to}${SEP}${person.id}`, a);
  }
  private readonly decisionObject = new Map<number, string>();
  private readonly unitTruth = new Map<string, number>();
  /** The attempt of each campaign for each person, by the lead state it started from, and by the one it goes to. */
  private readonly attemptFrom = new Map<string, Attempt>();
  private readonly attemptTo = new Map<string, Attempt>();
  /** The step's end each point was last decided for, per campaign. */
  private readonly pointStep = new Map<string, OutcomeId>();

  private enroll(subject: string, campaignId: string): void {
    let s = this.enrolled.get(subject);
    if (!s) this.enrolled.set(subject, (s = new Set()));
    s.add(campaignId);
  }

  private creditValue(campaign: Campaign, subject: string): void {
    const key = `${campaign.id}${SEP}${subject}`;
    if (this.valueCredited.has(key)) return;
    this.valueCredited.add(key);
    const v = this.targetValue(campaign).amount;
    const ours = this.catalogue.factory(this.rootFactory.get(subject) ?? "")?.ours ?? false;
    if (this.today) {
      const bucket = ours ? this.today.valueOurs : this.today.valueOther;
      bucket[campaign.id] = (bucket[campaign.id] ?? 0) + v;
    }
    if (ours) {
      const root = this.attemptFrom.get(`${campaign.id}${SEP}${campaign.start}${SEP}${subject}`);
      if (root) {
        const s = this.subjectsByCampaign.get(`${campaign.id}${SEP}${root.id}`);
        if (s) s.value += v;
      }
    }
  }

  // ---- the Supplier rating, webhooks ---------------------------------------------------

  /** The outcome Supplier rating legs make (content type "rating"). */
  ratingOutcome(): OutcomeId | null {
    return this.catalogue.outcomes.find((o) => o.contentType === "rating" && !o.retired)?.id ?? null;
  }

  /**
   * The Supplier rating, an auxiliary cost center: at each tick its leg reads
   * the ledger and the traceability and makes today's Rating for each brand
   * with a running campaign. Every choosing leg takes it as a Material; its
   * cost goes to the legs that consume it.
   */
  private rate(day: number): void {
    const outcome = this.ratingOutcome();
    if (!outcome) return;
    const leg = this.catalogue.providersOf(outcome).find((p) => !p.webhook);
    const script = leg ? this.catalogue.dynastiesOf(leg.id)[0] : undefined;
    if (!leg || !script) return;
    for (const brandId of this.brandIds) {
      if (!this.campaigns().some((c) => c.brandId === brandId && c.status === "running")) continue;
      const run = this.newRun(day, null, leg, script);
      run.spendCents += Math.round(this.truthOf(script, null).costCents);
      this.land(this.makeUnit(run, outcome, brandId, brandId, null, {}, []), day);
    }
  }

  /** Today's Rating of a brand (null when none was made). */
  ratingOf(brandId: string): Unit | null {
    const outcome = this.ratingOutcome();
    if (!outcome) return null;
    const list = this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? [];
    return list[list.length - 1] ?? null;
  }

  /**
   * Webhooks: legs of other factories with no internal Material, run when the
   * other factory calls them. The organic market brings leads; the client's CRM
   * attests what it saw; the mailbox reports a message sent. Their Units land
   * in the stock, available to every campaign.
   */
  private webhooks(day: number, firstTick: boolean): void {
    const calls = this.webhookCalls.filter((c) => c.tick <= this.tickIndex);
    if (calls.length > 0) {
      const rest = this.webhookCalls.filter((c) => c.tick > this.tickIndex);
      this.webhookCalls.length = 0;
      this.webhookCalls.push(...rest);
      for (const c of calls) {
        const leg = this.catalogue.leg(c.legId)!;
        const script = this.catalogue.dynastiesOf(leg.id)[0];
        const about = this.unitById.get(c.about);
        if (!script || !about) continue;
        const run = this.newRun(day, null, leg, script);
        // The call names the Unit it reports on: the new Unit carries its traceability.
        this.land(this.makeUnit(run, leg.output, about.subject, about.brandId, null, {}, about.trace), day);
      }
    }
    if (!firstTick) return;
    for (const leg of this.catalogue.legs) {
      if (!leg.webhook || !this.catalogue.isLegLive(leg)) continue;
      const wh = this.world.truth.legs[leg.id]?.webhook;
      if (!wh || wh.on) continue;
      const script = this.catalogue.dynastiesOf(leg.id)[0];
      if (!script) continue;
      const truth = this.truthOf(script, null);
      const pt = this.world.truth.legs[leg.id]!;
      for (const client of this.world.clients) {
        if (wh.creates) {
          const n = this.rng.binomial(Math.round(client.organicPerDay * 4), 0.25);
          for (let i = 0; i < n; i++) {
            const index = this.rng.int(this.world.settings.marketSize);
            const person = personOf(this.world, client.brand.id, index);
            if (this.reached.get(person.id)?.has(leg.output)) continue;
            this.persons.set(person.id, person);
            if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, leg.factory);
            const run = this.newRun(day, null, leg, script);
            this.land(this.makeUnit(run, leg.output, person.id, client.brand.id, null, {}, []), day);
          }
          continue;
        }
        if (!wh.attests || !client.connected.includes(leg.id)) continue;
        // An attesting webhook: the other factory reports the facts it sees, with its own recall.
        for (const [personId, factDay] of this.truePositive) {
          if (factDay + pt.delayMeanDays !== day) continue;
          const person = this.persons.get(personId);
          if (!person || person.brandId !== client.brand.id) continue;
          const attested = this.rng.next() < (truth.recall ?? 1);
          this.attestations.push({ producer: leg.id, outcome: leg.output, brandId: client.brand.id, subject: personId, attested });
          if (!attested) continue;
          const run = this.newRun(day, null, leg, script);
          this.land(this.makeUnit(run, leg.output, personId, client.brand.id, null, {}, []), day);
        }
      }
    }
  }

  // ---- decisions and beliefs -----------------------------------------------------------

  /** One choice for one subject: the universal prioritizer over the candidates at a point, on today's Rating. */
  private decide(a: Attempt, point: string, candidates: string[], day: number, remDelay: Rem, horizon = 0): string {
    this.evidence.offer(point, candidates, remDelay.mean, horizon, remDelay.fixed);
    this.blind.offer(point, candidates, remDelay.mean, horizon, remDelay.fixed);
    const offered = this.dayPicksAll.get(`${point}${SEP}${a.campaign.id}`) ?? new Set<string>();
    for (const o of candidates) offered.add(o);
    this.dayPicksAll.set(`${point}${SEP}${a.campaign.id}`, offered);
    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      const value = this.stepValue(a);
      const book = this.bookOf(a.client.brand.id);
      const priced: PricedCandidate[] = candidates.map((o) => ({ id: o, ...book.belief(point, o, candidates, a.client.brand.id, day) }));
      chosen = prioritize(priced, value, this.rng).chosenId;
    }
    this.pointStep.set(`${point}${SEP}${a.campaign.id}`, a.to);
    const id = this.decisions.length;
    this.decisions.push({ id, point, candidate: chosen, campaignId: a.campaign.id, brandId: a.client.brand.id, stepEnd: a.to, attemptId: a.id, day, credited: false });
    a.decisions.push(id);
    a.decisionAt.set(point, id);
    this.evidence.bump(point, chosen, a.client.brand.id, day, "t", 1);
    const pk = `${point}${SEP}${a.campaign.id}`;
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

  /** The evidence a brand's Rating reads: the ledger; a Rating script that reads no evidence gives every candidate its prior. */
  private bookOf(brandId: string): EvidenceBook {
    const r = this.ratingOf(brandId);
    const script = r?.scriptId ? this.catalogue.script(r.scriptId) : undefined;
    return script?.tactics.reads_evidence === false ? this.blind : this.evidence;
  }

  private groupOf(brandId: string): string {
    const b = this.world.clients.find((c) => c.brand.id === brandId)?.brand;
    return String(b?.tactics[this.world.settings.clientGroupTactic] ?? "");
  }

  /** The belief about one candidate at one point for one client, as the brand's Rating reads it (see EvidenceBook.belief). */
  belief(point: string, candidate: string, candidates: readonly string[], brandId: string, day: number) {
    return this.bookOf(brandId).belief(point, candidate, candidates, brandId, day);
  }

  /** The parent dynasty of a forked candidate (a script dynasty, or a brand dynasty such as a finer ICP). */
  private parentOf(candidate: string): string | null {
    const s = this.catalogue.versionsOf(candidate)[0];
    if (s?.parentDynasty) return s.parentDynasty;
    return this.parentDynasty.get(candidate) ?? null;
  }

  /** The parent of each forked brand dynasty (a finer ICP). */
  private readonly parentDynasty = new Map<string, string>();

  /** Value of one Unit at the end of an attempt's step (backward from the campaign's Target, along today's tree). */
  private stepValue(a: Pick<Attempt, "campaign" | "to">): number {
    const ck = `${a.campaign.id}${SEP}${a.to}`;
    if (this.stepValueDay !== this.dayIndex) {
      this.stepValueCache.clear();
      this.stepValueDay = this.dayIndex;
    }
    const hit = this.stepValueCache.get(ck);
    if (hit !== undefined) return hit;
    const v = this.computeStepValue(a);
    this.stepValueCache.set(ck, v);
    return v;
  }

  private readonly stepValueCache = new Map<string, number>();
  private stepValueDay = -1;

  private computeStepValue(a: Pick<Attempt, "campaign" | "to">): number {
    const target = this.targetValue(a.campaign).amount;
    const steps: { costPerAttempt: number; yieldRate: number }[] = [];
    for (let x: OutcomeId | null = a.to, n = 0; x && x !== a.campaign.target && n < 20; n++) {
      const to: OutcomeId | null = this.nextOf(a.campaign, x);
      if (!to) break;
      const e = this.stepEstimate(a.campaign, x, to);
      steps.push({ costPerAttempt: e.costPerAttempt ?? 0, yieldRate: e.yieldRate ?? 0.5 });
      x = to;
    }
    const { values } = valueBackwardLine(steps, target);
    return Math.max(values[0] ?? target, target * 0.01);
  }

  // ---- reports: the views ------------------------------------------------------------

  /** Where a campaign's tree starts: Start, or its start outcome. */
  startOf(campaign: Campaign): OutcomeId {
    return campaign.start;
  }

  /** The sales path a campaign's tree runs today (a view, named on first sight). */
  salesPathOf(campaign: Campaign) {
    return this.catalogue.peekSalesPath(campaign.start, this.pathOf(campaign));
  }

  /** The steps of the sales path the tree runs today, from one lead state to the next. */
  stepsOf(campaign: Campaign): { from: OutcomeId; to: OutcomeId }[] {
    const line = this.pathOf(campaign);
    return line.map((to, k) => ({ from: k === 0 ? campaign.start : line[k - 1]!, to }));
  }

  /** The leg that made each lead state of today's sales path: the play picked most over the last 7 days. */
  playsToday(campaign: Campaign): (string | null)[] {
    return this.stepsOf(campaign).map(({ from, to }) => {
      const plays = this.playsFor(campaign, from, to);
      let best: string | null = plays[0]?.id ?? null;
      let bestN = 0;
      for (const [o, arr] of this.pickSeries(playPoint(from, to), campaign.id)) {
        const n = arr.slice(-7).reduce((x, y) => x + y, 0);
        if (n > bestN || (n === bestN && n > 0 && best !== null && o < best)) {
          best = o;
          bestN = n;
        }
      }
      return best;
    });
  }

  /**
   * The sales funnel a campaign's tree runs today (a view): its sales path and
   * the leg that made each lead state. `name` stores the names (the session does
   * it once a day, in campaign order, so a seed always gives the same names);
   * otherwise nothing is stored.
   */
  salesFunnelOf(campaign: Campaign, name = false) {
    const line = this.pathOf(campaign);
    if (line.length === 0) return null;
    const plays = this.playsToday(campaign);
    if (plays.some((p) => p === null)) return null;
    return name ? this.catalogue.nameSalesFunnel(campaign.start, line, plays as string[]) : this.catalogue.peekSalesFunnel(campaign.start, line, plays as string[]);
  }

  /**
   * Every leg a step runs through, in the order they run: the explosion of the
   * Bill of materials of the script each leg runs most (over the last 7 days,
   * else the first allowed), each Material with the leg that supplies it, down
   * to the step's start, then the play itself. `main` marks the chain that
   * carries the subject; the others feed a Material of a leg on it (a research,
   * a model call). `campaign` null reads the picks of every campaign.
   */
  stepLegs(play: string, from: OutcomeId, campaign: Campaign | null): StepLeg[] {
    const out: StepLeg[] = [];
    const seen = new Set<string>();
    const strategic = campaign ?? ({ strategies: {}, start: from, target: from } as unknown as Campaign);
    const starts = this.startsOf(strategic);
    const mostPicked = (point: string, fallback: string | null): string | null => {
      let best = fallback;
      let bestN = 0;
      for (const [c, arr] of this.pickSeries(point, campaign?.id)) {
        const n = arr.slice(-7).reduce((x, y) => x + y, 0);
        if (n > bestN || (n === bestN && n > 0 && best !== null && c < best)) {
          best = c;
          bestN = n;
        }
      }
      return best;
    };
    const visit = (legId: string, script: Script | null, feeds: { leg: string; material: OutcomeId } | null, main: boolean) => {
      if (seen.has(legId)) return;
      seen.add(legId);
      const leg = this.catalogue.leg(legId);
      if (!leg) return;
      const runs = script ?? this.catalogue.dynastiesOf(legId)[0] ?? null;
      const bill = runs ? billOf(runs) : [];
      const subject = runs ? this.catalogue.subjectOf(runs) : null;
      const order = subject ? [subject, ...bill.filter((i) => i !== subject)] : bill;
      const supplied: { material: OutcomeId; leg: string | null }[] = [];
      for (const i of order) {
        const o = this.catalogue.outcome(i);
        if (!o) continue;
        if (o.track || i === from || o.contentType === "rating") {
          supplied.push({ material: i, leg: null });
          continue;
        }
        const providers = this.catalogue.providersOf(i).filter((p) => !p.webhook);
        const series = this.pickSeries(pointKey(legId, i), campaign?.id);
        let candidates: Leg[];
        if (o.subject === "brand") candidates = providers.filter((p) => this.catalogue.dynastiesOf(p.id).some((s) => series.has(s.dynasty)));
        else if (o.subject === "run") candidates = providers;
        else candidates = providers.filter((p) => this.catalogue.rootsOf(p, starts).has(from) || this.catalogue.rootsOf(p).has(START));
        if (candidates.length === 0 || !runs) {
          supplied.push({ material: i, leg: null });
          continue;
        }
        const scripts = this.allowedScripts(strategic, { leg, script: runs }, i, candidates);
        const best = mostPicked(pointKey(legId, i), scripts[0]?.dynasty ?? null);
        const head = best ? this.catalogue.headOf(best) : undefined;
        const provider = head?.legId ?? candidates[0]?.id;
        supplied.push({ material: i, leg: provider ?? null });
        if (provider) visit(provider, head && head.legId === provider ? head : null, { leg: legId, material: i }, main && i === subject);
      }
      out.push({ legId, output: leg.output, scriptId: runs?.id ?? null, materials: supplied, feeds, main });
    };
    const end = this.catalogue.leg(play)?.output ?? from;
    const stepScript = mostPicked(pointKey(stepConsumer(from, end), end), null);
    const head = stepScript ? this.catalogue.headOf(stepScript) : undefined;
    visit(play, head && head.legId === play ? head : null, null, true);
    return out;
  }

  /** Every leg each step of a campaign's tree runs through today (see `stepLegs`), step by step. */
  campaignLegs(campaign: Campaign): StepLeg[][] {
    const plays = this.playsToday(campaign);
    return this.stepsOf(campaign).map(({ from }, k) => {
      const play = plays[k];
      return play ? this.stepLegs(play, from, campaign) : [];
    });
  }

  /**
   * The production tree a campaign actually used over the last 7 days, per
   * outcome it made: each branch (the leg that made it), its share of the Units
   * and its cost of this step per Unit.
   */
  productionTree(campaignId: string, days = 7): { outcome: OutcomeId; units: number; branches: { legId: string; units: number; share: number; costPerUnit: number | null }[] }[] {
    const since = this.dayIndex - days;
    const made = new Map<OutcomeId, Map<string, number>>();
    const spend = new Map<string, number>();
    const unitsOfRun = new Set<string>();
    for (const u of this.units) {
      if (u.campaignId !== campaignId || u.day < since || !u.legId) continue;
      const m = made.get(u.outcome) ?? new Map<string, number>();
      m.set(u.legId, (m.get(u.legId) ?? 0) + 1);
      made.set(u.outcome, m);
      unitsOfRun.add(u.runId);
    }
    for (const r of this.runs) {
      if (r.campaignId !== campaignId || r.day < since || !r.legId) continue;
      spend.set(r.legId, (spend.get(r.legId) ?? 0) + r.spendCents);
    }
    const out: { outcome: OutcomeId; units: number; branches: { legId: string; units: number; share: number; costPerUnit: number | null }[] }[] = [];
    for (const [outcome, byLeg] of made) {
      const total = [...byLeg.values()].reduce((x, y) => x + y, 0);
      const branches = [...byLeg]
        .map(([legId, units]) => ({ legId, units, share: units / total, costPerUnit: units > 0 ? (spend.get(legId) ?? 0) / 100 / units : null }))
        .sort((x, y) => y.units - x.units || (x.legId < y.legId ? -1 : 1));
      out.push({ outcome, units: total, branches });
    }
    return out;
  }

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

  /** One step of a campaign as the decisions read it: censoring-corrected yield and measured cost per attempt. */
  stepEstimate(campaign: Campaign, from: OutcomeId, to: OutcomeId, day = this.dayIndex): StepEstimate {
    const plays = this.playsFor(campaign, from, to);
    const mean = Math.max(...plays.map((p) => this.legDelayMean(p, campaign)), 0);
    const fixed = Math.max(...plays.map((p) => this.legFixedDays(p, campaign)), 0);
    return { from, to, ...stepEstimateOf(this.stepCohorts.get(`${campaign.id}${SEP}${stepKey(from, to)}`), day, mean, fixed) };
  }

  /** Each step of the sales path a campaign's tree runs today. */
  stepEstimates(campaign: Campaign, day = this.dayIndex): StepEstimate[] {
    return this.stepsOf(campaign).map(({ from, to }) => this.stepEstimate(campaign, from, to, day));
  }

  /** Mean delay from a step's start to its end through a leg (the longest chain of subject Materials, a tick per leg). */
  legDelayMean(leg: Leg, campaign: Campaign | null = null, seen = new Set<string>()): number {
    if (seen.has(leg.id)) return 0;
    seen.add(leg.id);
    const ordered = this.catalogue.materialsOf(leg).some((m) => this.catalogue.outcome(m)?.subject === "run") ? 1 : 0;
    const own = tickDelay(this.world.truth.legs[leg.id]?.delayMeanDays ?? leg.maturity.delayMeanDays, this.ticksPerDay) + ordered / this.ticksPerDay;
    const s = this.catalogue.subjectMaterial(leg);
    const out = s ? this.catalogue.outcome(s) : undefined;
    if (!s || out?.track || (campaign && s === campaign.start)) return own;
    return own + Math.max(0, ...this.catalogue.providersOf(s).filter((p) => !p.webhook).map((p) => this.legDelayMean(p, campaign, new Set(seen))));
  }

  /** Days certain from a step's start to its end through a leg: one per leg on its longest chain, and one per ordered Material. */
  legFixedDays(leg: Leg, campaign: Campaign | null = null, seen = new Set<string>()): number {
    if (seen.has(leg.id)) return 0;
    seen.add(leg.id);
    const own = this.legTicks(leg).fixed;
    const s = this.catalogue.subjectMaterial(leg);
    const out = s ? this.catalogue.outcome(s) : undefined;
    if (!s || out?.track || (campaign && s === campaign.start)) return own;
    return own + Math.max(0, ...this.catalogue.providersOf(s).filter((p) => !p.webhook).map((p) => this.legFixedDays(p, campaign, new Set(seen))));
  }

  /** Expected and measured return of a campaign, on the same formula: value / cost per Target Unit. */
  economics(campaignId: string): CampaignEconomics {
    const campaign = this.campaign(campaignId)!;
    const tv = this.targetValue(campaign);
    const steps = this.stepEstimates(campaign);
    let spendCents = 0;
    let valueOurs = 0;
    let valueOther = 0;
    for (const d of this.days) {
      spendCents += d.spendCents[campaignId] ?? 0;
      valueOurs += d.valueOurs[campaignId] ?? 0;
      valueOther += d.valueOther[campaignId] ?? 0;
    }
    // Expected: the chain formula on the decision estimates, with a delta-method interval.
    let expected: CampaignEconomics["expected"] = { value: null, low: null, high: null };
    if (steps.length > 0 && steps.every((l) => l.yieldRate !== null && l.costPerAttempt !== null)) {
      const chain = steps.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! }));
      const t = chainCostPerTarget(chain);
      if (Number.isFinite(t) && t > 0) {
        const v = tv.amount / t;
        let rel2 = 0;
        for (const l of steps) if (l.attempts > 0 && l.yieldRate) rel2 += (1 - l.yieldRate) / (l.attempts * l.yieldRate);
        const rel = Math.sqrt(rel2);
        expected = { value: v, low: v * Math.exp(-1.96 * rel), high: v * Math.exp(1.96 * rel) };
      }
    }
    // Measured on the mature basis: subjects that entered before the tree's delay horizon.
    const horizon = Math.ceil(steps.reduce((s, l) => s + Math.max(0, ...this.playsFor(campaign, l.from, l.to).map((p) => this.legDelayMean(p, campaign))) * 3, 0));
    const cutoffDay = this.dayIndex - horizon;
    let mSpend = 0;
    let mValue = 0;
    for (const [k, s] of this.subjectsByCampaign) {
      if (!k.startsWith(`${campaignId}${SEP}`) || s.entryDay > cutoffDay) continue;
      mSpend += s.spendCents;
      mValue += s.value;
    }
    const targets = tv.amount > 0 ? Math.round(mValue / tv.amount) : 0;
    const mv = mSpend > 0 ? mValue / (mSpend / 100) : null;
    const rel = targets > 0 ? 1 / Math.sqrt(targets) : null;
    const measured = {
      value: mv,
      low: mv !== null && rel !== null ? mv * Math.exp(-1.96 * rel) : null,
      high: mv !== null && rel !== null ? mv * Math.exp(1.96 * rel) : null,
      targets,
      spendCents: mSpend,
      cutoffDay,
    };
    return { campaignId, spendCents, valueOurs, valueOther, targetsOurs: tv.amount > 0 ? Math.round(valueOurs / tv.amount) : 0, measured, expected, steps, targetValue: tv.amount, valueLabel: tv.label };
  }

  /**
   * The rows of a campaign page: per step of today's sales path, its attempts
   * per Target Unit, its cost of this step per outcome and its cost from Start
   * (cumulative: the one the return reads).
   */
  stepCosts(campaign: Campaign): { from: OutcomeId; to: OutcomeId; attemptsPerTarget: number | null; costOfStep: number | null; costFromStart: number | null }[] {
    const steps = this.stepEstimates(campaign);
    const ok = steps.every((l) => l.yieldRate !== null && l.costPerAttempt !== null && l.yieldRate > 0);
    const chain = ok ? steps.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! })) : [];
    const forward = ok ? costForwardLine(chain) : [];
    const per = ok ? stepBreakdown(chain) : [];
    return steps.map((l, k) => ({
      from: l.from,
      to: l.to,
      attemptsPerTarget: ok ? per[k]!.attemptsPerTarget : null,
      costOfStep: l.yieldRate && l.costPerAttempt !== null ? l.costPerAttempt / l.yieldRate : null,
      costFromStart: ok ? forward[k]! : null,
    }));
  }

  /** Picks per day per candidate at a point, for one campaign (or every campaign). */
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

  /** Every (point, campaign) where a choice was made. */
  choicePoints(): { point: string; campaignId: string }[] {
    return [...this.picks.keys()].map((k) => {
      const [point, campaignId] = k.split(SEP) as [string, string];
      return { point, campaignId };
    });
  }

  /** The candidates a campaign has at a point today (a brand point offers the brand's own dynasties in the stock). */
  candidatesFor(point: string, campaign: Campaign): string[] {
    const material = point.split("|")[1] ?? "";
    const out = this.catalogue.outcome(material);
    if (out?.subject === "brand") {
      const held = this.objectDynasties(campaign.brandId, material);
      if (held.length > 0) return held;
    }
    const seen = new Set(this.dayPicksAll.get(`${point}${SEP}${campaign.id}`) ?? []);
    const offered = this.candidatesAt(point).filter((o) => seen.has(o));
    return offered.length > 0 ? offered : this.candidatesAt(point);
  }

  /** The candidates ever offered at a point. */
  candidatesAt(point: string): string[] {
    return [...(this.evidence.pointCandidates.get(point) ?? [])];
  }

  /** Today's belief of each candidate at a point, for a campaign: mean rate, its spread, mean cost, mean value per dollar. */
  beliefsAt(point: string, campaignId: string): { candidate: string; rate: number; rateSd: number; cost: number; valuePerDollar: number; decisions: number; successes: number }[] {
    const campaign = this.campaign(campaignId);
    if (!campaign) return [];
    const candidates = this.candidatesFor(point, campaign);
    const brandId = campaign.brandId;
    const delay = this.evidence.delayOf(point);
    const value = this.stepValue({ campaign, to: this.pointStep.get(`${point}${SEP}${campaign.id}`) ?? campaign.target });
    return candidates.map((o) => {
      const b = this.belief(point, o, candidates, brandId, this.dayIndex);
      const c = this.evidence.counts(point, o, [brandId], this.dayIndex, delay);
      return { candidate: o, rate: betaMean(b.posterior), rateSd: Math.sqrt(betaVariance(b.posterior)), cost: b.cost.mean, valuePerDollar: (betaMean(b.posterior) * value) / Math.max(b.cost.mean, 1e-6), decisions: c.n, successes: c.successes };
    });
  }

  private logChoices(day: number): void {
    for (const [k, picks] of this.dayPicks) {
      const [point, campaignId] = k.split(SEP) as [string, string];
      const candidates = [...(this.dayPicksAll.get(k) ?? [])];
      if (candidates.length < 2) continue;
      const campaign = this.campaign(campaignId)!;
      const brandId = campaign.brandId;
      const scored = candidates.map((o) => {
        const b = this.belief(point, o, candidates, brandId, day);
        return { id: o, meanScore: betaMean(b.posterior) / Math.max(b.cost.mean, 1e-6), picks: picks.get(o) ?? 0 };
      });
      const chosenId = [...scored].sort((x, y) => y.picks - x.picks || (x.id < y.id ? -1 : 1))[0]!.id;
      const bestId = [...scored].sort((x, y) => y.meanScore - x.meanScore || (x.id < y.id ? -1 : 1))[0]!.id;
      this.choices.push({ day, campaignId, point, candidates: scored, chosenId, bestId });
    }
  }

  // ---- splits: finer ICPs and proposed strategies --------------------------------------

  private studyAndPropose(day: number): void {
    const mature = day - this.world.settings.splitMatureDays;
    const leadTactics = this.catalogue.tactics.filter((t) => !t.retired && (t.describes.includes("lead") || t.describes.includes("company")));
    // The brand outcome describing who to serve (content type "audience"): a finer one is a fork of it.
    const audience = this.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired)?.id;
    for (const campaign of this.campaigns()) {
      if (!audience || !this.isProactive(campaign) || campaign.status !== "running") continue;
      const brandId = campaign.brandId;
      const proposed = this.objectVersions(brandId, audience).filter((o) => o.parentDynasty).length;
      if (proposed >= this.world.settings.maxProposedIcps) continue;
      // The audience most served so far is the parent; the split looks inside the people it brought.
      const icpCount = new Map<string, number>();
      for (const a of this.attempts) {
        if (a.campaign.id !== campaign.id || a.from !== START) continue;
        const dyn = a.objects[audience];
        if (dyn) icpCount.set(dyn, (icpCount.get(dyn) ?? 0) + 1);
      }
      const parentDyn = [...icpCount].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
      if (!parentDyn) continue;
      const parent = this.objectHead(brandId, audience, parentDyn);
      if (!parent) continue;
      const records: SplitRecord[] = [];
      for (const a of this.attempts) {
        if (a.campaign.id !== campaign.id || a.from !== START || !a.person || a.startDay > mature || a.objects[audience] !== parentDyn) continue;
        records.push({ values: a.person.values, success: this.reached.get(a.person.id)?.has(a.to) ?? false, stratum: `${campaign.brandId}|month-${Math.floor(a.startDay / 30)}` });
      }
      const study = studySplits(records, leadTactics);
      if (!study.proposal) continue;
      const conditions = mergeConditions(parent.conditions ?? [], study.proposal.conditions);
      const key = JSON.stringify(conditions);
      if (this.units.some((o) => o.brandId === brandId && o.outcome === audience && JSON.stringify(o.conditions ?? []) === key)) continue;
      const finder = this.catalogue.script(this.world.settings.icpFinderScript);
      const leg = finder ? this.catalogue.leg(finder.legId) : undefined;
      if (!finder || !leg) continue;
      const cost = Math.round(this.truthOf(finder, null).costCents);
      const run = this.newRun(day, campaign.id, leg, finder);
      run.spendCents += cost;
      run.consumed.push(parent.id);
      this.spent.set(campaign.id, (this.spent.get(campaign.id) ?? 0) + cost);
      if (this.today) this.today.spendCents[campaign.id] = (this.today.spendCents[campaign.id] ?? 0) + cost;
      const dynasty = `${parentDyn}-fork-${day}`;
      const text = `${parent.text ?? ""} ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue).toLowerCase()).join(", ")}.`.replace(/\.\s/, ", ").trim();
      const u = this.makeUnit(run, audience, `${brandId}:${dynasty}:v1`, brandId, campaign.id, { [audience]: parent.id }, []);
      Object.assign(u, { dynasty, version: 1, parentDynasty: parentDyn, name: `Finer (day ${day})`, text, conditions });
      this.addUnit(u);
      this.proposals.push({ day, kind: "audience", brandId, campaignId: campaign.id, point: null, conditions, text, createdId: u.id, study });
      // The same conditions, as a strategy a play can choose (who the play serves).
      const firstStep = this.nextOf(campaign, START);
      const play = firstStep ? this.playsFor(campaign, START, firstStep)[0] : undefined;
      if (play) {
        const sid = `${play.id}#proposed-${brandId}-${day}`;
        if (!this.catalogue.strategy(sid)) {
          this.catalogue.add("strategies", { id: sid, name: `Serve: ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", ")}`, legId: play.id, rules: [], subject: study.proposal.conditions, proposed: { day, reason: `split on ${records.length} mature leads` } });
          this.proposals.push({ day, kind: "strategy", brandId, campaignId: campaign.id, point: null, conditions: study.proposal.conditions, text: "", createdId: sid, study });
        }
      }
    }
    // Splits on scripts: per point, the tactic values of the candidate chosen.
    for (const point of this.evidence.pointCandidates.keys()) {
      const [consumer, material] = point.split("|") as [string, string];
      const consumerPipe = this.catalogue.leg(consumer);
      if (!consumerPipe || !material) continue;
      const scriptTactics = this.catalogue.tactics.filter((t) => t.describes.includes("script"));
      const records: SplitRecord[] = [];
      for (const d of this.decisions) {
        if (d.point !== point || d.day > mature) continue;
        const s = this.catalogue.headOf(d.candidate);
        if (!s) continue;
        records.push({ values: s.tactics, success: d.credited, stratum: `${d.brandId}|month-${Math.floor(d.day / 30)}` });
      }
      const study = studySplits(records, scriptTactics, { maxDepth: 1 });
      if (!study.proposal) continue;
      const sid = `${consumer}#proposed-${material}-${study.proposal.conditions.map((c) => JSON.stringify(c)).join("")}`.replace(/[^a-zA-Z0-9#|:_-]/g, "");
      if (this.catalogue.strategy(sid)) continue;
      this.catalogue.add("strategies", {
        id: sid,
        name: `At ${this.catalogue.outcome(material)?.label ?? material}: ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", ")}`,
        legId: consumer,
        rules: [{ material, conditions: study.proposal.conditions }],
        proposed: { day, reason: `split on ${records.length} decisions` },
      });
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
      if (!o.referenceLeg) continue;
      reference[o.id] = o.referenceLeg;
      covered[o.id] = new Set(this.world.clients.filter((c) => c.connected.includes(o.referenceLeg!)).map((c) => c.brand.id));
    }
    return measureReliability(this.attestations, reference, covered);
  }

  /** Attempts of a campaign's legs (for the lead timeline and reports). */
  attemptsOf(subject: string): { campaignId: string; from: string; to: string; startDay: number; status: string; spentCents: number }[] {
    return this.attempts.filter((a) => a.person?.id === subject).map((a) => ({ campaignId: a.campaign.id, from: a.from, to: a.to, startDay: a.startDay, status: a.status, spentCents: a.spentCents }));
  }

  /** Attempts of a campaign: the leg, the Unit it started from, when, and how it ended. */
  campaignAttempts(campaignId: string): { from: OutcomeId; to: OutcomeId; startUnit: string | null; startDay: number; status: string; subject: string | null }[] {
    return this.attempts.filter((a) => a.campaign.id === campaignId).map((a) => ({ from: a.from, to: a.to, startUnit: a.startUnit, startDay: a.startDay, status: a.status, subject: a.person?.id ?? null }));
  }

  /**
   * What a leg costs and yields across the fleet today (every campaign with this leg),
   * for proposing funnels to a new campaign. Null when no campaign ran it yet.
   */
  fleetStepEstimate(from: OutcomeId, to: OutcomeId): { costPerAttempt: number; yieldRate: number; label: "measured" } | null {
    let att = 0;
    let y = 0;
    let c = 0;
    for (const campaign of this.campaigns()) {
      if (!this.playsFor(campaign, from, to).length) continue;
      const l = this.stepEstimate(campaign, from, to);
      if (l.yieldRate === null || l.costPerAttempt === null || l.attempts === 0) continue;
      att += l.attempts;
      y += l.yieldRate * l.attempts;
      c += l.costPerAttempt * l.attempts;
    }
    if (att === 0) return null;
    return { costPerAttempt: c / att, yieldRate: y / att, label: "measured" };
  }


  /** Number of attempts of a campaign (or of every campaign). */
  attemptCount(campaignId?: string): number {
    return campaignId ? this.attempts.filter((a) => a.campaign.id === campaignId).length : this.attempts.length;
  }

  /** People the world served, in order of first appearance. */
  people(): Person[] {
    return [...this.persons.values()];
  }
}

/** One leg a step runs through: what it makes, the script it runs most, each Material with the leg that supplies it (null: the stock or the step's start), and the Material of the leg it feeds (null for the step's play). */
export interface StepLeg {
  legId: string;
  output: OutcomeId;
  scriptId: string | null;
  materials: { material: OutcomeId; leg: string | null }[];
  feeds: { leg: string; material: OutcomeId } | null;
  /** On the chain that carries the step's subject from its start to its end. */
  main: boolean;
}

/** Merge two lists of conditions: the second refines the first. */
export function mergeConditions(a: readonly Condition[], b: readonly Condition[]): Condition[] {
  const out = [...a];
  for (const c of b) out.push(c);
  return out;
}

/** Run a world for a number of days. */
export function simulate(world: WorldSpec, days: number): SimulationSession {
  const s = new SimulationSession(world);
  s.run(days);
  return s;
}
