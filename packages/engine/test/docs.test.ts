import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allocateBudget, buildLedger, censoredCounts, chainCostPerTarget, costForwardLine, legBreakdown, pooledEstimate, valueBackwardLine } from "../src";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/framework.md", import.meta.url)), "utf8");
const money = (raw: number) => {
  const x = Math.round(raw * 100) / 100;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const pct = (x: number, digits: number) => `${(x * 100).toFixed(digits)}%`;

describe("docs/framework.md", () => {
  it("has no em or en dash and none of the retired words", () => {
    expect(doc).not.toMatch(/[–—]/);
    for (const w of [/workflow/i, /lineage/i, /reporter/i, /dimension/i, /credence/i, /internal pipe/i, /\bsettings?\b/i, /\bagency\b/i]) expect(doc).not.toMatch(w);
  });

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
    expect(legBreakdown(legs).map((l) => Math.round(l.leadsNeeded * 10) / 10)).toEqual([625, 12.5, 5]);
    expect(doc).toContain("needs 5 meetings, the booking leg needs 12.5 interested leads, the first leg needs 625 attempts");
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
        { id: "r1", pipeId: "sourcing", target: "lead_found", day: 0, spendCents: 1000, consumed: [] },
        { id: "r2", pipeId: "email", target: "lead_interested", day: 1, spendCents: 600, consumed: ["o1", "o2", "o3"] },
        { id: "r3", pipeId: "email", target: "lead_interested", day: 2, spendCents: 300, consumed: ["o1"] },
        { id: "r4", pipeId: null, target: null, day: 0, spendCents: 500, consumed: [], support: { kind: "setup", reason: "setup" } },
        { id: "r5", pipeId: "email", target: "lead_interested", day: 4, spendCents: 200, consumed: [], abnormalLoss: "already interested" },
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
    expect(doc).toContain(`**${money(l.decide.find((d) => d.pipeId === "email")!.costPerInput!)}**`);
    expect(doc).toContain(`**${money(l.report.find((r) => r.outcome === "lead_interested")!.unitCost!)}**`);
  });
});
