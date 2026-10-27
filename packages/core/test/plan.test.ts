import { describe, expect, it } from "vitest";
import { SimulationSession, type PlanNode, type PlanTreeNode } from "../src";
import { defaultWorld } from "./helpers";

/** The node of an outcome in a Plan, searched depth first. */
function nodeOf(plan: PlanNode | null, outcome: string): PlanNode | null {
  if (!plan) return null;
  if (plan.outcome === outcome) return plan;
  for (const m of plan.materials) {
    const n = nodeOf(m, outcome);
    if (n) return n;
  }
  return null;
}

describe("the Plan is recomputed at every tick", () => {
  it("follows the best-rated script of each Engine and shifts when the ratings change", () => {
    const s = new SimulationSession(defaultWorld());
    const c = s.campaign("campaign-outbound")!;
    const pickedEachDay = (days: number) => {
      const seen: string[] = [];
      for (let d = 0; d < days; d++) {
        s.nextDay();
        seen.push(nodeOf(s.planOf(c), "reply_received")!.scriptId!);
      }
      return seen;
    };
    const share = (xs: string[], x: string) => xs.filter((y) => y === x).length / xs.length;
    const before = pickedEachDay(30);
    const settled = before[before.length - 1]!;
    expect(share(before.slice(-10), settled)).toBeGreaterThanOrEqual(0.7);
    // The Plan is the tree down to Start: the Target first, every Engine below it.
    const plan = s.planOf(c)!;
    expect(plan.outcome).toBe("paid_client");
    expect(nodeOf(plan, "lead_found")).not.toBeNull();
    // The world changes: the settled script stops working; the ratings follow, and the Plan with them.
    s.world.truth.scripts[settled]!.base = 0;
    const after = pickedEachDay(40);
    expect(share(after.slice(-10), settled)).toBeLessThanOrEqual(0.2);
  }, 180_000);

  it("a push hands each landed Unit of the start outcome to the next Engine of the Plan, the day it lands", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(25);
    const c = s.campaign("campaign-follow-ups")!;
    expect(c.start).toBe("message_sent");
    expect(s.isProactive(c)).toBe(false);
    const pushes = s.pushes.filter((p) => p.campaignId === c.id);
    expect(pushes.length).toBeGreaterThan(200);
    for (const p of pushes) expect(p.day).toBe(s.unit(p.unitId)!.day);
    // The first Engine above the pushed Unit is the follow-up, then the reply, then the Target.
    const orders = s.campaignOrders(c.id);
    for (const o of orders) expect(o.from).toBe("message_sent");
    const made = new Set(s.runs.filter((r) => r.campaignId === c.id && r.scriptId).map((r) => s.catalogue.script(r.scriptId!)!.outcome));
    expect(made.has("follow_up_queued")).toBe(true);
    expect(made.has("lead_interested")).toBe(true);
    expect(made.has("lead_found")).toBe(false);
    expect(s.milestoneLine(c)).toEqual(["reply_received", "lead_interested"]);
  }, 120_000);
});

describe("budget", () => {
  it("no campaign spends more than its daily budget", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(20);
    for (const d of s.days) for (const c of s.campaigns()) expect(d.spendCents[c.id] ?? 0, `${c.id} day ${d.day}`).toBeLessThanOrEqual(c.dailyBudgetCents);
    // No budget: Units are still pushed, nothing runs.
    const z = new SimulationSession(defaultWorld());
    z.setCampaignBudget("campaign-follow-ups", 0);
    z.run(10);
    expect(z.pushes.filter((p) => p.campaignId === "campaign-follow-ups").length).toBeGreaterThan(20);
    expect(z.runs.filter((r) => r.campaignId === "campaign-follow-ups" && r.spendCents > 0).length).toBe(0);
  }, 120_000);
});

/** Every node of a Plan tree, depth first. */
function nodesOf(n: PlanTreeNode | null): PlanTreeNode[] {
  if (!n) return [];
  return [n, ...n.branches.flatMap((b) => b.children.flatMap(nodesOf))];
}

describe("the Plan is shown as what ran", () => {
  it("a tree: every script that made Units is a branch, with its own Plan below, the pick of this tick marked", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(25);
    const c = s.campaign("campaign-outbound")!;
    const tree = s.planTree(c)!;
    expect(tree.outcome).toBe("paid_client");
    const all = nodesOf(tree);
    for (const n of all) {
      expect(n.branches.filter((b) => b.current).length, n.outcome).toBeLessThanOrEqual(1);
      const total = n.branches.reduce((x, b) => x + b.share, 0);
      if (n.branches.some((b) => b.units > 0)) expect(total, n.outcome).toBeCloseTo(1, 6);
    }
    // Two ways to a reply ran this week; the LinkedIn branch finds no email under it, the cold email branch does.
    const replies = all.filter((n) => n.outcome === "reply_received").flatMap((n) => n.branches);
    const li = replies.find((b) => b.scriptId === "li_connect");
    const mb = replies.find((b) => b.scriptId === "mb_replies");
    expect(li && mb).toBeTruthy();
    const below = (b: { children: PlanTreeNode[] }): string[] => b.children.flatMap((n) => [n.outcome, ...n.branches.flatMap(below)]);
    expect(below(li!)).not.toContain("email_found");
    expect(below(mb!)).toContain("email_found");
    // The brand inputs a script used ride on its branch: the ICP versions behind the people found.
    const sourcing = all.filter((n) => n.outcome === "lead_found").flatMap((n) => n.branches).filter((b) => b.runs > 0);
    const icp = sourcing.flatMap((b) => b.inputs).find((x) => x.material === "audience_built")!;
    expect(icp.versions.length).toBeGreaterThan(0);
    expect(icp.versions.reduce((x, v) => x + v.share, 0)).toBeCloseTo(1, 6);
    expect(s.inputsOf("src_filters", c.id)[0]?.material).toBe("audience_built");
  }, 120_000);

  it("what the subjects went through, milestone to milestone, by script", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(25);
    const f = s.flows(s.campaign("campaign-outbound")!);
    expect(f.length).toBeGreaterThan(2);
    const first = f.find((h) => h.from === "start" && h.to === "reply_received")!;
    expect(first.subjects).toBeGreaterThan(10);
    expect(first.by.reduce((x, b) => x + b.share, 0)).toBeCloseTo(1, 6);
    for (const h of f) expect(h.by.reduce((x, b) => x + b.subjects, 0)).toBeGreaterThanOrEqual(h.subjects);
  }, 120_000);
});
