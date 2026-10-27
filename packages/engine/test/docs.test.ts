import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allocateBudget, buildLedger, censoredCounts, chainCostPerTarget, costForwardLine, stepBreakdown, pooledEstimate, valueBackwardLine } from "../src";
import { SimulationSession, worldFromData } from "../src";
import { acmeSession, acmeWorld } from "./acme";
import { RETIRED } from "./helpers";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/framework.md", import.meta.url)), "utf8");
const money = (raw: number) => {
  const x = Math.round(raw * 100) / 100;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const pct = (x: number, digits: number) => `${(x * 100).toFixed(digits)}%`;

describe("docs/framework.md", () => {
  it("has no em or en dash and none of the retired words", () => {
    expect(doc).not.toMatch(/[–—]/);
    for (const w of [/workflow/i, /lineage/i, /reporter/i, /dimension/i, /credence/i, /internal p(?:ipe)/i, /\bsettings?\b/i, /\bagency\b/i, ...RETIRED, /on demand/i, /\binputs?\b/i, /the engine/i]) expect(doc).not.toMatch(w);
  });

  it("defines every object of the model, and none of the words v5 removed", () => {
    for (const o of ["Outcome", "Unit", "Lead track", "Leg", "Bill of materials", "Script", "Run", "Specification", "Campaign", "Factory"]) expect(doc).toContain(`| **${o}** |`);
    expect(doc).toContain("**Material**");
    expect(doc).toMatch(/\*\*Specification\*\* \| New generic object\./);
    for (const w of ["`pull(specification, quantity, budget)`", "`push(unit, budget)`", "**Supplier rating**", "**Rating**", "**webhook**", "**production tree**", "**Target**", "## 4. The ledger is the common stock", "# GTM Factory v5"]) expect(doc).toContain(w);
    for (const w of [/\bpipes?\b/i, /\boptions?\b/i, /proactive\*\*/]) expect(doc).not.toMatch(w);
  });

  it("states the three owner decisions: a Target and a tree, scripts carrying their Bill of materials, the leg's contract", () => {
    expect(doc).toContain("fixes only its **Target**");
    expect(doc).toContain("rebuilt at every tick from performance");
    expect(doc).toContain("**The sales path and the sales funnel are views.**");
    expect(doc).toContain("declares its own Bill of materials");
    expect(doc).toContain("A script never calls anything itself.");
    expect(doc).toContain("A **Specification** addresses the outcome, never a producer.");
    expect(doc).toContain("leaves the subject waiting in the stock; the next tick retries");
  });

  it("the worked pull: Acme orders Meetings booked with $10 a day", () => {
    const s = acmeSession(12);
    const c = s.campaigns()[0]!;
    expect(c.dailyBudgetCents).toBe(1000);
    expect(c.target).toBe("meeting_booked");
    expect(doc).toContain("has the Target Meeting booked, starts from Start, with a daily budget of $10 and 20 new subjects a day");
    // Paul, the first lead: each Unit of his chain lands one tick after the run that made it.
    const booked = s.units.find((u) => u.outcome === "meeting_booked")!;
    const chain: Record<string, number> = {};
    for (let u: (typeof s.units)[number] | undefined = booked; u; ) {
      chain[u.outcome] = u.day;
      const subject: [string, string] | undefined = Object.entries(u.materials).find(([o]) => s.catalogue.outcome(o)?.subject === "lead");
      u = subject ? s.unit(subject[1]) : undefined;
    }
    expect(doc).toContain(`Paul's Lead found lands at tick **${chain.lead_found}**`);
    expect(doc).toContain(`his Lead identified lands at tick **${chain.lead_identified}**`);
    expect(doc).toContain(`his Verified email lands at tick **${chain.email_found}**`);
    expect(doc).toContain(`his Meeting booked lands at tick **${chain.meeting_booked}**`);
    expect(doc).toContain(`Acme spends **${money(s.days[3]!.spendCents[c.id]! / 100)}** that tick`);
    const writers = s.runs.filter((r) => r.legId === "writer");
    expect(s.units.filter((u) => u.outcome === "brand_context")).toHaveLength(1);
    expect(doc).toContain(`One Brand context was made for **${writers.length}** messages`);
    const researched = s.units.filter((u) => u.outcome === "company_researched").length;
    expect(doc).toContain(`**${researched}** Company researched Units served **${writers.length}** messages`);
  }, 60_000);

  it("the worked push: a reply pushed up to a Meeting booked", () => {
    const w = acmeWorld();
    const acme = w.clients[0]!;
    acme.campaigns = [
      { ...acme.campaigns[0]!, id: "acme-replies", name: "Replies for Acme", target: "reply_received" },
      { ...acme.campaigns[0]!, id: "acme-push", name: "Meetings from every reply", start: "reply_received", target: "meeting_booked", volume: undefined, dailyBudgetCents: 1000 },
    ];
    const s = new SimulationSession(worldFromData(w));
    s.run(12);
    expect(doc).toContain("has the Target Meeting booked and starts from Reply received: it is reactive");
    const first = s.pushes.find((p) => p.campaignId === "acme-push")!;
    const reply = s.unit(first.unitId)!;
    expect(first.day).toBe(reply.day);
    const reached = s.reachedBy(first.subject);
    expect(doc).toContain(`Tick **${reply.day}**: Lea's Reply received lands`);
    expect(doc).toContain(`Her Lead interested lands at tick **${reached.get("lead_interested")}**`);
    expect(doc).toContain(`her Meeting booked lands at tick **${reached.get("meeting_booked")}**`);
    const steps = s.attemptsOf(first.subject).filter((a) => a.campaignId === "acme-push");
    expect(steps.map((a) => `${a.from}>${a.to}`)).toEqual(["reply_received>lead_interested", "lead_interested>meeting_booked"]);
    expect(doc).toContain(`The push campaign spent **${money(steps.reduce((x, a) => x + a.spentCents, 0) / 100)}** on Lea`);
  }, 60_000);

  it("two calculations", () => {
    const legs = [
      { costPerAttempt: 1, yieldRate: 0.02 },
      { costPerAttempt: 2, yieldRate: 0.4 },
      { costPerAttempt: 10, yieldRate: 0.2 },
    ];
    for (const c of costForwardLine(legs)) expect(doc).toContain(`**${money(c)}**`);
    expect(doc).toContain(`**${(2100 / chainCostPerTarget(legs)).toFixed(1)}**`);
    const back = valueBackwardLine(legs, 2100).values;
    for (const v of back.slice(0, 3)) expect(doc).toContain(`**${money(v)}**`);
    expect(stepBreakdown(legs).map((l) => Math.round(l.attemptsPerTarget * 10) / 10)).toEqual([625, 12.5, 5]);
    expect(doc).toContain("the closing step makes 5 attempts on meetings, the booking step 12.5 on interested leads, the first step 625 from the market");
    expect(doc).toContain(`$2 / 0.4 = ${money(2 / 0.4)} per meeting`);
  });

  it("budget and the price of a dollar", () => {
    const r = allocateBudget([{ id: "a", valuePerDollar: 6, capacity: 300 }, { id: "b", valuePerDollar: 3, capacity: 1000 }], 500);
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
        { id: "r1", legId: "sourcing", target: "lead_found", day: 0, spendCents: 1000, consumed: [] },
        { id: "r2", legId: "email", target: "lead_interested", day: 1, spendCents: 600, consumed: ["o1", "o2", "o3"] },
        { id: "r3", legId: "email", target: "lead_interested", day: 2, spendCents: 300, consumed: ["o1"] },
        { id: "r4", legId: null, target: null, day: 0, spendCents: 500, consumed: [], support: { kind: "setup", reason: "setup" } },
        { id: "r5", legId: "email", target: "lead_interested", day: 4, spendCents: 200, consumed: [], abnormalLoss: "already interested" },
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
    expect(doc).toContain(`**${money(l.decide.find((d) => d.legId === "email")!.costPerInput!)}**`);
    expect(doc).toContain(`**${money(l.report.find((r) => r.outcome === "lead_interested")!.unitCost!)}**`);
  });
});
