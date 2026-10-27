import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Catalogue, SimulationSession, worldFromData, type WorldData } from "@gtm-factory/engine";
import { buildDistributeWorld, translateCatalogue, type PublicCatalogue } from "../src";

const seed = (name: string) => fileURLToPath(new URL(`../../../seed/${name}`, import.meta.url));
const PUB = JSON.parse(readFileSync(seed("distribute-catalogue.json"), "utf8")) as PublicCatalogue;
const WORLD = JSON.parse(readFileSync(seed("distribute-world.json"), "utf8")) as WorldData;

describe("distribute.you's public catalogue in the framework's model", () => {
  test("every channel's leg runs on a Leg, and the channel is a tactic of its scripts", () => {
    const t = translateCatalogue(PUB);
    const ids = new Set(t.catalogue.legs.map((p) => p.id));
    let transitions = 0;
    for (const c of PUB.channels) for (const tr of c.transitions) {
      transitions++;
      const legs = t.legsOf(c.slug, tr.legKey);
      expect(legs.length).toBeGreaterThan(0);
      for (const leg of legs) expect(ids.has(leg)).toBe(true);
    }
    expect(transitions).toBeGreaterThan(80);
    expect(t.catalogue.legs.length).toBeLessThan(transitions / 2);
    const channel = t.catalogue.tactics.find((x) => x.id === "channel")!;
    expect(channel.type).toEqual({ kind: "list", values: expect.arrayContaining(PUB.channels.map((c) => c.name)) });
    expect(new Catalogue(t.catalogue).validate()).toEqual([]);
    const world = buildDistributeWorld(PUB);
    for (const s of world.catalogue.scripts.filter((x) => !["llm", "template_writing", "icp_client", "icp_finder", "supplier_rating"].includes(x.legId))) expect(typeof s.tactics.channel).toBe("string");
  });

  test("each channel's script declares its own Bill of materials: scripts of one leg may need different Materials", () => {
    const world = buildDistributeWorld(PUB);
    const byLeg = new Map<string, Set<string>>();
    for (const s of world.catalogue.scripts) {
      const bill = s.materials.map((m) => m.outcome).sort().join(",");
      byLeg.set(s.legId, (byLeg.get(s.legId) ?? new Set()).add(bill));
    }
    expect([...byLeg.values()].some((bills) => bills.size > 1)).toBe(true);
    expect(new Catalogue(world.catalogue).validate()).toEqual([]);
  });

  test("lead states are tracks; evidence steps are their state, except where a leg would loop on it", () => {
    const t = translateCatalogue(PUB);
    expect(t.outcomeOfStep("conversation")).toBe("lead_interested");
    expect(t.outcomeOfStep("signup")).toBe("lead_interested");
    expect(t.outcomeOfStep("website_visit")).toBe("lead_visited");
    expect(t.outcomeOfStep("booking_call")).toBe("booking_call");
    expect(t.outcomeOfStep("purchase")).toBe("purchase");
    const tracked = t.catalogue.outcomes.filter((o) => o.track).map((o) => o.id).sort();
    expect(tracked).toEqual(["lead_interested", "lead_visited", "meeting_attended", "meeting_booked", "paid_client"]);
    for (const c of PUB.channels) for (const tr of c.transitions) for (const leg of t.legsOf(c.slug, tr.legKey)) expect(t.billOf(c.slug, tr.legKey, leg).map((m) => m.outcome)).not.toContain(t.catalogue.legs.find((l) => l.id === leg)!.output);
  });

  test("a reactive leg consumes what it reacts to; a delay is its scripts' waiting; a reported fact is a webhook's outcome", () => {
    const t = translateCatalogue(PUB);
    // Cold WhatsApp reacts to a number another system reports: that fact is in its script's Bill of materials.
    const wa = PUB.channels.find((c) => c.slug === "cold-whatsapp-outreach")!;
    const tr = wa.transitions.find((x) => x.consumes.includes("fact:whatsapp_number_given"))!;
    const given = t.legsOf(wa.slug, tr.legKey);
    expect(given.map((id) => t.billOf(wa.slug, tr.legKey, id)[0]!.outcome)).toEqual(["fact:whatsapp_number_given"]);
    const follow = PUB.channels.find((c) => c.slug === "ai-follow-up-email")!;
    const delayed = follow.transitions.find((x) => x.from === "website_visit" && x.to === "signup")!;
    expect(t.waitOf(follow.slug, delayed.legKey)).toBeCloseTo(30 / 1440, 3);
    const hot = t.catalogue.outcomes.find((o) => o.id === "fact:hot_lead")!;
    expect(hot.subject).toBe("lead");
    expect(t.catalogue.legs.find((p) => p.output === hot.id)!.webhook).toBe(true);
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

  test("the scenario plays: every running campaign spends and reaches the first lead state of its tree", () => {
    const world = worldFromData(WORLD);
    expect(world.catalogue.validate()).toEqual([]);
    const s = new SimulationSession(world);
    s.run(30);
    for (const c of s.campaigns()) {
      if (c.start !== "start") continue;
      expect(s.spentCents(c.id)).toBeGreaterThan(0);
      const first = s.pathOf(c)[0]!;
      const reached = s.days.reduce((n, d) => n + (d.outcomes[c.id]?.[first] ?? 0), 0);
      expect(reached).toBeGreaterThan(0);
    }
  });
});
