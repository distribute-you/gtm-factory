import { describe, expect, it } from "vitest";
import { SimulationSession, meanRegret, regretByDay, runGraded } from "../src";
import { defaultWorld } from "./helpers";

/** Days 50 to 60, mean of the five seeds: the bound the Supplier rating must stay under. */
export const REGRET_BOUND = 0.05;

describe("regret: the value per dollar lost against always choosing the hidden best", () => {
  it("falls between days 0-10 and 50-60 on each of five seeds, and ends under the bound on average", () => {
    const start: number[] = [];
    const end: number[] = [];
    for (const seed of [11, 1, 2, 3, 4]) {
      const s = new SimulationSession(defaultWorld(seed));
      const r = regretByDay(s, runGraded(s, 60));
      const a = meanRegret(r, 0, 10)!;
      const b = meanRegret(r, 50, 60)!;
      expect(b, `seed ${seed}`).toBeLessThan(a);
      expect(b, `seed ${seed}`).toBeLessThan(0.1);
      start.push(a);
      end.push(b);
    }
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(mean(end)).toBeLessThan(REGRET_BOUND);
    expect(mean(end)).toBeLessThan(mean(start) / 3);
  }, 600_000);
});
