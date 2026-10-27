/**
 * The Plan as pages draw it. A campaign's Plan is the tree recomputed at every tick: from
 * its Target down, each outcome's Engine with the script it picks now, and the Plan of
 * each outcome that script calls. Pages show it as what ran this week (a tree: every
 * script that made Units is a branch); a list row keeps the one line of today's picks.
 */

import type { Campaign, OutcomeId, PlanNode, PlanTreeNode, ScriptInput } from "@gtm-factory/core";
import type { FlowView, TreeInput, TreeNode } from "@/components/plan-tree";
import { candidateLabel, outcomeLabel, previewPlan, type Model } from "./model";

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
  /** The milestones it passes through, start excluded, Target last. */
  line: OutcomeId[];
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
  return memo(model, `plan:${campaign.id}`, () => ({ start: campaign.start, parts: chainOf(model, model.session.planOf(campaign), campaign.start), line: model.session.milestoneLine(campaign) }));
}

/** The Plan a new campaign would run today, drawn as its line. */
export function draftPlanLine(model: Model, brandId: string, start: OutcomeId, target: OutcomeId): PlanLine & { plan: PlanNode | null } {
  const { plan, line } = previewPlan(model, brandId, start, target);
  return { plan, start, parts: chainOf(model, plan, start), line };
}

/** The brand inputs of a script as a page shows them. */
export function inputsView(model: Model, inputs: readonly ScriptInput[]): TreeInput[] {
  return inputs.map((i) => ({ label: outcomeLabel(model.catalogue, i.material), versions: i.versions.map((v) => ({ label: v.label, share: v.share })) }));
}

/** A campaign's Plan as the tree of what ran this week. */
export function planTreeOf(model: Model, campaign: Campaign): TreeNode | null {
  return memo(model, `tree:${campaign.id}`, () => {
    const view = (n: PlanTreeNode): TreeNode => ({
      outcome: n.outcome,
      label: outcomeLabel(model.catalogue, n.outcome),
      icon: model.catalogue.outcome(n.outcome)?.icon,
      candidates: n.candidates,
      branches: n.branches.map((b) => {
        const s = model.catalogue.script(b.scriptId);
        return { key: b.scriptId, name: s?.name ?? b.scriptId, kind: s?.kind ?? "rules", dynasty: s?.dynasty ?? b.scriptId, units: b.units, share: b.share, costPerUnit: b.costPerUnit, current: b.current, inputs: inputsView(model, b.inputs), sameBelow: b.sameBelow, children: b.children.map(view) };
      }),
    });
    const t = model.session.planTree(campaign);
    return t ? view(t) : null;
  });
}

/** What a campaign's subjects went through this week, milestone to milestone, by script. */
export function flowsOf(model: Model, campaign: Campaign): FlowView[] {
  return memo(model, `flows:${campaign.id}`, () =>
    model.session.flows(campaign).map((f) => ({
      from: f.from,
      fromLabel: outcomeLabel(model.catalogue, f.from),
      to: f.to,
      toLabel: outcomeLabel(model.catalogue, f.to),
      subjects: f.subjects,
      by: f.by.map((b) => ({ name: model.catalogue.script(b.scriptId)?.name ?? candidateLabel(model, "", b.scriptId), subjects: b.subjects, share: b.share })),
    })),
  );
}
