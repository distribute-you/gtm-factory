import { describe, expect, it } from "vitest";
import { SimulationSession, fictionalWorld, simulate } from "../src";
import { seedCatalogue, smallWorld } from "./helpers";

const ENTRY = "email|start_to_interested";
const BEST = "email-researched"; // hidden: 1.8x yield for 1.2x cost

function shareOfBest(days: { spendByWorkflow: Record<string, Record<string, number>> }[]): number {
  let best = 0;
  let total = 0;
  for (const d of days) {
    for (const [wf, cents] of Object.entries(d.spendByWorkflow[ENTRY] ?? {})) {
      total += cents;
      if (wf === BEST) best += cents;
    }
  }
  return total > 0 ? best / total : 0;
}

describe("simulator", () => {
  const result = simulate(smallWorld(2026), 60);

  it("the prioritizer's share of spend on the best hidden option rises over time", () => {
    const first = shareOfBest(result.days.slice(0, 10));
    const last = shareOfBest(result.days.slice(50, 60));
    expect(last).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(0.5);
  });

  it("is byte-identical on rerun with the same seed", () => {
    const again = simulate(smallWorld(2026), 60);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
    const other = simulate(smallWorld(7), 60);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(result));
  });

  it("produces runs, occurrences and a ledger that reconciles to the cent", () => {
    expect(result.runs.length).toBeGreaterThan(100);
    expect(result.occurrences.length).toBeGreaterThan(50);
    const l = result.ledger;
    expect(l.reconciles).toBe(true);
    expect(l.standardChargedCents - l.reuseGainCents + l.runsProducingNone.totalCents).toBe(l.totalSpendCents);
    expect(l.runsProducingNone.supportCents).toBe(2 * 5000);
    expect(l.report.find((r) => r.outcome === "paid_client")?.unitCost).toBeGreaterThan(0);
  });

  it("stays within each campaign's daily budget", () => {
    for (const d of result.days) for (const cents of Object.values(d.spendCents)) expect(cents).toBeLessThanOrEqual(10000);
  });

  it("logs every choice and why", () => {
    const nodes = new Set(result.choices.map((c) => c.node));
    for (const n of ["funnel", "workflow", "slot:template", "slot:llm", "audience"]) expect(nodes.has(n)).toBe(true);
    expect(result.choices.every((c) => c.reason.length > 0)).toBe(true);
  });

  it("one occurrence per lead state per lead", () => {
    const seen = new Set<string>();
    for (const o of result.occurrences) {
      const k = `${o.subject}|${o.outcome}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("measures reporters against the reference and leaves the unreliable one out", () => {
    const tracker = result.reliability.find((r) => r.reporterId === "tracker")!;
    expect(tracker.reliability).toBeLessThan(0.8);
    const crm = result.reliability.find((r) => r.reporterId === "crm" && r.outcome === "meeting_booked")!;
    expect(crm.isReference).toBe(true);
  });

  it("serves flash and mature views of a pipe for reports", () => {
    const s = new SimulationSession(smallWorld(2026));
    s.run(30);
    const v = s.pipeMaturity(ENTRY)!;
    expect(v.flash.trials).toBeGreaterThan(v.mature.trials);
    expect(v.mature.trials).toBeGreaterThan(0);
    expect(v.flash.spend).toBeGreaterThan(v.mature.spend);
  });

  it("a session can change the catalogue while it runs", () => {
    const s = new SimulationSession(smallWorld(5));
    s.run(10);
    s.catalogue.retire("workflows", "email-plain");
    const after = s.run(5);
    for (const d of after) expect(d.spendByWorkflow[ENTRY]?.["email-plain"] ?? 0).toBe(0);
  });
});

describe("fictional world on the seed catalogue", () => {
  it("runs from the real catalogue with fictional clients", () => {
    const world = fictionalWorld(seedCatalogue(), { seed: 11, clients: 3 });
    const s = new SimulationSession(world);
    const days = s.run(20);
    expect(days.length).toBe(20);
    const r = s.result();
    expect(r.ledger.reconciles).toBe(true);
    expect(Object.keys(days[19]!.funnelOf).length).toBe(3);
    expect(r.runs.length).toBeGreaterThan(0);
    // The last client stated no lifetime revenue: the fleet median stands in.
    expect(world.clients[2]!.offer.lifetimeRevenue).toBeUndefined();
  });
});
