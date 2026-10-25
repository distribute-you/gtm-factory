import { describe, expect, it } from "vitest";
import { START, allocateBudget, costForward, valueBackward, type Offer } from "../src";
import { smallCatalogue, workedEstimator } from "./helpers";

const offer: Offer = { id: "o", brandId: "b", name: "Offer", steps: ["interested", "booked", "paid"], lifetimeRevenue: 2100 };

describe("value backward", () => {
  it("worked example: V(paid) = 2100, V(booked) = 410, V(interested) = 162, V(start) = 2.24 per trial", () => {
    const r = valueBackward(smallCatalogue(), offer, "paid", 2100, workedEstimator);
    expect(r.converged).toBe(true);
    expect(r.values.get("paid")!.value).toBe(2100);
    expect(r.values.get("booked")!.value).toBeCloseTo(0.2 * 2100 - 10, 9); // 410
    expect(r.values.get("interested")!.value).toBeCloseTo(0.4 * 410 - 2, 9); // 162
    expect(r.values.get(START)!.value).toBeCloseTo(0.02 * 162 - 1, 9); // 2.24
    expect(r.values.get(START)!.valuePerDollar).toBeCloseTo(3.24, 9);
    expect(r.values.get("booked")!.valuePerDollar).toBeCloseTo(42, 9);
    expect(r.values.get(START)!.bestPlayId).toBe("email|start_to_interested#default");
  });

  it("an action that loses money is not taken (value 0)", () => {
    const r = valueBackward(smallCatalogue(), offer, "paid", 40, workedEstimator);
    // 0.2 x 40 - 10 < 0: better do nothing with a booked meeting.
    expect(r.values.get("booked")!.value).toBe(0);
    expect(r.values.get("booked")!.bestPlayId).toBeNull();
  });
});

describe("cost forward", () => {
  it("worked example: $50 per interested lead, $130 per meeting, $700 per paid client", () => {
    const c = costForward(smallCatalogue(), offer, workedEstimator);
    expect(c.get("interested")!.cost).toBeCloseTo(50, 9);
    expect(c.get("booked")!.cost).toBeCloseTo(130, 9);
    expect(c.get("paid")!.cost).toBeCloseTo(700, 9);
  });
});

describe("budget", () => {
  it("funds by value per dollar until the budget, the marginal action sets the shadow price", () => {
    const r = allocateBudget(
      [
        { id: "a", valuePerDollar: 6, capacity: 300 },
        { id: "b", valuePerDollar: 3, capacity: 1000 },
        { id: "c", valuePerDollar: 0.8, capacity: 1000 },
      ],
      500,
    );
    expect(r.funded).toEqual([
      { id: "a", amount: 300, valuePerDollar: 6 },
      { id: "b", amount: 200, valuePerDollar: 3 },
    ]);
    expect(r.shadowPrice).toBe(3);
    expect(r.unspent).toBe(0);
  });

  it("never funds an action returning less than a dollar per dollar", () => {
    const r = allocateBudget([{ id: "c", valuePerDollar: 0.8, capacity: 1000 }], 500);
    expect(r.funded).toEqual([]);
    expect(r.unspent).toBe(500);
    expect(r.shadowPrice).toBe(1);
  });
});
