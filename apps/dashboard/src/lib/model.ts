/**
 * Read models over the running world: every figure a page shows is computed here, once per
 * simulated day, from the engine's own outputs (runs, occurrences, leads, choices). Pages divide
 * nothing themselves. Nothing here knows a channel, a pipe or a step by name: everything is read
 * off the catalogue.
 */

import {
  START,
  chainCostPerTarget,
  evaluateSplits,
  targetValue,
  valueBackward,
  type Catalogue,
  type ChoiceRecord,
  type LedgerOccurrence,
  type LedgerRun,
  type Pipe,
  type SimClient,
  type SimLead,
  type SimulationResult,
  type SimulationSession,
  type SplitResult,
  type StepKey,
  type WorldSpec,
} from "@gtm-factory/engine";
import { humanize, sentenceCase } from "./format";

export interface LeadStateDef {
  state: string;
  label: string;
  rank: number;
  trackId: string;
}

export interface TrackDef {
  id: string;
  /** The owner's word: "CRM lifecycle track". */
  label: string;
  description: string | undefined;
  states: LeadStateDef[];
}

export interface Model {
  day: number;
  world: WorldSpec;
  session: SimulationSession;
  result: SimulationResult;
  catalogue: Catalogue;
  clients: readonly SimClient[];
  leads: SimLead[];
  leadById: Map<string, SimLead>;
  runById: Map<string, LedgerRun>;
  occurrencesByRun: Map<string, LedgerOccurrence[]>;
  tracks: TrackDef[];
  stateDefs: Map<string, LeadStateDef>;
}

export function buildModel(world: WorldSpec, session: SimulationSession): Model {
  const result = session.result();
  const leads = session.leads();
  const occurrencesByRun = new Map<string, LedgerOccurrence[]>();
  for (const o of result.occurrences) {
    const list = occurrencesByRun.get(o.runId);
    if (list) list.push(o);
    else occurrencesByRun.set(o.runId, [o]);
  }
  const tracks = leadTracks(world.catalogue);
  const stateDefs = new Map<string, LeadStateDef>();
  for (const t of tracks) for (const s of t.states) stateDefs.set(s.state, s);
  return {
    day: session.day,
    world,
    session,
    result,
    catalogue: world.catalogue,
    clients: session.clients,
    leads,
    leadById: new Map(leads.map((l) => [l.id, l])),
    runById: new Map(result.runs.map((r) => [r.id, r])),
    occurrencesByRun,
    tracks,
    stateDefs,
  };
}

// ---------------------------------------------------------------------------
// Vocabulary read off the catalogue
// ---------------------------------------------------------------------------

/** Every lead track with its states in rank order. A track is never added to another. */
export function leadTracks(catalogue: Catalogue): TrackDef[] {
  return catalogue.leadTracks
    .filter((t) => !t.retired)
    .map((t) => {
      const seen = new Map<string, LeadStateDef>();
      for (const s of catalogue.steps) {
        const ls = s.leadState;
        if (!ls || ls.leadTrack !== t.id || s.retired) continue;
        if (!seen.has(ls.state)) seen.set(ls.state, { state: ls.state, label: humanize(ls.state), rank: ls.rank, trackId: t.id });
      }
      return {
        id: t.id,
        label: `${t.name} track`,
        description: t.description,
        states: [...seen.values()].sort((a, b) => a.rank - b.rank),
      };
    })
    .filter((t) => t.states.length > 0);
}

export function stepLabel(catalogue: Catalogue, key: StepKey): string {
  if (key === START) return "Start";
  return catalogue.step(key)?.label ?? humanize(key);
}

/** The lead state an outcome key names, or the step it is (object steps). */
export function outcomeLabel(model: Model, outcome: string): string {
  return model.stateDefs.get(outcome)?.label ?? stepLabel(model.catalogue, outcome);
}

export function channelName(catalogue: Catalogue, pipe: Pipe | undefined): string {
  if (!pipe) return "Unknown";
  return catalogue.channel(pipe.channel)?.name ?? humanize(pipe.channel);
}

