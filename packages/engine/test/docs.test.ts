import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allocateBudget, buildLedger, censoredCounts, costForward, pooledEstimate, rankSalesFunnels, valueBackward, START, type Offer } from "../src";
import { smallCatalogue, workedEstimator } from "./helpers";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/framework.md", import.meta.url)), "utf8");
const money = (raw: number) => {
  const x = Math.round(raw * 100) / 100;
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const pct = (x: number, digits: number) => `${(x * 100).toFixed(digits)}%`;

describe("docs/framework.md worked examples match the engine", () => {
  it("has no em or en dash in prose", () => {
    expect(doc).not.toMatch(/[–—]/);
  });

  it("two calculations", () => {
    const c = smallCatalogue();
    const meetingOffer: Offer = { id: "o", brandId: "b", name: "x", steps: ["interested", "booked", "paid"], lifetimeRevenue: 2100 };
    const fwd = costForward(c, meetingOffer, workedEstimator);
    for (const [step, v] of [["interested", 50], ["booked", 130], ["paid", 700]] as const) {
      expect(fwd.get(step)!.cost).toBeCloseTo(v, 9);
      expect(doc).toContain(`**${money(v)}**`);
    }
    const back = valueBackward(c, meetingOffer, "paid", 2100, workedEstimator);
    expect(doc).toContain(`**${money(back.values.get("booked")!.value)}**`);
    expect(doc).toContain(`**${money(back.values.get("interested")!.value)}**`);
    expect(doc).toContain(`**${money(back.values.get(START)!.value)}**`);
    expect(doc).toContain(`**${money(back.values.get(START)!.valuePerDollar!)}**`);
    const all: Offer = { ...meetingOffer, steps: ["interested", "booked", "paid", "visited", "signup"] };
    const [b, a] = rankSalesFunnels(c, all, "paid", workedEstimator, 2100);
    expect(doc).toContain(`**${money(b!.costPerTarget)}**`);
    expect(doc).toContain(`**${b!.valuePerDollar.toFixed(1)}**`);
    expect(doc).toContain(`**${a!.valuePerDollar.toFixed(1)}**`);
    for (const l of a!.legs) expect(doc).toContain(`**${money(l.costPerTarget)}**`);
  });

  it("budget shadow price", () => {
    const r = allocateBudget([{ id: "a", valuePerDollar: 6, capacity: 300 }, { id: "b", valuePerDollar: 3, capacity: 1000 }], 500);
    expect(doc).toContain(`is worth **${money(r.shadowPrice)}**`);
  });

  it("partial pooling", () => {
    const prior = { rate: 0.02, strength: 200 };
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 3, trials: 50 }, prior), 1)}**`);
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 30, trials: 1000 }, prior), 2)}**`);
    expect(doc).toContain(`**${pct(pooledEstimate({ successes: 300, trials: 10000 }, prior), 2)}**`);
  });

  it("delay correction", () => {
    const counts = censoredCounts([{ ageDays: 7, trials: 100, successes: 2 }], { cdf: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 1] });
    expect(doc).toContain(`**${pct(counts.successes / counts.trials, 2)}**`);
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
    expect(doc).toContain(`**${money(l.runsProducingNone.totalCents / 100).replace(".00", "")}.00**`);
    expect(doc).toContain(`**${money(l.totalSpendCents / 100).replace(".00", "")}.00**`);
    const email = l.decide.find((d) => d.pipeId === "email")!;
    expect(doc).toContain(`**${money(email.costPerInput!)}**`);
    const interested = l.report.find((r) => r.outcome === "lead_interested")!;
    expect(doc).toContain(`**${money(Math.round(interested.unitCost! * 100) / 100)}**`);
  });
});
