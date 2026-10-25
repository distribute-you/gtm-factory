import { describe, expect, it } from "vitest";
import { buildLedger, solveUnitCosts, splitCents, type LedgerOccurrence, type LedgerRun } from "../src";

const occurrences: LedgerOccurrence[] = [
  { id: "o1", outcome: "lead_found", subject: "lead-1", runId: "r1", day: 0 },
  { id: "o2", outcome: "lead_found", subject: "lead-2", runId: "r1", day: 0 },
  { id: "o3", outcome: "lead_found", subject: "lead-3", runId: "r1", day: 0 },
  { id: "o4", outcome: "lead_interested", subject: "lead-1", runId: "r2", day: 3 },
];

const runs: LedgerRun[] = [
  { id: "r1", pipeId: "sourcing", target: "lead_found", day: 0, spendCents: 1000, consumed: [] },
  { id: "r2", pipeId: "email", target: "lead_interested", day: 1, spendCents: 600, consumed: ["o1", "o2", "o3"] },
  { id: "r3", pipeId: "email", target: "lead_interested", day: 2, spendCents: 300, consumed: ["o1"] },
  { id: "r4", pipeId: null, target: null, day: 0, spendCents: 500, consumed: [], support: { kind: "brand_setup", reason: "first setup" } },
  { id: "r5", pipeId: "email", target: "lead_interested", day: 4, spendCents: 200, consumed: ["o4"], abnormalLoss: "lead already interested" },
];

describe("ledger", () => {
  it("splits a run to the cent (largest remainder)", () => {
    expect(splitCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(splitCents(101, [1, 2])).toEqual([34, 67]);
    expect(splitCents(5, [0, 0])).toEqual([3, 2]);
  });

  it("reconciles to the cent: standard on occurrences - reuse gain + runs producing none = spend", () => {
    const l = buildLedger(runs, occurrences);
    expect(l.totalSpendCents).toBe(2600);
    expect(l.standardCents).toEqual({ o1: 334, o2: 333, o3: 333, o4: 600 });
    expect(l.consumptions).toEqual({ o1: 2, o2: 1, o3: 1, o4: 1 });
    expect(l.standardChargedCents).toBe(334 * 2 + 333 + 333 + 600); // 1934
    expect(l.reuseGainCents).toBe(334); // o1 reused once at its standard cost
    expect(l.runsProducingNone).toEqual({ normalLossCents: 300, abnormalLossCents: 200, supportCents: 500, totalCents: 1000 });
    expect(l.standardChargedCents - l.reuseGainCents + l.runsProducingNone.totalCents).toBe(l.totalSpendCents);
    expect(l.reconciles).toBe(true);
  });

  it("DECIDE reads each pipe's own cost per input and its yield", () => {
    const email = buildLedger(runs, occurrences).decide.find((d) => d.pipeId === "email")!;
    // r2 + r3 (normal loss included), r5 apart: $9 over 4 inputs, 1 output.
    expect(email).toEqual({ pipeId: "email", spendCents: 900, inputs: 4, outputs: 1, costPerInput: 2.25, yieldRate: 0.25, costPerOutcome: 9 });
  });

  it("REPORT prices every path: inputs at their own unit cost, normal loss absorbed", () => {
    const report = buildLedger(runs, occurrences).report;
    const found = report.find((r) => r.outcome === "lead_found")!;
    const interested = report.find((r) => r.outcome === "lead_interested")!;
    expect(found.unitCost).toBeCloseTo(10 / 3, 12);
    // ($9 own production + 4 leads consumed x $3.33) / 1
    expect(interested.unitCost).toBeCloseTo(9 + 4 * (10 / 3), 9);
  });

  it("solves a cycle (Neumann series)", () => {
    // u_A = (1 + 2 u_B) / 10, u_B = (0.5 + u_A) / 5  ->  u_A = u_B = 0.125
    const r = solveUnitCosts(
      ["A", "B"],
      new Map([["A", 10], ["B", 5]]),
      new Map([["A", 100], ["B", 50]]),
      new Map([["A", new Map([["B", 2]])], ["B", new Map([["A", 1]])]]),
    );
    expect(r.divergent).toEqual([]);
    expect(r.unit.get("A")).toBeCloseTo(0.125, 9);
    expect(r.unit.get("B")).toBeCloseTo(0.125, 9);
  });

  it("names a diverging cycle instead of pricing it", () => {
    const r = solveUnitCosts(
      ["A", "B"],
      new Map([["A", 1], ["B", 1]]),
      new Map([["A", 100], ["B", 100]]),
      new Map([["A", new Map([["B", 2]])], ["B", new Map([["A", 2]])]]),
      200,
    );
    expect(r.divergent.sort()).toEqual(["A", "B"]);
    expect(r.unit.size).toBe(0);
  });

  it("refuses a support run that produces something", () => {
    expect(() => buildLedger([{ ...runs[3]!, id: "rx" }], [{ id: "ox", outcome: "x", subject: "s", runId: "rx", day: 0 }])).toThrow(/support or abnormal/);
  });
});
