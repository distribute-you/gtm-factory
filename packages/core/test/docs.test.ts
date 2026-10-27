import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SimulationSession, allocateBudget, buildLedger, censoredCounts, chainCostPerTarget, costForwardLine, pooledEstimate, targetBreakdown, valueBackwardLine, type PlanNode } from "../src";
import { SCRIPTS_DIR, defaultWorld } from "./helpers";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const doc = read("../../../docs/framework.md");
const api = read("../../../docs/api.md");
const readme = read("../../../README.md");

const money = (raw: number) => {
  const x = Math.round(raw * 100) / 100;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const pct = (x: number, digits: number) => `${(x * 100).toFixed(digits)}%`;

describe("the words", () => {
  it("no dash, none of the retired words, and the product name is the only factory", () => {
    const retired = [/\bpipes?\b/i, /\blegs?\b/i, /\bsteps?\b/i, /\bplays?\b/i, /\bspecifications?\b/i, /\boptions?\b/i, /\bsales funnels?\b/i, /\bsales paths?\b/i, /(?<!GTM |-)\bfactor(y|ies)\b(?!-)/i];
    for (const [name, text] of [["framework.md", doc], ["api.md", api], ["README.md", readme]] as const) {
      expect(text, name).not.toMatch(/[–—]/);
      for (const w of retired) expect(text, `${name} ${w}`).not.toMatch(w);
    }
  });

  it("defines every object of the model and states the six decisions", () => {
    for (const o of ["Outcome", "Unit", "Engine", "Script", "Provider", "Run", "Campaign", "Plan", "Routing", "Track"]) expect(doc).toContain(`| **${o}** |`);
    expect(doc).toContain("# GTM Factory v6");
    expect(doc).toContain("1. **One Engine per outcome.**");
    expect(doc).toContain("2. **No written manifest.**");
    expect(doc).toContain("`get()`, with no argument");
    expect(doc).toContain("`pull()` and `push(unit)`");
    expect(doc).toContain("4. **Freshness is the script's job.**");
    expect(doc).toContain("5. **The names.** Engine, Provider, Plan, Routing, Track.");
    expect(doc).toContain("6. **\"Performed by\" is a tactic of scripts.**");
  });
});

describe("scripts are code", () => {
  it("the doc quotes the email lookup's code as it is, and the writer's re-get", () => {
    const lookup = readFileSync(`${SCRIPTS_DIR}email_found/ef_lookup/v1.ts`, "utf8");
    const body = lookup.slice(lookup.indexOf("export default function"));
    expect(doc).toContain(body.trim());
    expect(readFileSync(`${SCRIPTS_DIR}message_written/wr_short/v1.ts`, "utf8")).toContain('if (context.ageDays > 90) context = ctx.get("brand_context")');
    expect(doc).toContain('`if (context.ageDays > 90) context = ctx.get("brand_context")`');
  });
});

describe("the worked examples", () => {
  let s: SimulationSession;
  beforeAll(() => {
    s = new SimulationSession(defaultWorld());
    s.run(14);
  }, 60_000);

  it("a pull: the ads campaign's Plan, milestones, cost and return after 14 days", () => {
    expect(doc).toContain("After **14** days");
    expect(s.day).toBe(14);
    const c = s.campaign("campaign-ads")!;
    expect(c.target).toBe("meeting_booked");
    expect(c.start).toBe("start");
    expect(doc).toContain(`with a daily budget of ${money(c.dailyBudgetCents / 100)}`);
    expect(doc).toContain(`"${c.brief}"`);
    const value = s.targetValue(c).amount;
    expect(doc).toContain(`A meeting is worth **${money(value)}** to Northwind.`);
    const plan = s.planOf(c)!;
    const node = (n: PlanNode, o: string): PlanNode | undefined => (n.outcome === o ? n : n.materials.map((m) => node(m, o)).find(Boolean));
    const booked = node(plan, "meeting_booked")!;
    const interested = node(plan, "lead_interested")!;
    const visited = node(plan, "lead_visited")!;
    const icp = node(plan, "audience_built")!;
    expect([booked.scriptId, interested.scriptId, visited.scriptId, icp.scriptId]).toEqual(["bk_slots", "web_signup", "ad_search", null]);
    expect(s.catalogue.script("web_signup")!.tactics.performed_by).toBe("Client's team");
    expect(doc).toContain(`Meeting booked, made by the slot booking script (**${booked.candidates}** scripts compete)`);
    expect(doc).toContain(`Lead interested, made by the website signup, performed by the client's team (**${interested.candidates}** script)`);
    expect(doc).toContain(`Lead visited, made by the search ads script (**${visited.candidates}** scripts compete)`);
    expect(doc).toContain(`the ICP, served from the stock (**${icp.candidates}** ICP dynasties compete)`);
    expect(doc).toContain(`Its Routing is "${s.routingOf(c).name}".`);
    const costs = s.milestoneCosts(c);
    const label = (o: string) => s.catalogue.outcome(o)!.label;
    for (const m of costs) expect(doc).toContain(`| ${label(m.to)} | **${m.attemptsPerTarget!.toFixed(1)}** | **${money(m.costFromStart!)}** |`);
    const last = costs[costs.length - 1]!;
    expect(doc).toContain(`One meeting costs **${money(last.costFromStart!)}** from Start, so the expected return is ${money(value)} / ${money(last.costFromStart!)} = **${(value / last.costFromStart!).toFixed(1)}** dollars per dollar.`);
    expect(s.economics(c.id).expected.value!.toFixed(1)).toBe((value / last.costFromStart!).toFixed(1));
    expect(doc).toContain(`their cost of this outcome is ${money(costs.find((m) => m.to === "lead_interested")!.costOfOutcome!)}`);
  });

  it("a push: the first lead the follow-up campaign won", () => {
    const f = s.campaign("campaign-follow-ups")!;
    expect(f.start).toBe("message_sent");
    expect(f.target).toBe("lead_interested");
    expect(doc).toContain(`"${f.brief}"`);
    expect(doc).toContain(`Its Routing is "${s.routingOf(f).name}", and the next Engine its Plan names is ${s.catalogue.outcome(s.planOf(f)!.materials[0]!.materials[0]!.outcome)!.label}.`);
    const won = s.units.find((u) => u.outcome === "lead_interested" && u.campaignId === f.id)!;
    const push = s.pushes.find((p) => p.campaignId === f.id && p.subject === won.subject)!;
    const day = (o: string) => s.units.find((u) => u.subject === won.subject && u.outcome === o && (u.campaignId === f.id || o === "message_sent"))!.day;
    expect(push.day).toBe(day("message_sent"));
    expect(doc).toContain(`Day **${day("message_sent")}**: Lea's Message sent lands.`);
    expect(doc).toContain(`Day **${day("follow_up_queued")}**: the follow-up is queued.`);
    expect(day("reply_received")).toBe(won.day);
    expect(doc).toContain(`Day **${won.day}**: the mailbox reads Lea's reply`);
    const spent = s.ordersOf(won.subject).filter((o) => o.campaignId === f.id).reduce((x, o) => x + o.spentCents, 0);
    expect(doc).toContain(`The follow-up campaign spent **${money(spent / 100)}** on Lea.`);
    expect(doc).toContain(`"${s.catalogue.strategy(f.verdicts!.follow_up_queued!)!.name}"`);
  });

  it("regret: the bound the regret test holds", () => {
    const bound = /export const REGRET_BOUND = ([0-9.]+);/.exec(read("./regret.test.ts"))![1]!;
    expect(doc).toContain(`its mean over days 50 to 60 stays under **${bound}**`);
  });
});

describe("the calculations", () => {
  const line = [
    { costPerAttempt: 1, yieldRate: 0.02 },
    { costPerAttempt: 2, yieldRate: 0.4 },
    { costPerAttempt: 10, yieldRate: 0.2 },
  ];

  it("costs forward, values backward, attempts per Target", () => {
    for (const c of costForwardLine(line)) expect(doc).toContain(`**${money(c)}**`);
    expect(doc).toContain(`$2,100 / $700 = **${(2100 / chainCostPerTarget(line)).toFixed(1)}**`);
    for (const v of valueBackwardLine(line, 2100).values.slice(0, 3)) expect(doc).toContain(`**${money(v)}**`);
    const a = targetBreakdown(line).map((l) => Math.round(l.attemptsPerTarget * 10) / 10);
    expect(doc).toContain(`**attempts per Paid client** are ${a[2]} on meetings, ${a[1]} on interested leads and ${a[0]} from the market`);
    expect(doc).toContain(`$2 / 0.4 = ${money(2 / 0.4)} per meeting`);
  });

  it("budget and the price of a dollar", () => {
    const r = allocateBudget([{ id: "a", valuePerDollar: 6, capacity: 300 }, { id: "b", valuePerDollar: 3, capacity: 1000 }], 500);
    expect(r.funded.map((f) => f.amount)).toEqual([300, 200]);
    expect(doc).toContain(`is worth **${money(r.dollarPrice)}**`);
  });

  it("pooling", () => {
    const prior = { rate: 0.02, strength: 200 };
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 3, trials: 50 }, prior), 1)}**`);
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 30, trials: 1000 }, prior), 2)}**`);
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 300, trials: 10000 }, prior), 2)}**`);
  });

  it("delays", () => {
    const c = censoredCounts([{ ageDays: 7, trials: 100, successes: 2 }], { cdf: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 1] });
    expect(doc).toContain(`**${pct(c.successes / c.trials, 2)}**`);
  });

  it("ledger reconciliation", () => {
    const l = buildLedger(
      [
        { id: "r1", engine: "lead_found", target: "lead_found", day: 0, spendCents: 1000, consumed: [] },
        { id: "r2", engine: "email", target: "lead_interested", day: 1, spendCents: 600, consumed: ["o1", "o2", "o3"] },
        { id: "r3", engine: "email", target: "lead_interested", day: 2, spendCents: 300, consumed: ["o1"] },
        { id: "r4", engine: null, target: null, day: 0, spendCents: 500, consumed: [], support: { kind: "setup", reason: "setup" } },
        { id: "r5", engine: "email", target: "lead_interested", day: 4, spendCents: 200, consumed: [], abnormalLoss: "already interested" },
      ],
      [
        { id: "o1", outcome: "lead_found", subject: "l1", runId: "r1", day: 0 },
        { id: "o2", outcome: "lead_found", subject: "l2", runId: "r1", day: 0 },
        { id: "o3", outcome: "lead_found", subject: "l3", runId: "r1", day: 0 },
        { id: "o4", outcome: "lead_interested", subject: "l1", runId: "r2", day: 3 },
      ],
    );
    expect(l.reconciles).toBe(true);
    expect(doc).toContain(`**${money(l.standardChargedCents / 100)}**`);
    expect(doc).toContain(`**${money(l.reuseGainCents / 100)}**`);
    expect(doc).toContain(`**$${(l.runsProducingNone.totalCents / 100).toFixed(2)}**`);
    expect(doc).toContain(`**$${(l.totalSpendCents / 100).toFixed(2)}**`);
    expect(doc).toContain(`**${money(l.decide.find((d) => d.engine === "email")!.costPerInput!)}**`);
    expect(doc).toContain(`**${money(l.report.find((r) => r.outcome === "lead_interested")!.unitCost!)}**`);
  });
});
