import { describe, expect, it } from "vitest";
import {
  betaMean,
  chiSquare1Survival,
  createRng,
  erfc,
  fisherExactTwoSided,
  fitPoolingStrength,
  hierarchicalPosterior,
  mantelHaenszel,
  pooledEstimate,
  pooledPosterior,
} from "../src";

describe("partial pooling", () => {
  it("worked example: fleet 2%, k = 200, client 3 of 50 gives 2.8%", () => {
    // (3 + 200 x 0.02) / (50 + 200) = 7 / 250
    expect(pooledEstimate({ successes: 3, trials: 50 }, { rate: 0.02, strength: 200 })).toBeCloseTo(0.028, 12);
    const p = pooledPosterior({ successes: 3, trials: 50 }, { rate: 0.02, strength: 200 });
    expect(p.alpha).toBeCloseTo(7, 12);
    expect(p.beta).toBeCloseTo(243, 12);
  });

  it("client data overtakes the fleet prior as trials accumulate", () => {
    const fleet = { rate: 0.02, strength: 200 };
    const clientRate = 0.03;
    const steps = [0, 50, 1000, 10000, 100000];
    const estimates = steps.map((n) => pooledEstimate({ successes: clientRate * n, trials: n }, fleet));
    expect(estimates[0]).toBeCloseTo(0.02, 12); // no data: the fleet rate
    expect(estimates[1]).toBeCloseTo(0.022, 12); // (1.5 + 4) / 250
    expect(estimates[2]).toBeCloseTo(34 / 1200, 12); // (30 + 4) / 1200
    expect(estimates[3]).toBeCloseTo(304 / 10200, 12);
    for (let i = 1; i < estimates.length; i++) expect(estimates[i]!).toBeGreaterThan(estimates[i - 1]!);
    expect(Math.abs(estimates[4]! - clientRate)).toBeLessThan(0.0001);
    expect(Math.abs(estimates[4]! - clientRate)).toBeLessThan(Math.abs(estimates[0]! - clientRate) / 50);
  });

  it("hierarchy: fleet -> channel -> client, each level the prior of the next", () => {
    const p = hierarchicalPosterior(
      [
        { successes: 200, trials: 10000, strength: 1 }, // fleet: 2%
        { successes: 30, trials: 1000, strength: 100 }, // channel
        { successes: 0, trials: 0, strength: 50 }, // a new client
      ],
      0.5,
    );
    const fleet = (200 + 0.5) / 10001;
    const channel = (30 + 100 * fleet) / 1100;
    expect(betaMean(p)).toBeCloseTo(channel, 12);
  });

  it("empirical Bayes fits k from the spread between groups", () => {
    // m = 0.2; sum n(r-m)^2 = 2; noise (G-1)m(1-m) = 0.16; tau2 = 1.84 / 100 = 0.0184
    // k = 0.16 / 0.0184 - 1 = 7.6957
    expect(fitPoolingStrength([{ successes: 10, trials: 100 }, { successes: 30, trials: 100 }])).toBeCloseTo(0.16 / 0.0184 - 1, 9);
  });

  it("groups that differ by noise only are pooled fully (k = total trials)", () => {
    expect(fitPoolingStrength([{ successes: 20, trials: 100 }, { successes: 20, trials: 100 }])).toBe(200);
  });
});

describe("exact and stratified tests", () => {
  it("Fisher two-sided on [[3,1],[1,3]] = 34/70", () => {
    expect(fisherExactTwoSided({ a: 3, b: 1, c: 1, d: 3 })).toBeCloseTo(34 / 70, 12);
  });

  it("Fisher two-sided on [[10,0],[0,10]] = 2 / C(20,10)", () => {
    expect(fisherExactTwoSided({ a: 10, b: 0, c: 0, d: 10 })).toBeCloseTo(2 / 184756, 15);
  });

  it("Mantel-Haenszel on one stratum [[10,20],[5,25]]", () => {
    // E[a] = 7.5, Var = 30*30*15*45 / (60^2 * 59) = 2.86017, X = 2.5^2 / Var = 2.18519
    const r = mantelHaenszel([{ a: 10, b: 20, c: 5, d: 25 }]);
    expect(r.oddsRatio).toBeCloseTo(2.5, 12);
    expect(r.statistic).toBeCloseTo(2.185185185, 8);
    expect(r.pValue).toBeCloseTo(0.139344, 5);
  });

  it("erfc and the chi-square survival", () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(1)).toBeCloseTo(0.157299207, 6);
    expect(chiSquare1Survival(3.841459)).toBeCloseTo(0.05, 5);
  });
});

describe("random numbers", () => {
  it("replay byte for byte from a seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 50 }, () => a.beta(2, 5));
    const ys = Array.from({ length: 50 }, () => b.beta(2, 5));
    expect(xs).toEqual(ys);
  });

  it("Beta draws have the right mean", () => {
    const r = createRng("beta");
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.beta(3, 7);
    expect(s / 20000).toBeCloseTo(0.3, 2);
  });
});
