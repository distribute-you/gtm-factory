import { describe, expect, it } from "vitest";
import { allocateUnits, createRng, prioritize, scoreOption, yieldPosterior, type ChoiceOption } from "../src";

describe("universal prioritizer", () => {
  it("one leg: score = y x value / cost", () => {
    const o: ChoiceOption = { id: "a", value: 162, legs: [{ posterior: { alpha: 2, beta: 98 }, costPerTrial: 1 }] };
    expect(scoreOption(o, [0.02])).toBeCloseTo(3.24, 12);
  });

  it("several legs: score = value / cost per target (the funnel formula)", () => {
    const funnel: ChoiceOption = {
      id: "f",
      value: 2100,
      legs: [
        { posterior: { alpha: 1, beta: 1 }, costPerTrial: 1 },
        { posterior: { alpha: 1, beta: 1 }, costPerTrial: 2 },
        { posterior: { alpha: 1, beta: 1 }, costPerTrial: 10 },
      ],
    };
    expect(scoreOption(funnel, [0.02, 0.4, 0.2])).toBeCloseTo(3, 12);
  });

  it("puts most units on the best option once the data is clear", () => {
    const options: ChoiceOption[] = [
      { id: "weak", value: 100, legs: [{ posterior: { alpha: 20, beta: 980 }, costPerTrial: 1 }] },
      { id: "strong", value: 100, legs: [{ posterior: { alpha: 40, beta: 960 }, costPerTrial: 1 }] },
    ];
    const picks = allocateUnits(options, 1000, createRng(7));
    expect(picks.get("strong")!).toBeGreaterThan(990);
  });

  it("explores an option it knows little about", () => {
    const options: ChoiceOption[] = [
      { id: "known", value: 100, legs: [{ posterior: { alpha: 200, beta: 9800 }, costPerTrial: 1 }] },
      { id: "new", value: 100, legs: [{ posterior: { alpha: 0.2, beta: 9.8 }, costPerTrial: 1 }] },
    ];
    const picks = allocateUnits(options, 2000, createRng(11));
    expect(picks.get("new")!).toBeGreaterThan(100);
    expect(picks.get("known")!).toBeGreaterThan(picks.get("new")!);
  });

  it("cost matters as much as yield: same yield, half the cost wins", () => {
    const options: ChoiceOption[] = [
      { id: "dear", value: 100, legs: [{ posterior: { alpha: 300, beta: 9700 }, costPerTrial: 2 }] },
      { id: "cheap", value: 100, legs: [{ posterior: { alpha: 300, beta: 9700 }, costPerTrial: 1 }] },
    ];
    expect(prioritize(options, createRng(1)).chosenId).toBe("cheap");
  });

  it("builds a posterior by pooling levels from fleet to client", () => {
    const p = yieldPosterior(
      [
        { counts: { successes: 100, trials: 5000 }, strength: 1 },
        { counts: { successes: 6, trials: 100 }, strength: 200 },
      ],
      0.05,
      2,
    );
    const fleet = (100 + 1 * 0.05) / 5001; // root prior 5%, worth 1 trial at the fleet level
    expect(p.alpha / (p.alpha + p.beta)).toBeCloseTo((6 + 200 * fleet) / 300, 12);
  });
});
