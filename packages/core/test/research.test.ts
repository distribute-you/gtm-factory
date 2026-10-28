import { describe, expect, it } from "vitest";
import { SimulationSession, chanceOfBest, estimatedRegret } from "../src";
import { defaultWorld } from "./helpers";

describe("research figures read the beliefs only", () => {
  it("the chance to be the best sums to one and names a clear winner", () => {
    const c = chanceOfBest([
      { id: "a", rate: 0.1, rateSd: 0.01, cost: 1 },
      { id: "b", rate: 0.05, rateSd: 0.01, cost: 1 },
      { id: "c", rate: 0.04, rateSd: 0.03, cost: 1 },
    ]);
    expect(Object.values(c).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    expect(c.a).toBeGreaterThan(0.9);
    // Two candidates the Rating cannot tell apart: no clear winner.
    const even = chanceOfBest([
      { id: "a", rate: 0.05, rateSd: 0.02, cost: 1 },
      { id: "b", rate: 0.05, rateSd: 0.02, cost: 1 },
    ]);
    expect(Math.max(even.a!, even.b!)).toBeLessThan(0.6);
  });

  it("the estimated regret falls and the best's margin narrows as the Rating learns", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(30);
    const byDay = new Map<number, { regret: number; margins: number[] }>();
    for (const p of s.pickLog) {
      const r = estimatedRegret({ candidates: p.candidates });
      const d = byDay.get(p.day) ?? { regret: 0, margins: [] };
      d.regret += r.regretCents;
      if (r.bestMargin !== null) d.margins.push(r.bestMargin);
      byDay.set(p.day, d);
    }
    const sum = (from: number, to: number, f: (d: { regret: number; margins: number[] }) => number) => {
      let x = 0;
      for (let d = from; d < to; d++) x += f(byDay.get(d) ?? { regret: 0, margins: [] });
      return x;
    };
    expect(sum(23, 30, (d) => d.regret)).toBeLessThan(sum(1, 8, (d) => d.regret));
    const meanMargin = (from: number, to: number) => {
      const all: number[] = [];
      for (let d = from; d < to; d++) all.push(...(byDay.get(d)?.margins ?? []));
      return all.reduce((x, y) => x + y, 0) / Math.max(1, all.length);
    };
    expect(meanMargin(23, 30)).toBeLessThan(meanMargin(1, 8));
  }, 180_000);
});
