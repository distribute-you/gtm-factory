/**
 * A sales funnel (a view of a campaign's tree) as pages draw it: its start
 * outcome, then each step with every leg on the chain that carries the subject,
 * in the order they run; each leg carries the Bill of materials of the script
 * it runs, each Material with the leg that supplies it (the legs feeding a side
 * Material are drawn through that badge). The funnel line and the plays list
 * read this one model, so they always describe the same legs.
 */

import { START, type Campaign, type StepLeg, type OutcomeId, type Leg, type RankedFunnel, type SalesFunnel, type SalesPath } from "@gtm-factory/core";
import type { Model } from "./model";

export interface LinePart {
  /** A leg on the chain that carries the subject. */
  leg: Leg;
  /** Legs feeding one of its Materials (or a Material of those), in the order they run. */
  side: Leg[];
  /** What it makes. */
  output: OutcomeId;
  /** The script it runs most, and that script's Bill of materials with the leg supplying each Material (null: the stock or the step's start). */
  scriptId: string | null;
  materials: { material: OutcomeId; leg: string | null }[];
}

export interface LineStep {
  from: OutcomeId;
  to: OutcomeId;
  parts: LinePart[];
}

export interface FunnelLineModel {
  /** START (the market), or the outcome a reactive campaign starts from. */
  start: OutcomeId;
  steps: LineStep[];
  path: SalesPath;
  /** Null while a step has no play. */
  funnel: SalesFunnel | null;
}

function memo<T>(model: Model, key: string, f: () => T): T {
  if (model.memo.has(key)) return model.memo.get(key) as T;
  const v = f();
  model.memo.set(key, v);
  return v;
}

/** Turn a step's legs (providers first) into the parts a line draws. */
export function partsOf(model: Model, legs: readonly StepLeg[]): LinePart[] {
  const byId = new Map(legs.map((p) => [p.legId, p]));
  const anchor = (p: StepLeg): string | null => {
    let cur: StepLeg | undefined = p;
    for (let guard = 0; cur && !cur.main && guard < 50; guard++) cur = cur.feeds ? byId.get(cur.feeds.leg) : undefined;
    return cur?.main ? cur.legId : null;
  };
  const parts: LinePart[] = [];
  const pending: Leg[] = [];
  for (const lp of legs) {
    const leg = model.catalogue.leg(lp.legId);
    if (!leg) continue;
    if (lp.main) {
      parts.push({ leg, side: pending.splice(0).filter((s) => anchor(byId.get(s.id)!) === leg.id), output: lp.output, scriptId: lp.scriptId, materials: lp.materials });
    } else pending.push(leg);
  }
  // A side leg that feeds a main leg drawn earlier (never in practice) is drawn beside the play.
  if (pending.length > 0 && parts.length > 0) parts[parts.length - 1]!.side.push(...pending);
  return parts;
}

/** The funnel a campaign runs today: its path, the play of each step, every leg each step runs through. */
export function campaignLine(model: Model, campaign: Campaign): FunnelLineModel {
  return memo(model, `line:${campaign.id}`, () => {
    const s = model.session;
    const start = s.startOf(campaign);
    const legs = s.campaignLegs(campaign);
    const steps = s.stepsOf(campaign).map(({ from, to }, k) => ({ from, to, parts: partsOf(model, legs[k] ?? []) }));
    return { start, steps, path: s.salesPathOf(campaign), funnel: s.salesFunnelOf(campaign) };
  });
}

/** A proposed funnel (not launched): each step through its play, read on every campaign's picks. */
export function rankedLine(model: Model, funnel: RankedFunnel): FunnelLineModel {
  const start = funnel.line[0] ?? START;
  const line = funnel.line.slice(1);
  const steps = funnel.steps.map((l) => ({ from: l.from, to: l.to, parts: partsOf(model, model.session.stepLegs(l.legId, l.from, null)) }));
  return {
    start,
    steps,
    path: model.catalogue.peekSalesPath(start, line),
    funnel: model.catalogue.peekSalesFunnel(start, line, funnel.steps.map((l) => l.legId)),
  };
}

/** A named sales funnel drawn on its own (its page): each step through its play, on every campaign's picks. */
export function namedLine(model: Model, funnel: SalesFunnel): FunnelLineModel | null {
  const path = model.catalogue.salesPath(funnel.pathId);
  if (!path) return null;
  const steps = path.line.map((to, k) => {
    const from = k === 0 ? path.start : path.line[k - 1]!;
    const play = funnel.plays[k];
    return { from, to, parts: play ? partsOf(model, model.session.stepLegs(play, from, null)) : [] };
  });
  return { start: path.start, steps, path, funnel };
}

/** Every leg a line draws, once, in the order it draws them. */
export function lineLegs(line: FunnelLineModel): Leg[] {
  const out: Leg[] = [];
  for (const l of line.steps) for (const p of l.parts) for (const x of [...p.side, p.leg]) if (!out.some((o) => o.id === x.id)) out.push(x);
  return out;
}

/** Campaigns running a sales funnel today (or a sales path, any funnel of it). */
export function campaignsRunning(model: Model, id: string): Campaign[] {
  return model.campaigns.filter((c) => {
    const l = campaignLine(model, c);
    return l.funnel?.id === id || l.path.id === id;
  });
}
