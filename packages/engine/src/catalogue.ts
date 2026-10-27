/**
 * The catalogue: every object of a GTM factory as data. Three objects carry a
 * status of their own: outcomes, legs and scripts. Tactics and strategies
 * describe them. Nothing in the code is keyed on a particular id: add an
 * outcome, a leg or a script and it competes like the others.
 */

import type { Condition, TacticValue } from "./tactics";

/** The root every sales funnel can start from: the market. */
export const START = "start";

export type OutcomeId = string;

/**
 * What a Unit of an outcome is about, its subject: a lead (a person), a
 * company, the brand (an ICP, a template, a brand context), or the run that
 * ordered it (an LLM completion answers one run's question: no other run is
 * ever served it).
 */
export type SubjectKind = "lead" | "company" | "brand" | "run";

/** A lead state on a lead track. Tracks are never added together. */
export interface TrackPlace {
  track: string;
  rank: number;
}

/**
 * What a Unit of a brand or run outcome holds, as data: a reader shows it
 * with one renderer per content type, whatever the outcome is.
 *  - text_with_variables: a text with {{variables}}, versioned in its dynasty;
 *  - text: plain text;
 *  - audience: a sentence describing who, with the conditions a judge reads from it;
 *  - rating: per candidate at each choice point, beliefs about value per dollar (a Supplier rating);
 *  - list, record, image: other shapes.
 */
export type ContentType = "text_with_variables" | "text" | "audience" | "rating" | "list" | "record" | "image";

