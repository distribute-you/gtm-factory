/**
 * Read models of the engine pages (Research, Catalogue, Ledger). Figures only: pages divide
 * nothing. Nothing here knows an outcome, a pipe or a script by name.
 */

import type { PointConvergence } from "@gtm-factory/engine";
import { convergenceOf, pluggedAt, pointInfo, type Model, type PluggedInput, type PointInfo } from "./model";

export interface PointGroup {
  /** The consuming pipe's id, or "leg" for a leg's own choices. */
  key: string;
  title: string;
  points: { info: PointInfo; conv: PointConvergence }[];
}

/** Choice points grouped by the pipe that consumes the input (a leg's own choices together). */
export function pointGroups(model: Model): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const conv of convergenceOf(model)) {
    const info = pointInfo(model.catalogue, conv.point);
    const key = info.consumer?.id ?? "leg";
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, title: info.consumer?.name ?? "Plays of each leg", points: [] }));
    g.points.push({ info, conv });
  }
  return [...groups.values()];
}

/** Share of picks on the hidden best over the last `days` days (null without picks). */
export function recentShare(conv: PointConvergence, days = 7): number | null {
  let p = 0;
  let b = 0;
  for (const d of conv.daily.slice(-days)) {
    p += d.picks;
    b += d.onBest;
  }
  return p > 0 ? b / p : null;
}

/** Provider pipes plugged at two inputs or more, with the best script at each input. */
export function multiPlugged(model: Model): { pipeId: string; inputs: PluggedInput[] }[] {
  const out: { pipeId: string; inputs: PluggedInput[] }[] = [];
  for (const p of model.catalogue.pipes) {
    const inputs = pluggedAt(model, p.id).filter((x) => x.info.consumer);
    if (inputs.length >= 2) out.push({ pipeId: p.id, inputs });
  }
  return out;
}

export interface FactoryFigures {
  id: string;
  name: string;
  ours: boolean;
  pipes: string[];
  runs: number;
  occurrences: number;
  spendCents: number;
}

/** What each factory ran: its pipes, runs, occurrences and what it cost (our spend or an access cost). */
export function factoryFigures(model: Model): FactoryFigures[] {
  return model.catalogue.factories.map((f) => {
    const pipes = model.catalogue.pipes.filter((p) => p.factory === f.id).map((p) => p.id);
    let runs = 0;
    let spend = 0;
    for (const r of model.session.runs) {
      if (r.factory !== f.id) continue;
      runs++;
      spend += r.spendCents;
    }
    const occurrences = model.session.occurrences.filter((o) => o.factory === f.id).length;
    return { id: f.id, name: f.name, ours: f.ours, pipes, runs, occurrences, spendCents: spend };
  });
}

/** The occurrences consumed most often: where the reuse gain of the ledger comes from. */
export function mostReused(model: Model, limit = 6): { id: string; consumptions: number; standardCents: number }[] {
  const l = model.session.ledger();
  return Object.entries(l.consumptions)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id, n]) => ({ id, consumptions: n, standardCents: l.standardCents[id] ?? 0 }));
}
