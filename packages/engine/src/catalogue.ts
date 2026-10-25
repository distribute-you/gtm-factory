/**
 * The catalogue: every object of a GTM factory as data. Four objects carry a
 * status of their own: outcomes, pipes, triggers and scripts. Tactics and
 * strategies describe them. Nothing in the engine is keyed on a particular id:
 * add an outcome, a pipe or a script and it competes like the others.
 */

import type { Condition, TacticValue } from "./tactics";

/** The root every sales funnel can start from: the market. */
export const START = "start";

export type OutcomeId = string;

/**
 * What an occurrence of an outcome is about: a lead (a person), a company, an
 * object (an ICP, a template, an LLM completion), or a trigger event.
 */
export type SubjectKind = "lead" | "company" | "object" | "event";

/** A lead state on a lead track. Tracks are never added together. */
export interface TrackPlace {
  track: string;
  rank: number;
}

/**
 * What an occurrence of an object outcome holds, as data: a reader shows it
 * with one renderer per content type, whatever the outcome is.
 *  - text_with_variables: a text with {{variables}}, versioned in its dynasty;
 *  - text: plain text;
 *  - audience: a sentence describing who, with the conditions a judge reads from it;
 *  - list, record, image: other shapes.
 */
export type ContentType = "text_with_variables" | "text" | "audience" | "list" | "record" | "image";

export interface Outcome {
  id: OutcomeId;
  label: string;
  plural?: string;
  subject: SubjectKind;
  /** The lead state this outcome is, when it is one. */
  track?: TrackPlace;
  /** For an object outcome: what its occurrences hold. */
  contentType?: ContentType;
  /** The pipe whose output other producers of this outcome are measured against. */
  referencePipe?: string;
  description?: string;
  icon?: string;
  retired?: boolean;
}

export interface LeadTrack {
  id: string;
  name: string;
  description?: string;
  retired?: boolean;
}

/**
 * Who performs a pipe: our own factory, or another one (the client's team,
 * their CRM, the organic market) at a named access cost per run (0 allowed).
 */
export interface Factory {
  id: string;
  name: string;
  ours: boolean;
  description?: string;
}

export interface Maturity {
  /** Days after a decision before its cohort is read as mature. */
  durationDays: number;
  /** Outcomes the mature view needs before it is read on its own. */
  outcomesRequired: number;
  /** Expected mean delay between a run and its outcome, days. */
  delayMeanDays: number;
  /** Longest delay, days. */
  horizonDays: number;
}

/**
 * A pipe transforms input outcomes into one output outcome. It may need
 * several inputs (the message writer needs a verified email, the company
 * research, a template, a brand context and an LLM completion). Each input is
 * an outcome: produced ahead (an ICP, a template) or on demand (an LLM
 * completion). A pipe with no lead input creates its subjects: it turns the
 * market into leads.
 */
export interface Pipe {
  id: string;
  name: string;
  inputs: OutcomeId[];
  output: OutcomeId;
  factory: string;
  /**
   * A reactive pipe waits on one trigger. On the "On demand" trigger it runs
   * when a consuming script asks the engine for its output (an LLM completion,
   * a brand context): one run, one occurrence, at the consumer's input.
   */
  triggerId?: string | null;
  maturity: Maturity;
  /** A pipe of another factory that runs on its own schedule and reports what it produced (a CRM import, the organic market). */
  reports?: boolean;
  description?: string;
  icon?: string;
  retired?: boolean;
}

export type ScriptKind = "rules" | "ai" | "human";

/**
 * What performs a pipe. Several scripts compete on each pipe. A script is a
 * version of a dynasty; the dynasty is what competes, its active head is what
 * runs. A fork starts a new dynasty from a parent's.
 */
