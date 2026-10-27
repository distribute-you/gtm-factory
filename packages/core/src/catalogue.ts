/**
 * The catalogue: every object of a GTM factory as data. Outcomes are the parts;
 * each outcome has ONE Engine, which makes it, and ONE Provider, which serves
 * it. Scripts perform an Engine: several compete on each, in dynasties of
 * versions, and each is code that calls the Providers it needs. Tactics and
 * strategies describe scripts. Nothing in the code is keyed on a particular id:
 * add an outcome or a script and it competes like the others.
 */

import type { Condition, TacticValue } from "./tactics";

/** The root every Plan can start from: the market. */
export const START = "start";

export type OutcomeId = string;

/**
 * What a Unit of an outcome is about, its subject: a lead (a person), a
 * company, the brand (an ICP, a template, a brand context), or the run that
 * ordered it (an LLM completion answers one run's question: no other run is
 * ever served it).
 */
export type SubjectKind = "lead" | "company" | "brand" | "run";

/** A milestone on a Track. Tracks are never added together. */
export interface TrackPlace {
  track: string;
  rank: number;
}

/**
 * What a Unit of a brand or run outcome holds, as data: a reader shows it
 * with one renderer per content type, whatever the outcome is.
 */
export type ContentType = "text_with_variables" | "text" | "audience" | "rating" | "list" | "record" | "image";

export interface Outcome {
  id: OutcomeId;
  label: string;
  plural?: string;
  subject: SubjectKind;
  /** The milestone this outcome is on a Track, when it is one. */
  track?: TrackPlace;
  /** For a brand or run outcome: what its Units hold. */
  contentType?: ContentType;
  /** The script whose output other producers of this outcome are measured against (its dynasty). */
  reference?: string;
  description?: string;
  icon?: string;
  retired?: boolean;
}

/** An ordered ladder of milestones (a CRM lifecycle, website visits). */
export interface Track {
  id: string;
  name: string;
  description?: string;
  retired?: boolean;
}

export type ScriptKind = "rules" | "ai" | "human";

/**
 * What a script can do in one day, and what one Unit takes. Measured for code
 * and AI scripts (runs, vendor quotas); typed by a person for the scripts a
 * person performs. A script out of capacity for today leaves today's choices.
 */
export interface Capacity {
  /** Most Units it makes per day (unset: no limit). */
  perDay?: number;
  /** Days one Unit takes, mean. */
  daysPerUnit?: number;
}

/**
 * What performs an Engine. A script makes ONE outcome and is code: its `code`
 * names the function the factory runs, which calls the Providers it needs. A
 * script is a version of a dynasty; the dynasty competes, its active head runs.
 * A fork starts a new dynasty from a parent's.
 */
export interface Script {
  id: string;
  /** The outcome its Engine makes. */
  outcome: OutcomeId;
  dynasty: string;
  version: number;
  name: string;
  /** The dynasty this one was forked from (its prior starts from the parent's). */
  parentDynasty?: string | null;
  kind: ScriptKind;
  /** The code the factory runs: a key of the script library. */
  code: string;
  /**
   * The outcomes its code calls: read from the code by a judge for each new
   * version, then what the ledger measured its runs consume. Never typed by hand.
   */
  materials: OutcomeId[];
  /** Tactic values describing the script (typed: yes/no, a value from a list, a number). "Performed by" is one. */
  tactics: Record<string, TacticValue>;
  /** Expected cost of one run, cents (the prior; the measured cost decides). */
  costCents: number;
  capacity?: Capacity;
  /**
   * Another party runs it on its own and reports what it saw (a webhook: the
   * mailbox reporting a message sent, the CRM, the organic market). It is
   * never ordered: its Units land when it is called.
   */
  webhook?: boolean;
  status: "active" | "retired";
  /** Who makes it (a model vendor, a data provider), shown as its logo. */
  provider?: { name: string; color?: string; logoUrl?: string };
  description?: string;
}

export type TacticType = { kind: "yesno" } | { kind: "list"; values: string[] } | { kind: "number"; unit?: string };

/** A typed property. The same tactics describe scripts and leads, judged by an AI or read from data. */
export interface Tactic {
  id: string;
  name: string;
  type: TacticType;
  describes: Array<"script" | "lead" | "company" | "brand" | "unit">;
  source: "data" | "judged";
  description?: string;
  retired?: boolean;
}

