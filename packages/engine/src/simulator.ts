/**
 * A factory at work on a simulated world, tick by tick (one tick = one day).
 *
 * The Campaign orders production. A proactive Campaign (started from Start)
 * pulls on its target at each tick: the most advanced Units in the stock are
 * served first, then new subjects are made from the market with what is left
 * of its budget. A reactive Campaign (started from any other outcome) pushes
 * each landed Unit of its start outcome into its first pipe, as far as its
 * budget allows.
 *
 * Each pipe serves itself its Bill of materials: from the ledger's common
 * stock when a Unit conforms to its Specification, else by ordering a new
 * piece from one producer it chooses with the Supplier rating. Every Run
 * performs one script and lands one Unit or none, after its delay: a Unit
 * advances one pipe per tick. Each Unit carries its traceability (the choices
 * that led to it), and when the end of a leg lands every choice on its
 * traceability is credited. Deterministic: one seed, one history.
 */

import { START, defaultStrategyId, type Catalogue, type OutcomeId, type Pipe, type Script, type Specification, type Strategy } from "./catalogue";
import { EvidenceBook, SEP, bumpCell, legEstimateOf, type CellStore } from "./evidence";
import { chainCostPerTarget, valueBackwardLine } from "./funnels";
import { buildLedger, type LedgerReport, type LedgerRun, type LedgerUnit } from "./ledger";
import { prioritize, type PricedOption } from "./prioritizer";
import { measureReliability, type Attestation, type ProducerReliability } from "./reliability";
import { createRng, type Rng } from "./rng";
import { studySplits, type SplitRecord, type SplitStudy } from "./splits";
import { betaMean, betaVariance } from "./stats";
import { StorageHouse, type PipeStorage, type StorageReport } from "./storage";
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
  pipeId: string | null;
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

/** One choice: at a point (consuming pipe x Material), for a subject, the option picked. */
export interface Decision {
  id: number;
  point: string;
  option: string;
  campaignId: string;
  brandId: string;
  /** The outcome this decision exists for: the end of its campaign's leg. */
  legTarget: OutcomeId;
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
  options: { id: string; meanScore: number; picks: number }[];
  /** The option with the most picks today. */
  chosenId: string;
  /** The option with the best expected value per dollar today. */
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

/** A Unit a reactive Campaign pushed into its first pipe. */
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
  legs: { from: OutcomeId; to: OutcomeId; attempts: number; reached: number; yieldRate: number | null; costPerAttempt: number | null; label: "expected" | "measured" }[];
  targetValue: number;
  valueLabel: "stated" | "expected";
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** A Unit a campaign took into one of its legs: the production it orders until the leg's end lands, or fails. */
interface Attempt {
  id: number;
  campaign: Campaign;
  client: WorldClient;
  legIndex: number;
  from: OutcomeId;
  to: OutcomeId;
  /** Raw record before identity, then the person. */
  subject: string | null;
  person: Person | null;
  recontact: boolean;
  /** The Unit the leg starts from (pulled from the stock or pushed), none from Start. */
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

interface PendingLanding {
  tick: number;
  attempt: Attempt;
  key: string;
  unit: Unit;
  final: boolean;
  /** The stock key it fills (outcome and subject), while it is in flight. */
  flight: string;
}

/** Days from a choice to its leg's end: the mean, and the part of it that is certain (one tick per pipe). */
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

export function legConsumer(from: OutcomeId, to: OutcomeId): string {
  return `leg:${from}>${to}`;
}

export function playPoint(from: OutcomeId, to: OutcomeId): string {
  return `play:${from}>${to}`;
}

/** The tactic a Unit carries from the ledger: its age in days. */
export const UNIT_AGE = "age_days";

/** Mean days a run takes to land, counting the tick it runs in (a Unit advances one pipe per tick, `ticksPerDay` ticks a day). */
export function tickDelay(delayMeanDays: number, ticksPerDay = 1): number {
  return delayMeanDays + 1 / ticksPerDay / (1 + delayMeanDays);
}

// ---------------------------------------------------------------------------
// Script business logic: generic, read off the script's tactics, kept in its pipe storage
// ---------------------------------------------------------------------------

/** What a running script is handed: its own pipe's storage, the day, its tactics. Nothing else. */
export interface ScriptContext {
  readonly storage: PipeStorage;
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
 * "days before recontact" tactic) read against its pipe storage.
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
 * keeps a reference to the Unit it waits on in its pipe storage and runs once
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
  /** What a Rating that reads no evidence sees: every option at its prior. */
  private readonly blind: EvidenceBook;
  private readonly legCohorts: CellStore = new Map();
  private readonly picks = new Map<string, Map<string, number[]>>();
  private readonly spent = new Map<string, number>();
  private readonly budgetLeft = new Map<string, number>();
  private readonly subjectsByCampaign = new Map<string, { entryDay: number; spendCents: number; value: number }>();
  /** Webhook calls another factory will make: at a tick, about a Unit. */
  private readonly webhookCalls: { tick: number; pipeId: string; about: string }[] = [];
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
  /** Options offered per (point, campaign), ever. */
  private readonly dayPicksAll = new Map<string, Set<string>>();
  /** New subjects made per campaign per day (for a volume per period). */
  private readonly madePerDay = new Map<string, number[]>();

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

  /** Ticks per simulated day: at each tick every campaign pulls or pushes, and a Unit advances one pipe. */
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