export interface Script {
  id: string;
  pipeId: string;
  dynasty: string;
  version: number;
  name: string;
  /** The dynasty this one was forked from (its prior starts from the parent's). */
  parentDynasty?: string | null;
  kind: ScriptKind;
  /** Tactic values describing the script (typed: yes/no, a value from a list, a number). */
  tactics: Record<string, TacticValue>;
  /** Expected cost of one run on one subject, cents (the prior; the measured cost decides). */
  costCents: number;
  status: "active" | "retired";
  /** Who makes it (a model vendor, a data provider), shown as its logo. */
  provider?: { name: string; color?: string; logoUrl?: string };
  description?: string;
}

/**
 * One generic trigger: when outcome X (or one of a list) is reached for a
 * subject, after delay D, unless outcome Y is reached meanwhile. Or reported
 * from outside. Each event is itself an occurrence of `event`.
 */
export interface Trigger {
  id: string;
  label: string;
  when: OutcomeId[];
  delayDays: number;
  unless: OutcomeId[];
  reported?: boolean;
  /** The outcome each event is an occurrence of (none for "On demand": the call is traced on the consuming run). */
  event?: OutcomeId;
  description?: string;
  retired?: boolean;
}

export type TacticType =
  | { kind: "yesno" }
  | { kind: "list"; values: string[] }
  | { kind: "number"; unit?: string };

/** A typed property. The same tactics describe scripts and leads, judged by an AI or read from data. */
export interface Tactic {
  id: string;
  name: string;
  type: TacticType;
  describes: Array<"script" | "lead" | "company" | "brand">;
  source: "data" | "judged";
  description?: string;
  retired?: boolean;
}

/**
 * A rule of a strategy. `input` names the input it attaches to: its
 * conditions filter the provider scripts at that input of this pipe only.
 * Without `input`, it filters the pipe's own scripts.
 */
export interface StrategyRule {
  input?: OutcomeId;
  conditions: Condition[];
}

/** A set of conditions on tactics, for one pipe. A play = pipe x strategy. */
export interface Strategy {
  id: string;
  name: string;
  pipeId: string;
  rules: StrategyRule[];
  /** Conditions on the subject (lead tactics, outcomes reached): who the play serves. */
  subject?: Condition[];
  /** Set when the split mechanism proposed it. */
  proposed?: { day: number; reason: string };
  retired?: boolean;
}

/**
 * A sales path: a straight line of lead states from Start (or a trigger's
 * event) to a target. Named on first sight, never renamed.
 */
export interface SalesPath {
  id: string;
  name: string;
  /** START, or the event outcome of the trigger that opens it. */
  entry: OutcomeId;
  /** The lead states after the entry; the last one is the target. */
  line: OutcomeId[];
}

/** A sales funnel: a sales path and one play (a pipe) per leg. Named on first sight, never renamed. */
export interface SalesFunnel {
  id: string;
  name: string;
  pathId: string;
  /** The pipe playing each leg of the path. */
  plays: string[];
}

export function salesPathId(entry: OutcomeId, line: readonly OutcomeId[]): string {
  return `path:${[entry, ...line].join(">")}`;
}

export function salesFunnelId(entry: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): string {
  return `funnel:${[entry, ...line].join(">")}|${plays.join("+")}`;
}

export interface CatalogueData {
  leadTracks: LeadTrack[];
  outcomes: Outcome[];
  factories: Factory[];
  pipes: Pipe[];
  scripts: Script[];
  triggers: Trigger[];
  tactics: Tactic[];
  strategies: Strategy[];
  /** Sales paths and sales funnels named so far (names are given on first sight and kept). */
  salesPaths?: SalesPath[];
  salesFunnels?: SalesFunnel[];
}

type Kind = Exclude<keyof CatalogueData, "salesPaths" | "salesFunnels">;

export interface CatalogueIssue {
  kind: string;
  id: string;
  message: string;
}

/** The id of the default strategy of a pipe (no condition). */
export function defaultStrategyId(pipeId: string): string {
  return `${pipeId}#default`;
}

