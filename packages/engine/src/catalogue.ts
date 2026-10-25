/**
 * The catalogue: every object of a GTM factory as data. Steps (outcomes),
 * triggers, channels, pipes (channel x leg), tactics, strategies, plays,
 * workflows and the options their slots take (template dynasties, LLM
 * dynasties, any other slot). Anything can be added, removed or retired while
 * the factory runs; nothing in the engine is keyed on a particular slug.
 */

/** The step every sales path starts from. */
export const START = "start";

export type StepKey = string;

/**
 * A lead track: an ordered ladder of lead states a lead moves forward on
 * (e.g. "CRM lifecycle": interested, meeting booked, meeting attended, paid
 * client; "Website visits": visited). A lead moves on each track separately;
 * tracks are never added together. Declared as data like any other object.
 */
export interface LeadTrack {
  id: string;
  name: string;
  description?: string;
  retired?: boolean;
}

/** A lead state: reached once per lead x brand, at a rank on one lead track. */
export interface LeadState {
  state: string;
  leadTrack: string;
  rank: number;
}

export interface Step {
  key: StepKey;
  label: string;
  pluralLabel?: string;
  description?: string;
  icon?: string;
  /** What an occurrence of this step is about: a lead, an object (a post, an audience), or nothing yet. */
  subjectKind: "lead" | "object" | "none";
  /** The lead state this step is evidence of, if any. */
  leadState: LeadState | null;
  retired?: boolean;
}

/** Fires a reactive pipe: an outcome reached, or a condition about a lead (a "Lead event"). */
export interface Trigger {
  id: string;
  label: string;
  kind: "outcome" | "condition";
  /** For an outcome trigger: the step whose occurrence fires it. */
  outcomeStep: StepKey | null;
  /** The step the trigger's subject is at, when it has one. */
  fromStep: StepKey | null;
  description?: string;
  retired?: boolean;
}

export interface Channel {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  /** Free grouping label for display (outbound, paid reach...). */
  group?: string;
  /** Who operates it: the platform, or the customer's own team. */
  operatedBy: "platform" | "customer";
  /** Who performs the work: software or a person. */
  performedBy: "software" | "person";
  retired?: boolean;
}

export interface Maturity {
  /** Days after a trial before its cohort is read as mature. */
  durationDays: number;
  /** Outcomes the mature view needs before it is read on its own. */
  outcomesRequired: number;
  /** Expected mean delay between a trial and its outcome, in days. */
  delayMeanDays: number;
}

/** A pipe = channel x leg (from step -> to step). */
export interface Pipe {
  id: string;
  channel: string;
  from: StepKey;
  to: StepKey;
  /** Proactive pipes spend their own budget; reactive pipes wait on ONE trigger. */
  mode: "proactive" | "reactive";
  triggerId: string | null;
  name?: string;
  maturity: Maturity;
  retired?: boolean;
}

export type TacticSubject = "workflow" | "slot_option";

/** A yes/no tag on a workflow or on a slot option (a template, an LLM). */
export interface Tactic {
  id: string;
  name: string;
  appliesTo: TacticSubject;
  description?: string;
  retired?: boolean;
}

/** Tactics required and excluded. An empty strategy accepts everything. */
export interface Strategy {
  id: string;
  name: string;
  required: string[];
  excluded: string[];
  retired?: boolean;
}

/** A play = pipe x strategy. A null strategy is the pipe's default play. */
export interface Play {
  id: string;
  pipeId: string;
  strategyId: string | null;
  retired?: boolean;
}

export type WorkflowKind = "rules" | "ai" | "human";

/** How a pipe is performed. It declares the slots it needs filled (template, llm, ...). */
export interface Workflow {
  id: string;
  dynasty: string;
  pipeId: string;
  kind: WorkflowKind;
  slots: string[];
  tactics: string[];
  /** Expected cost of processing one input, in cents (before slot options). */
  costPerTrialCents: number;
  /** Yield expected by whoever added it, before any data (the prior's centre). */
  expectedYield?: number;
  status: "active" | "retired";
}