  /** Read-only report of one pipe's storage (row counts and a sample): what the dashboard shows. */
  storageReport(pipeId: string): StorageReport {
    return this.storage.report(pipeId);
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
      this.runs.push({ id: setupId, pipeId: null, target: null, day: this.dayIndex, spendCents: this.world.settings.setupCentsPerBrand, consumed: [], support: { kind: "brand_setup", reason: "first setup of the brand" }, factory: this.ourFactory(), subjects: 0, campaignId: c.campaigns[0]?.id });
    }
    for (const s of c.seeds) {
      if (this.units.some((o) => o.brandId === c.brand.id && o.dynasty === s.dynasty && o.version === s.version)) continue;
      const script = this.catalogue.script(s.scriptId);
      const pipe = script ? this.catalogue.pipe(script.pipeId) : undefined;
      if (!script || !pipe) throw new Error(`seed Unit names unknown script "${s.scriptId}"`);
      const cost = Math.round(this.truthOf(script, null).costCents);
      const run = this.newRun(this.dayIndex, c.campaigns[0]?.id ?? null, pipe, script);
      run.spendCents += cost;
      if (this.catalogue.isOurs(pipe) && c.campaigns[0]) this.spent.set(c.campaigns[0].id, (this.spent.get(c.campaigns[0].id) ?? 0) + cost);
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
    const pipe = from.pipeId ? this.catalogue.pipe(from.pipeId) : undefined;
    if (!script || !pipe) throw new Error("the previous version names no script");
    const run = this.newRun(this.dayIndex, from.campaignId, pipe, script);
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

  /** Choose a campaign's strategy for one pipe (its play on that pipe). */
  setCampaignStrategy(campaignId: string, pipeId: string, strategyId: string): void {
    const c = this.campaign(campaignId);
    if (!c) throw new Error(`campaign "${campaignId}" not found`);
    const s = this.catalogue.strategy(strategyId);
    if (!s || s.pipeId !== pipeId) throw new Error(`strategy "${strategyId}" is not a strategy of ${pipeId}`);
    if (strategyId === defaultStrategyId(pipeId)) delete c.strategies[pipeId];
    else c.strategies[pipeId] = strategyId;
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
      // All campaigns run each tick, each on its own budget.
      for (const campaign of order) {
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

  /**
   * A proactive Campaign pulls on its target: the most advanced Units first
   * (open legs nearest the target, then Units waiting in the stock at a lead
   * state of its line), and only then new subjects from the market, with the
   * budget left. Upstream makes nothing downstream did not ask for.
   */
  private pull(campaign: Campaign, day: number): void {
    const client = this.clientOf(campaign.id)!;
    let blocked = false;
    for (let k = campaign.line.length - 1; k >= 0; k--) {
      for (const a of this.openAt(campaign, k)) if (this.advance(a, day) === "blocked") blocked = true;
      if (k === 0 || blocked) continue;
      // Units waiting in the stock at the start of leg k, oldest first.
      const key = `${campaign.id}${SEP}${k}`;
      const list = this.byBrand.get(`${campaign.brandId}${SEP}${campaign.line[k - 1]!}`) ?? [];
      let i = this.stockRead.get(key) ?? 0;
      for (; i < list.length; i++) {
        const u = list[i]!;
        const person = this.persons.get(u.subject);
        if (!person || this.attemptOf.has(`${campaign.id}${SEP}${k}${SEP}${person.id}`) || this.reached.get(person.id)?.has(campaign.line[k]!)) continue;
        const a = this.newAttempt(campaign, client, k, person, day, u.id);
        if (this.advance(a, day) === "blocked") {
          blocked = true;
          i++;
          break;
        }
      }
      this.stockRead.set(key, i);
    }
    if (blocked) return;
    // New subjects from the market, with the budget left (and within the volume per period).
    for (let guard = 0; guard < 20_000; guard++) {
      if ((this.budgetLeft.get(campaign.id) ?? 0) <= 0 || this.volumeReached(campaign, day)) break;
      const a = this.newAttempt(campaign, client, 0, null, day);
      const made = this.madePerDay.get(campaign.id) ?? [];
      made[day] = (made[day] ?? 0) + 1;
      this.madePerDay.set(campaign.id, made);
      if (this.advance(a, day) === "blocked") break;
    }
  }

  /** A reactive Campaign moves what it pushed, most advanced first, as far as its budget allows. */
  private advanceOpen(campaign: Campaign, day: number): void {
    for (let k = campaign.line.length - 1; k >= 0; k--) for (const a of this.openAt(campaign, k)) this.advance(a, day);
  }

  /** Open attempts of a campaign at a leg that can move today (none waiting on a landing), oldest first. */
  private openAt(campaign: Campaign, legIndex: number): Attempt[] {
    const all = (this.open.get(campaign.id) ?? []).filter((a) => a.status === "open");
    this.open.set(campaign.id, all);
    return all.filter((a) => a.legIndex === legIndex && a.pending.size === 0 && a.wakeTick <= this.tickIndex);
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
   * A reactive Campaign's push: a Unit of its start outcome landed for its
   * brand; it goes into the campaign's first pipe (moved this tick if the
   * budget allows, kept open otherwise).
   */
  private push(campaign: Campaign, unit: Unit, day: number): void {
    const person = this.persons.get(unit.subject);
    if (!person || this.reached.get(person.id)?.has(campaign.line[0]!)) return;
    if (this.attemptOf.has(`${campaign.id}${SEP}0${SEP}${person.id}`) && this.attemptOf.get(`${campaign.id}${SEP}0${SEP}${person.id}`)!.status === "open") return;
    this.newAttempt(campaign, this.clientOf(campaign.id)!, 0, person, day, unit.id);
    this.pushes.push({ day, campaignId: campaign.id, unitId: unit.id, subject: person.id });
    if (this.today) this.today.pushes++;
  }

  // ---- attempts ----------------------------------------------------------------

  private newAttempt(campaign: Campaign, client: WorldClient, legIndex: number, person: Person | null, day: number, startUnit: string | null = null): Attempt {
    const from = legIndex === 0 ? campaign.start : campaign.line[legIndex - 1]!;
    const a: Attempt = {
      id: this.attempts.length,
      campaign,
      client,
      legIndex,
      from,
      to: campaign.line[legIndex]!,
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
    bumpCell(this.legCohorts, `${campaign.id}${SEP}${legIndex}`, day, "t", 1);
    if (this.today) this.today.attempts[campaign.id] = (this.today.attempts[campaign.id] ?? 0) + 1;
    return a;
  }

  /** Move an attempt as far as it can go today. */
  private advance(a: Attempt, day: number): "done" | "wait" | "fail" | "blocked" {
    if (a.status !== "open") return a.status === "done" ? "done" : "fail";
    if (a.subject && this.reached.get(a.subject)?.has(a.to)) {
      this.finish(a, "done");
      return "done";
    }
    const consumer = legConsumer(a.from, a.to);
    // The play of the leg: which pipe produces its end.
    let pipeId = a.choices.get(playPoint(a.from, a.to));
    if (!pipeId) {
      const plays = this.playsFor(a.campaign, a.from, a.to);
      if (plays.length === 0) return this.fail(a, "no play");
      const pinned = a.campaign.pinned?.[a.legIndex];
      const rem = plays.map((p) => addRem(this.pipeTicks(p), this.ticksBelow(p, a.from, a))).reduce((x, y) => (y.mean > x.mean ? y : x));
      pipeId = pinned && plays.some((p) => p.id === pinned) ? pinned : this.decide(a, playPoint(a.from, a.to), plays.map((p) => p.id), day, rem, Math.ceil(rem.mean * 4));
      a.choices.set(playPoint(a.from, a.to), pipeId);
    }
    const pipe = this.catalogue.pipe(pipeId)!;
    const scripts = this.allowedScripts(a.campaign, null, null, [pipe]);
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
      this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "f", 1);
    }
    if (status === "failed") bumpCell(this.legCohorts, `${a.campaign.id}${SEP}${a.legIndex}`, a.startDay, "f", 1);
    a.choices.clear();
    a.got.clear();
  }

  /** The outcomes a campaign may start from besides Start (its own start outcome). */
  private startsOf(campaign: Campaign): Set<OutcomeId> {
    return campaign.start === START ? new Set() : new Set([campaign.start]);
  }

  /** Live pipes producing a leg's end whose subject comes from the leg's start. */
  playsFor(campaign: Campaign, from: OutcomeId, to: OutcomeId): Pipe[] {
    const starts = this.startsOf(campaign);
    return this.catalogue
      .providersOf(to)
      .filter((p) => !p.webhook && this.catalogue.rootsOf(p, starts).has(from))
      .filter((p) => this.catalogue.dynastiesOf(p.id).length > 0);
  }

  /** The campaign's strategy on a pipe (its play on that pipe). */
  strategyOf(campaign: Campaign, pipeId: string): Strategy | null {
    const id = campaign.strategies[pipeId];
    return (id ? this.catalogue.strategy(id) : null) ?? this.catalogue.strategy(defaultStrategyId(pipeId)) ?? null;
  }

  /** The conditions a campaign's strategy states at one Material of a pipe: they enter its Specification. */
  materialConditions(campaign: Campaign, pipe: Pipe, material: OutcomeId): Condition[] {
    return (this.strategyOf(campaign, pipe.id)?.rules ?? []).filter((r) => r.material === material).flatMap((r) => r.conditions);
  }

  /** The conditions of a list a script can be read against (tactics describing scripts). */
  private scriptConditions(conditions: readonly Condition[]): Condition[] {
    return conditions.filter((c) => c.op !== "notReached" && c.tactic !== UNIT_AGE && (this.catalogue.tactic(c.tactic)?.describes.includes("script") ?? true));
  }

  /**
   * The scripts allowed at one Material: the producers' active dynasty heads,
   * filtered by the consuming pipe's play (its strategy's conditions at this
   * Material). `consumerPipe` null = the leg's own pipe, filtered by its rules
   * without a Material.
   */
  allowedScripts(campaign: Campaign, consumerPipe: Pipe | null, material: OutcomeId | null, providers: Pipe[]): Script[] {
    let rules: Condition[] = [];
    if (consumerPipe && material) rules = this.materialConditions(campaign, consumerPipe, material);
    else if (providers[0]) rules = (this.strategyOf(campaign, providers[0].id)?.rules ?? []).filter((r) => !r.material).flatMap((r) => r.conditions);
    const conds = this.scriptConditions(rules);
    return providers.flatMap((p) => this.catalogue.dynastiesOf(p.id)).filter((s) => meetsAll(s.tactics, conds));
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

  /** The option a brand Unit stands for at a choice: its dynasty, else its producer script's dynasty. */
  optionOf(u: Unit): string {
    return u.dynasty ?? (u.scriptId ? this.catalogue.script(u.scriptId)?.dynasty : undefined) ?? u.id;
  }

  // ---- orchestration -------------------------------------------------------------

  private produce(a: Attempt, consumer: string, o: OutcomeId, scripts: Script[], remDelay: Rem, final: boolean, day: number): Obtained {
    const key = pointKey(consumer, o);
    const have = a.got.get(key);
    if (have) return { kind: "ok", unit: have };
    if (a.pending.has(key)) return { kind: "wait" };
    let dynasty = a.choices.get(key);
    if (!dynasty) {
      if (scripts.length === 0) return { kind: "fail", reason: `no script at ${key}` };
      // From this choice to the leg's end: what is left to run below it, its own pipe, then what is above.
      const pipes = scripts.map((s) => this.catalogue.pipe(s.pipeId)!);
      const longest = pipes.map((p) => addRem(this.pipeTicks(p), this.ticksBelow(p, a.from, a))).reduce((x, y) => (y.mean > x.mean ? y : x));
      const rem = addRem(remDelay, longest);
      const horizon = Math.max(...pipes.map((p) => p.maturity.horizonDays + 1)) + rem.mean * 3;
      dynasty = this.decide(a, key, scripts.map((s) => s.dynasty), day, rem, Math.ceil(horizon));
      a.choices.set(key, dynasty);
    }
    const script = this.catalogue.headOf(dynasty);
    if (!script) return { kind: "fail", reason: `dynasty ${dynasty} has no active version` };
    const pipe = this.catalogue.pipe(script.pipeId)!;
    const rem = addRem(remDelay, this.pipeTicks(pipe));

    // The subject Material first: nothing else is asked for before the subject is there.
    const subjectMaterial = this.catalogue.subjectMaterial(pipe);
    const materials: Record<OutcomeId, string> = {};
    if (subjectMaterial) {
      const r = this.obtain(a, pipe, subjectMaterial, rem, day);
      if (r.kind !== "ok") return r;
      materials[subjectMaterial] = r.unit;
      if (a.person && !a.checkedSubject) {
        a.checkedSubject = true;
        if (!this.subjectAllowed(a)) return { kind: "fail", reason: "excluded by the play's strategy" };
      }
      // The script decides when to run (a follow-up waits its days since the last message).
      const u = this.unitById.get(r.unit)!;
      const ctx: ScriptContext = { storage: this.storage.forPipe(pipe.id), day, tactics: script.tactics };
      if (!scriptReady(ctx, a.person?.id ?? a.subject ?? u.subject, u)) {
        a.wakeTick = (u.day + Number(script.tactics.wait_days)) * this.ticksPerDay;
        return { kind: "wait" };
      }
    }
    // The other Materials, asked for together.
    let waiting = false;
    for (const i of pipe.materials) {
      if (i === subjectMaterial) continue;
      const r = this.obtain(a, pipe, i, rem, day);
      if (r.kind === "fail" || r.kind === "blocked") return r;
      if (r.kind === "wait") waiting = true;
      else materials[i] = r.unit;
    }
    if (waiting) return { kind: "wait" };
    return this.runScript(a, key, pipe, script, materials, o, final, day);
  }

  /**
   * A pipe serves itself one Material: from the stock when a Unit conforms to
   * its Specification, else it orders one from a producer it chooses.
   */
  private obtain(a: Attempt, consumer: Pipe, i: OutcomeId, rem: Rem, day: number): Obtained {
    const key = pointKey(consumer.id, i);
    const have = a.got.get(key);
    if (have) return { kind: "ok", unit: have };
    if (a.pending.has(key)) return { kind: "wait" };
    const out = this.catalogue.outcome(i);
    if (!out) return { kind: "fail", reason: `unknown Material ${i}` };
    // The Unit the leg started from.
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
      return this.produce(a, consumer.id, i, this.allowedScripts(a.campaign, consumer, i, rooted), rem, false, day);
    }
    // A Unit about the run that asks for it (an LLM completion): never in the stock, always ordered.
    if (out.subject === "run") return this.produce(a, consumer.id, i, this.allowedScripts(a.campaign, consumer, i, providers), rem, false, day);
    // A brand Unit: chosen among the conforming ones in the stock, else ordered.
    const conformingUnits = this.stock({ outcome: i, subject: null, brandId, conditions, quantity: Number.MAX_SAFE_INTEGER }, day).reverse();
    const options: string[] = [];
    for (const u of conformingUnits) {
      const opt = this.optionOf(u);
      if (!options.includes(opt)) options.push(opt);
    }
    if (options.length > 0) {
      let dynasty = a.choices.get(key);
      if (!dynasty || !options.includes(dynasty)) {
        dynasty = options.length > 1 ? this.decide(a, key, options, day, rem) : options[0]!;
        a.choices.set(key, dynasty);
      }
      const u = this.latestOf(conformingUnits.filter((x) => this.optionOf(x) === dynasty));
      if (!u) return { kind: "fail", reason: `no Unit of ${dynasty}` };
      const dec = a.decisionAt.get(key);
      if (dec !== undefined && this.decisions[dec]!.option === dynasty) this.decisionObject.set(dec, u.id);
      else a.served.push(u.id);
      a.objects[i] = dynasty;
      a.got.set(key, u.id);
      return { kind: "ok", unit: u.id };
    }
    if (this.inFlight.has(`${i}${SEP}${brandId}`)) return { kind: "wait" };
    return this.produce(a, consumer.id, i, this.allowedScripts(a.campaign, consumer, i, providers), rem, false, day);
  }

  /** Ticks one run of a pipe takes (one at least), counting the tick its ordered Materials take to land (an LLM completion). */
  pipeTicks(pipe: Pipe): Rem {
    const ordered = pipe.materials.some((m) => this.catalogue.outcome(m)?.subject === "run") ? 1 : 0;
    const tick = 1 / this.ticksPerDay;
    return { mean: tickDelay(pipe.maturity.delayMeanDays, this.ticksPerDay) + ordered * tick, fixed: (1 + ordered) * tick };
  }

  /** Ticks before a pipe has its subject Material in hand, from a leg's start (none once the attempt holds its subject there). */
  ticksBelow(pipe: Pipe, from: OutcomeId, a: Attempt | null = null, seen = new Set<string>()): Rem {
    const s = this.catalogue.subjectMaterial(pipe);
    if (!s || s === from || this.catalogue.outcome(s)?.track || seen.has(pipe.id)) return NO_REM;
    if (a?.person && (this.bySubject.get(`${a.person.id}${SEP}${s}`)?.length ?? 0) > 0) return NO_REM;
    seen.add(pipe.id);
    let most = NO_REM;
    for (const p of this.catalogue.providersOf(s)) {
      if (p.webhook) continue;
      const r = addRem(this.pipeTicks(p), this.ticksBelow(p, from, a, new Set(seen)));
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

  /** Dynasties (options) of a brand outcome a brand holds in the stock. */
  objectDynasties(brandId: string, outcome: OutcomeId): string[] {
    const out: string[] = [];
    for (const o of this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []) {
      const opt = this.optionOf(o);
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
    return this.latestOf((this.brandUnits.get(`${brandId}${SEP}${outcome}`) ?? []).filter((o) => this.optionOf(o) === dynasty));
  }

  /** The play's conditions on its subject (lead tactics, end states reached). */
  private subjectAllowed(a: Attempt): boolean {
    const pipeId = a.choices.get(playPoint(a.from, a.to));
    if (!pipeId || !a.person) return true;
    const cond = this.strategyOf(a.campaign, pipeId)?.subject ?? [];
    if (cond.length === 0) return true;
    return meetsAll(a.person.values, cond, new Set(this.reached.get(a.person.id)?.keys() ?? []));
  }

  // ---- runs ------------------------------------------------------------------------

  /**
   * Hidden: the chance a script creating subjects finds someone today for an
   * audience (its source's coverage, the audience, who it may not pick again
   * yet). For grading only: a script never sees another pipe's storage.
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
    const store = this.storage.forPipe(script.pipeId);
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

  /** Hidden truth of an option at a point. For grading only. */
  optionTruthAt(point: string, option: string): Partial<ScriptTruth> {
    return this.optionTruth(point, option);
  }

  private truthOf(script: Script, point: string | null): ScriptTruth {
    const base = this.world.truth.scripts[script.id] ?? this.world.truth.scripts[script.dynasty] ?? { costCents: script.costCents };
    const at = point ? this.world.truth.at[point]?.[script.dynasty] : undefined;
    return { ...base, ...(at ?? {}) };
  }

  private optionTruth(point: string, option: string): Partial<ScriptTruth> {
    const s = this.catalogue.headOf(option);
    if (s) return this.truthOf(s, point);
    const at = this.world.truth.at[point]?.[option];
    if (at) return at;
    return {};
  }

  /** Open a Run: one script on one subject. */
  private newRun(day: number, campaignId: string | null, pipe: Pipe, script: Script): Run {
    const r: Run = { id: `run:${++this.runCounter}`, pipeId: pipe.id, target: pipe.output, day, spendCents: 0, consumed: [], inputs: 1, factory: pipe.factory, scriptId: script.id, subjects: 1, ...(campaignId ? { campaignId } : {}) };
    this.runs.push(r);
    return r;
  }

  private makeUnit(run: Run, outcome: OutcomeId, subject: string, brandId: string, campaignId: string | null, materials: Record<OutcomeId, string>, trace: number[]): Unit {
    return { id: `unit:${++this.unitCounter}`, outcome, subject, runId: run.id, day: run.day, brandId, campaignId, factory: run.factory, pipeId: run.pipeId, scriptId: run.scriptId ?? null, materials, trace };
  }

  private runScript(a: Attempt, key: string, pipe: Pipe, script: Script, materials: Record<OutcomeId, string>, o: OutcomeId, final: boolean, day: number): Obtained {
    const ctx: ScriptContext = Object.freeze({ storage: this.storage.forPipe(pipe.id), day, tactics: script.tactics });
    const truth = this.truthOf(script, key);
    const ours = this.catalogue.isOurs(pipe);
    const creates = this.catalogue.createsSubjects(pipe);
    const subjectKey = a.person?.id ?? a.subject ?? "";
    if (!creates && subjectKey && !scriptAccepts(ctx, subjectKey)) return { kind: "fail", reason: "the script does not retry yet" };
    const cost = Math.max(0, Math.round(truth.costCents * (0.85 + 0.3 * this.rng.next())));
    if (ours && cost > (this.budgetLeft.get(a.campaign.id) ?? 0)) return { kind: "blocked" };

    const run = this.newRun(day, a.campaign.id, pipe, script);
    run.spendCents += cost;
    for (const id of Object.values(materials)) run.consumed.push(id);
    this.charge(a, cost, ours);

    const pt = this.world.truth.pipes[pipe.id] ?? { base: 1, delayMeanDays: 0, horizonDays: 0 };
    // The trace: this choice, the choices made at this pipe's Materials, and what its Materials carried.
    const trace = new Set<number>();
    const own = a.decisionAt.get(key);
    if (own !== undefined) trace.add(own);
    if (final) {
      const play = a.decisionAt.get(playPoint(a.from, a.to));
      if (play !== undefined) trace.add(play);
    }
    for (const i of pipe.materials) {
      const d = a.decisionAt.get(pointKey(pipe.id, i));
      if (d !== undefined) trace.add(d);
      const u = this.unitById.get(materials[i]!);
      if (u) for (const t of u.trace) trace.add(t);
    }

    let subject = a.subject ?? "";
    let fact: boolean;
    let recall = truth.recall ?? 1;
    let fp = truth.falsePositive ?? 0;
    for (const i of pipe.materials) {
      const d = a.decisionAt.get(pointKey(pipe.id, i));
      if (d === undefined) continue;
      const t = this.optionTruth(this.decisions[d]!.point, this.decisions[d]!.option);
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
        this.rootFactory.set(subject, pipe.factory);
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
          if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, pipe.factory);
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
          if (a.legIndex === 0 && this.isProactive(a.campaign)) p *= segmentMultiplier(this.world, a.person.values) * (a.recontact ? this.world.truth.recontactMult : 1);
        }
        if (a.legIndex > 0 && pt.onFalseInput !== undefined && a.person && !this.truePositive.has(a.person.id) && this.catalogue.factory(this.rootFactory.get(a.person.id) ?? "")?.ours !== false) p *= pt.onFalseInput;
      }
      fact = p >= 1 || this.rng.next() < Math.min(0.97, p);
      if (raw && fact && kind === "lead") {
        // Identity: the raw record becomes a person, the one id space every pipe shares.
        const index = this.rawPerson.get(raw)!;
        const person = personOf(this.world, a.client.brand.id, index);
        this.persons.set(person.id, person);
        if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, this.rootFactory.get(raw) ?? pipe.factory);
        this.setPerson(a, person);
        this.enroll(person.id, a.campaign.id);
        subject = person.id;
      } else if (kind === "company" && a.person) subject = a.person.companyId;
      else if (kind === "brand") subject = a.client.brand.id;
      else if (kind === "run") subject = run.id;
      else if (a.person) subject = a.person.id;
    }
    const attested = fact ? this.rng.next() < recall : this.rng.next() < fp;
    if (final && fact && a.person && this.catalogue.outcome(o)?.referencePipe) this.truePositive.set(a.person.id, day);
    if (this.catalogue.outcome(o)?.referencePipe && a.person) {
      this.attestations.push({ producer: pipe.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
      this.attestations.push({ producer: script.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
    }
    if (kind !== "run" && subjectKey) scriptRecords(ctx, subjectKey, attested);
    if (!attested) return { kind: "fail", reason: `no outcome at ${pipe.id}` };

    const u = this.makeUnit(run, o, subject, a.client.brand.id, a.campaign.id, materials, [...trace].sort((x, y) => x - y));
    // A Unit advances one pipe per tick: it lands at the next tick at the earliest.
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
      if (dec.legTarget !== a.to || dec.attemptId !== a.id) continue;
      const obj = this.decisionObject.get(d);
      p *= obj ? this.objectTruthEnd(this.unitById.get(obj)!) : (this.optionTruth(dec.point, dec.option).end ?? 1);
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
      this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "c", cents);
    }
    // Leg economics read our own spend: what another factory charges is its cost, not ours.
    if (ours) bumpCell(this.legCohorts, `${a.campaign.id}${SEP}${a.legIndex}`, a.startDay, "c", cents);
    const root = a.legIndex === 0 ? a : a.person ? this.attemptOf.get(`${a.campaign.id}${SEP}0${SEP}${a.person.id}`) : undefined;
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
    for (const p of this.catalogue.pipes) {
      const on = this.world.truth.pipes[p.id]?.webhook?.on;
      if (!p.webhook || on !== u.outcome || !this.catalogue.isPipeLive(p)) continue;
      const client = this.world.clients.find((c) => c.brand.id === u.brandId);
      if (!client?.connected.includes(p.id)) continue;
      const pt = this.world.truth.pipes[p.id]!;
      if (this.rng.next() >= pt.base) continue;
      this.webhookCalls.push({ tick: this.tickIndex + this.delayTicks(pt.delayMeanDays, pt.horizonDays), pipeId: p.id, about: u.id });
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
      if (dec.credited || dec.legTarget !== u.outcome) continue;
      const at = this.attempts[dec.attemptId]!;
      if (at.person?.id !== u.subject) continue;
      dec.credited = true;
      // Settled as a failure when its attempt ended, and reached after all (another producer attested it).
      if (at.status !== "open") this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "f", -1);
      this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "s", 1);
    }

    // Reactive campaigns starting from this outcome: the Unit is pushed into their first pipe.
    for (const c of this.campaigns()) if (c.status === "running" && c.start === u.outcome && c.brandId === u.brandId) this.push(c, u, day);

    if (!first) return;
    for (const cid of this.enrolled.get(u.subject) ?? []) {
      const campaign = this.campaign(cid);
      // A campaign counts what its own runs made, and what another factory brought or attested.
      if (!campaign || (u.campaignId !== null && u.campaignId !== cid)) continue;
      const k = campaign.line.indexOf(u.outcome);
      if (k < 0) continue;
      if (this.today) {
        const o = (this.today.outcomes[cid] ??= {});
        o[u.outcome] = (o[u.outcome] ?? 0) + 1;
      }
      // The leg attempt that just reached its end.
      const done = this.attemptOf.get(`${cid}${SEP}${k}${SEP}${u.subject}`);
      if (done && !this.legDone.has(done.id)) {
        this.legDone.add(done.id);
        bumpCell(this.legCohorts, `${cid}${SEP}${k}`, done.startDay, "s", 1);
      }
      if (k === campaign.line.length - 1) this.creditValue(campaign, u.subject);
      // A reactive campaign pushes the Unit on into its next leg; a proactive one pulls it from the stock.
      else if (!this.isProactive(campaign) && campaign.status === "running" && done) {
        const person = this.persons.get(u.subject);
        if (person && !this.attemptOf.has(`${cid}${SEP}${k + 1}${SEP}${u.subject}`)) this.newAttempt(campaign, this.clientOf(cid)!, k + 1, person, day, u.id);
      }
    }
  }

  private readonly legDone = new Set<number>();

  private setPerson(a: Attempt, person: Person): void {
    a.person = person;
    a.subject = person.id;
    this.attemptOf.set(`${a.campaign.id}${SEP}${a.legIndex}${SEP}${person.id}`, a);
  }
  private readonly decisionObject = new Map<number, string>();
  private readonly unitTruth = new Map<string, number>();
  /** The attempt of each campaign leg for each person. */
  private readonly attemptOf = new Map<string, Attempt>();
  private readonly pointLeg = new Map<string, number>();

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
      const root = this.attemptOf.get(`${campaign.id}${SEP}0${SEP}${subject}`);
      if (root) {
        const s = this.subjectsByCampaign.get(`${campaign.id}${SEP}${root.id}`);
        if (s) s.value += v;
      }
    }
  }

