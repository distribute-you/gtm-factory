/**
 * The engine at work on a simulated world. Day by day, under each campaign's
 * budget, the engine orchestrates: it picks the play of each leg, then at every
 * input of every pipe it runs, the script providing that input (or the
 * occurrence to consume), all with the universal prioritizer. Runs produce
 * occurrences after their delay; each occurrence carries its traceability (the
 * input choices that led to it), and when the end of a leg lands every input
 * choice on its traceability is credited. Deterministic: one seed, one history.
 */

import { START, defaultStrategyId, isOnDemand, type Catalogue, type OutcomeId, type Pipe, type Script, type Strategy } from "./catalogue";
import { EvidenceBook, SEP, bumpCell, legEstimateOf, type CellStore } from "./evidence";
import { chainCostPerTarget, valueBackwardLine } from "./funnels";
import { buildLedger, type LedgerOccurrence, type LedgerReport, type LedgerRun } from "./ledger";
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

/** One occurrence: an outcome reached for a subject, produced by one run. */
export interface Occurrence extends LedgerOccurrence {
  brandId: string;
  campaignId: string | null;
  factory: string;
  pipeId: string | null;
  scriptId: string | null;
  /** The occurrences it consumed, by input. */
  inputs: Record<OutcomeId, string>;
  /** Traceability: the input choices that led to it (decision ids), its own included. */
  trace: number[];
  /** Object occurrences: their dynasty, version and text. */
  dynasty?: string;
  version?: number;
  parentDynasty?: string;
  name?: string;
  text?: string;
  conditions?: Condition[];
}

/** One input choice: at a point (consuming pipe x input), for a subject, the option picked. */
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

export interface Run extends LedgerRun {
  factory: string;
  scriptId?: string;
  /** Subjects processed and how many got the outcome. */
  subjects: number;
}

/** What the engine logs per day, per choice point and campaign: the picks and why. */
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
  attempts: Record<string, number>;
  triggerEvents: number;
}

export interface TriggerEvent {
  day: number;
  triggerId: string;
  subject: string;
  brandId: string;
  occurrenceId: string;
  campaignIds: string[];
}

export interface Proposal {
  day: number;
  kind: "audience" | "strategy";
  brandId: string | null;
  campaignId: string | null;
  point: string | null;
  conditions: Condition[];
  text: string;
  /** The ICP occurrence or the strategy it became. */
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
  eventOcc: string | null;
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
  /** The object dynasty consumed per outcome (kept after the attempt ends, for studies). */
  objects: Record<OutcomeId, string>;
}

interface PendingLanding {
  day: number;
  attempt: Attempt;
  key: string;
  occ: Occurrence;
  final: boolean;
}

type Obtained = { kind: "ok"; occ: string } | { kind: "wait" } | { kind: "fail"; reason: string } | { kind: "blocked" };

export function pointKey(consumer: string, input: OutcomeId): string {
  return `${consumer}|${input}`;
}

export function legConsumer(from: OutcomeId, to: OutcomeId): string {
  return `leg:${from}>${to}`;
}

