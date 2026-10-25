import { describe, expect, it } from "vitest";
import { createRng, discoverSegments, evaluateSplits, verdictOf, type SegmentRecord } from "../src";

describe("verdict rule", () => {
  it("conclusion: crude AND like-for-like pass under Bonferroni, same direction", () => {
    const s = { a: 30, b: 70, c: 10, d: 90 };
    const v = verdictOf({ a: 60, b: 140, c: 20, d: 180 }, [s, s], 1);
    expect(v.verdict).toBe("conclusion");
    expect(v.direction).toBe("better");
  });

  it("signal: the crude difference vanishes like for like (a mix effect)", () => {
    // Stratum A: 30% both sides. Stratum B: 5% both sides. The segment is mostly in A.
    const A = { a: 30, b: 70, c: 6, d: 14 };
    const B = { a: 1, b: 19, c: 5, d: 95 };
    const crude = { a: 31, b: 89, c: 11, d: 109 };
    const v = verdictOf(crude, [A, B], 1);
    expect(v.crudePValue).toBeLessThan(0.05);
    expect(v.likeForLike.oddsRatio).toBeCloseTo(1, 9);
    expect(v.verdict).toBe("signal");
  });

  it("noise: a leader under 5 outcomes, whatever the p-value", () => {
    const v = verdictOf({ a: 4, b: 0, c: 0, d: 100 }, [{ a: 4, b: 0, c: 0, d: 100 }], 1);
    expect(v.verdict).toBe("noise");
  });

  it("Bonferroni: the same p-value can conclude alone and not among many tests", () => {
    const s = { a: 25, b: 75, c: 12, d: 88 };
    const one = verdictOf(s, [s], 1);
    const many = verdictOf(s, [s], 50);
    expect(one.threshold).toBeCloseTo(0.05, 12);
    expect(many.threshold).toBeCloseTo(0.001, 12);
    expect(one.crudePValue).toBeLessThan(0.05);
    expect(many.verdict).toBe("noise");
  });
});

function world(seed: number): SegmentRecord[] {
  const rng = createRng(seed);
  const out: SegmentRecord[] = [];
  for (let i = 0; i < 6000; i++) {
    const country = ["France", "Germany", "Spain"][rng.int(3)]!;
    const size = ["small", "large"][rng.int(2)]!;
    const month = `m${rng.int(2)}`;
    const p = size === "large" ? 0.08 : country === "Spain" ? 0.01 : 0.03;
    out.push({ attributes: { country, size }, success: rng.bernoulli(p), stratum: `client-a|${month}` });
  }
  return out;
}

describe("segment discovery", () => {
  it("only tests splits holding at least 10 outcomes on each side", () => {
    const records: SegmentRecord[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ attributes: { x: "a" }, success: i < 9, stratum: "s" })),
      ...Array.from({ length: 50 }, (_, i) => ({ attributes: { x: "b" }, success: i < 20, stratum: "s" })),
    ];
    expect(evaluateSplits(records)).toEqual([]);
  });

  it("finds the planted winner, then the planted loser inside the rest", () => {
    const d = discoverSegments(world(3), { maxDepth: 2 });
    expect(d.winners[0]!.rule).toEqual({ size: ["large"] });
    expect(d.winners[0]!.split.verdict).toBe("conclusion");
    expect(d.losers.map((l) => l.rule)).toContainEqual({ size: ["small"], country: ["Spain"] });
  });
});