  // ---- the Supplier rating, webhooks ---------------------------------------------------

  /** The outcome Supplier rating pipes make (content type "rating"). */
  ratingOutcome(): OutcomeId | null {
    return this.catalogue.outcomes.find((o) => o.contentType === "rating" && !o.retired)?.id ?? null;
  }

  /**
   * The Supplier rating, an auxiliary cost center: at each tick its pipe reads
   * the ledger and the traceability and makes today's Rating for each brand
   * with a running campaign. Every choosing pipe takes it as a Material; its
   * cost goes to the pipes that consume it.
   */
  private rate(day: number): void {
    const outcome = this.ratingOutcome();
    if (!outcome) return;
    const pipe = this.catalogue.providersOf(outcome).find((p) => !p.webhook);
    const script = pipe ? this.catalogue.dynastiesOf(pipe.id)[0] : undefined;
    if (!pipe || !script) return;
    for (const brandId of this.brandIds) {
      if (!this.campaigns().some((c) => c.brandId === brandId && c.status === "running")) continue;
      const run = this.newRun(day, null, pipe, script);
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
   * Webhooks: pipes of other factories with no internal Material, run when the
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
        const pipe = this.catalogue.pipe(c.pipeId)!;
        const script = this.catalogue.dynastiesOf(pipe.id)[0];
        const about = this.unitById.get(c.about);
        if (!script || !about) continue;
        const run = this.newRun(day, null, pipe, script);
        // The call names the Unit it reports on: the new Unit carries its traceability.
        this.land(this.makeUnit(run, pipe.output, about.subject, about.brandId, null, {}, about.trace), day);
      }
    }
    if (!firstTick) return;
    for (const pipe of this.catalogue.pipes) {
      if (!pipe.webhook || !this.catalogue.isPipeLive(pipe)) continue;
      const wh = this.world.truth.pipes[pipe.id]?.webhook;
      if (!wh || wh.on) continue;
      const script = this.catalogue.dynastiesOf(pipe.id)[0];
      if (!script) continue;
      const truth = this.truthOf(script, null);
      const pt = this.world.truth.pipes[pipe.id]!;
      for (const client of this.world.clients) {
        if (wh.creates) {
          const n = this.rng.binomial(Math.round(client.organicPerDay * 4), 0.25);
          for (let i = 0; i < n; i++) {
            const index = this.rng.int(this.world.settings.marketSize);
            const person = personOf(this.world, client.brand.id, index);
            if (this.reached.get(person.id)?.has(pipe.output)) continue;
            this.persons.set(person.id, person);
            if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, pipe.factory);
            const run = this.newRun(day, null, pipe, script);
            this.land(this.makeUnit(run, pipe.output, person.id, client.brand.id, null, {}, []), day);
          }
          continue;
        }
        if (!wh.attests || !client.connected.includes(pipe.id)) continue;
        // An attesting webhook: the other factory reports the facts it sees, with its own recall.
        for (const [personId, factDay] of this.truePositive) {
          if (factDay + pt.delayMeanDays !== day) continue;
          const person = this.persons.get(personId);
          if (!person || person.brandId !== client.brand.id) continue;
          const attested = this.rng.next() < (truth.recall ?? 1);
          this.attestations.push({ producer: pipe.id, outcome: pipe.output, brandId: client.brand.id, subject: personId, attested });
          if (!attested) continue;
          const run = this.newRun(day, null, pipe, script);
          this.land(this.makeUnit(run, pipe.output, personId, client.brand.id, null, {}, []), day);
        }
      }
    }
  }

  // ---- decisions and beliefs -----------------------------------------------------------

  /** One choice for one subject: the universal prioritizer over the options at a point, on today's Rating. */
  private decide(a: Attempt, point: string, options: string[], day: number, remDelay: Rem, horizon = 0): string {
    this.evidence.offer(point, options, remDelay.mean, horizon, remDelay.fixed);
    this.blind.offer(point, options, remDelay.mean, horizon, remDelay.fixed);
    const offered = this.dayPicksAll.get(`${point}${SEP}${a.campaign.id}`) ?? new Set<string>();
    for (const o of options) offered.add(o);
    this.dayPicksAll.set(`${point}${SEP}${a.campaign.id}`, offered);
    let chosen = options[0]!;
    if (options.length > 1) {
      const value = this.legValue(a);
      const book = this.bookOf(a.client.brand.id);
      const priced: PricedOption[] = options.map((o) => ({ id: o, ...book.belief(point, o, options, a.client.brand.id, day) }));
      chosen = prioritize(priced, value, this.rng).chosenId;
    }
    this.pointLeg.set(`${point}${SEP}${a.campaign.id}`, a.legIndex);
    const id = this.decisions.length;
    this.decisions.push({ id, point, option: chosen, campaignId: a.campaign.id, brandId: a.client.brand.id, legTarget: a.to, attemptId: a.id, day, credited: false });
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

  /** The evidence a brand's Rating reads: the ledger; a Rating script that reads no evidence gives every option its prior. */
  private bookOf(brandId: string): EvidenceBook {
    const r = this.ratingOf(brandId);
    const script = r?.scriptId ? this.catalogue.script(r.scriptId) : undefined;
    return script?.tactics.reads_evidence === false ? this.blind : this.evidence;
  }

  private groupOf(brandId: string): string {
    const b = this.world.clients.find((c) => c.brand.id === brandId)?.brand;
    return String(b?.tactics[this.world.settings.clientGroupTactic] ?? "");
  }

  /** The belief about one option at one point for one client, as the brand's Rating reads it (see EvidenceBook.belief). */
  belief(point: string, option: string, options: readonly string[], brandId: string, day: number) {
    return this.bookOf(brandId).belief(point, option, options, brandId, day);
  }

  /** The parent dynasty of a forked option (a script dynasty, or a brand dynasty such as a finer ICP). */
  private parentOf(option: string): string | null {
    const s = this.catalogue.versionsOf(option)[0];
    if (s?.parentDynasty) return s.parentDynasty;
    return this.parentDynasty.get(option) ?? null;
  }

  /** The parent of each forked brand dynasty (a finer ICP). */
  private readonly parentDynasty = new Map<string, string>();

  /** Value of one Unit at the end of an attempt's leg (backward from the campaign's target). */
  private legValue(a: Attempt): number {
    const ck = `${a.campaign.id}${SEP}${a.legIndex}`;
    const hit = this.legValueCache.get(ck);
    if (hit !== undefined && this.legValueDay === this.dayIndex) return hit;
    if (this.legValueDay !== this.dayIndex) {
      this.legValueCache.clear();
      this.legValueDay = this.dayIndex;
    }
    const v = this.computeLegValue(a);
    this.legValueCache.set(ck, v);
    return v;
  }

  private readonly legValueCache = new Map<string, number>();
  private legValueDay = -1;

  private computeLegValue(a: Attempt): number {
    const target = this.targetValue(a.campaign).amount;
    const legs = this.legEstimates(a.campaign, this.dayIndex);
    const { values } = valueBackwardLine(legs.map((l) => ({ costPerAttempt: l.costPerAttempt ?? 0, yieldRate: l.yieldRate ?? 0.5 })), target);
    return Math.max(values[a.legIndex + 1] ?? target, target * 0.01);
  }

  // ---- reports ---------------------------------------------------------------------------

  /** Where a campaign's line starts: Start, or its start outcome. */
  startOf(campaign: Campaign): OutcomeId {
    return campaign.start;
  }

  /** The sales path a campaign runs (named on first sight). */
  salesPathOf(campaign: Campaign) {
    return this.catalogue.peekSalesPath(campaign.start, campaign.line);
  }

  /** The pipe playing each leg of a campaign today: its pinned play, else the play picked most over the last 7 days. */
  playsToday(campaign: Campaign): (string | null)[] {
    return campaign.line.map((to, k) => {
      const from = k === 0 ? campaign.start : campaign.line[k - 1]!;
      const plays = this.playsFor(campaign, from, to);
      const pinned = campaign.pinned?.[k];
      if (pinned && plays.some((p) => p.id === pinned)) return pinned;
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
   * The sales funnel a campaign runs today: its sales path and the play of each
   * leg. `name` stores the names (the session does it once a day, in campaign
   * order, so a seed always gives the same names); otherwise nothing is stored.
   */
  salesFunnelOf(campaign: Campaign, name = false) {
    const plays = this.playsToday(campaign);
    if (plays.some((p) => p === null)) return null;
    return name ? this.catalogue.nameSalesFunnel(campaign.start, campaign.line, plays as string[]) : this.catalogue.peekSalesFunnel(campaign.start, campaign.line, plays as string[]);
  }

  /**
   * Every pipe a leg runs through, in the order they run: the pipe providing
   * each Material of the leg's play (the script picked most at that Material
   * over the last 7 days, else the first allowed), down to the leg's start,
   * then the play itself. `main` marks the chain that carries the subject; the
   * others feed a Material of a pipe on it (a research, a model call).
   * `campaign` null reads the picks of every campaign (a funnel not launched yet).
   */
  legPipes(play: string, from: OutcomeId, campaign: Campaign | null): LegPipe[] {
    const out: LegPipe[] = [];
    const seen = new Set<string>();
    const strategic = campaign ?? ({ strategies: {}, start: from } as unknown as Campaign);
    const starts = this.startsOf(strategic);
    const visit = (pipeId: string, feeds: { pipe: string; material: OutcomeId } | null, main: boolean) => {
      if (seen.has(pipeId)) return;
      seen.add(pipeId);
      const pipe = this.catalogue.pipe(pipeId);
      if (!pipe) return;
      const subject = this.catalogue.subjectMaterial(pipe);
      const order = subject ? [subject, ...pipe.materials.filter((i) => i !== subject)] : [...pipe.materials];
      for (const i of order) {
        const o = this.catalogue.outcome(i);
        if (!o || o.track || i === from || o.contentType === "rating") continue;
        const providers = this.catalogue.providersOf(i).filter((p) => !p.webhook);
        const series = this.pickSeries(pointKey(pipe.id, i), campaign?.id);
        let candidates: Pipe[];
        if (o.subject === "brand") candidates = providers.filter((p) => this.catalogue.dynastiesOf(p.id).some((s) => series.has(s.dynasty)));
        else if (o.subject === "run") candidates = providers;
        else candidates = providers.filter((p) => this.catalogue.rootsOf(p, starts).has(from) || this.catalogue.rootsOf(p).has(START));
        if (candidates.length === 0) continue;
        const scripts = this.allowedScripts(strategic, pipe, i, candidates);
        let best = scripts[0]?.dynasty ?? null;
        let bestN = 0;
        for (const [opt, arr] of series) {
          const n = arr.slice(-7).reduce((x, y) => x + y, 0);
          if (n > bestN || (n === bestN && n > 0 && best !== null && opt < best)) {
            best = opt;
            bestN = n;
          }
        }
        const provider = (best ? this.catalogue.headOf(best)?.pipeId : undefined) ?? candidates[0]?.id;
        if (provider) visit(provider, { pipe: pipe.id, material: i }, main && i === subject);
      }
      out.push({ pipeId, output: pipe.output, feeds, main });
    };
    visit(play, null, true);
    return out;
  }

  /** Every pipe each leg of a campaign runs through today (see `legPipes`), leg by leg. */
  campaignPipes(campaign: Campaign): LegPipe[][] {
    const plays = this.playsToday(campaign);
    return campaign.line.map((_, k) => {
      const play = plays[k];
      return play ? this.legPipes(play, k === 0 ? campaign.start : campaign.line[k - 1]!, campaign) : [];
    });
  }

  /** The value of one target outcome of a campaign: stated, else the fleet median of stated ones. */
  targetValue(campaign: Campaign): { amount: number; label: "stated" | "expected" } {
    const offer = this.world.clients.find((c) => c.offer.id === campaign.offerId)?.offer;
    const target = campaign.line[campaign.line.length - 1]!;
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

  /** Each leg of a campaign as the decisions read it: censoring-corrected yield and measured cost per attempt. */
  legEstimates(campaign: Campaign, day = this.dayIndex): CampaignEconomics["legs"] {
    return campaign.line.map((to, k) => {
      const from = k === 0 ? campaign.start : campaign.line[k - 1]!;
      const plays = this.playsFor(campaign, from, to);
      const mean = Math.max(...plays.map((p) => this.legDelayMean(p, campaign)), 0);
      const fixed = Math.max(...plays.map((p) => this.legFixedDays(p, campaign)), 0);
      return { from, to, ...legEstimateOf(this.legCohorts.get(`${campaign.id}${SEP}${k}`), day, mean, fixed) };
    });
  }

  /** Mean delay from a leg's start to its end through a pipe (the longest chain of subject Materials, a tick per pipe). */
  legDelayMean(pipe: Pipe, campaign: Campaign | null = null, seen = new Set<string>()): number {
    if (seen.has(pipe.id)) return 0;
    seen.add(pipe.id);
    const ordered = pipe.materials.some((m) => this.catalogue.outcome(m)?.subject === "run") ? 1 : 0;
    const own = tickDelay(this.world.truth.pipes[pipe.id]?.delayMeanDays ?? pipe.maturity.delayMeanDays, this.ticksPerDay) + ordered / this.ticksPerDay;
    const s = this.catalogue.subjectMaterial(pipe);
    const out = s ? this.catalogue.outcome(s) : undefined;
    if (!s || out?.track || (campaign && s === campaign.start)) return own;
    return own + Math.max(0, ...this.catalogue.providersOf(s).filter((p) => !p.webhook).map((p) => this.legDelayMean(p, campaign, new Set(seen))));
  }

  /** Days certain from a leg's start to its end through a pipe: one per pipe on its longest chain, and one per ordered Material. */
  legFixedDays(pipe: Pipe, campaign: Campaign | null = null, seen = new Set<string>()): number {
    if (seen.has(pipe.id)) return 0;
    seen.add(pipe.id);
    const own = this.pipeTicks(pipe).fixed;
    const s = this.catalogue.subjectMaterial(pipe);
    const out = s ? this.catalogue.outcome(s) : undefined;
    if (!s || out?.track || (campaign && s === campaign.start)) return own;
    return own + Math.max(0, ...this.catalogue.providersOf(s).filter((p) => !p.webhook).map((p) => this.legFixedDays(p, campaign, new Set(seen))));
  }

  /** Expected and measured return of a campaign, on the same formula: value / cost per target. */
  economics(campaignId: string): CampaignEconomics {
    const campaign = this.campaign(campaignId)!;
    const tv = this.targetValue(campaign);
    const legs = this.legEstimates(campaign);
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
    if (legs.every((l) => l.yieldRate !== null && l.costPerAttempt !== null)) {
      const chain = legs.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! }));
      const t = chainCostPerTarget(chain);
      if (Number.isFinite(t) && t > 0) {
        const v = tv.amount / t;
        let rel2 = 0;
        for (const l of legs) if (l.attempts > 0 && l.yieldRate) rel2 += (1 - l.yieldRate) / (l.attempts * l.yieldRate);
        const rel = Math.sqrt(rel2);
        expected = { value: v, low: v * Math.exp(-1.96 * rel), high: v * Math.exp(1.96 * rel) };
      }
    }
    // Measured on the mature basis: subjects that entered before the funnel's delay horizon.
    const horizon = Math.ceil(legs.reduce((s, l) => s + Math.max(0, ...this.playsFor(campaign, l.from, l.to).map((p) => this.legDelayMean(p, campaign))) * 3, 0));
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
    return { campaignId, spendCents, valueOurs, valueOther, targetsOurs: tv.amount > 0 ? Math.round(valueOurs / tv.amount) : 0, measured, expected, legs, targetValue: tv.amount, valueLabel: tv.label };
  }

  /** Picks per day per option at a point, for one campaign (or every campaign). */
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

  /** The options a campaign has at a point today (a brand point offers the brand's own dynasties in the stock). */
  optionsFor(point: string, campaign: Campaign): string[] {
    const material = point.split("|")[1] ?? "";
    const out = this.catalogue.outcome(material);
    if (out?.subject === "brand") {
      const held = this.objectDynasties(campaign.brandId, material);
      if (held.length > 0) return held;
    }
    const seen = new Set(this.dayPicksAll.get(`${point}${SEP}${campaign.id}`) ?? []);
    const offered = this.optionsAt(point).filter((o) => seen.has(o));
    return offered.length > 0 ? offered : this.optionsAt(point);
  }

  /** The options ever offered at a point. */
  optionsAt(point: string): string[] {
    return [...(this.evidence.pointOptions.get(point) ?? [])];
  }

  /** Today's belief of each option at a point, for a campaign: mean rate, its spread, mean cost, mean value per dollar. */
  beliefsAt(point: string, campaignId: string): { option: string; rate: number; rateSd: number; cost: number; valuePerDollar: number; decisions: number; successes: number }[] {
    const campaign = this.campaign(campaignId);
    if (!campaign) return [];
    const options = this.optionsFor(point, campaign);
    const brandId = campaign.brandId;
    const delay = this.evidence.delayOf(point);
    const fake = { campaign, client: this.clientOf(campaignId)!, legIndex: Math.max(0, this.legOfPoint(campaign, point)) } as Attempt;
    const value = this.legValue(fake);
    return options.map((o) => {
      const b = this.belief(point, o, options, brandId, this.dayIndex);
      const c = this.evidence.counts(point, o, [brandId], this.dayIndex, delay);
      return { option: o, rate: betaMean(b.posterior), rateSd: Math.sqrt(betaVariance(b.posterior)), cost: b.cost.mean, valuePerDollar: (betaMean(b.posterior) * value) / Math.max(b.cost.mean, 1e-6), decisions: c.n, successes: c.successes };
    });
  }

  private legOfPoint(campaign: Campaign, point: string): number {
    return this.pointLeg.get(`${point}${SEP}${campaign.id}`) ?? 0;
  }

  private logChoices(day: number): void {
    for (const [k, picks] of this.dayPicks) {
      const [point, campaignId] = k.split(SEP) as [string, string];
      const options = [...(this.dayPicksAll.get(k) ?? [])];
      if (options.length < 2) continue;
      const campaign = this.campaign(campaignId)!;
      const brandId = campaign.brandId;
      const scored = options.map((o) => {
        const b = this.belief(point, o, options, brandId, day);
        return { id: o, meanScore: betaMean(b.posterior) / Math.max(b.cost.mean, 1e-6), picks: picks.get(o) ?? 0 };
      });
      const chosenId = [...scored].sort((x, y) => y.picks - x.picks || (x.id < y.id ? -1 : 1))[0]!.id;
      const bestId = [...scored].sort((x, y) => y.meanScore - x.meanScore || (x.id < y.id ? -1 : 1))[0]!.id;
      this.choices.push({ day, campaignId, point, options: scored, chosenId, bestId });
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
        if (a.campaign.id !== campaign.id || a.legIndex !== 0) continue;
        const dyn = a.objects[audience];
        if (dyn) icpCount.set(dyn, (icpCount.get(dyn) ?? 0) + 1);
      }
      const parentDyn = [...icpCount].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
      if (!parentDyn) continue;
      const parent = this.objectHead(brandId, audience, parentDyn);
      if (!parent) continue;
      const records: SplitRecord[] = [];
      for (const a of this.attempts) {
        if (a.campaign.id !== campaign.id || a.legIndex !== 0 || !a.person || a.startDay > mature || a.objects[audience] !== parentDyn) continue;
        records.push({ values: a.person.values, success: this.reached.get(a.person.id)?.has(a.to) ?? false, stratum: `${campaign.brandId}|month-${Math.floor(a.startDay / 30)}` });
      }
      const study = studySplits(records, leadTactics);
      if (!study.proposal) continue;
      const conditions = mergeConditions(parent.conditions ?? [], study.proposal.conditions);
      const key = JSON.stringify(conditions);
      if (this.units.some((o) => o.brandId === brandId && o.outcome === audience && JSON.stringify(o.conditions ?? []) === key)) continue;
      const finder = this.catalogue.script(this.world.settings.icpFinderScript);
      const pipe = finder ? this.catalogue.pipe(finder.pipeId) : undefined;
      if (!finder || !pipe) continue;
      const cost = Math.round(this.truthOf(finder, null).costCents);
      const run = this.newRun(day, campaign.id, pipe, finder);
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
      const play = this.playsFor(campaign, START, campaign.line[0]!)[0];
      if (play) {
        const sid = `${play.id}#proposed-${brandId}-${day}`;
        if (!this.catalogue.strategy(sid)) {
          this.catalogue.add("strategies", { id: sid, name: `Serve: ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", ")}`, pipeId: play.id, rules: [], subject: study.proposal.conditions, proposed: { day, reason: `split on ${records.length} mature leads` } });
          this.proposals.push({ day, kind: "strategy", brandId, campaignId: campaign.id, point: null, conditions: study.proposal.conditions, text: "", createdId: sid, study });
        }
      }
    }
    // Splits on scripts: per point, the tactic values of the option chosen.
    for (const point of this.evidence.pointOptions.keys()) {
      const [consumer, material] = point.split("|") as [string, string];
      const consumerPipe = this.catalogue.pipe(consumer);
      if (!consumerPipe || !material) continue;
      const scriptTactics = this.catalogue.tactics.filter((t) => t.describes.includes("script"));
      const records: SplitRecord[] = [];
      for (const d of this.decisions) {
        if (d.point !== point || d.day > mature) continue;
        const s = this.catalogue.headOf(d.option);
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
        pipeId: consumer,
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
      if (!o.referencePipe) continue;
      reference[o.id] = o.referencePipe;
      covered[o.id] = new Set(this.world.clients.filter((c) => c.connected.includes(o.referencePipe!)).map((c) => c.brand.id));
    }
    return measureReliability(this.attestations, reference, covered);
  }

  /** Attempts of a campaign's legs (for the lead timeline and reports). */
  attemptsOf(subject: string): { campaignId: string; legIndex: number; from: string; to: string; startDay: number; status: string; spentCents: number }[] {
    return this.attempts.filter((a) => a.person?.id === subject).map((a) => ({ campaignId: a.campaign.id, legIndex: a.legIndex, from: a.from, to: a.to, startDay: a.startDay, status: a.status, spentCents: a.spentCents }));
  }

  /** Attempts of a campaign: the leg, the Unit it started from, when, and how it ended. */
  campaignAttempts(campaignId: string): { legIndex: number; startUnit: string | null; startDay: number; status: string; subject: string | null }[] {
    return this.attempts.filter((a) => a.campaign.id === campaignId).map((a) => ({ legIndex: a.legIndex, startUnit: a.startUnit, startDay: a.startDay, status: a.status, subject: a.person?.id ?? null }));
  }

  /**
   * What a leg costs and yields across the fleet today (every campaign with this leg),
   * for proposing funnels to a new campaign. Null when no campaign ran it yet.
   */
  fleetLegEstimate(from: OutcomeId, to: OutcomeId): { costPerAttempt: number; yieldRate: number; label: "measured" } | null {
    let att = 0;
    let s = 0;
    let c = 0;
    for (const campaign of this.campaigns()) {
      const legs = this.legEstimates(campaign);
      for (const l of legs) {
        if (l.from !== from || l.to !== to || l.yieldRate === null || l.costPerAttempt === null) continue;
        att += l.attempts;
        s += l.yieldRate * l.attempts;
        c += l.costPerAttempt * l.attempts;
      }
    }
    if (att === 0) return null;
    return { costPerAttempt: c / att, yieldRate: s / att, label: "measured" };
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

/** One pipe a leg runs through: what it makes, and the Material of the pipe it feeds (null for the leg's play). */
export interface LegPipe {
  pipeId: string;
  output: OutcomeId;
  feeds: { pipe: string; material: OutcomeId } | null;
  /** On the chain that carries the leg's subject from its start to its end. */
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
