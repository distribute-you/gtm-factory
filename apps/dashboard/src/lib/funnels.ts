/**
 * A sales funnel as pages draw it: its start outcome, then each leg with EVERY
 * pipe the leg runs through, in the order they run (the pipes feeding a side Material ride
 * beside the pipe they feed). The funnel line and the plays list read this one
 * model, so they always describe the same pipes.
 */

import { START, type Campaign, type LegPipe, type OutcomeId, type Pipe, type RankedFunnel, type SalesFunnel, type SalesPath } from "@gtm-factory/engine";
import type { Model } from "./model";

export interface LinePart {
  /** A pipe on the chain that carries the subject. */
  pipe: Pipe;
  /** Pipes feeding one of its Materials (or a Material of those), in the order they run. */
  side: Pipe[];
  /** What it makes. */
  output: OutcomeId;
}

export interface LineLeg {
  from: OutcomeId;
  to: OutcomeId;
  parts: LinePart[];
}

export interface FunnelLineModel {
  /** START (the market), or the outcome a reactive campaign starts from. */
  start: OutcomeId;
  legs: LineLeg[];
  path: SalesPath;
  /** Null while a leg has no play. */
  funnel: SalesFunnel | null;
}

function memo<T>(model: Model, key: string, f: () => T): T {
  if (model.memo.has(key)) return model.memo.get(key) as T;
  const v = f();
  model.memo.set(key, v);
  return v;
}

/** Turn a leg's pipes (providers first) into the parts a line draws. */
export function partsOf(model: Model, pipes: readonly LegPipe[]): LinePart[] {
  const byId = new Map(pipes.map((p) => [p.pipeId, p]));
  const anchor = (p: LegPipe): string | null => {
    let cur: LegPipe | undefined = p;
    for (let guard = 0; cur && !cur.main && guard < 50; guard++) cur = cur.feeds ? byId.get(cur.feeds.pipe) : undefined;
    return cur?.main ? cur.pipeId : null;
  };
  const parts: LinePart[] = [];
  const pending: Pipe[] = [];
  for (const lp of pipes) {
    const pipe = model.catalogue.pipe(lp.pipeId);
    if (!pipe) continue;
    if (lp.main) {
      parts.push({ pipe, side: pending.splice(0).filter((s) => anchor(byId.get(s.id)!) === pipe.id), output: lp.output });
    } else pending.push(pipe);
  }
  // A side pipe that feeds a main pipe drawn earlier (never in practice) is drawn beside the play.
  if (pending.length > 0 && parts.length > 0) parts[parts.length - 1]!.side.push(...pending);
  return parts;
}

/** The funnel a campaign runs today: its path, the play of each leg, every pipe each leg runs through. */
export function campaignLine(model: Model, campaign: Campaign): FunnelLineModel {
  return memo(model, `line:${campaign.id}`, () => {
    const s = model.session;
    const start = s.startOf(campaign);
    const pipes = s.campaignPipes(campaign);
    const legs = campaign.line.map((to, k) => ({ from: k === 0 ? start : campaign.line[k - 1]!, to, parts: partsOf(model, pipes[k] ?? []) }));
    return { start, legs, path: s.salesPathOf(campaign), funnel: s.salesFunnelOf(campaign) };
  });
}

/** A proposed funnel (not launched): each leg through its play, read on every campaign's picks. */
export function rankedLine(model: Model, funnel: RankedFunnel): FunnelLineModel {
  const start = funnel.line[0] ?? START;
  const line = funnel.line.slice(1);
  const legs = funnel.legs.map((l) => ({ from: l.from, to: l.to, parts: partsOf(model, model.session.legPipes(l.pipeId, l.from, null)) }));
  return {
    start,
    legs,
    path: model.catalogue.peekSalesPath(start, line),
    funnel: model.catalogue.peekSalesFunnel(start, line, funnel.legs.map((l) => l.pipeId)),
  };
}

/** A named sales funnel drawn on its own (its page): each leg through its play, on every campaign's picks. */
export function namedLine(model: Model, funnel: SalesFunnel): FunnelLineModel | null {
  const path = model.catalogue.salesPath(funnel.pathId);
  if (!path) return null;
  const legs = path.line.map((to, k) => {
    const from = k === 0 ? path.start : path.line[k - 1]!;
    const play = funnel.plays[k];
    return { from, to, parts: play ? partsOf(model, model.session.legPipes(play, from, null)) : [] };
  });
  return { start: path.start, legs, path, funnel };
}

/** Every pipe a line draws, once, in the order it draws them. */
export function linePipes(line: FunnelLineModel): Pipe[] {
  const out: Pipe[] = [];
  for (const l of line.legs) for (const p of l.parts) for (const x of [...p.side, p.pipe]) if (!out.some((o) => o.id === x.id)) out.push(x);
  return out;
}

/** Campaigns running a sales funnel today (or a sales path, any funnel of it). */
export function campaignsRunning(model: Model, id: string): Campaign[] {
  return model.campaigns.filter((c) => {
    const l = campaignLine(model, c);
    return l.funnel?.id === id || l.path.id === id;
  });
}
