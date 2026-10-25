import { describe, expect, it } from "vitest";
import { attest, measureReliability, outcomeCoverage, type Evidence, type ReporterConnection } from "../src";

const policy = { referenceReporter: { meeting_booked: "crm" }, minReliability: 0.8 };

const connections: ReporterConnection[] = [
  { reporterId: "crm", clientId: "c1", outcomes: ["meeting_booked"] },
  { reporterId: "tracker", clientId: "c1", outcomes: ["meeting_booked"] },
  { reporterId: "judge", clientId: "c1", outcomes: ["meeting_booked"] },
  { reporterId: "crm", clientId: "c2", outcomes: ["meeting_booked"] },
  { reporterId: "tracker", clientId: "c3", outcomes: ["meeting_booked"] },
  { reporterId: "judge", clientId: "c4", outcomes: ["meeting_booked"] },
];

const ev = (reporterId: string, clientId: string, subject: string): Evidence => ({ reporterId, clientId, subject, outcome: "meeting_booked", day: 1 });

const evidence: Evidence[] = [
  ...Array.from({ length: 10 }, (_, i) => ev("crm", "c1", `s${i}`)),
  ...Array.from({ length: 4 }, (_, i) => ev("tracker", "c1", `s${i}`)),
  ...Array.from({ length: 6 }, (_, i) => ev("tracker", "c1", `x${i}`)),
  ...Array.from({ length: 10 }, (_, i) => ev("judge", "c1", `s${i}`)),
  ev("tracker", "c3", "y1"),
];

describe("evidence", () => {
  it("measures reliability as agreement with the reference", () => {
    const rel = measureReliability(evidence, connections, policy);
    const tracker = rel.find((r) => r.reporterId === "tracker")!;
    expect([tracker.agreements, tracker.reporterOnly, tracker.referenceOnly]).toEqual([4, 6, 6]);
    expect(tracker.reliability).toBeCloseTo(5 / 18, 12); // Beta(1 + 4, 1 + 12)
    const judge = rel.find((r) => r.reporterId === "judge")!;
    expect(judge.reliability).toBeCloseTo(11 / 12, 12); // Beta(1 + 10, 1 + 0)
    expect(rel.find((r) => r.reporterId === "crm")!.isReference).toBe(true);
  });

  it("counts a client only when a reliable reporter covers the outcome, never as 0", () => {
    const rel = measureReliability(evidence, connections, policy);
    const [cov] = outcomeCoverage(["c1", "c2", "c3", "c4"], ["meeting_booked"], connections, rel, policy);
    expect(cov!.counted).toEqual(["c1", "c2", "c4"]);
    expect(cov!.leftOut).toEqual(["c3"]); // only an unreliable reporter there
  });

  it("weights each occurrence by its reporters' reliability", () => {
    const rel = measureReliability(evidence, connections, policy);
    const att = attest(evidence, rel);
    const s0 = att.find((a) => a.subject === "s0")!;
    expect(s0.reporters).toEqual(["crm", "judge", "tracker"]);
    expect(s0.credence).toBeCloseTo(1, 12);
    const x0 = att.find((a) => a.subject === "x0")!;
    expect(x0.credence).toBeCloseTo(5 / 18, 12);
  });
});