/**
 * One option a workflow slot can take: a template dynasty (slot "template"),
 * an LLM dynasty (slot "llm"), or any other slot a workflow declares.
 * `pipeId` null = usable on every pipe.
 */
export interface SlotOption {
  id: string;
  slot: string;
  name: string;
  pipeId: string | null;
  tactics: string[];
  /** Expected extra cost per input processed, in cents. */
  costPerTrialCents: number;
  status: "active" | "retired";
}

export function legKey(from: StepKey, to: StepKey): string {
  return `${from}_to_${to}`;
}

export function defaultPlayId(pipeId: string): string {
  return `${pipeId}#default`;
}

export interface CatalogueIssue {
  kind: string;
  id: string;
  message: string;
}

/** Does a set of tactics follow a strategy? */
export function followsStrategy(tactics: readonly string[], strategy: Strategy | null): boolean {
  if (!strategy) return true;
  for (const t of strategy.required) if (!tactics.includes(t)) return false;
  for (const t of strategy.excluded) if (tactics.includes(t)) return false;
  return true;
}

export interface CatalogueData {
  leadTracks: LeadTrack[];
  steps: Step[];
  triggers: Trigger[];
  channels: Channel[];
  pipes: Pipe[];
  tactics: Tactic[];
  strategies: Strategy[];
  plays: Play[];
  workflows: Workflow[];
  slotOptions: SlotOption[];
}

type Kind = keyof CatalogueData;

/**
 * A mutable catalogue. Lists keep insertion order, so every read is
 * deterministic. Retiring keeps the object (history stays readable) but
 * removes it from every choice.
 */
export class Catalogue {
  private readonly data: CatalogueData;

  constructor(data?: Partial<CatalogueData>) {
    this.data = {
      leadTracks: [...(data?.leadTracks ?? [])],
      steps: [...(data?.steps ?? [])],
      triggers: [...(data?.triggers ?? [])],
      channels: [...(data?.channels ?? [])],
      pipes: [...(data?.pipes ?? [])],
      tactics: [...(data?.tactics ?? [])],
      strategies: [...(data?.strategies ?? [])],
      plays: [...(data?.plays ?? [])],
      workflows: [...(data?.workflows ?? [])],
      slotOptions: [...(data?.slotOptions ?? [])],
    };
    for (const pipe of this.data.pipes) this.ensureDefaultPlay(pipe.id);
  }

  snapshot(): CatalogueData {
    return structuredCloneData(this.data);
  }

  clone(): Catalogue {
    return new Catalogue(this.snapshot());
  }

  // ---- reads -------------------------------------------------------------

  get leadTracks(): readonly LeadTrack[] {
    return this.data.leadTracks;
  }
  get steps(): readonly Step[] {
    return this.data.steps;
  }
  get triggers(): readonly Trigger[] {
    return this.data.triggers;
  }
  get channels(): readonly Channel[] {
    return this.data.channels;
  }
  get pipes(): readonly Pipe[] {
    return this.data.pipes;
  }
  get tactics(): readonly Tactic[] {
    return this.data.tactics;
  }
  get strategies(): readonly Strategy[] {
    return this.data.strategies;
  }
  get plays(): readonly Play[] {
    return this.data.plays;
  }
  get workflows(): readonly Workflow[] {
    return this.data.workflows;
  }
  get slotOptions(): readonly SlotOption[] {
    return this.data.slotOptions;
  }

  leadTrack(id: string): LeadTrack | undefined {
    return this.data.leadTracks.find((t) => t.id === id);
  }
  step(key: StepKey): Step | undefined {
    return this.data.steps.find((s) => s.key === key);
  }
  pipe(id: string): Pipe | undefined {
    return this.data.pipes.find((p) => p.id === id);
  }
  channel(slug: string): Channel | undefined {
    return this.data.channels.find((c) => c.slug === slug);
  }
  trigger(id: string): Trigger | undefined {
    return this.data.triggers.find((t) => t.id === id);
  }
  strategy(id: string): Strategy | undefined {
    return this.data.strategies.find((s) => s.id === id);
  }
  play(id: string): Play | undefined {
    return this.data.plays.find((p) => p.id === id);
  }
  workflow(id: string): Workflow | undefined {
    return this.data.workflows.find((w) => w.id === id);
  }
  slotOption(id: string): SlotOption | undefined {
    return this.data.slotOptions.find((o) => o.id === id);
  }