/** A strategy of one Engine: the scripts it keeps (conditions on their tactics), and who it serves. */
export interface Strategy {
  id: string;
  name: string;
  outcome: OutcomeId;
  conditions: Condition[];
  /** Conditions on the subject (lead tactics, milestones reached): who it serves. */
  subject?: Condition[];
  /** Set when the split mechanism proposed it. */
  proposed?: { day: number; reason: string };
  retired?: boolean;
}

/**
 * A Routing: the ordered milestones a Plan passes through, from its start
 * (Start, or an outcome) to its Target. A view, named on first sight and kept.
 */
export interface Routing {
  id: string;
  name: string;
  start: OutcomeId;
  /** The milestones after the start; the last one is the Target. */
  line: OutcomeId[];
}

export function routingId(start: OutcomeId, line: readonly OutcomeId[]): string {
  return `routing:${[start, ...line].join(">")}`;
}

export interface CatalogueData {
  tracks: Track[];
  outcomes: Outcome[];
  scripts: Script[];
  tactics: Tactic[];
  strategies: Strategy[];
  /** Routings named so far (views: a name is given on first sight and kept). */
  routings?: Routing[];
}

type Kind = Exclude<keyof CatalogueData, "routings">;

export interface CatalogueIssue {
  kind: string;
  id: string;
  message: string;
}

/** The id of the default strategy of an Engine (keeps every script). */
export function defaultStrategyId(outcome: OutcomeId): string {
  return `${outcome}#default`;
}

/** The tactic every script carries: who performs it (ours, the client's team, the mailbox...). */
export const PERFORMED_BY = "performed_by";
/** The value of "Performed by" that is this factory: its runs spend the budget and count in its return. */
export const OURS = "Ours";

/** Is a script performed by this factory? */
export function isOurs(script: Pick<Script, "tactics">): boolean {
  return (script.tactics[PERFORMED_BY] ?? OURS) === OURS;
}

/**
 * A mutable catalogue. Lists keep insertion order, so every read is
 * deterministic. Retiring keeps the object for history and takes it out of
 * every choice.
 */
export class Catalogue {
  private readonly data: CatalogueData;
  private readonly memo = new Map<string, unknown>();

  constructor(data?: Partial<CatalogueData>) {
    this.data = {
      tracks: [...(data?.tracks ?? [])],
      outcomes: [...(data?.outcomes ?? [])],
      scripts: [...(data?.scripts ?? [])],
      tactics: [...(data?.tactics ?? [])],
      strategies: [...(data?.strategies ?? [])],
      routings: [...(data?.routings ?? [])],
    };
    for (const o of this.engines()) this.ensureDefaultStrategy(o);
  }

  snapshot(): CatalogueData {
    return JSON.parse(JSON.stringify(this.data)) as CatalogueData;
  }

  clone(): Catalogue {
    return new Catalogue(this.snapshot());
  }

  get tracks(): readonly Track[] {
    return this.data.tracks;
  }
  get outcomes(): readonly Outcome[] {
    return this.data.outcomes;
  }
  get scripts(): readonly Script[] {
    return this.data.scripts;
  }
  get tactics(): readonly Tactic[] {
    return this.data.tactics;
  }
  get strategies(): readonly Strategy[] {
    return this.data.strategies;
  }
  get routings(): readonly Routing[] {
    return this.data.routings ?? [];
  }

  outcome(id: OutcomeId): Outcome | undefined {
    return this.data.outcomes.find((o) => o.id === id);
  }
  script(id: string): Script | undefined {
    return this.data.scripts.find((s) => s.id === id);
  }
  tactic(id: string): Tactic | undefined {
    return this.data.tactics.find((t) => t.id === id);
  }
  strategy(id: string): Strategy | undefined {
    return this.data.strategies.find((s) => s.id === id);
  }
  routing(id: string): Routing | undefined {
    return this.routings.find((r) => r.id === id);
  }

  /** Outcomes that have an Engine: at least one script makes them. */
  engines(): OutcomeId[] {
    const out: OutcomeId[] = [];
    for (const s of this.data.scripts) if (!out.includes(s.outcome)) out.push(s.outcome);
    return out;
  }

  /** Is an outcome a milestone (on a Track)? */
  isMilestone(o: OutcomeId): boolean {
    return !!this.outcome(o)?.track;
  }

