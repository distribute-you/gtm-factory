import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Catalogue, SimulationSession, worldFromData, type WorldData } from "@gtm-factory/engine";
import { buildDistributeWorld, translateCatalogue, type PublicCatalogue } from "../src";

const seed = (name: string) => fileURLToPath(new URL(`../../../seed/${name}`, import.meta.url));
const PUB = JSON.parse(readFileSync(seed("distribute-catalogue.json"), "utf8")) as PublicCatalogue;
const WORLD = JSON.parse(readFileSync(seed("distribute-world.json"), "utf8")) as WorldData;

describe("distribute.you's public catalogue in the framework's model", () => {
  test("every channel leg of the public catalogue is a pipe", () => {
    const t = translateCatalogue(PUB);
    const ids = new Set(t.catalogue.pipes.map((p) => p.id));
    let legs = 0;
    for (const c of PUB.channels) for (const tr of c.transitions) {
      legs++;
      expect(ids.has(`${c.slug}|${tr.legKey}`)).toBe(true);
    }
    expect(legs).toBeGreaterThan(80);
    expect(new Catalogue(t.catalogue).validate()).toEqual([]);
  });

  test("lead states are tracks; evidence steps are their state unless a pipe would loop on it", () => {
    const t = translateCatalogue(PUB);
    expect(t.outcomeOfStep("conversation")).toBe("lead_interested");
    expect(t.outcomeOfStep("signup")).toBe("lead_interested");
    expect(t.outcomeOfStep("website_visit")).toBe("lead_visited");
    expect(t.outcomeOfStep("booking_call")).toBe("booking_call");
    expect(t.outcomeOfStep("purchase")).toBe("purchase");
    const tracked = t.catalogue.outcomes.filter((o) => o.track).map((o) => o.id).sort();
    expect(tracked).toEqual(["lead_interested", "lead_visited", "meeting_attended", "meeting_booked", "paid_client"]);
    for (const p of t.catalogue.pipes) expect(p.inputs).not.toContain(p.output);
  });

  test("no production figure, no price and never the word agency", () => {
    const text = readFileSync(seed("distribute-catalogue.json"), "utf8") + readFileSync(seed("distribute-world.json"), "utf8");
    expect(text.toLowerCase()).not.toContain("agency");
    for (const k of ["emailDelivery", "meetingBookingGain", "meetingBookingBeforeAfter", "minimumMonthlyBudgetCents", "dailyOperatingCostCents", "deliveryRatePct", "costUsd", "roi"]) expect(text).not.toContain(`"${k}"`);
    expect(PUB.channels.some((c) => c.slug.startsWith("managed-"))).toBe(true);
  });

  test("the committed scenario is what the builder makes from the committed catalogue", () => {
    expect(JSON.parse(JSON.stringify(buildDistributeWorld(PUB)))).toEqual(WORLD);
  });

  test("the scenario plays: every running campaign spends and reaches the end of its first leg", () => {
    const world = worldFromData(WORLD);
    expect(world.catalogue.validate()).toEqual([]);
    const s = new SimulationSession(world);
    s.run(30);
    for (const c of s.campaigns()) {
      if (c.entry.kind !== "start") continue;
      expect(s.spentCents(c.id)).toBeGreaterThan(0);
      const reached = s.days.reduce((n, d) => n + (d.outcomes[c.id]?.[c.line[0]!] ?? 0), 0);
      expect(reached).toBeGreaterThan(0);
    }
  });
});
