import { describe, expect, it } from "vitest";
import { chainCostPerTarget, enumerateSalesFunnels, rankSalesFunnels, type Offer, type PlayEstimator } from "../src";
import { seedCatalogue, smallCatalogue, workedEstimator } from "./helpers";

const allSteps: Offer = { id: "o", brandId: "b", name: "Offer", steps: ["interested", "booked", "paid", "visited", "signup"], lifetimeRevenue: 2100 };

describe("cost per target outcome", () => {
  it("worked example: $1 at 2%, $2 at 40%, $10 at 20% costs $700 per paid client", () => {
    // 10 / 0.2 = 50; 2 / 0.08 = 25; 1 / 0.0016 = 625; total 700
    expect(chainCostPerTarget([
      { costPerTrial: 1, yieldRate: 0.02 },
      { costPerTrial: 2, yieldRate: 0.4 },
      { costPerTrial: 10, yieldRate: 0.2 },
    ])).toBeCloseTo(700, 9);
  });

  it("ranks funnels cheapest per target first, with value per dollar", () => {
    const ranked = rankSalesFunnels(smallCatalogue(), allSteps, "paid", workedEstimator, 2100);
    expect(ranked.map((f) => f.steps.join(">"))).toEqual(["start>visited>signup>paid", "start>interested>booked>paid"]);
    expect(ranked[0]!.costPerTarget).toBeCloseTo(350, 9);
    expect(ranked[0]!.valuePerDollar).toBeCloseTo(6, 9);
    expect(ranked[1]!.costPerTarget).toBeCloseTo(700, 9);
    expect(ranked[1]!.valuePerDollar).toBeCloseTo(3, 9);
    const legs = ranked[1]!.legs;
    expect(legs.map((l) => l.inputsPerTarget)).toEqual([expect.closeTo(625, 9), expect.closeTo(12.5, 9), expect.closeTo(5, 9)]);
    expect(legs.map((l) => l.costPerTarget)).toEqual([expect.closeTo(625, 9), expect.closeTo(25, 9), expect.closeTo(50, 9)]);
  });

  it("an offer without a signup step never walks a signup", () => {
    const c = smallCatalogue();
    const noSignup: Offer = { ...allSteps, steps: ["interested", "booked", "paid", "visited"] };
    const ranked = rankSalesFunnels(c, noSignup, "paid", workedEstimator, 2100);
    expect(ranked.length).toBe(1);
    for (const f of ranked) expect(f.steps).not.toContain("signup");
  });

  it("on the full seed catalogue, a client whose offer has no signup step gets funnels, none through a signup", () => {
    const c = seedCatalogue();
    const flat: PlayEstimator = () => ({ costPerTrial: 1, yieldRate: 0.2, label: "expected" });
    const steps = c.steps.map((s) => s.key).filter((k) => k !== "signup");
    const offer: Offer = { id: "o-nosignup", brandId: "b", name: "Consulting retainer", steps, lifetimeRevenue: 12000 };
    const ranked = rankSalesFunnels(c, offer, "paid_client", flat, 12000, 200);
    expect(ranked.length).toBeGreaterThan(20);
    for (const f of ranked) {
      expect(f.steps).not.toContain("signup");
      expect(f.legs.every((l) => c.pipe(l.pipeId)!.from !== "signup" && c.pipe(l.pipeId)!.to !== "signup")).toBe(true);
    }
    // The same catalogue with a signup step does walk it.
    const withSignup: Offer = { ...offer, steps: [...steps, "signup"] };
    const all = rankSalesFunnels(c, withSignup, "paid_client", flat, 12000, 500);
    expect(all.some((f) => f.steps.includes("signup"))).toBe(true);
  });

  it("enumeration is lazy and in order", () => {
    const c = seedCatalogue();
    const offer: Offer = { id: "o", brandId: "b", name: "x", steps: c.steps.map((s) => s.key), lifetimeRevenue: 5000 };
    let i = 0;
    let previous = 0;
    for (const f of enumerateSalesFunnels(c, offer, "paid_client", (play) => ({ costPerTrial: 1 + (play.id.length % 7), yieldRate: 0.1 + (play.id.length % 5) / 10, label: "expected" }), 5000)) {
      expect(f.costPerTarget).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = f.costPerTarget;
      expect(new Set(f.steps).size).toBe(f.steps.length); // a straight line, no step twice
      if (++i >= 30) break;
    }
    expect(i).toBe(30);
  });

  it("a retired pipe leaves every funnel at once", () => {
    const c = smallCatalogue();
    c.retire("pipes", "site|visited_to_signup");
    const ranked = rankSalesFunnels(c, allSteps, "paid", workedEstimator, 2100);
    expect(ranked.map((f) => f.steps.join(">"))).toEqual(["start>interested>booked>paid"]);
  });
});
