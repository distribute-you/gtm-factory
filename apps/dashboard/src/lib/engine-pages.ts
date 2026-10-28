/**
 * Read models of the Research, Catalogue and Ledger pages. Figures only: pages divide
 * nothing. Nothing here knows an outcome or a script by name.
 */

import { OURS } from "@gtm-factory/core";
import { convergenceOf, engineName, pluggedAt, pointInfo, type Model, type PluggedInput, type PointConvergence, type PointInfo } from "./model";

export interface PointGroup {
  /** The consuming Engine's outcome, or "campaign" for the Target itself. */
  key: string;
  title: string;
  points: { info: PointInfo; conv: PointConvergence }[];
}

/** Candidate places grouped by the Engine that calls the outcome. */
export function pointGroups(model: Model, campaignIds: ReadonlySet<string> | null = null): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const conv of convergenceOf(model, campaignIds)) {
    const info = pointInfo(model.catalogue, conv.point);
    // Brand inputs (ICPs, templates) show on the row of the script that used them.
    if (info.kind !== "script") continue;
    const key = info.consumer;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, title: key === "campaign" ? "The campaign's Target" : `Called by ${engineName(model.catalogue, key)}`, points: [] }));
    g.points.push({ info, conv });
  }
  return [...groups.values()];
}

/** Share of picks on the candidate believed best over the last `days` days (null without picks). */
export function recentShare(conv: PointConvergence, days = 7): number | null {
  let p = 0;
  let b = 0;
  for (const d of conv.daily.slice(-days)) {
    p += d.picks;
    b += d.onBest;
  }
  return p > 0 ? b / p : null;
}

/** Engines called by two Engines or more, with the best script at each caller. */
export function multiPlugged(model: Model): { outcome: string; inputs: PluggedInput[] }[] {
  const out: { outcome: string; inputs: PluggedInput[] }[] = [];
  for (const o of model.catalogue.engines()) {
    const inputs = pluggedAt(model, o).filter((x) => x.info.kind === "script");
    if (inputs.length >= 2) out.push({ outcome: o, inputs });
  }
  return out;
}

export interface PerformerFigures {
  /** The "Performed by" value. */
  id: string;
  ours: boolean;
  scripts: string[];
  runs: number;
  units: number;
  spendCents: number;
}

/** What each performer ran (the "Performed by" tactic): its scripts, runs, Units and what it cost (our spend or an access cost). */
export function performerFigures(model: Model, runs = model.session.runs): PerformerFigures[] {
  const by = new Map<string, PerformerFigures>();
  const of = (id: string) => {
    let f = by.get(id);
    if (!f) by.set(id, (f = { id, ours: id === OURS, scripts: [], runs: 0, units: 0, spendCents: 0 }));
    return f;
  };
  for (const s of model.catalogue.scripts) of(String(s.tactics.performed_by ?? OURS)).scripts.push(s.id);
  const ids = runs === model.session.runs ? null : new Set(runs.map((r) => r.id));
  for (const r of runs) {
    const f = of(r.performedBy);
    f.runs++;
    f.spendCents += r.spendCents;
  }
  for (const u of model.session.units) if (!ids || (u.runId && ids.has(u.runId))) of(u.performedBy).units++;
  return [...by.values()].sort((a, b) => Number(b.ours) - Number(a.ours) || a.id.localeCompare(b.id));
}

/** The Units consumed most often: where the reuse gain of the ledger comes from. */
export function mostReused(model: Model, limit = 6, l = model.session.ledger()): { id: string; consumptions: number; standardCents: number }[] {
  return Object.entries(l.consumptions)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id, n]) => ({ id, consumptions: n, standardCents: l.standardCents[id] ?? 0 }));
}