/**
 * A mutable catalogue. Lists keep insertion order, so every read is
 * deterministic. Retiring keeps the object for history and takes it out of
 * every choice.
 */
export class Catalogue {
  private readonly data: CatalogueData;

  constructor(data?: Partial<CatalogueData>) {
    this.data = {
      leadTracks: [...(data?.leadTracks ?? [])],
      outcomes: [...(data?.outcomes ?? [])],
      factories: [...(data?.factories ?? [])],
      pipes: [...(data?.pipes ?? [])],
      scripts: [...(data?.scripts ?? [])],
      triggers: [...(data?.triggers ?? [])],
      tactics: [...(data?.tactics ?? [])],
      strategies: [...(data?.strategies ?? [])],
      salesPaths: [...(data?.salesPaths ?? [])],
      salesFunnels: [...(data?.salesFunnels ?? [])],
    };
    for (const p of this.data.pipes) this.ensureDefaultStrategy(p.id);
  }

  snapshot(): CatalogueData {
    return JSON.parse(JSON.stringify(this.data)) as CatalogueData;
  }

  clone(): Catalogue {
    return new Catalogue(this.snapshot());
  }

  get leadTracks(): readonly LeadTrack[] {
    return this.data.leadTracks;
  }
  get outcomes(): readonly Outcome[] {
    return this.data.outcomes;
  }
  get factories(): readonly Factory[] {
    return this.data.factories;
  }
  get pipes(): readonly Pipe[] {
    return this.data.pipes;
  }
  get scripts(): readonly Script[] {
    return this.data.scripts;
  }
  get triggers(): readonly Trigger[] {
    return this.data.triggers;
  }
  get tactics(): readonly Tactic[] {
    return this.data.tactics;
  }
  get strategies(): readonly Strategy[] {
    return this.data.strategies;
  }

  get salesPaths(): readonly SalesPath[] {
    return this.data.salesPaths ?? [];
  }
  get salesFunnels(): readonly SalesFunnel[] {
    return this.data.salesFunnels ?? [];
  }

  salesPath(id: string): SalesPath | undefined {
    return this.salesPaths.find((p) => p.id === id);
  }
  salesFunnel(id: string): SalesFunnel | undefined {
    return this.salesFunnels.find((f) => f.id === id);
  }
  /** The funnels of a sales path, in the order they were named. */
  funnelsOf(pathId: string): SalesFunnel[] {
    return this.salesFunnels.filter((f) => f.pathId === pathId);
  }

  /** The sales path of a line: its stored name, or the name it would get now (nothing is stored). */
  peekSalesPath(entry: OutcomeId, line: readonly OutcomeId[]): SalesPath {
    const id = salesPathId(entry, line);
    return this.salesPath(id) ?? { id, name: this.freshName(this.pathNames(entry, line), new Set(this.salesPaths.map((p) => p.name))), entry, line: [...line] };
  }

  /** The sales path of a line, named on first sight and kept. */
  nameSalesPath(entry: OutcomeId, line: readonly OutcomeId[]): SalesPath {
    const p = this.peekSalesPath(entry, line);
    if (!this.salesPath(p.id)) this.data.salesPaths!.push(p);
    return p;
  }

  /** The sales funnel of a line and its plays: its stored name, or the name it would get now (nothing is stored). */
  peekSalesFunnel(entry: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): SalesFunnel {
    const id = salesFunnelId(entry, line, plays);
    const found = this.salesFunnel(id);
    if (found) return found;
    const path = this.peekSalesPath(entry, line);
    return { id, name: this.freshName(this.funnelNames(path, plays), new Set(this.salesFunnels.map((f) => f.name))), pathId: path.id, plays: [...plays] };
  }

  /** The sales funnel of a line and its plays, named on first sight (its path too) and kept. */
  nameSalesFunnel(entry: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): SalesFunnel {
    this.nameSalesPath(entry, line);
    const f = this.peekSalesFunnel(entry, line, plays);
    if (!this.salesFunnel(f.id)) this.data.salesFunnels!.push(f);
    return f;
  }