/** A pipe's own name (its bird) and what it does. */
export function pipeTitle(catalogue: Catalogue, pipeId: string): { name: string; line: string } {
  const p = catalogue.pipe(pipeId);
  if (!p) return { name: pipeId, line: "" };
  return { name: p.name ?? pipeId, line: `${stepLabel(catalogue, p.from)} → ${channelName(catalogue, p)} → ${stepLabel(catalogue, p.to)}` };
}

export function playPipe(catalogue: Catalogue, playId: string): Pipe | undefined {
  const play = catalogue.play(playId);
  return play ? catalogue.pipe(play.pipeId) : undefined;
}

/** A sales funnel's plain name: what it starts with and what it brings. */
export function funnelName(catalogue: Catalogue, playIds: readonly string[]): string {
  const first = playPipe(catalogue, playIds[0] ?? "");
  const last = playPipe(catalogue, playIds[playIds.length - 1] ?? "");
  if (!first || !last) return "Sales funnel";
  const via = playIds.length > 2 ? ` via ${stepLabel(catalogue, playPipe(catalogue, playIds[0]!)!.to)}` : "";
  return `${channelName(catalogue, first)}${via} to ${stepLabel(catalogue, last.to)}`;
}

export function workflowLabel(catalogue: Catalogue, id: string): string {
  const w = catalogue.workflow(id);
  if (!w) return id;
  const tail = id.split(":wf:")[1] ?? w.dynasty;
  const words: Record<string, string> = { rules: "Rules", ai: "AI writer", "ai-research": "AI researcher", human: "Person", scripted: "Person with script" };
  return words[tail] ?? humanize(tail);
}

export function slotOptionLabel(catalogue: Catalogue, id: string): string {
  const o = catalogue.slotOption(id);
  return o ? humanize(o.name) : id;
}

export function optionLabel(model: Model, node: string, id: string): string {
  if (node === "workflow") return workflowLabel(model.catalogue, id);
  if (node.startsWith("slot:")) return slotOptionLabel(model.catalogue, id);
  if (node === "audience") return sentenceCase(model.result.audiences.find((a) => a.id === id)?.name ?? id);
  if (node === "funnel") return funnelName(model.catalogue, id.split(" > "));
  return id;
}

export function nodeLabel(node: string): string {
  if (node === "funnel") return "Sales funnel";
  if (node === "workflow") return "Workflow";
  if (node === "audience") return "Audience";
  if (node.startsWith("slot:")) return node.slice(5) === "llm" ? "LLM" : humanize(node.slice(5));
  return humanize(node);
}

// ---------------------------------------------------------------------------
// Clients, campaigns, value
// ---------------------------------------------------------------------------

export function clientOfCampaign(model: Model, campaignId: string): SimClient | undefined {
  return model.clients.find((c) => c.campaign.id === campaignId);
}

/** Campaigns in scope: one brand, or every client. */
export function scopedClients(model: Model, brandId: string | null): SimClient[] {
  return model.clients.filter((c) => !brandId || c.brand.id === brandId);
}

/** One target outcome's value and whether the client stated it. */
export function valueOf(model: Model, client: SimClient): { amount: number; label: "stated" | "expected" } | null {
  return targetValue(client.offer, client.campaign.target, model.clients.map((c) => c.offer), model.catalogue);
}

export function targetState(model: Model, client: SimClient): string {
  return model.catalogue.step(client.campaign.target)?.leadState?.state ?? client.campaign.target;
}

/** Expected return of a campaign's funnel today: value of a target outcome / its cost on today's estimates. */
export function expectedRoi(model: Model, client: SimClient): number | null {
  const plays = model.session.funnelOfCampaign(client.campaign.id) ?? client.campaign.salesFunnel ?? null;
  const value = valueOf(model, client)?.amount ?? null;
  if (!plays || value == null) return null;
  const legs = plays.map((p) => model.session.estimateLeg(p, client.brand.id));
  if (legs.some((l) => !l)) return null;
  const cost = chainCostPerTarget(legs.map((l) => ({ costPerTrial: l!.costPerTrial, yieldRate: l!.yieldRate })));
  return Number.isFinite(cost) && cost > 0 ? value / cost : null;
}