  /** Live pipes leaving a step. */
  pipesFrom(step: StepKey): Pipe[] {
    return this.data.pipes.filter((p) => !p.retired && p.from === step && this.isPipeLive(p));
  }

  /** Live pipes arriving at a step. */
  pipesInto(step: StepKey): Pipe[] {
    return this.data.pipes.filter((p) => !p.retired && p.to === step && this.isPipeLive(p));
  }

  isPipeLive(p: Pipe): boolean {
    if (p.retired) return false;
    const channel = this.channel(p.channel);
    if (channel?.retired) return false;
    if (p.from !== START && this.step(p.from)?.retired) return false;
    if (this.step(p.to)?.retired) return false;
    return true;
  }

  /** Live plays of a pipe (its default play first). */
  playsOf(pipeId: string): Play[] {
    return this.data.plays.filter(
      (p) => p.pipeId === pipeId && !p.retired && (p.strategyId === null || !this.strategy(p.strategyId)?.retired),
    );
  }

  /** Active workflows of a pipe that follow a play's strategy. */
  workflowsFor(play: Play): Workflow[] {
    const strategy = play.strategyId ? this.strategy(play.strategyId) ?? null : null;
    return this.data.workflows.filter(
      (w) => w.pipeId === play.pipeId && w.status === "active" && followsStrategy(w.tactics, this.subjectStrategy(strategy, "workflow")),
    );
  }

  /** Active options of one slot usable on a pipe, following a play's strategy. */
  slotOptionsFor(play: Play, slot: string): SlotOption[] {
    const strategy = play.strategyId ? this.strategy(play.strategyId) ?? null : null;
    return this.data.slotOptions.filter(
      (o) =>
        o.slot === slot &&
        o.status === "active" &&
        (o.pipeId === null || o.pipeId === play.pipeId) &&
        followsStrategy(o.tactics, this.subjectStrategy(strategy, "slot_option")),
    );
  }

  /** The part of a strategy that speaks about one subject (a template tactic never gates a workflow). */
  subjectStrategy(strategy: Strategy | null, subject: TacticSubject): Strategy | null {
    if (!strategy) return null;
    const onSubject = (id: string) => this.data.tactics.find((t) => t.id === id)?.appliesTo === subject;
    return { ...strategy, required: strategy.required.filter(onSubject), excluded: strategy.excluded.filter(onSubject) };
  }

  // ---- writes ------------------------------------------------------------

  add<K extends Kind>(kind: K, item: CatalogueData[K][number]): this {
    const list = this.data[kind] as Array<CatalogueData[K][number]>;
    const id = idOf(kind, item);
    if (list.some((x) => idOf(kind, x) === id)) throw new Error(`${kind} "${id}" already exists`);
    list.push(item);
    if (kind === "pipes") this.ensureDefaultPlay(id);
    return this;
  }

  /** Remove an object for good (its history is not kept by the catalogue). */
  remove(kind: Kind, id: string): this {
    const list = this.data[kind] as unknown as unknown[];
    const i = list.findIndex((x) => idOf(kind, x) === id);
    if (i < 0) throw new Error(`${kind} "${id}" not found`);
    list.splice(i, 1);
    if (kind === "pipes") this.data.plays = this.data.plays.filter((p) => p.pipeId !== id);
    return this;
  }

  /** Retire an object: kept for history, out of every choice. */
  retire(kind: Kind, id: string): this {
    const list = this.data[kind] as unknown as Array<Record<string, unknown>>;
    const item = list.find((x) => idOf(kind, x) === id);
    if (!item) throw new Error(`${kind} "${id}" not found`);
    if (kind === "workflows" || kind === "slotOptions") item.status = "retired";
    else item.retired = true;
    return this;
  }