  private plural(o: OutcomeId): string {
    const out = this.outcome(o);
    return out?.plural ?? `${out?.label ?? o}s`;
  }

  /** Plain words, most general first: "Paid clients from the market", then the states it passes through. */
  private pathNames(entry: OutcomeId, line: readonly OutcomeId[]): string[] {
    const target = line[line.length - 1] ?? entry;
    const from = entry === START ? "the market" : (this.triggers.find((t) => t.event === entry)?.label ?? this.outcome(entry)?.label ?? entry).toLowerCase();
    const base = `${this.plural(target)} from ${from}`;
    const via = line.slice(0, -1).map((o) => this.plural(o).toLowerCase());
    return via.length > 0 ? [base, `${base}, through ${via.length > 1 ? `${via.slice(0, -1).join(", ")} and ${via[via.length - 1]}` : via[0]}`] : [base];
  }

  /** Plain words: the plays it runs, then what it brings; then where it starts. */
  private funnelNames(path: SalesPath, plays: readonly string[]): string[] {
    const names = plays.map((id) => this.pipe(id)?.name ?? id);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? path.name;
    const target = this.plural(path.line[path.line.length - 1] ?? path.entry).toLowerCase();
    const from = path.entry === START ? "the market" : (this.triggers.find((t) => t.event === path.entry)?.label ?? path.entry).toLowerCase();
    return [`${list} for ${target}`, `${list} for ${target}, from ${from}`];
  }

  /** The first candidate no other object holds, else the last one numbered (2, 3...). */
  private freshName(candidates: readonly string[], taken: ReadonlySet<string>): string {
    for (const c of candidates) if (!taken.has(c)) return c;
    const last = candidates[candidates.length - 1]!;
    for (let n = 2; ; n++) if (!taken.has(`${last} ${n}`)) return `${last} ${n}`;
  }

  outcome(id: OutcomeId): Outcome | undefined {
    return this.data.outcomes.find((o) => o.id === id);
  }
  pipe(id: string): Pipe | undefined {
    return this.data.pipes.find((p) => p.id === id);
  }
  script(id: string): Script | undefined {
    return this.data.scripts.find((s) => s.id === id);
  }
  trigger(id: string): Trigger | undefined {
    return this.data.triggers.find((t) => t.id === id);
  }
  tactic(id: string): Tactic | undefined {
    return this.data.tactics.find((t) => t.id === id);
  }
  strategy(id: string): Strategy | undefined {
    return this.data.strategies.find((s) => s.id === id);
  }
  factory(id: string): Factory | undefined {
    return this.data.factories.find((f) => f.id === id);
  }

  isOurs(pipe: Pipe): boolean {
    return this.factory(pipe.factory)?.ours ?? false;
  }

  isPipeLive(p: Pipe): boolean {
    if (p.retired) return false;
    if (this.outcome(p.output)?.retired) return false;
    return p.inputs.every((i) => !this.outcome(i)?.retired);
  }

  /** Live pipes producing an outcome. */
  providersOf(outcome: OutcomeId): Pipe[] {
    return this.data.pipes.filter((p) => p.output === outcome && this.isPipeLive(p));
  }

  /** The input of a pipe that carries its subject (a lead, a company or a trigger event), if any. */
  subjectInput(pipe: Pipe): OutcomeId | null {
    for (const i of pipe.inputs) {
      const k = this.outcome(i)?.subject;
      if (k === "lead" || k === "event") return i;
    }
    return null;
  }

  /** A pipe with no lead or event input creates its subjects. */
  createsSubjects(pipe: Pipe): boolean {
    return this.subjectInput(pipe) === null && this.outcome(pipe.output)?.subject === "lead";
  }