  /** Active head version of each dynasty of an Engine, in catalogue order (only scripts whose outcome and Materials are live). */
  scriptsOf(outcome: OutcomeId): Script[] {
    const k = `heads|${outcome}`;
    const hit = this.memo.get(k) as Script[] | undefined;
    if (hit) return hit;
    const heads = new Map<string, Script>();
    for (const s of this.data.scripts) {
      if (s.outcome !== outcome || s.status !== "active") continue;
      const cur = heads.get(s.dynasty);
      if (!cur || s.version > cur.version) heads.set(s.dynasty, s);
    }
    const live = [...heads.values()].filter((s) => !this.outcome(s.outcome)?.retired && s.materials.every((m) => !this.outcome(m)?.retired));
    this.memo.set(k, live);
    return live;
  }

  /** The Material of a script that carries its subject (a lead), if any: the Unit it works on. */
  subjectOf(script: Pick<Script, "materials">): OutcomeId | null {
    for (const m of script.materials) if (this.outcome(m)?.subject === "lead") return m;
    return null;
  }

  /** A script with no lead Material making a lead outcome creates its subjects: it draws them from the market. */
  createsSubjects(script: Pick<Script, "materials" | "outcome">): boolean {
    return this.subjectOf(script) === null && this.outcome(script.outcome)?.subject === "lead";
  }

  /** Every version of a dynasty, oldest first. */
  versionsOf(dynasty: string): Script[] {
    return this.data.scripts.filter((s) => s.dynasty === dynasty).sort((a, b) => a.version - b.version);
  }

  /** The script running for a dynasty today (its active head), if any. */
  headOf(dynasty: string): Script | undefined {
    return this.versionsOf(dynasty).filter((s) => s.status === "active").pop();
  }

  strategiesOf(outcome: OutcomeId): Strategy[] {
    return this.data.strategies.filter((s) => s.outcome === outcome && !s.retired);
  }

  // ---- Routings: views, named on first sight ---------------------------------------

  private plural(o: OutcomeId): string {
    const out = this.outcome(o);
    return out?.plural ?? `${out?.label ?? o}s`;
  }

  /** Short plain words: "Paid clients from the market"; the milestones it passes through only to tell two apart, a number last. */
  private routingNames(start: OutcomeId, line: readonly OutcomeId[]): string[] {
    const target = line[line.length - 1] ?? start;
    const from = start === START ? "the market" : this.plural(start).toLowerCase();
    const base = `${this.plural(target)} from ${from}`;
    const via = line.slice(0, -1).map((o) => this.plural(o).toLowerCase());
    const all = via.length > 1 ? `${via.slice(0, -1).join(", ")} and ${via[via.length - 1]}` : via[0];
    return via.length > 0 ? [...new Set([base, `${base}, via ${via[0]}`, `${base}, via ${all}`])] : [base];
  }

  /** The Routing of a line: its stored name, or the name it would get now (nothing is stored). */
  peekRouting(start: OutcomeId, line: readonly OutcomeId[]): Routing {
    const id = routingId(start, line);
    const found = this.routing(id);
    if (found) return found;
    const taken = new Set(this.routings.map((r) => r.name));
    const names = this.routingNames(start, line);
    let name = names.find((n) => !taken.has(n));
    for (let n = 2; !name; n++) if (!taken.has(`${names[0]} ${n}`)) name = `${names[0]} ${n}`;
    return { id, name, start, line: [...line] };
  }

  /** The Routing of a line, named on first sight and kept. */
  nameRouting(start: OutcomeId, line: readonly OutcomeId[]): Routing {
    const r = this.peekRouting(start, line);
    if (!this.routing(r.id)) this.data.routings!.push(r);
    return r;
  }

  // ---- writes ---------------------------------------------------------------

  add<K extends Kind>(kind: K, item: CatalogueData[K][number]): this {
    this.memo.clear();
    const list = this.data[kind] as Array<CatalogueData[K][number]>;
    const id = (item as { id: string }).id;
    if (list.some((x) => (x as { id: string }).id === id)) throw new Error(`${kind} "${id}" already exists`);
    list.push(item);
    if (kind === "scripts") this.ensureDefaultStrategy((item as Script).outcome);
    return this;
  }

  /** Retire an object: kept for history, out of every choice. */
  retire(kind: Kind, id: string): this {
    this.memo.clear();
    const item = (this.data[kind] as unknown as Array<Record<string, unknown>>).find((x) => x.id === id);
    if (!item) throw new Error(`${kind} "${id}" not found`);
    if (kind === "scripts") item.status = "retired";
    else item.retired = true;
    return this;
  }