export function playPoint(from: OutcomeId, to: OutcomeId): string {
  return `play:${from}>${to}`;
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

/** What a script keeps after a run: failures it will not retry soon, and each subject it served. */
export function scriptRecords(ctx: ScriptContext, subject: string, ok: boolean): void {
  if (ctx.tactics.retry_days !== undefined && !ok) ctx.storage.set("failed", subject, ctx.day);
  ctx.storage.set("served", subject, { day: ctx.day, ok });
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
  readonly occurrences: Occurrence[] = [];
  readonly decisions: Decision[] = [];
  readonly choices: ChoiceRecord[] = [];
  readonly days: DaySnapshot[] = [];
  readonly triggerEvents: TriggerEvent[] = [];
  readonly proposals: Proposal[] = [];
  readonly attestations: Attestation[] = [];

  private readonly occById = new Map<string, Occurrence>();
  private readonly runIndex = new Map<string, Run>();
  private readonly attempts: Attempt[] = [];
  private readonly pendings: PendingLanding[] = [];
  private readonly queues = new Map<string, Attempt[]>();
  /** Latest occurrence per subject per outcome. */
  private readonly latest = new Map<string, string>();
  /** Lead states reached: subject -> outcome -> first day. */
  private readonly reached = new Map<string, Map<OutcomeId, number>>();
  private readonly rawPerson = new Map<string, number>();
  private readonly rootFactory = new Map<string, string>();
  private readonly enrolled = new Map<string, Set<string>>();
  private readonly legStarted = new Set<string>();
  private readonly valueCredited = new Set<string>();
  private readonly truePositive = new Map<string, number>();
  private readonly persons = new Map<string, Person>();
  private readonly evidence: EvidenceBook;
  private readonly legCohorts: CellStore = new Map();
  private readonly picks = new Map<string, Map<string, number[]>>();
  private readonly spent = new Map<string, number>();
  private readonly budgetLeft = new Map<string, number>();
  private readonly subjectsByCampaign = new Map<string, { entryDay: number; spendCents: number; value: number }>();
  private readonly triggerChecks: { day: number; triggerId: string; subject: string; brandId: string; fromDay: number }[] = [];
  private readonly brandIds: string[];
  private ledgerCache: { day: number; runs: number; occ: number; report: LedgerReport } | null = null;
  private occCounter = 0;
  private runCounter = 0;
  private rawCounter = 0;
  private today: DaySnapshot | null = null;
  private dayPicks = new Map<string, Map<string, number>>();
  /** Options offered per (point, campaign), ever. */
  private readonly dayPicksAll = new Map<string, Set<string>>();

  constructor(world: WorldSpec) {
    this.world = world;
    this.catalogue = world.catalogue;
    this.rng = createRng(world.seed);
    this.brandIds = [...new Set(world.clients.map((c) => c.brand.id))];
    this.evidence = new EvidenceBook({
      catalogue: this.catalogue,
      brandIds: () => this.brandIds,
      groupOf: (b) => this.groupOf(b),
      parentOf: (o) => this.parentOf(o),
      ...(world.settings.memoryHalfLifeDays !== undefined ? { memoryHalfLifeDays: world.settings.memoryHalfLifeDays } : {}),
    });
    for (const c of world.clients) this.register(c);
  }

  get day(): number {
    return this.dayIndex;
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

  occurrence(id: string): Occurrence | undefined {
    return this.occById.get(id);
  }

  person(id: string): Person | undefined {
    return this.persons.get(id);
  }

  /** Lead states (and every outcome) a subject reached, with the first day. */
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

  // ---- setup -----------------------------------------------------------------

  private register(c: WorldClient): void {
    if (!this.brandIds.includes(c.brand.id)) this.brandIds.push(c.brand.id);
    const setupId = `run:setup:${c.brand.id}`;
    if (this.world.settings.setupCentsPerBrand > 0 && !this.runs.some((r) => r.id === setupId)) {
      this.pushRun({ id: setupId, pipeId: null, target: null, day: this.dayIndex, spendCents: this.world.settings.setupCentsPerBrand, consumed: [], support: { kind: "brand_setup", reason: "first setup of the brand" }, factory: this.ourFactory(), subjects: 0, campaignId: c.campaigns[0]?.id });
    }
    for (const s of c.seeds) {
      if (this.occurrences.some((o) => o.brandId === c.brand.id && o.dynasty === s.dynasty && o.version === s.version)) continue;
      const script = this.catalogue.script(s.scriptId);
      const pipe = script ? this.catalogue.pipe(script.pipeId) : undefined;
      if (!script || !pipe) throw new Error(`seed occurrence names unknown script "${s.scriptId}"`);
      const cost = Math.round(this.truthOf(script, null).costCents);
      const run = this.runFor(this.dayIndex, c.campaigns[0]?.id ?? null, pipe, script);
      run.spendCents += cost;
      run.subjects += 1;
      if (this.catalogue.isOurs(pipe) && c.campaigns[0]) this.spent.set(c.campaigns[0].id, (this.spent.get(c.campaigns[0].id) ?? 0) + cost);
      const occ = this.makeOcc(run, s.outcome, `${c.brand.id}:${s.dynasty}:v${s.version}`, c.brand.id, null, {}, []);
      Object.assign(occ, { dynasty: s.dynasty, version: s.version, name: s.name, text: s.text, ...(s.parentDynasty ? { parentDynasty: s.parentDynasty } : {}), ...(s.conditions ? { conditions: s.conditions } : {}) });
      this.addOcc(occ);
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
   * A new version of an object dynasty (an edit): from now on the input
   * choice that picks this dynasty serves the new head; the dynasty keeps its
   * stats. Made by the script that made the previous head, by hand (no cost).
   */
  addObjectVersion(brandId: string, outcome: OutcomeId, dynasty: string, change: { text: string; name?: string; conditions?: Condition[] }): Occurrence {
    const head = this.objectHead(brandId, outcome, dynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${dynasty}" for ${brandId}`);
    return this.newObject(head, { dynasty, version: (head.version ?? 1) + 1, ...change });
  }

  /** A fork of an object dynasty: a new dynasty that starts from its parent's posterior. */
  forkObject(brandId: string, outcome: OutcomeId, parentDynasty: string, change: { dynasty: string; text: string; name?: string; conditions?: Condition[] }): Occurrence {
    const head = this.objectHead(brandId, outcome, parentDynasty);
    if (!head) throw new Error(`no ${outcome} dynasty "${parentDynasty}" for ${brandId}`);
    if (this.objectHead(brandId, outcome, change.dynasty)) throw new Error(`dynasty "${change.dynasty}" already exists`);
    return this.newObject(head, { ...change, version: 1, parentDynasty });
  }

  private newObject(from: Occurrence, v: { dynasty: string; version: number; text: string; name?: string; conditions?: Condition[]; parentDynasty?: string }): Occurrence {
    const script = from.scriptId ? this.catalogue.script(from.scriptId) : undefined;
    const pipe = from.pipeId ? this.catalogue.pipe(from.pipeId) : undefined;
    if (!script || !pipe) throw new Error("the previous version names no script");
    const run = this.runFor(this.dayIndex, from.campaignId, pipe, script);
    run.subjects += 1;
    run.consumed.push(from.id);
    const occ = this.makeOcc(run, from.outcome, `${from.brandId}:${v.dynasty}:v${v.version}`, from.brandId, from.campaignId, { [from.outcome]: from.id }, []);
    Object.assign(occ, { dynasty: v.dynasty, version: v.version, name: v.name ?? from.name, text: v.text, ...(v.conditions ?? from.conditions ? { conditions: v.conditions ?? from.conditions } : {}), ...(v.parentDynasty ? { parentDynasty: v.parentDynasty } : {}) });
    // Hidden: an edit moves the effect a little, either way.
    const r = createRng(`${this.world.seed}|edit|${occ.subject}`);
    this.occTruth.set(occ.id, this.objectTruthEnd(from) * (0.85 + 0.4 * r.next()));
    this.addOcc(occ);
    return occ;
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

  // ---- the day ---------------------------------------------------------------

  step(): DaySnapshot {
    const day = this.dayIndex;
    this.evidence.newDay();
    this.dayPicks = new Map();
    const snap: DaySnapshot = { day, spendCents: {}, otherCents: {}, outcomes: {}, valueOurs: {}, valueOther: {}, attempts: {}, triggerEvents: 0 };
    this.today = snap;
    for (const c of this.campaigns()) this.budgetLeft.set(c.id, c.status === "running" ? c.dailyBudgetCents : 0);

    this.deliver(day);
    this.otherFactories(day);
    this.fireTriggers(day);

    for (const campaign of this.campaigns()) {
      if (campaign.status !== "running") continue;
      const client = this.clientOf(campaign.id)!;
      const queue = this.queues.get(campaign.id) ?? [];
      this.queues.set(campaign.id, []);
      const keep: Attempt[] = [];
      for (const a of queue) {
        if (a.status !== "open") continue;
        const r = this.advance(a, day);
        if (r === "blocked") keep.push(a);
      }
      this.queues.set(campaign.id, [...keep, ...(this.queues.get(campaign.id) ?? [])]);
      if (campaign.entry.kind === "start" && keep.length === 0) {
        let created = this.createdCount(campaign.id);
        for (let guard = 0; guard < 20_000; guard++) {
          if (campaign.maxVolume !== undefined && created >= campaign.maxVolume) break;
          if ((this.budgetLeft.get(campaign.id) ?? 0) <= 0) break;
          const a = this.newAttempt(campaign, client, 0, null, day);
          created++;
          const r = this.advance(a, day);
          if (r === "blocked") {
            this.queues.get(campaign.id)!.push(a);
            break;
          }
        }
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

  private createdCount(campaignId: string): number {
    return this.created.get(campaignId) ?? 0;
  }

  // ---- attempts ----------------------------------------------------------------

  private newAttempt(campaign: Campaign, client: WorldClient, legIndex: number, person: Person | null, day: number, eventOcc: string | null = null): Attempt {
    const from = legIndex === 0 ? (campaign.entry.kind === "start" ? START : this.triggerEventOutcome(campaign.entry.triggerId)) : campaign.line[legIndex - 1]!;
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
      eventOcc,
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
    };
    this.attempts.push(a);
    if (legIndex === 0) this.created.set(campaign.id, (this.created.get(campaign.id) ?? 0) + 1);
    if (person) this.setPerson(a, person);
    bumpCell(this.legCohorts, `${campaign.id}${SEP}${legIndex}`, day, "t", 1);
    if (this.today) this.today.attempts[campaign.id] = (this.today.attempts[campaign.id] ?? 0) + 1;
    return a;
  }

  private triggerEventOutcome(triggerId: string): OutcomeId {
    const t = this.catalogue.trigger(triggerId);
    if (!t?.event) throw new Error(`trigger "${triggerId}" has no event outcome`);
    return t.event;
  }

  /** Move an attempt as far as it can go today. */
  private advance(a: Attempt, day: number): "done" | "wait" | "fail" | "blocked" {
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
      pipeId = pinned && plays.some((p) => p.id === pinned) ? pinned : this.decide(a, playPoint(a.from, a.to), plays.map((p) => p.id), day, 0);
      a.choices.set(playPoint(a.from, a.to), pipeId);
    }
    const pipe = this.catalogue.pipe(pipeId)!;
    const scripts = this.allowedScripts(a.campaign, pipe, null, [pipe]);
    const r = this.produce(a, consumer, a.to, scripts, 0, true, day);
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

  /** Live pipes producing a leg's end whose subject comes from the leg's start. */
  playsFor(campaign: Campaign, from: OutcomeId, to: OutcomeId): Pipe[] {
    return this.catalogue
      .providersOf(to)
      .filter((p) => !isOnDemand(p) && !this.reports(p) && this.catalogue.rootsOf(p).has(from))
      .filter((p) => this.catalogue.dynastiesOf(p.id).length > 0)
      .filter((p) => (campaign.pinned ? true : true));
  }

  /** A pipe of another factory that runs on its own schedule and reports (a CRM import, the organic market). */
  reports(p: Pipe): boolean {
    return p.reports === true;
  }

  /** The campaign's strategy on a pipe (its play on that pipe). */
  strategyOf(campaign: Campaign, pipeId: string): Strategy | null {
    const id = campaign.strategies[pipeId];
    return (id ? this.catalogue.strategy(id) : null) ?? this.catalogue.strategy(defaultStrategyId(pipeId)) ?? null;
  }

  /**
   * The scripts allowed at one input: the providers' active dynasty heads,
   * filtered by the consuming pipe's play (its strategy's rules for this input).
   * `consumer` null = the leg's own pipe, filtered by its rules without input.
   */
  allowedScripts(campaign: Campaign, consumerPipe: Pipe | null, input: OutcomeId | null, providers: Pipe[]): Script[] {
    let rules: Condition[] = [];
    if (consumerPipe && input) rules = (this.strategyOf(campaign, consumerPipe.id)?.rules ?? []).filter((r) => r.input === input).flatMap((r) => r.conditions);
    else if (providers[0]) rules = (this.strategyOf(campaign, providers[0].id)?.rules ?? []).filter((r) => !r.input).flatMap((r) => r.conditions);
    return providers.flatMap((p) => this.catalogue.dynastiesOf(p.id)).filter((s) => meetsAll(s.tactics, rules));
  }

  // ---- orchestration -------------------------------------------------------------

  private produce(a: Attempt, consumer: string, o: OutcomeId, scripts: Script[], remDelay: number, final: boolean, day: number): Obtained {
    const key = pointKey(consumer, o);
    const have = a.got.get(key);
    if (have) return { kind: "ok", occ: have };
    if (a.pending.has(key)) return { kind: "wait" };
    let dynasty = a.choices.get(key);
    if (!dynasty) {
      if (scripts.length === 0) return { kind: "fail", reason: `no script at ${key}` };
      const pipeDelay = (s: Script) => this.catalogue.pipe(s.pipeId)!.maturity;
      const rem = remDelay + Math.max(...scripts.map((s) => pipeDelay(s).delayMeanDays));
      dynasty = this.decide(a, key, scripts.map((s) => s.dynasty), day, rem, Math.max(...scripts.map((s) => pipeDelay(s).horizonDays)));
      a.choices.set(key, dynasty);
    }
    const script = this.catalogue.headOf(dynasty);
    if (!script) return { kind: "fail", reason: `dynasty ${dynasty} has no active version` };
    const pipe = this.catalogue.pipe(script.pipeId)!;
    const rem = remDelay + pipe.maturity.delayMeanDays;

    // Inputs: the subject first; nothing else is asked for before the subject is there.
    const subjectInput = this.catalogue.subjectInput(pipe);
    const order = subjectInput ? [subjectInput, ...pipe.inputs.filter((i) => i !== subjectInput)] : [...pipe.inputs];
    const inputs: Record<OutcomeId, string> = {};
    for (const i of order) {
      const r = this.obtain(a, pipe, i, rem, day);
      if (r.kind !== "ok") return r;
      inputs[i] = r.occ;
      if (i === subjectInput && a.person && !a.checkedSubject) {
        a.checkedSubject = true;
        if (!this.subjectAllowed(a)) return { kind: "fail", reason: "excluded by the play's strategy" };
      }
    }
    const outcome = this.catalogue.outcome(o)!;
    // A lead or company outcome already reached is reused, never produced again.
    if (!final && a.person && (outcome.subject === "lead" || outcome.subject === "company")) {
      const existing = this.latest.get(`${outcome.subject === "company" ? a.person.companyId : a.person.id}${SEP}${o}`);
      if (existing) {
        a.got.set(key, existing);
        return { kind: "ok", occ: existing };
      }
    }
    return this.runScript(a, key, pipe, script, inputs, o, final, day);
  }

  private obtain(a: Attempt, consumer: Pipe, i: OutcomeId, rem: number, day: number): Obtained {
    const key = pointKey(consumer.id, i);
    const have = a.got.get(key);
    if (have) return { kind: "ok", occ: have };
    const out = this.catalogue.outcome(i);
    if (!out) return { kind: "fail", reason: `unknown input ${i}` };
    if (out.subject === "event") {
      if (!a.eventOcc) return { kind: "fail", reason: "no trigger event" };
      a.got.set(key, a.eventOcc);
      return { kind: "ok", occ: a.eventOcc };
    }
    const providers = this.catalogue.providersOf(i).filter((p) => !this.reports(p));
    if (out.subject === "lead" || out.subject === "company") {
      if (a.person) {
        const existing = this.latest.get(`${out.subject === "company" ? a.person.companyId : a.person.id}${SEP}${i}`);
        if (existing) {
          a.got.set(key, existing);
          return { kind: "ok", occ: existing };
        }
      }
      const rooted = providers.filter((p) => isOnDemand(p) || this.catalogue.rootsOf(p).has(a.from) || this.rootedAnywhere(p, a.from));
      return this.produce(a, consumer.id, i, this.allowedScripts(a.campaign, consumer, i, rooted), rem, false, day);
    }
    // An object: produced on demand at this input, or an existing occurrence chosen here.
    const onDemand = providers.filter((p) => isOnDemand(p));
    if (onDemand.length > 0) return this.produce(a, consumer.id, i, this.allowedScripts(a.campaign, consumer, i, onDemand), rem, false, day);
    let dynasty = a.choices.get(key);
    if (!dynasty) {
      const options = this.objectDynasties(a.client.brand.id, i);
      if (options.length === 0) return { kind: "fail", reason: `no ${i} for this brand` };
      dynasty = this.decide(a, key, options, day, rem);
      a.choices.set(key, dynasty);
    }
    const occ = this.objectHead(a.client.brand.id, i, dynasty);
    if (!occ) return { kind: "fail", reason: `no head version of ${dynasty}` };
    const dec = a.decisionAt.get(key);
    if (dec !== undefined) this.decisionObject.set(dec, occ.id);
    a.objects[i] = dynasty;
    a.got.set(key, occ.id);
    return { kind: "ok", occ: occ.id };
  }

  /** A provider whose roots do not include the leg start may still be reached from it through a lead state below (e.g. company research). */
  private rootedAnywhere(p: Pipe, from: OutcomeId): boolean {
    const roots = this.catalogue.rootsOf(p);
    if (from === START) return roots.has(START);
    return false;
  }

  /** Dynasties of an object outcome a brand holds (each serves its head version). */
  objectDynasties(brandId: string, outcome: OutcomeId): string[] {
    const out: string[] = [];
    for (const o of this.objectsBy.get(`${brandId}${SEP}${outcome}`) ?? []) if (o.dynasty && !out.includes(o.dynasty)) out.push(o.dynasty);
    return out;
  }

  /** Every version of every object dynasty a brand holds for an outcome, oldest first. */
  objectVersions(brandId: string, outcome: OutcomeId): Occurrence[] {
    return [...(this.objectsBy.get(`${brandId}${SEP}${outcome}`) ?? [])];
  }

  /** The head (latest version) of an object dynasty. */
  objectHead(brandId: string, outcome: OutcomeId, dynasty: string): Occurrence | undefined {
    let head: Occurrence | undefined;
    for (const o of this.objectsBy.get(`${brandId}${SEP}${outcome}`) ?? []) if (o.dynasty === dynasty && (!head || (o.version ?? 0) > (head.version ?? 0))) head = o;
    return head;
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

  /** Hidden truth of a script (at one input when it differs there). For grading only. */
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

  private runFor(day: number, campaignId: string | null, pipe: Pipe, script: Script): Run {
    const key = `${day}|${campaignId ?? ""}|${pipe.id}|${script.id}`;
    let r = this.runIndex.get(key);
    if (!r) {
      r = { id: `run:${++this.runCounter}`, pipeId: pipe.id, target: pipe.output, day, spendCents: 0, consumed: [], inputs: 0, factory: pipe.factory, scriptId: script.id, subjects: 0, ...(campaignId ? { campaignId } : {}) };
      this.pushRun(r);
      this.runIndex.set(key, r);
    }
    return r;
  }

  private pushRun(r: Run): void {
    this.runs.push(r);
  }

  private makeOcc(run: Run, outcome: OutcomeId, subject: string, brandId: string, campaignId: string | null, inputs: Record<OutcomeId, string>, trace: number[]): Occurrence {
    return { id: `occ:${++this.occCounter}`, outcome, subject, runId: run.id, day: run.day, brandId, campaignId, factory: run.factory, pipeId: run.pipeId, scriptId: run.scriptId ?? null, inputs, trace };
  }

  private runScript(a: Attempt, key: string, pipe: Pipe, script: Script, inputs: Record<OutcomeId, string>, o: OutcomeId, final: boolean, day: number): Obtained {
    const ctx: ScriptContext = Object.freeze({ storage: this.storage.forPipe(pipe.id), day, tactics: script.tactics });
    const truth = this.truthOf(script, key);
    const ours = this.catalogue.isOurs(pipe);
    const creates = this.catalogue.createsSubjects(pipe);
    const subjectKey = a.person?.id ?? a.subject ?? "";
    if (!creates && subjectKey && !scriptAccepts(ctx, subjectKey)) return { kind: "fail", reason: "the script does not retry yet" };
    const cost = Math.max(0, Math.round(truth.costCents * (0.85 + 0.3 * this.rng.next())));
    if (ours && cost > (this.budgetLeft.get(a.campaign.id) ?? 0)) return { kind: "blocked" };

    const run = this.runFor(day, a.campaign.id, pipe, script);
    run.spendCents += cost;
    run.subjects += 1;
    run.inputs = (run.inputs ?? 0) + 1;
    for (const id of Object.values(inputs)) run.consumed.push(id);
    this.charge(a, cost, ours, day);

    const pt = this.world.truth.pipes[pipe.id] ?? { base: 1, delayMeanDays: 0, horizonDays: 0 };
    // The trace: this input choice, the choices made at this pipe's inputs, and what its inputs carried.
    const trace = new Set<number>();
    const own = a.decisionAt.get(key);
    if (own !== undefined) trace.add(own);
    if (final) {
      const play = a.decisionAt.get(playPoint(a.from, a.to));
      if (play !== undefined) trace.add(play);
    }
    for (const i of pipe.inputs) {
      const d = a.decisionAt.get(pointKey(pipe.id, i));
      if (d !== undefined) trace.add(d);
      const occ = this.occById.get(inputs[i]!);
      if (occ) for (const t of occ.trace) trace.add(t);
    }

    let subject = a.subject ?? "";
    let fact: boolean;
    let recall = truth.recall ?? 1;
    let fp = truth.falsePositive ?? 0;
    for (const i of pipe.inputs) {
      const d = a.decisionAt.get(pointKey(pipe.id, i));
      if (d === undefined) continue;
      const t = this.optionTruth(this.decisions[d]!.point, this.decisions[d]!.option);
      if (t.recall !== undefined) recall *= t.recall;
      if (t.falsePositive !== undefined) fp = Math.max(fp, t.falsePositive);
    }
    if (creates) {
      const icpOcc = Object.values(inputs).map((id) => this.occById.get(id)).find((x) => x?.conditions);
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
        inIcp: (i) => meetsAll(personOf(this.world, brandId, i).values, icpOcc?.conditions ?? []),
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
          subject = person.id;
          this.enroll(person.id, a.campaign.id, day);
        }
      }
    } else {
      let p = pt.base * (truth.step ?? 1);
      const raw = a.subject && this.rawPerson.has(a.subject) && !a.person ? a.subject : null;
      if (final) {
        p *= this.endProduct(a, trace);
        if (a.person) {
          p *= this.world.clients.find((c) => c.brand.id === a.person!.brandId)?.truthMultiplier ?? 1;
          if (a.legIndex === 0 && a.campaign.entry.kind === "start") p *= segmentMultiplier(this.world, a.person.values) * (a.recontact ? this.world.truth.recontactMult : 1);
        }
        if (a.legIndex > 0 && pt.onFalseInput !== undefined && a.person && !this.truePositive.has(a.person.id) && this.rootFactory.get(a.person.id) !== "organic") p *= pt.onFalseInput;
      }
      fact = p >= 1 || this.rng.next() < Math.min(0.97, p);
      if (raw && fact) {
        // Identity: the raw record becomes a person, the one id space every pipe shares.
        const index = this.rawPerson.get(raw)!;
        const person = personOf(this.world, a.client.brand.id, index);
        this.persons.set(person.id, person);
        if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, this.rootFactory.get(raw) ?? pipe.factory);
        this.setPerson(a, person);
        subject = person.id;
        this.enroll(person.id, a.campaign.id, day);
      } else if (a.person) subject = this.catalogue.outcome(o)?.subject === "company" ? a.person.companyId : a.person.id;
    }
    const attested = fact ? this.rng.next() < recall : this.rng.next() < fp;
    if (final && fact && a.person && this.catalogue.outcome(o)?.referencePipe) this.truePositive.set(a.person.id, day);
    if (this.catalogue.outcome(o)?.referencePipe && a.person) {
      this.attestations.push({ producer: pipe.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
      this.attestations.push({ producer: script.id, outcome: o, brandId: a.client.brand.id, subject: a.person.id, attested });
    }
    if (!isOnDemand(pipe) && subjectKey) scriptRecords(ctx, subjectKey, attested);
    if (!attested) return { kind: "fail", reason: `no outcome at ${pipe.id}` };

    const occ = this.makeOcc(run, o, subject, a.client.brand.id, a.campaign.id, inputs, [...trace].sort((x, y) => x - y));
    const delay = this.sampleDelay(pt.delayMeanDays, pt.horizonDays);
    if (delay <= 0) {
      this.land(occ, day);
      a.got.set(key, occ.id);
      return { kind: "ok", occ: occ.id };
    }
    a.pending.add(key);
    this.pendings.push({ day: day + delay, attempt: a, key, occ, final });
    return { kind: "wait" };
  }

  /** Hidden: the product of the end effects of this attempt's input choices on a trace. */
  private endProduct(a: Attempt, trace: Iterable<number>): number {
    let p = 1;
    for (const d of trace) {
      const dec = this.decisions[d]!;
      if (dec.legTarget !== a.to || dec.attemptId !== a.id) continue;
      const obj = this.decisionObject.get(d);
      p *= obj ? this.objectTruthEnd(this.occById.get(obj)!) : (this.optionTruth(dec.point, dec.option).end ?? 1);
    }
    return p;
  }

  /** Hidden: how much an object occurrence changes the end of the leg it serves. */
  objectTruthEnd(occ: Occurrence): number {
    const drawn = this.occTruth.get(occ.id);
    if (drawn !== undefined) return drawn;
    const seed = this.world.clients.find((c) => c.brand.id === occ.brandId)?.seeds.find((s) => s.dynasty === occ.dynasty && s.version === occ.version);
    return seed?.truthEnd ?? 1;
  }

  private charge(a: Attempt, cents: number, ours: boolean, day: number): void {
    if (ours) {
      this.budgetLeft.set(a.campaign.id, (this.budgetLeft.get(a.campaign.id) ?? 0) - cents);
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
    void day;
  }

  private sampleDelay(mean: number, horizon: number): number {
    if (mean <= 0) return 0;
    const q = 1 / (1 + mean);
    const u = 1 - this.rng.next();
    return Math.min(horizon, Math.floor(Math.log(u) / Math.log(1 - q)));
  }

  // ---- landing ------------------------------------------------------------------------

  private addOcc(occ: Occurrence): void {
    this.occurrences.push(occ);
    this.occById.set(occ.id, occ);
    if (occ.dynasty) {
      const k = `${occ.brandId}${SEP}${occ.outcome}`;
      const list = this.objectsBy.get(k);
      if (list) list.push(occ);
      else this.objectsBy.set(k, [occ]);
    }
  }

  private deliver(day: number): void {
    const due = this.pendings.filter((p) => p.day <= day);
    if (due.length === 0) return;
    const rest = this.pendings.filter((p) => p.day > day);
    this.pendings.length = 0;
    this.pendings.push(...rest);
    for (const p of due) {
      p.occ.day = day;
      this.land(p.occ, day);
      p.attempt.pending.delete(p.key);
      if (p.attempt.status !== "open") continue;
      p.attempt.got.set(p.key, p.occ.id);
      if (p.final) this.finish(p.attempt, "done");
      else this.queues.get(p.attempt.campaign.id)?.push(p.attempt);
    }
  }

  /** An occurrence lands: record it, credit the trace, wake triggers and the next legs. */
  private land(occ: Occurrence, day: number): void {
    this.addOcc(occ);
    const out = this.catalogue.outcome(occ.outcome);
    if (out?.subject === "lead" || out?.subject === "company" || out?.subject === "event") this.latest.set(`${occ.subject}${SEP}${occ.outcome}`, occ.id);
    if (out?.subject !== "lead") return;
    let m = this.reached.get(occ.subject);
    if (!m) this.reached.set(occ.subject, (m = new Map()));
    const first = !m.has(occ.outcome);
    if (first) m.set(occ.outcome, day);

    // Credit every input choice on the trace that exists for this outcome, for this subject.
    for (const d of occ.trace) {
      const dec = this.decisions[d]!;
      if (dec.credited || dec.legTarget !== occ.outcome) continue;
      const at = this.attempts[dec.attemptId]!;
      if (at.person?.id !== occ.subject) continue;
      dec.credited = true;
      // Settled as a failure when its attempt ended, and reached after all (another producer attested it).
      if (at.status !== "open") this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "f", -1);
      this.evidence.bump(dec.point, dec.option, dec.brandId, dec.day, "s", 1);
    }
    if (!first) return;

    for (const cid of this.enrolled.get(occ.subject) ?? []) {
      const campaign = this.campaign(cid);
      if (!campaign) continue;
      const k = campaign.line.indexOf(occ.outcome);
      if (k < 0) continue;
      if (this.today) {
        const o = (this.today.outcomes[cid] ??= {});
        o[occ.outcome] = (o[occ.outcome] ?? 0) + 1;
      }
      // The leg attempt that just reached its end.
      const done = this.attemptOf.get(`${cid}${SEP}${k}${SEP}${occ.subject}`);
      if (done && !this.legDone.has(done.id)) {
        this.legDone.add(done.id);
        bumpCell(this.legCohorts, `${cid}${SEP}${k}`, done.startDay, "s", 1);
      }
      if (k === campaign.line.length - 1) this.creditValue(campaign, occ.subject, day);
      else this.startLeg(campaign, k + 1, occ.subject, day);
    }
    for (const t of this.catalogue.triggers) {
      if (t.retired || !t.when.includes(occ.outcome) || !t.event) continue;
      this.triggerChecks.push({ day: day + t.delayDays, triggerId: t.id, subject: occ.subject, brandId: occ.brandId, fromDay: day });
    }
  }

  private readonly legDone = new Set<number>();

  private setPerson(a: Attempt, person: Person): void {
    a.person = person;
    a.subject = person.id;
    this.attemptOf.set(`${a.campaign.id}${SEP}${a.legIndex}${SEP}${person.id}`, a);
  }
  private readonly decisionObject = new Map<number, string>();
  private readonly objectsBy = new Map<string, Occurrence[]>();
  private readonly occTruth = new Map<string, number>();
  /** The attempt of each campaign leg for each person. */
  private readonly attemptOf = new Map<string, Attempt>();
  private readonly created = new Map<string, number>();
  private readonly pointLeg = new Map<string, number>();

  private enroll(subject: string, campaignId: string, _day: number): void {
    let s = this.enrolled.get(subject);
    if (!s) this.enrolled.set(subject, (s = new Set()));
    s.add(campaignId);
  }

  private startLeg(campaign: Campaign, legIndex: number, subject: string, day: number): void {
    const key = `${campaign.id}${SEP}${legIndex}${SEP}${subject}`;
    if (this.legStarted.has(key)) return;
    this.legStarted.add(key);
    const person = this.persons.get(subject);
    if (!person) return;
    const client = this.clientOf(campaign.id)!;
    const a = this.newAttempt(campaign, client, legIndex, person, day);
    const q = this.queues.get(campaign.id) ?? [];
    q.push(a);
    this.queues.set(campaign.id, q);
  }

  private creditValue(campaign: Campaign, subject: string, day: number): void {
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
    void day;
  }

  // ---- other factories and triggers -------------------------------------------------

  /** Pipes of other factories that run on their own: a CRM import attesting replies, the organic market. */
  private otherFactories(day: number): void {
    for (const pipe of this.catalogue.pipes) {
      if (!this.reports(pipe) || !this.catalogue.isPipeLive(pipe)) continue;
      const script = this.catalogue.dynastiesOf(pipe.id)[0];
      if (!script) continue;
      const truth = this.truthOf(script, null);
      const pt = this.world.truth.pipes[pipe.id]!;
      for (const client of this.world.clients) {
        const creates = this.catalogue.createsSubjects(pipe);
        if (creates) {
          const n = this.rng.binomial(Math.round(client.organicPerDay * 4), 0.25);
          for (let i = 0; i < n; i++) {
            const index = this.rng.int(this.world.settings.marketSize);
            const person = personOf(this.world, client.brand.id, index);
            if (this.reached.get(person.id)?.has(pipe.output)) continue;
            this.persons.set(person.id, person);
            if (!this.rootFactory.has(person.id)) this.rootFactory.set(person.id, pipe.factory);
            const run = this.runFor(day, null, pipe, script);
            run.subjects++;
            for (const c of client.campaigns) if (c.entry.kind === "start" && c.line.includes(pipe.output)) this.enroll(person.id, c.id, day);
            this.land(this.makeOcc(run, pipe.output, person.id, client.brand.id, null, {}, []), day);
          }
          continue;
        }
        if (!client.connected.includes(pipe.id)) continue;
        // An attesting pipe of another factory: it reports the facts it sees, with its own recall.
        for (const [personId, factDay] of this.truePositive) {
          if (factDay + pt.delayMeanDays !== day) continue;
          const person = this.persons.get(personId);
          if (!person || person.brandId !== client.brand.id) continue;
          const attested = this.rng.next() < (truth.recall ?? 1);
          this.attestations.push({ producer: pipe.id, outcome: pipe.output, brandId: client.brand.id, subject: personId, attested });
          if (!attested) continue;
          const input = pipe.inputs.map((i) => this.latest.get(`${personId}${SEP}${i}`)).filter((x): x is string => !!x);
          const run = this.runFor(day, null, pipe, script);
          run.subjects++;
          for (const id of input) run.consumed.push(id);
          const traced = input.flatMap((id) => this.occById.get(id)?.trace ?? []);
          this.land(this.makeOcc(run, pipe.output, personId, client.brand.id, null, Object.fromEntries(pipe.inputs.map((i, k) => [i, input[k] ?? ""]).filter(([, v]) => v)), [...new Set(traced)].sort((x, y) => x - y)), day);
        }
      }
    }
  }

  private fireTriggers(day: number): void {
    const due = this.triggerChecks.filter((t) => t.day <= day);
    if (due.length === 0) return;
    const rest = this.triggerChecks.filter((t) => t.day > day);
    this.triggerChecks.length = 0;
    this.triggerChecks.push(...rest);
    for (const c of due) {
      const t = this.catalogue.trigger(c.triggerId);
      if (!t || t.retired || !t.event) continue;
      const reached = this.reached.get(c.subject);
      if (t.unless.some((u) => (reached?.get(u) ?? -1) >= c.fromDay)) continue;
      const listeners = this.campaigns().filter((x) => x.brandId === c.brandId && x.entry.kind === "trigger" && x.entry.triggerId === t.id && x.status === "running");
      if (listeners.length === 0) continue;
      const run: Run = { id: `run:${++this.runCounter}`, pipeId: null, target: t.event, day, spendCents: 0, consumed: [], factory: this.ourFactory(), subjects: 1 };
      this.pushRun(run);
      const occ = this.makeOcc(run, t.event, c.subject, c.brandId, null, {}, []);
      this.land(occ, day);
      this.triggerEvents.push({ day, triggerId: t.id, subject: c.subject, brandId: c.brandId, occurrenceId: occ.id, campaignIds: listeners.map((x) => x.id) });
      if (this.today) this.today.triggerEvents++;
      for (const camp of listeners) {
        const person = this.persons.get(c.subject);
        if (!person) continue;
        this.enroll(person.id, camp.id, day);
        const a = this.newAttempt(camp, this.clientOf(camp.id)!, 0, person, day, occ.id);
        const q = this.queues.get(camp.id) ?? [];
        q.push(a);
        this.queues.set(camp.id, q);
      }
    }
  }

  // ---- decisions and beliefs -----------------------------------------------------------

  /** One input choice for one subject: the universal prioritizer over the options at a point. */
  private decide(a: Attempt, point: string, options: string[], day: number, remDelay: number, horizon = 0): string {
    this.evidence.offer(point, options, remDelay, horizon);
    const offered = this.dayPicksAll.get(`${point}${SEP}${a.campaign.id}`) ?? new Set<string>();
    for (const o of options) offered.add(o);
    this.dayPicksAll.set(`${point}${SEP}${a.campaign.id}`, offered);
    let chosen = options[0]!;
    if (options.length > 1) {
      const value = this.legValue(a);
      const priced: PricedOption[] = options.map((o) => ({ id: o, ...this.belief(point, o, options, a.client.brand.id, day) }));
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

  private groupOf(brandId: string): string {
    const b = this.world.clients.find((c) => c.brand.id === brandId)?.brand;
    return String(b?.tactics[this.world.settings.clientGroupTactic] ?? "");
  }

  /** The belief about one option at one point for one client (see EvidenceBook.belief). */
  belief(point: string, option: string, options: readonly string[], brandId: string, day: number) {
    return this.evidence.belief(point, option, options, brandId, day);
  }

  /** The parent dynasty of a forked option (a script dynasty, or an object dynasty such as a finer ICP). */
  private parentOf(option: string): string | null {
    const s = this.catalogue.versionsOf(option)[0];
    if (s?.parentDynasty) return s.parentDynasty;
    const o = this.occurrences.find((x) => x.dynasty === option && x.parentDynasty);
    return o?.parentDynasty ?? null;
  }

  /** Value of one occurrence at the end of an attempt's leg (backward from the campaign's target). */
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

  /** Where a campaign's line starts: Start, or its trigger's event. */
  entryOf(campaign: Campaign): OutcomeId {
    return campaign.entry.kind === "start" ? START : this.catalogue.trigger(campaign.entry.triggerId)?.event ?? START;
  }

  /** The sales path a campaign runs (named on first sight). */
  salesPathOf(campaign: Campaign) {
    return this.catalogue.peekSalesPath(this.entryOf(campaign), campaign.line);
  }

  /** The pipe playing each leg of a campaign today: its pinned play, else the play picked most over the last 7 days. */
  playsToday(campaign: Campaign): (string | null)[] {
    return campaign.line.map((to, k) => {
      const from = k === 0 ? this.entryOf(campaign) : campaign.line[k - 1]!;
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
    const entry = this.entryOf(campaign);
    return name ? this.catalogue.nameSalesFunnel(entry, campaign.line, plays as string[]) : this.catalogue.peekSalesFunnel(entry, campaign.line, plays as string[]);
  }

  /**
   * Every pipe a leg runs through, in the order they run: the pipe providing
   * each input of the leg's play (the script picked most at that input over
   * the last 7 days, else the first allowed), down to the leg's start, then the
   * play itself. `main` marks the chain that carries the subject; the others
   * feed an input of a pipe on it (a research, a model call).
   * `campaign` null reads the picks of every campaign (a funnel not launched yet).
   */
  legPipes(play: string, from: OutcomeId, campaign: Campaign | null): LegPipe[] {
    const out: LegPipe[] = [];
    const seen = new Set<string>();
    const strategic = campaign ?? ({ strategies: {} } as Campaign);
    const visit = (pipeId: string, feeds: { pipe: string; input: OutcomeId } | null, main: boolean) => {
      if (seen.has(pipeId)) return;
      seen.add(pipeId);
      const pipe = this.catalogue.pipe(pipeId);
      if (!pipe) return;
      const subject = this.catalogue.subjectInput(pipe);
      const order = subject ? [subject, ...pipe.inputs.filter((i) => i !== subject)] : [...pipe.inputs];
      for (const i of order) {
        const o = this.catalogue.outcome(i);
        if (!o || o.subject === "event" || o.track) continue;
        const providers = this.catalogue.providersOf(i).filter((p) => !this.reports(p));
        const onDemand = providers.filter((p) => isOnDemand(p));
        let candidates: Pipe[];
        if (o.subject === "object") candidates = onDemand;
        else candidates = providers.filter((p) => isOnDemand(p) || this.catalogue.rootsOf(p).has(from) || this.rootedAnywhere(p, from));
        if (candidates.length === 0) continue;
        const scripts = this.allowedScripts(strategic, pipe, i, candidates);
        let best = scripts[0]?.dynasty ?? null;
        let bestN = 0;
        for (const [opt, arr] of this.pickSeries(pointKey(pipe.id, i), campaign?.id)) {
          const n = arr.slice(-7).reduce((x, y) => x + y, 0);
          if (n > bestN || (n === bestN && n > 0 && best !== null && opt < best)) {
            best = opt;
            bestN = n;
          }
        }
        const provider = best ? this.catalogue.headOf(best)?.pipeId : candidates[0]?.id;
        if (provider) visit(provider, { pipe: pipe.id, input: i }, main && i === subject);
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
      return play ? this.legPipes(play, k === 0 ? this.entryOf(campaign) : campaign.line[k - 1]!, campaign) : [];
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
      const from = k === 0 ? (campaign.entry.kind === "start" ? START : this.triggerEventOutcome(campaign.entry.triggerId)) : campaign.line[k - 1]!;
      const plays = this.playsFor(campaign, from, to);
      const mean = Math.max(...plays.map((p) => this.legDelayMean(p)), 0);
      return { from, to, ...legEstimateOf(this.legCohorts.get(`${campaign.id}${SEP}${k}`), day, mean) };
    });
  }

  /** Mean delay from a leg's start to its end through a pipe (the longest input chain). */
  legDelayMean(pipe: Pipe, seen = new Set<string>()): number {
    if (seen.has(pipe.id)) return 0;
    seen.add(pipe.id);
    const own = this.world.truth.pipes[pipe.id]?.delayMeanDays ?? pipe.maturity.delayMeanDays;
    const s = this.catalogue.subjectInput(pipe);
    const out = s ? this.catalogue.outcome(s) : undefined;
    if (!s || out?.track || out?.subject === "event") return own;
    return own + Math.max(0, ...this.catalogue.providersOf(s).filter((p) => !this.reports(p)).map((p) => this.legDelayMean(p, new Set(seen))));
  }

  /** Expected and measured return of a campaign, on the same formula: value / cost per target. */
  economics(campaignId: string): CampaignEconomics {
    const campaign = this.campaign(campaignId)!;
    const tv = this.targetValue(campaign);
    const legs = this.legEstimates(campaign);
    let spendCents = 0;
    let otherCents = 0;
    let valueOurs = 0;
    let valueOther = 0;
    for (const d of this.days) {
      spendCents += d.spendCents[campaignId] ?? 0;
      otherCents += d.otherCents[campaignId] ?? 0;
      valueOurs += d.valueOurs[campaignId] ?? 0;
      valueOther += d.valueOther[campaignId] ?? 0;
    }
    void otherCents;
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
    const horizon = Math.ceil(legs.reduce((s, l, k) => {
      const plays = this.playsFor(campaign, l.from, l.to);
      void k;
      return s + Math.max(0, ...plays.map((p) => this.legDelayMean(p))) * 3;
    }, 0));
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

  /** The options a campaign has at a point today (an object point offers the brand's own dynasties). */
  optionsFor(point: string, campaign: Campaign): string[] {
    const input = point.split("|")[1] ?? "";
    const out = this.catalogue.outcome(input);
    if (out?.subject === "object" && !this.catalogue.providersOf(input).some((p) => isOnDemand(p))) return this.objectDynasties(campaign.brandId, input);
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
    // The object outcome describing who to serve (content type "audience"): a finer one is a fork of it.
    const audience = this.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired)?.id;
    for (const campaign of this.campaigns()) {
      if (!audience || campaign.entry.kind !== "start" || campaign.status !== "running") continue;
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
      if (this.occurrences.some((o) => o.brandId === brandId && o.outcome === audience && JSON.stringify(o.conditions ?? []) === key)) continue;
      const finder = this.catalogue.script(this.world.settings.icpFinderScript);
      const pipe = finder ? this.catalogue.pipe(finder.pipeId) : undefined;
      if (!finder || !pipe) continue;
      const cost = Math.round(this.truthOf(finder, null).costCents);
      const run = this.runFor(day, campaign.id, pipe, finder);
      run.spendCents += cost;
      run.subjects += 1;
      run.consumed.push(parent.id);
      this.spent.set(campaign.id, (this.spent.get(campaign.id) ?? 0) + cost);
      if (this.today) this.today.spendCents[campaign.id] = (this.today.spendCents[campaign.id] ?? 0) + cost;
      const dynasty = `${parentDyn}-fork-${day}`;
      const text = `${parent.text ?? ""} ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue).toLowerCase()).join(", ")}.`.replace(/\.\s/, ", ").trim();
      const occ = this.makeOcc(run, audience, `${brandId}:${dynasty}:v1`, brandId, campaign.id, { [audience]: parent.id }, []);
      Object.assign(occ, { dynasty, version: 1, parentDynasty: parentDyn, name: `Finer (day ${day})`, text, conditions });
      this.addOcc(occ);
      this.proposals.push({ day, kind: "audience", brandId, campaignId: campaign.id, point: null, conditions, text, createdId: occ.id, study });
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
      const [consumer, input] = point.split("|") as [string, string];
      const consumerPipe = this.catalogue.pipe(consumer);
      if (!consumerPipe || !input) continue;
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
      const sid = `${consumer}#proposed-${input}-${study.proposal.conditions.map((c) => JSON.stringify(c)).join("")}`.replace(/[^a-zA-Z0-9#|:_-]/g, "");
      if (this.catalogue.strategy(sid)) continue;
      this.catalogue.add("strategies", {
        id: sid,
        name: `At ${this.catalogue.outcome(input)?.label ?? input}: ${study.proposal.conditions.map((c) => describeCondition(c, this.catalogue)).join(", ")}`,
        pipeId: consumer,
        rules: [{ input, conditions: study.proposal.conditions }],
        proposed: { day, reason: `split on ${records.length} decisions` },
      });
      this.proposals.push({ day, kind: "strategy", brandId: null, campaignId: null, point, conditions: study.proposal.conditions, text: "", createdId: sid, study });
    }
  }

  // ---- results -----------------------------------------------------------------------

  ledger(): LedgerReport {
    const c = this.ledgerCache;
    if (c && c.day === this.dayIndex && c.runs === this.runs.length && c.occ === this.occurrences.length) return c.report;
    const report = buildLedger(this.runs, this.occurrences);
    this.ledgerCache = { day: this.dayIndex, runs: this.runs.length, occ: this.occurrences.length, report };
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

  /** Number of attempts and of distinct people of a campaign. */
  attemptCount(campaignId?: string): number {
    return campaignId ? this.attempts.filter((a) => a.campaign.id === campaignId).length : this.attempts.length;
  }

  /** The leg cohorts as cells: per campaign leg and day of entry (what a snapshot of this world holds). */
  legCells(): { campaignId: string; legIndex: number; day: number; t: number; s: number; f: number; c: number }[] {
    const out: { campaignId: string; legIndex: number; day: number; t: number; s: number; f: number; c: number }[] = [];
    for (const [k, m] of this.legCohorts) {
      const [campaignId, leg] = k.split(SEP) as [string, string];
      for (const [day, c] of m) out.push({ campaignId, legIndex: Number(leg), day, ...c });
    }
    return out;
  }

  /** Every choice point offered so far: its options and the delay from a decision to its leg's end. */
  pointsOffered(): { point: string; options: string[]; delayMeanDays: number; horizonDays: number }[] {
    return [...this.evidence.pointOptions].map(([point, opts]) => {
      const d = this.evidence.pointDelay.get(point) ?? { mean: 0, horizon: 0 };
      return { point, options: [...opts], delayMeanDays: d.mean, horizonDays: d.horizon };
    });
  }

  /** The evidence of every choice as cells: per point, option, client and day of decision. */
  choiceCells(): { point: string; option: string; brandId: string; day: number; t: number; s: number; f: number; c: number }[] {
    const out: { point: string; option: string; brandId: string; day: number; t: number; s: number; f: number; c: number }[] = [];
    for (const [k, m] of this.evidence.cohorts) {
      const [point, option, brandId] = k.split(SEP) as [string, string, string];
      for (const [day, c] of m) out.push({ point, option, brandId, day, ...c });
    }
    return out;
  }

  /** People the world served, in order of first appearance. */
  people(): Person[] {
    return [...this.persons.values()];
  }
}

/** One pipe a leg runs through: what it makes, and the input of the pipe it feeds (null for the leg's play). */
export interface LegPipe {
  pipeId: string;
  output: OutcomeId;
  feeds: { pipe: string; input: OutcomeId } | null;
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
