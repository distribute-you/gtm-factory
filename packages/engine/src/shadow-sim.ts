/**
 * A snapshot of a simulated world, taken the way an exporter takes one of a
 * real factory: what each campaign runs today and aggregated observations,
 * never the hidden truth. Used to test shadow mode on fictional data, and to
 * show it on the public dashboard.
 */

import { START, type OutcomeId } from "./catalogue";
import { playPoint, type SimulationSession } from "./simulator";
import { SHADOW_FORMAT, type ChoiceCell, type LeadCell, type LegCell, type RunCell, type ShadowCampaign, type ShadowClient, type ShadowObject, type ShadowSnapshot, type StateCell } from "./shadow";

export interface SimulationSnapshotOptions {
  name?: string;
  /** The date of day 0 (ISO date). */
  firstDay?: string;
  /** Days a "today" pick looks back over (default 7). */
  recentDays?: number;
}

export function snapshotFromSimulation(session: SimulationSession, options: SimulationSnapshotOptions = {}): ShadowSnapshot {
  const world = session.world;
  const catalogue = session.catalogue;
  const recent = options.recentDays ?? 7;
  const today = session.day;
  const brandOfCampaign = new Map(session.campaigns().map((c) => [c.id, c.brandId]));

  // What each campaign runs today: the option with the most picks over the recent days.
  const picksByCampaign = new Map<string, Record<string, string>>();
  for (const { point, campaignId } of session.choicePoints()) {
    let best: string | null = null;
    let bestN = 0;
    for (const [o, arr] of session.pickSeries(point, campaignId)) {
      const n = arr.slice(-recent).reduce((x, y) => x + y, 0);
      if (n > bestN || (n === bestN && best !== null && n > 0 && o < best)) {
        best = o;
        bestN = n;
      }
    }
    if (!best) continue;
    const m = picksByCampaign.get(campaignId) ?? {};
    m[point] = best;
    picksByCampaign.set(campaignId, m);
  }

  const clients: ShadowClient[] = world.clients.map((c) => {
    const campaigns: ShadowCampaign[] = c.campaigns.map((camp) => {
      const picks = picksByCampaign.get(camp.id) ?? {};
      const legPipes = camp.line.map((to, k) => {
        const from = k === 0 ? (camp.entry.kind === "start" ? START : catalogue.trigger(camp.entry.triggerId)?.event ?? START) : camp.line[k - 1]!;
        return picks[playPoint(from, to)] ?? session.playsFor(camp, from, to)[0]?.id ?? null;
      });
      return { ...structuredClone(camp), today: { legPipes, picks } };
    });
    const objects: ShadowObject[] = [];
    for (const o of catalogue.outcomes) {
      if (o.subject !== "object") continue;
      for (const occ of session.objectVersions(c.brand.id, o.id)) {
        if (!occ.dynasty) continue;
        objects.push({
          outcome: o.id,
          dynasty: occ.dynasty,
          version: occ.version ?? 1,
          name: occ.name ?? occ.dynasty,
          text: occ.text ?? "",
          ...(occ.parentDynasty ? { parentDynasty: occ.parentDynasty } : {}),
          ...(occ.conditions ? { conditions: occ.conditions } : {}),
          ...(occ.scriptId ? { scriptId: occ.scriptId } : {}),
        });
      }
    }
    return { org: { ...c.org }, brand: structuredClone(c.brand), offers: [structuredClone(c.offer)], campaigns, objects, production: {} };
  });

  const legs: LegCell[] = session.legCells().map((x) => ({ campaignId: x.campaignId, legIndex: x.legIndex, day: x.day, attempts: x.t, reached: x.s, failed: x.f, costCents: x.c }));
  const choices: ChoiceCell[] = session.choiceCells().map((x) => ({ point: x.point, option: x.option, brandId: x.brandId, day: x.day, decisions: x.t, successes: x.s, failures: x.f, costCents: x.c }));

  // Runs, aggregated per (pipe, script, campaign, day).
  const producedBy = new Map<string, { n: number; outcome: OutcomeId; brandId: string }>();
  for (const o of session.occurrences) {
    const p = producedBy.get(o.runId) ?? { n: 0, outcome: o.outcome, brandId: o.brandId };
    p.n += o.quantity ?? 1;
    producedBy.set(o.runId, p);
  }
  const runCells = new Map<string, RunCell>();
  for (const r of session.runs) {
    const prod = producedBy.get(r.id);
    const brandId = (r.campaignId ? brandOfCampaign.get(r.campaignId) : undefined) ?? prod?.brandId;
    if (!brandId) continue;
    const key = [brandId, r.campaignId ?? "", r.pipeId ?? "", r.scriptId ?? "", r.day, r.support?.kind ?? ""].join("|");
    const cell = runCells.get(key) ?? { brandId, campaignId: r.campaignId ?? null, pipeId: r.pipeId, scriptId: r.scriptId ?? null, day: r.day, runs: 0, spendCents: 0, inputs: 0, outputs: 0, outcome: prod?.outcome ?? r.target, ...(r.support ? { support: r.support.kind } : {}), ...(r.factory ? { factory: r.factory } : {}) };
    cell.runs += 1;
    cell.spendCents += r.spendCents;
    cell.inputs += r.inputs ?? (r.consumed.length > 0 ? r.consumed.length : 1);
    cell.outputs += prod?.n ?? 0;
    runCells.set(key, cell);
  }
  const runs = [...runCells.values()];

  // Lead states: each lead counted once per outcome, on the campaign that brought it (ours) or none.
  const stateCells = new Map<string, StateCell>();
  const leadCells = new Map<string, LeadCell>();
  const tracked = new Set(catalogue.outcomes.filter((o) => o.track).map((o) => o.id));
  const mature = today - world.settings.splitMatureDays;
  for (const person of session.people()) {
    const reached = session.reachedBy(person.id);
    const ours = catalogue.factory(session.rootOf(person.id) ?? "")?.ours ?? false;
    const enrolled = session.campaignsOfSubject(person.id);
    for (const [outcome, day] of reached) {
      if (!tracked.has(outcome)) continue;
      const campaignId = ours ? enrolled.find((id) => session.campaign(id)?.line.includes(outcome)) ?? null : null;
      const key = [person.brandId, campaignId ?? "", outcome, day].join("|");
      const cell = stateCells.get(key) ?? { brandId: person.brandId, campaignId, outcome, day, leads: 0 };
      cell.leads += 1;
      stateCells.set(key, cell);
    }
    for (const a of session.attemptsOf(person.id)) {
      const camp = session.campaign(a.campaignId);
      if (a.legIndex !== 0 || !camp || camp.entry.kind !== "start" || a.startDay > mature) continue;
      const stratum = `${person.brandId}|month-${Math.floor(a.startDay / 30)}`;
      const key = [a.campaignId, stratum, JSON.stringify(person.values)].join("|");
      const cell = leadCells.get(key) ?? { campaignId: a.campaignId, legIndex: 0, values: { ...person.values }, stratum, served: 0, reached: 0 };
      cell.served += 1;
      if (reached.has(a.to)) cell.reached += 1;
      leadCells.set(key, cell);
    }
  }
  const states = [...stateCells.values()];

  return {
    format: SHADOW_FORMAT,
    name: options.name ?? `Snapshot of the simulation, day ${today}`,
    takenAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    firstDay: options.firstDay ?? "2026-01-01",
    today,
    catalogue: catalogue.snapshot(),
    clients,
    observations: { points: session.pointsOffered(), legs, choices, runs, states, leads: [...leadCells.values()] },
    settings: {
      ...(world.settings.memoryHalfLifeDays !== undefined ? { memoryHalfLifeDays: world.settings.memoryHalfLifeDays } : {}),
      clientGroupTactic: world.settings.clientGroupTactic,
      splitMatureDays: world.settings.splitMatureDays,
    },
  };
}

/**
 * Production figures of a snapshot computed from its own observations: what a
 * real exporter reads from production instead. For a fictional snapshot only.
 */
export function selfProduction(snapshot: ShadowSnapshot, source = "the simulation's own books"): ShadowSnapshot {
  const copy = structuredClone(snapshot);
  for (const c of copy.clients) {
    const b = c.brand.id;
    const spend = copy.observations.runs.filter((r) => r.brandId === b).reduce((s, r) => s + r.spendCents, 0);
    const outcomes: Record<OutcomeId, { value: number; source: string }> = {};
    for (const s of copy.observations.states) {
      if (s.brandId !== b) continue;
      const f = (outcomes[s.outcome] ??= { value: 0, source });
      f.value += s.leads;
    }
    c.production = { spendCents: { value: spend, source }, outcomes };
  }
  return copy;
}