  /**
   * Where a pipe's subject comes from: Start for a pipe creating subjects, a
   * lead state, or a trigger event, found by walking subject inputs back
   * through outcomes that are neither.
   */
  rootsOf(pipe: Pipe, seen: Set<string> = new Set()): Set<OutcomeId> {
    const roots = new Set<OutcomeId>();
    if (seen.has(pipe.id)) return roots;
    seen.add(pipe.id);
    if (this.createsSubjects(pipe)) {
      roots.add(START);
      return roots;
    }
    const s = this.subjectInput(pipe);
    if (!s) return roots;
    const o = this.outcome(s);
    if (o?.track || o?.subject === "event") {
      roots.add(s);
      return roots;
    }
    for (const q of this.providersOf(s)) for (const r of this.rootsOf(q, new Set(seen))) roots.add(r);
    return roots;
  }

  /** Active head version of each dynasty of a pipe, in catalogue order. */
  dynastiesOf(pipeId: string): Script[] {
    const heads = new Map<string, Script>();
    for (const s of this.data.scripts) {
      if (s.pipeId !== pipeId || s.status !== "active") continue;
      const cur = heads.get(s.dynasty);
      if (!cur || s.version > cur.version) heads.set(s.dynasty, s);
    }
    return [...heads.values()];
  }

  /** Every version of a dynasty, oldest first. */
  versionsOf(dynasty: string): Script[] {
    return this.data.scripts.filter((s) => s.dynasty === dynasty).sort((a, b) => a.version - b.version);
  }

  /** The script running for a dynasty today (its active head), if any. */
  headOf(dynasty: string): Script | undefined {
    return this.versionsOf(dynasty).filter((s) => s.status === "active").pop();
  }

  strategiesOf(pipeId: string): Strategy[] {
    return this.data.strategies.filter((s) => s.pipeId === pipeId && !s.retired);
  }

  // ---- writes ---------------------------------------------------------------

  add<K extends Kind>(kind: K, item: CatalogueData[K][number]): this {
    const list = this.data[kind] as Array<CatalogueData[K][number]>;
    const id = (item as { id: string }).id;
    if (list.some((x) => (x as { id: string }).id === id)) throw new Error(`${kind} "${id}" already exists`);
    list.push(item);
    if (kind === "pipes") this.ensureDefaultStrategy(id);
    return this;
  }

  /** Retire an object: kept for history, out of every choice. */
  retire(kind: Kind, id: string): this {
    const item = (this.data[kind] as unknown as Array<Record<string, unknown>>).find((x) => x.id === id);
    if (!item) throw new Error(`${kind} "${id}" not found`);
    if (kind === "scripts") item.status = "retired";
    else item.retired = true;
    return this;
  }

  /** Bring a retired object back. */
  restore(kind: Kind, id: string): this {
    const item = (this.data[kind] as unknown as Array<Record<string, unknown>>).find((x) => x.id === id);
    if (!item) throw new Error(`${kind} "${id}" not found`);
    if (kind === "scripts") item.status = "active";
    else delete item.retired;
    return this;
  }

  /** Add a new version of a dynasty: it runs from now on, the dynasty keeps its history. */
  upgrade(dynasty: string, changes: Partial<Omit<Script, "dynasty" | "version" | "pipeId">> & { id: string }): Script {
    const head = this.headOf(dynasty) ?? this.versionsOf(dynasty).pop();
    if (!head) throw new Error(`dynasty "${dynasty}" not found`);
    const next: Script = { ...head, ...changes, dynasty, pipeId: head.pipeId, version: head.version + 1, status: "active" };
    this.add("scripts", next);
    return next;
  }

  /** Fork a dynasty: a new dynasty whose prior starts from the parent's. */
  fork(parentDynasty: string, script: Omit<Script, "parentDynasty" | "version" | "pipeId" | "status"> & { status?: Script["status"] }): Script {
    const parent = this.headOf(parentDynasty) ?? this.versionsOf(parentDynasty).pop();
    if (!parent) throw new Error(`dynasty "${parentDynasty}" not found`);
    const s: Script = { status: "active", ...script, pipeId: parent.pipeId, version: 1, parentDynasty };
    this.add("scripts", s);
    return s;
  }