  /** Bring a retired object back. */
  restore(kind: Kind, id: string): this {
    this.memo.clear();
    const item = (this.data[kind] as unknown as Array<Record<string, unknown>>).find((x) => x.id === id);
    if (!item) throw new Error(`${kind} "${id}" not found`);
    if (kind === "scripts") item.status = "active";
    else delete item.retired;
    return this;
  }

  /** Set what a script can do (typed by a person for a script a person performs). */
  setCapacity(scriptId: string, capacity: Capacity): this {
    this.memo.clear();
    const s = this.data.scripts.find((x) => x.id === scriptId);
    if (!s) throw new Error(`script "${scriptId}" not found`);
    s.capacity = { ...capacity };
    return this;
  }

  /** Record the Materials a script's runs consume (measured by the ledger, or read from its code by a judge). */
  setMaterials(scriptId: string, materials: OutcomeId[]): this {
    this.memo.clear();
    const s = this.data.scripts.find((x) => x.id === scriptId);
    if (!s) throw new Error(`script "${scriptId}" not found`);
    s.materials = [...materials];
    return this;
  }

  /** Add a new version of a dynasty: it runs from now on, the dynasty keeps its history. Its code, else the head's. */
  upgrade(dynasty: string, changes: Partial<Omit<Script, "dynasty" | "version" | "outcome">> & { id: string }): Script {
    const head = this.headOf(dynasty) ?? this.versionsOf(dynasty).pop();
    if (!head) throw new Error(`dynasty "${dynasty}" not found`);
    const next: Script = { ...head, ...changes, dynasty, outcome: head.outcome, version: head.version + 1, status: "active" };
    this.add("scripts", next);
    return next;
  }

  /** Fork a dynasty: a new dynasty whose prior starts from the parent's (its own code, else the parent's). */
  fork(parentDynasty: string, script: Omit<Script, "parentDynasty" | "version" | "outcome" | "status" | "code" | "materials"> & { status?: Script["status"]; code?: string; materials?: OutcomeId[] }): Script {
    const parent = this.headOf(parentDynasty) ?? this.versionsOf(parentDynasty).pop();
    if (!parent) throw new Error(`dynasty "${parentDynasty}" not found`);
    const s: Script = { status: "active", code: parent.code, materials: parent.materials, ...script, outcome: parent.outcome, version: 1, parentDynasty };
    this.add("scripts", s);
    return s;
  }

  private ensureDefaultStrategy(outcome: OutcomeId): void {
    const id = defaultStrategyId(outcome);
    if (!this.data.strategies.some((s) => s.id === id)) this.data.strategies.push({ id, name: "Every script", outcome, conditions: [] });
  }

  // ---- validation -------------------------------------------------------------

  validate(): CatalogueIssue[] {
    const issues: CatalogueIssue[] = [];
    const outcomeIds = new Set(this.data.outcomes.map((o) => o.id));
    for (const kind of Object.keys(this.data) as Kind[]) {
      const seen = new Set<string>();
      for (const it of (this.data[kind] ?? []) as Array<{ id: string }>) {
        if (seen.has(it.id)) issues.push({ kind, id: it.id, message: "duplicate id" });
        seen.add(it.id);
      }
    }
    if (outcomeIds.has(START)) issues.push({ kind: "outcomes", id: START, message: `"${START}" is reserved` });
    for (const o of this.data.outcomes) if (o.track && !this.data.tracks.some((t) => t.id === o.track!.track)) issues.push({ kind: "outcomes", id: o.id, message: `unknown track "${o.track.track}"` });
    for (const s of this.data.scripts) {
      if (!outcomeIds.has(s.outcome)) issues.push({ kind: "scripts", id: s.id, message: `unknown outcome "${s.outcome}"` });
      for (const m of s.materials) if (!outcomeIds.has(m)) issues.push({ kind: "scripts", id: s.id, message: `unknown Material "${m}"` });
      if (s.materials.includes(s.outcome)) issues.push({ kind: "scripts", id: s.id, message: "a script cannot consume the outcome it makes" });
      for (const t of Object.keys(s.tactics)) if (!this.tactic(t)) issues.push({ kind: "scripts", id: s.id, message: `unknown tactic "${t}"` });
    }
    for (const s of this.data.strategies) {
      if (!outcomeIds.has(s.outcome)) issues.push({ kind: "strategies", id: s.id, message: `unknown outcome "${s.outcome}"` });
      for (const c of s.conditions) if (c.op !== "notReached" && !this.tactic(c.tactic)) issues.push({ kind: "strategies", id: s.id, message: `unknown tactic "${c.tactic}"` });
    }
    return issues;
  }
}
