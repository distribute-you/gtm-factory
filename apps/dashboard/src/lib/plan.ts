/**
 * The Plan as pages draw it. A campaign's Plan is the tree recomputed at every tick: from
 * its Target down, each outcome's Engine with the script it runs now, and the Plan of
 * each outcome that script calls. The line follows the chain that carries the subject,
 * from the start up to the Target; the tree shows every outcome, with the share and cost
 * per Unit of each script that actually made it over the last 7 days.
 */

import type { Campaign, OutcomeId, PlanNode, Routing } from "@gtm-factory/core";
import { previewPlan, type Model } from "./model";

/** One Engine on the chain that carries the subject: the script it runs now and every outcome that script calls. */
export interface ChainPart {
  outcome: OutcomeId;
  scriptId: string | null;
  /** Scripts competing there. */
  candidates: number;
  materials: PlanNode[];
}

export interface PlanLine {
  /** START (the market), or the outcome a reactive campaign starts from. */
  start: OutcomeId;
  /** Engines from the start up to the Target, in the order they run. */
  parts: ChainPart[];
  routing: Routing;
}

/** A branch of an outcome: one script's share of the Units it made over the last 7 days, and its cost per Unit. */
export interface PlanBranch {
  scriptId: string;
  units: number;
  share: number;
  costPerUnit: number | null;
}

function memo<T>(model: Model, key: string, f: () => T): T {
  if (model.memo.has(key)) return model.memo.get(key) as T;
  const v = f();
  model.memo.set(key, v);
  return v;
}

/** The chain that carries the subject in a Plan, start first. */
export function chainOf(model: Model, plan: PlanNode | null, start: OutcomeId): ChainPart[] {
  const parts: ChainPart[] = [];
  let node: PlanNode | undefined = plan ?? undefined;
  while (node && node.outcome !== start && node.scriptId) {
    parts.unshift({ outcome: node.outcome, scriptId: node.scriptId, candidates: node.candidates, materials: node.materials });
    node = node.materials.find((m) => model.catalogue.outcome(m.outcome)?.subject === "lead");
  }
  return parts;
}

/** A campaign's Plan this tick, drawn as its line. */
export function campaignPlanLine(model: Model, campaign: Campaign): PlanLine {
  return memo(model, `plan:${campaign.id}`, () => ({ start: campaign.start, parts: chainOf(model, model.session.planOf(campaign), campaign.start), routing: model.session.routingOf(campaign) }));
}

/** The Plan a new campaign would run today, drawn as its line. */
export function draftPlanLine(model: Model, brandId: string, start: OutcomeId, target: OutcomeId): PlanLine & { plan: PlanNode | null } {
  const { plan, line } = previewPlan(model, brandId, start, target);
  return { plan, start, parts: chainOf(model, plan, start), routing: model.catalogue.peekRouting(start, line) };
}

/** The scripts that made each outcome of a campaign over the last 7 days, by outcome. */
export function planBranches(model: Model, campaign: Campaign): Map<OutcomeId, PlanBranch[]> {
  return memo(model, `branches:${campaign.id}`, () => new Map(model.session.productionTree(campaign.id).map((t) => [t.outcome, t.branches])));
}

/** Campaigns whose Plan passes through a Routing today. */
export function campaignsOnRouting(model: Model, routingId: string): Campaign[] {
  return model.campaigns.filter((c) => campaignPlanLine(model, c).routing.id === routingId);
}