/** Value of one occurrence at each step of the offer, backward from its target (Bellman). */
export function stepValues(model: Model, client: SimClient): Map<StepKey, number> {
  const value = valueOf(model, client)?.amount ?? 0;
  const back = valueBackward(model.catalogue, client.offer, client.campaign.target, value, (play) => model.session.estimateLeg(play.id, client.brand.id));
  return new Map([...back.values].map(([k, v]) => [k, v.value]));
}

export interface ScopeFigures {
  spendCents: number;
  dailySpendCents: number[];
  /** Occurrences per outcome (lead state or object step), to date. */
  outcomes: Record<string, number>;
  /** Occurrences per outcome per day. */
  dailyOutcomes: Record<string, number[]>;
  /** Value of target outcomes reached, dollars, per day. */
  dailyValue: number[];
  value: number;
  roi: number | null;
  expectedRoi: number | null;
  /** Expected cost of one target outcome on today's estimates, dollars. */
  expectedCostPerTarget: number | null;
  leads: number;
  dailyLeads: number[];
}

/** Value of one target outcome across a set of campaigns: what was won per outcome, else the mean stated value. */
function meanTargetValue(model: Model, clients: readonly SimClient[], value: number, outcomes: Record<string, number>): number {
  const won = [...new Set(clients.map((c) => targetState(model, c)))].reduce((s, st) => s + (outcomes[st] ?? 0), 0);
  if (won > 0) return value / won;
  const vals = clients.map((c) => valueOf(model, c)?.amount ?? 0).filter((v) => v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

/** Money and outcomes of a set of campaigns, day by day. */
export function scopeFigures(model: Model, clients: readonly SimClient[]): ScopeFigures {
  const ids = new Set(clients.map((c) => c.campaign.id));
  const days = model.day;
  const dailySpendCents = new Array<number>(days).fill(0);
  model.result.days.forEach((d) => {
    for (const [cid, cents] of Object.entries(d.spendCents)) if (ids.has(cid)) dailySpendCents[d.day]! += cents;
  });
  const setup = model.result.runs.filter((r) => r.support && clients.some((c) => r.id === `run:setup:${c.brand.id}`));
  for (const r of setup) if (r.day < days) dailySpendCents[r.day]! += r.spendCents;
  const outcomes: Record<string, number> = {};
  const dailyOutcomes: Record<string, number[]> = {};
  const dailyValue = new Array<number>(days).fill(0);
  const valueByCampaign = new Map(clients.map((c) => [c.campaign.id, { state: targetState(model, c), value: valueOf(model, c)?.amount ?? 0 }]));
  for (const o of model.result.occurrences) {
    const lead = model.leadById.get(o.subject);
    if (!lead || !ids.has(lead.campaignId)) continue;
    outcomes[o.outcome] = (outcomes[o.outcome] ?? 0) + 1;
    const series = (dailyOutcomes[o.outcome] ??= new Array<number>(days).fill(0));
    if (o.day < days) series[o.day]! += 1;
    const v = valueByCampaign.get(lead.campaignId);
    if (v && v.state === o.outcome && o.day < days) dailyValue[o.day]! += v.value;
  }
  const dailyLeads = new Array<number>(days).fill(0);
  let leads = 0;
  for (const l of model.leads) {
    if (!ids.has(l.campaignId)) continue;
    leads++;
    if (l.createdDay < days) dailyLeads[l.createdDay]! += 1;
  }
  const spendCents = dailySpendCents.reduce((s, x) => s + x, 0);
  const value = dailyValue.reduce((s, x) => s + x, 0);
  let expWeighted = 0;
  let expSpend = 0;
  for (const c of clients) {
    const e = expectedRoi(model, c);
    const spent = model.session.spentCents(c.campaign.id) || c.campaign.dailyBudgetCents;
    if (e != null && e > 0) {
      expWeighted += e * spent;
      expSpend += spent;
    }
  }
  return {
    spendCents,
    dailySpendCents,
    outcomes,
    dailyOutcomes,
    dailyValue,
    value,
    roi: spendCents > 0 ? value / (spendCents / 100) : null,
    expectedRoi: expSpend > 0 ? expWeighted / expSpend : null,
    expectedCostPerTarget: expSpend > 0 && expWeighted > 0 ? meanTargetValue(model, clients, value, outcomes) / (expWeighted / expSpend) : null,
    leads,
    dailyLeads,
  };
}

export function cumulative(values: readonly number[]): number[] {
  let s = 0;
  return values.map((v) => (s += v));
}

/** Cost per outcome to date, day by day: cumulative spend / cumulative outcomes (null before the first). */
export function costPerOutcomeSeries(dailySpendCents: readonly number[], dailyOutcomes: readonly number[]): (number | null)[] {
  const spend = cumulative(dailySpendCents);
  const outs = cumulative(dailyOutcomes);
  return spend.map((s, i) => (outs[i]! > 0 ? s / 100 / outs[i]! : null));
}

// ---------------------------------------------------------------------------
// Pipes and options, from the runs
// ---------------------------------------------------------------------------

export interface Tally {
  spendCents: number;
  inputs: number;
  outputs: number;
  runs: number;
  lastDay: number | null;
}

export const emptyTally = (): Tally => ({ spendCents: 0, inputs: 0, outputs: 0, runs: 0, lastDay: null });

export function addRun(t: Tally, model: Model, run: LedgerRun): void {
  t.spendCents += run.spendCents;
  t.inputs += run.inputs ?? (run.consumed.length || 1);
  t.outputs += model.occurrencesByRun.get(run.id)?.length ?? 0;
  t.runs += 1;
  t.lastDay = Math.max(t.lastDay ?? 0, run.day);
}

export interface FlashMature {
  flash: Tally;
  mature: Tally;
  /** The pipe's maturity window, days. */
  windowDays: number;
  outcomesRequired: number;
  isMature: boolean;
}

/** Flash (every run to date) and mature (runs old enough for their outcomes) tallies of a set of runs. */
export function flashMature(model: Model, pipe: Pipe | undefined, runs: readonly LedgerRun[]): FlashMature {
  const windowDays = pipe?.maturity.durationDays ?? 0;
  const outcomesRequired = pipe?.maturity.outcomesRequired ?? 1;
  const flash = emptyTally();
  const mature = emptyTally();
  for (const r of runs) {
    addRun(flash, model, r);
    if (model.day - r.day >= windowDays) addRun(mature, model, r);
  }
  return { flash, mature, windowDays, outcomesRequired, isMature: mature.outputs >= outcomesRequired && mature.inputs > 0 };
}

export function rate(t: Tally): number | null {
  return t.inputs > 0 ? t.outputs / t.inputs : null;
}

export function costPerOutcome(t: Tally): number | null {
  return t.outputs > 0 ? t.spendCents / 100 / t.outputs : null;
}

export function runsOf(model: Model, filter: { campaignIds?: Set<string>; pipeId?: string }): LedgerRun[] {
  return model.result.runs.filter(
    (r) => r.pipeId && !r.support && (!filter.pipeId || r.pipeId === filter.pipeId) && (!filter.campaignIds || (r.campaignId && filter.campaignIds.has(r.campaignId))),
  );
}

/** The option a run used at a choice node. */
export function optionOfRun(run: LedgerRun, node: string): string | null {
  if (node === "workflow") return run.workflowId ?? null;
  if (node === "audience") return run.audienceId ?? null;
  if (node.startsWith("slot:")) return run.slotChoice?.[node.slice(5)] ?? null;
  return null;
}

/** The latest choice record of a node (for a campaign, or any campaign), with the share of picks. */
export function latestChoice(model: Model, node: string, pipeId: string | null, campaignId?: string): ChoiceRecord | null {
  for (let i = model.result.choices.length - 1; i >= 0; i--) {
    const c = model.result.choices[i]!;
    if (c.node === node && c.pipeId === pipeId && (!campaignId || c.campaignId === campaignId)) return c;
  }
  return null;
}

/** Share of picks per option over the last `days` days of a node's choice records. */
export function pickShares(model: Model, node: string, pipeId: string | null, campaignIds: Set<string> | null, days = 7): Map<string, number> {
  const from = model.day - days;
  const picks = new Map<string, number>();
  let total = 0;
  for (const c of model.result.choices) {
    if (c.node !== node || c.pipeId !== pipeId || c.day < from) continue;
    if (campaignIds && !campaignIds.has(c.campaignId)) continue;
    for (const o of c.options) {
      const n = node === "funnel" ? (o.id === c.chosenId ? 1 : 0) : o.picks;
      picks.set(o.id, (picks.get(o.id) ?? 0) + n);
      total += n;
    }
  }
  if (total > 0) for (const [k, v] of picks) picks.set(k, v / total);
  return picks;
}

/** The hidden true yield of an option on a pipe (base yield x its multiplier), for the Research page. */
export function trueYield(model: Model, pipeId: string, node: string, optionId: string): number | null {
  const base = model.world.truth.pipes.find((t) => t.pipeId === pipeId)?.baseYield;
  if (base == null) return null;
  if (node === "workflow") return base * (model.world.truth.workflows[optionId] ?? 1);
  if (node.startsWith("slot:")) return base * (model.world.truth.slotOptions[optionId] ?? 1);
  return base;
}

// ---------------------------------------------------------------------------
// Segments: the study behind discovered audiences
// ---------------------------------------------------------------------------

/** Every one-attribute split of a campaign's mature entry trials, with its verdict (noise, signal, conclusion). */
export function segmentStudy(model: Model, client: SimClient): { splits: SplitResult[]; records: number } {
  const plays = model.session.funnelOfCampaign(client.campaign.id) ?? [];
  const entry = playPipe(model.catalogue, plays[0] ?? "");
  if (!entry) return { splits: [], records: 0 };
  const matureAge = Math.max(entry.maturity.durationDays, 1);
  const records = model.leads
    .filter((l) => l.campaignId === client.campaign.id && l.audienceId && model.day - l.createdDay >= matureAge)
    .map((l) => ({
      attributes: l.attributes,
      success: l.timeline.some((e) => e.kind === "outcome" && e.pipeId === entry.id),
      stratum: `${l.brandId}|month-${Math.floor(l.createdDay / 30)}`,
    }));
  return { splits: evaluateSplits(records), records: records.length };
}

/** The furthest lead state a lead reached on a track (null = none yet). */
export function leadStateOn(model: Model, lead: SimLead, track: TrackDef): LeadStateDef | null {
  const rank = lead.states[track.id];
  if (!rank) return null;
  return track.states.filter((s) => s.rank <= rank).sort((a, b) => b.rank - a.rank)[0] ?? null;
}

/** Sales paths of the catalogue: chains of legs (step to step) from Start to a top lead state, any channel. */
export function salesPaths(catalogue: Catalogue, limit = 120): StepKey[][] {
  const legs = new Map<StepKey, Set<StepKey>>();
  for (const p of catalogue.pipes) {
    if (!catalogue.isPipeLive(p)) continue;
    const set = legs.get(p.from) ?? new Set<StepKey>();
    set.add(p.to);
    legs.set(p.from, set);
  }
  const tops = new Set(
    catalogue.steps
      .filter((s) => s.leadState && !catalogue.steps.some((x) => x.leadState?.leadTrack === s.leadState!.leadTrack && x.leadState.rank > s.leadState!.rank))
      .map((s) => s.key),
  );
  const out: StepKey[][] = [];
  const walk = (path: StepKey[]) => {
    if (out.length >= limit) return;
    const at = path[path.length - 1]!;
    if (tops.has(at) && path.length > 1) {
      out.push(path);
      return;
    }
    if (path.length > 5) return;
    for (const next of [...(legs.get(at) ?? [])].sort()) if (!path.includes(next)) walk([...path, next]);
  };
  walk([START]);
  return out.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

/** Why a choice went the way it went, in plain words, from its own options (never a raw id). */
export function explainChoice(model: Model, c: ChoiceRecord): string {
  const best = [...c.options].sort((a, b) => b.meanScore - a.meanScore || (a.id < b.id ? -1 : 1))[0];
  const chosen = optionLabel(model, c.node, c.chosenId);
  const money = (x: number) => (Number.isFinite(x) ? `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}` : "unbounded");
  if (!best) return `${chosen} was the only option.`;
  if (c.options.length === 1) return `${chosen} was the only option: ${money(best.meanScore)} back per $1 expected.`;
  if (best.id === c.chosenId) return `Highest expected value: ${money(best.meanScore)} back per $1 spent.`;
  return `Exploring: ${chosen} drew higher this time. Best expected is ${optionLabel(model, c.node, best.id)} at ${money(best.meanScore)} per $1.`;
}