  private ensureDefaultPlay(pipeId: string): void {
    const id = defaultPlayId(pipeId);
    if (!this.data.plays.some((p) => p.id === id)) this.data.plays.push({ id, pipeId, strategyId: null });
  }

  // ---- validation ----------------------------------------------------------

  validate(): CatalogueIssue[] {
    const issues: CatalogueIssue[] = [];
    const stepKeys = new Set(this.data.steps.map((s) => s.key));
    const dup = (kind: Kind, items: readonly unknown[]) => {
      const seen = new Set<string>();
      for (const it of items) {
        const id = idOf(kind, it);
        if (seen.has(id)) issues.push({ kind, id, message: "duplicate id" });
        seen.add(id);
      }
    };
    (Object.keys(this.data) as Kind[]).forEach((k) => dup(k, this.data[k]));
    if (stepKeys.has(START)) issues.push({ kind: "steps", id: START, message: `"${START}" is reserved` });
    for (const s of this.data.steps) {
      if (s.leadState && !this.data.leadTracks.some((t) => t.id === s.leadState!.leadTrack))
        issues.push({ kind: "steps", id: s.key, message: `unknown lead track "${s.leadState.leadTrack}"` });
    }
    for (const p of this.data.pipes) {
      if (p.from !== START && !stepKeys.has(p.from)) issues.push({ kind: "pipes", id: p.id, message: `unknown from step "${p.from}"` });
      if (!stepKeys.has(p.to)) issues.push({ kind: "pipes", id: p.id, message: `unknown to step "${p.to}"` });
      if (p.from === p.to) issues.push({ kind: "pipes", id: p.id, message: "a pipe cannot loop on one step" });
      if (!this.channel(p.channel)) issues.push({ kind: "pipes", id: p.id, message: `unknown channel "${p.channel}"` });
      if (p.mode === "reactive" && !p.triggerId) issues.push({ kind: "pipes", id: p.id, message: "a reactive pipe waits on one trigger" });
      if (p.mode === "proactive" && p.triggerId) issues.push({ kind: "pipes", id: p.id, message: "a proactive pipe has no trigger" });
      if (p.triggerId && !this.trigger(p.triggerId)) issues.push({ kind: "pipes", id: p.id, message: `unknown trigger "${p.triggerId}"` });
    }
    for (const t of this.data.triggers) {
      if (t.kind === "outcome" && (!t.outcomeStep || !stepKeys.has(t.outcomeStep)))
        issues.push({ kind: "triggers", id: t.id, message: "an outcome trigger names a known step" });
    }
    for (const s of this.data.strategies) {
      for (const t of [...s.required, ...s.excluded])
        if (!this.data.tactics.some((x) => x.id === t)) issues.push({ kind: "strategies", id: s.id, message: `unknown tactic "${t}"` });
    }
    for (const p of this.data.plays) {
      if (!this.pipe(p.pipeId)) issues.push({ kind: "plays", id: p.id, message: `unknown pipe "${p.pipeId}"` });
      if (p.strategyId && !this.strategy(p.strategyId)) issues.push({ kind: "plays", id: p.id, message: `unknown strategy "${p.strategyId}"` });
    }
    for (const w of this.data.workflows) {
      if (!this.pipe(w.pipeId)) issues.push({ kind: "workflows", id: w.id, message: `unknown pipe "${w.pipeId}"` });
      for (const t of w.tactics) if (!this.data.tactics.some((x) => x.id === t)) issues.push({ kind: "workflows", id: w.id, message: `unknown tactic "${t}"` });
    }
    for (const o of this.data.slotOptions) {
      if (o.pipeId && !this.pipe(o.pipeId)) issues.push({ kind: "slotOptions", id: o.id, message: `unknown pipe "${o.pipeId}"` });
    }
    return issues;
  }
}

function idOf(kind: Kind, item: unknown): string {
  const rec = item as Record<string, unknown>;
  if (kind === "steps") return String(rec.key);
  if (kind === "channels") return String(rec.slug);
  return String(rec.id);
}

function structuredCloneData(d: CatalogueData): CatalogueData {
  return JSON.parse(JSON.stringify(d)) as CatalogueData;
}