export interface Outcome {
  id: OutcomeId;
  label: string;
  plural?: string;
  subject: SubjectKind;
  /** The lead state this outcome is, when it is one. */
  track?: TrackPlace;
  /** For a brand or run outcome: what its Units hold. */
  contentType?: ContentType;
  /** The leg whose output other producers of this outcome are measured against. */
  referenceLeg?: string;
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
 * Who performs a leg: our own factory, or another one (the client's team,
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
 * A Leg goes from one outcome to another: it makes one output outcome, and
 * competing scripts in dynasties perform it. A Leg holds no Bill of materials:
 * each script declares its own (a writer with or without a company research).
 * Its generic code orchestrates them: `pull(specification, quantity, budget)`
 * and `push(unit, budget)`, the same for every leg.
 */
export interface Leg {
  id: string;
  name: string;
  output: OutcomeId;
  factory: string;
  maturity: Maturity;
  /**
   * A webhook: the leg's scripts declare no internal Material, its producer is
   * another factory (the prospect, the client's CRM), and its script runs when
   * the webhook is called instead of at the tick.
   */
  webhook?: boolean;
  description?: string;
  icon?: string;
  retired?: boolean;
}

/**
 * One line of a script's Bill of materials: the outcome it consumes per Unit
 * produced, and the conditions of the Specification the script builds from its
 * own subject ("Brand context younger than 90 days"). The subject follows from
 * the outcome: my lead, the company of my lead, my brand, or this run.
 */
export interface Material {
  outcome: OutcomeId;
  conditions?: Condition[];
}

export type ScriptKind = "rules" | "ai" | "human";

/**
 * What performs a leg. Several scripts compete on each leg. A script is a
 * version of a dynasty; the dynasty is what competes, its active head is what
 * runs. A fork starts a new dynasty from a parent's. A script never calls
 * anything itself: it declares its Bill of materials as data, receives the
 * Materials, its leg storage and the metered vendor client, and returns one
 * Unit or none.
 */
export interface Script {
  id: string;
  legId: string;
  dynasty: string;
  version: number;
  name: string;
  /** The dynasty this one was forked from (its prior starts from the parent's). */
  parentDynasty?: string | null;
  kind: ScriptKind;
  /** The Bill of materials: one Material per line, each an outcome consumed per Unit produced. */
  materials: Material[];
  /** Tactic values describing the script (typed: yes/no, a value from a list, a number). */
  tactics: Record<string, TacticValue>;
  /** Expected cost of one run on one subject, cents (the prior; the measured cost decides). */
  costCents: number;
  status: "active" | "retired";
  /** Who makes it (a model vendor, a data provider), shown as its logo. */
  provider?: { name: string; color?: string; logoUrl?: string };
  description?: string;
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
  describes: Array<"script" | "lead" | "company" | "brand" | "unit">;
  source: "data" | "judged";
  description?: string;
  retired?: boolean;
}

/**
 * A rule of a strategy. `material` names the Material it attaches to: its
 * conditions enter the Specification of that Material on this leg only, so
 * they filter both the Units served from the stock and the producer scripts
 * ordered from. Without `material`, it filters the leg's own scripts.
 */
export interface StrategyRule {
  material?: OutcomeId;
  conditions: Condition[];
}

/**
 * New generic object. A Specification is what a consumer asks for when it
 * pulls an outcome (its cahier des charges): the subject (the lead, the
 * company of a lead, the brand), conditions on tactics (a Unit's age, its
 * producer's channel: the script's own Bill of materials and the Campaign's
 * strategy enter here) and a quantity. It names the outcome, never a
 * producer: whichever leg is picked receives it. A push carries no
 * Specification: the pushed Unit is the Material.
 */
export interface Specification {
  outcome: OutcomeId;
  /** The subject the Units must be about (null: any subject of the brand). */
  subject: string | null;
  brandId: string;
  conditions: Condition[];
  quantity: number;
}

/** A set of conditions on tactics, for one leg. A play = leg x strategy. */
export interface Strategy {
  id: string;
  name: string;
  legId: string;
  rules: StrategyRule[];
  /** Conditions on the subject (lead tactics, outcomes reached): who the play serves. */
  subject?: Condition[];
  /** Set when the split mechanism proposed it. */
  proposed?: { day: number; reason: string };
  retired?: boolean;
}

/**
 * A sales path is a view: the straight line of lead states a Campaign's
 * production tree actually went through, from its start outcome (Start, the
 * market, or any outcome) to its Target. It controls nothing; it has a name
 * to talk about it, given on first sight and kept.
 */
export interface SalesPath {
  id: string;
  name: string;
  /** START, or the outcome the path starts from. */
  start: OutcomeId;
  /** The lead states after the start; the last one is the Target. */
  line: OutcomeId[];
}

/** A sales funnel is a view too: a sales path and the leg that made each of its lead states. Named on first sight, never renamed. */
export interface SalesFunnel {
  id: string;
  name: string;
  pathId: string;
  /** The leg that made each lead state of the path. */
  plays: string[];
}

export function salesPathId(start: OutcomeId, line: readonly OutcomeId[]): string {
  return `path:${[start, ...line].join(">")}`;
}

export function salesFunnelId(start: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): string {
  return `funnel:${[start, ...line].join(">")}|${plays.join("+")}`;
}

export interface CatalogueData {
  leadTracks: LeadTrack[];
  outcomes: Outcome[];
  factories: Factory[];
  legs: Leg[];
  scripts: Script[];
  tactics: Tactic[];
  strategies: Strategy[];
  /** Sales paths and sales funnels named so far (views: names are given on first sight and kept). */
  salesPaths?: SalesPath[];
  salesFunnels?: SalesFunnel[];
}

type Kind = Exclude<keyof CatalogueData, "salesPaths" | "salesFunnels">;

export interface CatalogueIssue {
  kind: string;
  id: string;
  message: string;
}

/** The id of the default strategy of a leg (no condition). */
export function defaultStrategyId(legId: string): string {
  return `${legId}#default`;
}

/** The outcomes of a Bill of materials, in order. */
export function billOf(script: Pick<Script, "materials">): OutcomeId[] {
  return script.materials.map((m) => m.outcome);
}

/**
 * A mutable catalogue. Lists keep insertion order, so every read is
 * deterministic. Retiring keeps the object for history and takes it out of
 * every choice.
 */
export class Catalogue {
  private readonly data: CatalogueData;
  /** Reads computed from the lists, kept until the next write. */
  private readonly memo = new Map<string, unknown>();

  constructor(data?: Partial<CatalogueData>) {
    this.data = {
      leadTracks: [...(data?.leadTracks ?? [])],
      outcomes: [...(data?.outcomes ?? [])],
      factories: [...(data?.factories ?? [])],
      legs: [...(data?.legs ?? [])],
      scripts: [...(data?.scripts ?? [])],
      tactics: [...(data?.tactics ?? [])],
      strategies: [...(data?.strategies ?? [])],
      salesPaths: [...(data?.salesPaths ?? [])],
      salesFunnels: [...(data?.salesFunnels ?? [])],
    };
    for (const l of this.data.legs) this.ensureDefaultStrategy(l.id);
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
  get legs(): readonly Leg[] {
    return this.data.legs;
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
  peekSalesPath(start: OutcomeId, line: readonly OutcomeId[]): SalesPath {
    const id = salesPathId(start, line);
    return this.salesPath(id) ?? { id, name: this.freshName(this.pathNames(start, line), new Set(this.salesPaths.map((p) => p.name))), start, line: [...line] };
  }

  /** The sales path of a line, named on first sight and kept. */
  nameSalesPath(start: OutcomeId, line: readonly OutcomeId[]): SalesPath {
    const p = this.peekSalesPath(start, line);
    if (!this.salesPath(p.id)) this.data.salesPaths!.push(p);
    return p;
  }

  /** The sales funnel of a line and its plays: its stored name, or the name it would get now (nothing is stored). */
  peekSalesFunnel(start: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): SalesFunnel {
    const id = salesFunnelId(start, line, plays);
    const found = this.salesFunnel(id);
    if (found) return found;
    const path = this.peekSalesPath(start, line);
    return { id, name: this.freshName(this.funnelNames(path, plays), new Set(this.salesFunnels.map((f) => f.name))), pathId: path.id, plays: [...plays] };
  }

  /** The sales funnel of a line and its plays, named on first sight (its path too) and kept. */
  nameSalesFunnel(start: OutcomeId, line: readonly OutcomeId[], plays: readonly string[]): SalesFunnel {
    this.nameSalesPath(start, line);
    const f = this.peekSalesFunnel(start, line, plays);
    if (!this.salesFunnel(f.id)) this.data.salesFunnels!.push(f);
    return f;
  }

  private plural(o: OutcomeId): string {
    const out = this.outcome(o);
    return out?.plural ?? `${out?.label ?? o}s`;
  }

  /** Short plain words: "Paid clients from the market"; the states it passes through only to tell two apart (the first, then all), a number last. */
  private pathNames(start: OutcomeId, line: readonly OutcomeId[]): string[] {
    const target = line[line.length - 1] ?? start;
    const from = start === START ? "the market" : this.plural(start).toLowerCase();
    const base = `${this.plural(target)} from ${from}`;
    const via = line.slice(0, -1).map((o) => this.plural(o).toLowerCase());
    const all = via.length > 1 ? `${via.slice(0, -1).join(", ")} and ${via[via.length - 1]}` : via[0];
    return via.length > 0 ? [...new Set([base, `${base}, via ${via[0]}`, `${base}, via ${all}`])] : [base];
  }

  /** Short plain words: the leg that brings the first lead state, then the Target ("Reply judge to paid clients"). */
  private funnelNames(path: SalesPath, plays: readonly string[]): string[] {
    const names = plays.map((id) => this.leg(id)?.name ?? id);
    const target = this.plural(path.line[path.line.length - 1] ?? path.start).toLowerCase();
    const out: string[] = [];
    for (let k = 1; k <= Math.max(1, names.length); k++) out.push(`${names.slice(0, k).join(", ") || path.name} to ${target}`);
    return out;
  }

  /** The first candidate no other object holds, else the last one numbered (2, 3...). */
  private freshName(candidates: readonly string[], taken: ReadonlySet<string>): string {
    for (const c of candidates) if (!taken.has(c)) return c;
    const first = candidates[0]!;
    for (let n = 2; ; n++) if (!taken.has(`${first} ${n}`)) return `${first} ${n}`;
  }

  outcome(id: OutcomeId): Outcome | undefined {
    return this.data.outcomes.find((o) => o.id === id);
  }
  leg(id: string): Leg | undefined {
    return this.data.legs.find((l) => l.id === id);
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
  factory(id: string): Factory | undefined {
    return this.data.factories.find((f) => f.id === id);
  }

  isOurs(leg: Leg): boolean {
    return this.factory(leg.factory)?.ours ?? false;
  }

  isLegLive(l: Leg): boolean {
    if (l.retired) return false;
    return !this.outcome(l.output)?.retired;
  }

  /** Is a script runnable: active, on a live leg, every Material of its Bill of materials live? */
  isScriptLive(s: Script): boolean {
    const leg = this.leg(s.legId);
    return s.status === "active" && !!leg && this.isLegLive(leg) && s.materials.every((m) => !this.outcome(m.outcome)?.retired);
  }

  /** Live legs producing an outcome. */
  providersOf(outcome: OutcomeId): Leg[] {
    const k = `providers|${outcome}`;
    const hit = this.memo.get(k) as Leg[] | undefined;
    if (hit) return hit;
    const v = this.data.legs.filter((l) => l.output === outcome && this.isLegLive(l));
    this.memo.set(k, v);
    return v;
  }

  /** Every outcome any script of a leg consumes, in first-seen order (what the leg may need). */
  materialsOf(leg: Leg): OutcomeId[] {
    const out: OutcomeId[] = [];
    for (const s of this.data.scripts) if (s.legId === leg.id) for (const m of s.materials) if (!out.includes(m.outcome)) out.push(m.outcome);
    return out;
  }

  /** The Material of a script that carries its subject (a lead), if any. */
  subjectOf(script: Pick<Script, "materials">): OutcomeId | null {
    for (const m of script.materials) if (this.outcome(m.outcome)?.subject === "lead") return m.outcome;
    return null;
  }

  /** The outcome a leg goes from: the subject Material its scripts share (null: it creates its subjects, or makes a brand or run Unit). */
  subjectMaterial(leg: Leg): OutcomeId | null {
    const k = `subject|${leg.id}`;
    if (this.memo.has(k)) return this.memo.get(k) as OutcomeId | null;
    let v: OutcomeId | null = null;
    for (const s of this.data.scripts) {
      if (s.legId !== leg.id) continue;
      v = this.subjectOf(s);
      if (v) break;
    }
    this.memo.set(k, v);
    return v;
  }

  /** A leg with no lead Material and a lead output creates its subjects (it turns the market into leads). */
  createsSubjects(leg: Leg): boolean {
    return !leg.webhook && this.subjectMaterial(leg) === null && this.outcome(leg.output)?.subject === "lead";
  }

  /**
   * Where a leg's subject comes from: Start for a leg creating subjects, or a
   * lead state, found by walking subject Materials back through outcomes that
   * are not lead states. `starts` adds outcomes a campaign may start from (a
   * Message sent): a leg consuming one is rooted there.
   */
  rootsOf(leg: Leg, starts: ReadonlySet<OutcomeId> = new Set(), seen?: Set<string>): Set<OutcomeId> {
    if (seen) return this.computeRoots(leg, starts, seen);
    const k = `roots|${leg.id}|${[...starts].sort().join(",")}`;
    const hit = this.memo.get(k) as Set<OutcomeId> | undefined;
    if (hit) return hit;
    const v = this.computeRoots(leg, starts, new Set());
    this.memo.set(k, v);
    return v;
  }

  private computeRoots(leg: Leg, starts: ReadonlySet<OutcomeId>, seen: Set<string>): Set<OutcomeId> {
    const roots = new Set<OutcomeId>();
    if (seen.has(leg.id)) return roots;
    seen.add(leg.id);
    if (this.createsSubjects(leg)) {
      roots.add(START);
      return roots;
    }
    const s = this.subjectMaterial(leg);
    if (!s) return roots;
    const o = this.outcome(s);
    if (o?.track || starts.has(s)) {
      roots.add(s);
      if (o?.track) return roots;
    }
    for (const q of this.providersOf(s)) if (!q.webhook) for (const r of this.computeRoots(q, starts, new Set(seen))) roots.add(r);
    return roots;
  }

  /** Active head version of each dynasty of a leg, in catalogue order. */
  dynastiesOf(legId: string): Script[] {
    const heads = new Map<string, Script>();
    for (const s of this.data.scripts) {
      if (s.legId !== legId || s.status !== "active") continue;
      const cur = heads.get(s.dynasty);
      if (!cur || s.version > cur.version) heads.set(s.dynasty, s);
    }
    return [...heads.values()].filter((s) => this.isScriptLive(s));
  }

  /** Every version of a dynasty, oldest first. */
  versionsOf(dynasty: string): Script[] {
    return this.data.scripts.filter((s) => s.dynasty === dynasty).sort((a, b) => a.version - b.version);
  }

  /** The script running for a dynasty today (its active head), if any. */
  headOf(dynasty: string): Script | undefined {
    return this.versionsOf(dynasty).filter((s) => s.status === "active").pop();
  }

  strategiesOf(legId: string): Strategy[] {
    return this.data.strategies.filter((s) => s.legId === legId && !s.retired);
  }

  // ---- writes ---------------------------------------------------------------

  add<K extends Kind>(kind: K, item: CatalogueData[K][number]): this {
    this.memo.clear();
    const list = this.data[kind] as Array<CatalogueData[K][number]>;
    const id = (item as { id: string }).id;
    if (list.some((x) => (x as { id: string }).id === id)) throw new Error(`${kind} "${id}" already exists`);
    list.push(item);
    if (kind === "legs") this.ensureDefaultStrategy(id);
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

  /** Add a new version of a dynasty: it runs from now on, the dynasty keeps its history. */
  upgrade(dynasty: string, changes: Partial<Omit<Script, "dynasty" | "version" | "legId">> & { id: string }): Script {
    const head = this.headOf(dynasty) ?? this.versionsOf(dynasty).pop();
    if (!head) throw new Error(`dynasty "${dynasty}" not found`);
    const next: Script = { ...head, ...changes, dynasty, legId: head.legId, version: head.version + 1, status: "active" };
    this.add("scripts", next);
    return next;
  }

  /** Fork a dynasty: a new dynasty whose prior starts from the parent's (its own Bill of materials, else the parent's). */
  fork(parentDynasty: string, script: Omit<Script, "parentDynasty" | "version" | "legId" | "status" | "materials"> & { status?: Script["status"]; materials?: Material[] }): Script {
    const parent = this.headOf(parentDynasty) ?? this.versionsOf(parentDynasty).pop();
    if (!parent) throw new Error(`dynasty "${parentDynasty}" not found`);
    const s: Script = { status: "active", materials: parent.materials, ...script, legId: parent.legId, version: 1, parentDynasty };
    this.add("scripts", s);
    return s;
  }

  private ensureDefaultStrategy(legId: string): void {
    const id = defaultStrategyId(legId);
    if (!this.data.strategies.some((s) => s.id === id)) this.data.strategies.push({ id, name: "Default", legId, rules: [] });
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
      if (o.referenceLeg && !this.leg(o.referenceLeg)) issues.push({ kind: "outcomes", id: o.id, message: `unknown reference leg "${o.referenceLeg}"` });
    }
    for (const l of this.data.legs) {
      if (!outcomeIds.has(l.output)) issues.push({ kind: "legs", id: l.id, message: `unknown output "${l.output}"` });
      if (!this.factory(l.factory)) issues.push({ kind: "legs", id: l.id, message: `unknown factory "${l.factory}"` });
      if (l.webhook && this.factory(l.factory)?.ours) issues.push({ kind: "legs", id: l.id, message: "a webhook's producer is another factory" });
    }
    for (const s of this.data.scripts) {
      const leg = this.leg(s.legId);
      if (!leg) {
        issues.push({ kind: "scripts", id: s.id, message: `unknown leg "${s.legId}"` });
        continue;
      }
      for (const m of s.materials) {
        if (!outcomeIds.has(m.outcome)) issues.push({ kind: "scripts", id: s.id, message: `unknown Material "${m.outcome}"` });
        for (const c of m.conditions ?? []) if (c.op !== "notReached" && !this.tactic(c.tactic)) issues.push({ kind: "scripts", id: s.id, message: `unknown tactic "${c.tactic}"` });
      }
      if (s.materials.some((m) => m.outcome === leg.output)) issues.push({ kind: "scripts", id: s.id, message: "a script cannot consume its leg's own output" });
      if (leg.webhook && s.materials.length > 0) issues.push({ kind: "scripts", id: s.id, message: "a webhook's script has no internal Material" });
      if (this.subjectOf(s) !== this.subjectMaterial(leg)) issues.push({ kind: "scripts", id: s.id, message: `the scripts of ${leg.id} go from different outcomes` });
      for (const t of Object.keys(s.tactics)) if (!this.tactic(t)) issues.push({ kind: "scripts", id: s.id, message: `unknown tactic "${t}"` });
    }
    for (const s of this.data.strategies) {
      const leg = this.leg(s.legId);
      if (!leg) issues.push({ kind: "strategies", id: s.id, message: `unknown leg "${s.legId}"` });
      for (const r of s.rules) {
        if (r.material && leg && !this.materialsOf(leg).includes(r.material)) issues.push({ kind: "strategies", id: s.id, message: `"${r.material}" is not a Material of ${s.legId}` });
        for (const c of r.conditions) if (c.op !== "notReached" && !this.tactic(c.tactic)) issues.push({ kind: "strategies", id: s.id, message: `unknown tactic "${c.tactic}"` });
      }
    }
    return issues;
  }
}
