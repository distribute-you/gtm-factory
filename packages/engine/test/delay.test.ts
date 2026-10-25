import { describe, expect, it } from "vitest";
import { censoredCounts, delayCdfAt, delayFromPmf, effectiveTrials, geometricDelay, maturityViews } from "../src";

describe("delay correction", () => {
  it("worked example: 100 emails 7 days old, 70% of replies due by day 7, 2 replies -> 2.86%", () => {
    const dist = { cdf: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.65, 0.7, 0.8, 0.9, 1] };
    const c = censoredCounts([{ ageDays: 7, trials: 100, successes: 2 }], dist);
    expect(c.trials).toBeCloseTo(70, 12);
    expect(c.successes / c.trials).toBeCloseTo(2 / 70, 12);
    // Without the correction: 2 / 100 = 2%, an underestimate by 30%.
  });

  it("mature cohorts count fully, today's cohort counts for its first day", () => {
    const dist = delayFromPmf([1, 1, 1, 1]);
    expect(dist.cdf).toEqual([0.25, 0.5, 0.75, 1]);
    expect(effectiveTrials([0, 1, 10], dist)).toBeCloseTo(0.25 + 0.5 + 1, 12);
    expect(delayCdfAt(dist, -1)).toBe(0);
  });

  it("geometric delay has the stated CDF", () => {
    const d = geometricDelay(1, 30); // q = 0.5
    expect(d.cdf[0]).toBeCloseTo(0.5, 6);
    expect(d.cdf[1]).toBeCloseTo(0.75, 6);
    expect(d.cdf[30]).toBe(1);
  });

  it("flash and mature views of one figure", () => {
    const v = maturityViews(
      [
        { ageDays: 30, trials: 100, successes: 3, spend: 100 },
        { ageDays: 25, trials: 100, successes: 2, spend: 100 },
        { ageDays: 2, trials: 100, successes: 0, spend: 100 },
      ],
      { durationDays: 21, outcomesRequired: 5 },
    );
    expect(v.flash).toEqual({ successes: 5, trials: 300, spend: 300 });
    expect(v.mature).toEqual({ successes: 5, trials: 200, spend: 200 });
    expect(v.isMature).toBe(true);
  });
});