  private ensureDefaultStrategy(pipeId: string): void {
    const id = defaultStrategyId(pipeId);
    if (!this.data.strategies.some((s) => s.id === id)) this.data.strategies.push({ id, name: "Default", pipeId, rules: [] });
  }

  // ---- validation -------------------------------------------------------------

  validate(): CatalogueIssue[] {
    const issues: CatalogueIssue[] = [];
    const outcomeIds = new Set(this.data.outcomes.map((o) => o.id));
    for (const kind of Object.keys(this.data) as Kind[]) {
      const seen = new Set<string>();
      for (const it of this.data[kind] as Array<{ id: string }>) {
        if (seen.has(it.id)) issues.push({ kind, id: it.id, message: "duplicate id" });
        seen.add(it.id);
      }
    }
    if (outcomeIds.has(START)) issues.push({ kind: "outcomes", id: START, message: `"${START}" is reserved` });
    for (const o of this.data.outcomes) {
      if (o.track && !this.data.leadTracks.some((t) => t.id === o.track!.track)) issues.push({ kind: "outcomes", id: o.id, message: `unknown lead track "${o.track.track}"` });
      if (o.referencePipe && !this.pipe(o.referencePipe)) issues.push({ kind: "outcomes", id: o.id, message: `unknown reference pipe "${o.referencePipe}"` });
    }
    for (const p of this.data.pipes) {
      for (const i of p.inputs) if (!outcomeIds.has(i)) issues.push({ kind: "pipes", id: p.id, message: `unknown input "${i}"` });
      if (!outcomeIds.has(p.output)) issues.push({ kind: "pipes", id: p.id, message: `unknown output "${p.output}"` });
      if (p.inputs.includes(p.output)) issues.push({ kind: "pipes", id: p.id, message: "a pipe cannot consume its own output" });
      if (!this.factory(p.factory)) issues.push({ kind: "pipes", id: p.id, message: `unknown factory "${p.factory}"` });
      if (p.triggerId && !this.trigger(p.triggerId)) issues.push({ kind: "pipes", id: p.id, message: `unknown trigger "${p.triggerId}"` });
    }
    for (const s of this.data.scripts) {
      if (!this.pipe(s.pipeId)) issues.push({ kind: "scripts", id: s.id, message: `unknown pipe "${s.pipeId}"` });
      for (const t of Object.keys(s.tactics)) if (!this.tactic(t)) issues.push({ kind: "scripts", id: s.id, message: `unknown tactic "${t}"` });
    }
    for (const t of this.data.triggers) {
      for (const o of [...t.when, ...t.unless, ...(t.event ? [t.event] : [])]) if (!outcomeIds.has(o)) issues.push({ kind: "triggers", id: t.id, message: `unknown outcome "${o}"` });
    }
    for (const s of this.data.strategies) {
      if (!this.pipe(s.pipeId)) issues.push({ kind: "strategies", id: s.id, message: `unknown pipe "${s.pipeId}"` });
      for (const r of s.rules) {
        if (r.input && !this.pipe(s.pipeId)?.inputs.includes(r.input)) issues.push({ kind: "strategies", id: s.id, message: `"${r.input}" is not an input of ${s.pipeId}` });
        for (const c of r.conditions) if (c.op !== "notReached" && !this.tactic(c.tactic)) issues.push({ kind: "strategies", id: s.id, message: `unknown tactic "${c.tactic}"` });
      }
    }
    return issues;
  }
}

/** The trigger of pipes called on demand by a consuming script. */
export const ON_DEMAND = "on_demand";

/** Is this pipe called on demand (its output is produced at the consumer's input, never ahead)? */
export function isOnDemand(pipe: Pipe): boolean {
  return pipe.triggerId === ON_DEMAND;
}
