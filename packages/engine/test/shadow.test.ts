import { describe, expect, test } from "vitest";
import { SHADOW_FORMAT, ShadowSession, SimulationSession, selfProduction, snapshotFromSimulation, validateSnapshot, type ShadowSnapshot } from "../src";
import { defaultWorld } from "./helpers";

// A fictional snapshot: the default fictional world played 40 days, read the way an exporter reads a real factory.
function fictionalSnapshot(): ShadowSnapshot {
  const sim = new SimulationSession(defaultWorld());
  sim.run(40);
  return selfProduction(snapshotFromSimulation(sim));
}

const SNAP = fictionalSnapshot();

describe("shadow mode on an observed world", () => {
  test("a snapshot holds no hidden truth and survives JSON", () => {
    const text = JSON.stringify(SNAP);
    expect(text).not.toContain("truthEnd");
    expect(text).not.toContain("truthMultiplier");
    expect(validateSnapshot(JSON.parse(text))).toEqual([]);
    expect(SNAP.format).toBe(SHADOW_FORMAT);
    expect(SNAP.observations.legs.length).toBeGreaterThan(0);
    expect(SNAP.observations.choices.length).toBeGreaterThan(0);
  });

  test("deterministic: the same snapshot gives the same report, byte for byte", () => {
    const a = new ShadowSession(JSON.parse(JSON.stringify(SNAP))).compute();
    const b = new ShadowSession(JSON.parse(JSON.stringify(SNAP))).compute();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("every client reconciles with its own books, and every running campaign gets recommendations", () => {
    const r = new ShadowSession(SNAP).compute();
    for (const c of r.clients) {
      expect(c.reconciliation.reconciles).toBe(true);
      expect(c.campaigns.length).toBeGreaterThan(0);
    }
    const views = r.clients.flatMap((c) => c.campaigns);
    for (const v of views) {
      expect(v.points.length).toBeGreaterThan(0);
      for (const p of v.points) {
        expect(p.options.map((o) => o.option)).toContain(p.engine);
        const share = p.options.reduce((s, o) => s + o.pickShare, 0);
        expect(share).toBeCloseTo(1, 6);
      }
    }
    expect(r.ledger.reconciles).toBe(true);
  });

  test("the engine reads the same beliefs as the simulation it shadows", () => {
    const sim = new SimulationSession(defaultWorld());
    sim.run(40);
    const shadow = new ShadowSession(selfProduction(snapshotFromSimulation(sim)));
    const r = shadow.compute();
    const view = r.clients[0]!.campaigns[0]!;
    const point = view.points.find((p) => p.options.length > 1 && p.kind === "script")!;
    const simBeliefs = sim.beliefsAt(point.point, view.campaignId);
    for (const o of point.options) {
      const s = simBeliefs.find((b) => b.option === o.option);
      if (!s) continue;
      expect(o.rate).toBeCloseTo(s.rate, 9);
      expect(o.cost).toBeCloseTo(s.cost, 9);
    }
  });

  test("a client that does not reconcile is shown with its gap, never with recommendations", () => {
    const snap = structuredClone(SNAP);
    const client = snap.clients[1]!;
    client.production.spendCents = { value: Math.round(client.production.spendCents!.value * 1.05), source: "test" };
    const r = new ShadowSession(snap).compute();
    const view = r.clients.find((c) => c.brandId === client.brand.id)!;
    expect(view.reconciliation.reconciles).toBe(false);
    expect(view.campaigns).toEqual([]);
    const spend = view.reconciliation.lines.find((l) => l.key === "spend")!;
    expect(spend.matches).toBe(false);
    expect(spend.relativeGap).toBeCloseTo(1 / 1.05 - 1, 3);
    expect(r.actions.some((a) => a.brandId === client.brand.id)).toBe(false);
  });

  test("a gap within the tolerance (1%) still reconciles; a client with no production figure does not", () => {
    const snap = structuredClone(SNAP);
    snap.clients[0]!.production.spendCents!.value = Math.round(snap.clients[0]!.production.spendCents!.value * 1.005);
    snap.clients[2]!.production = {};
    const r = new ShadowSession(snap).compute();
    expect(r.clients[0]!.reconciliation.reconciles).toBe(true);
    expect(r.clients[2]!.reconciliation.reconciles).toBe(false);
    expect(r.clients[2]!.reconciliation.missing).toContain("spend");
  });

  test("budgets: the same total is spread again by value per dollar, never more than twice today's per campaign", () => {
    const r = new ShadowSession(SNAP).compute();
    for (const c of r.clients) {
      const priced = c.campaigns.filter((v) => v.budget.valuePerDollar !== null && v.budget.todayCents > 0);
      const today = priced.reduce((s, v) => s + v.budget.todayCents, 0);
      const engine = priced.reduce((s, v) => s + v.budget.engineCents, 0);
      expect(engine).toBeLessThanOrEqual(today + priced.length);
      for (const v of priced) expect(v.budget.engineCents).toBeLessThanOrEqual(2 * v.budget.todayCents + 1);
    }
  });

  test("actions are read-only descriptions, one per differing choice, with plain labels", () => {
    const r = new ShadowSession(SNAP).compute();
    const ids = r.actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of r.actions) {
      expect(a.label.length).toBeGreaterThan(5);
      expect(a.label).not.toMatch(/undefined|NaN/);
    }
    const switches = r.actions.filter((a) => a.kind.startsWith("switch_") && a.kind !== "switch_funnel");
    for (const a of switches) expect(a.from).not.toBe(a.to);
  });

  test("a campaign with no observation still gets its points, priced on the fleet's beliefs", () => {
    const snap = structuredClone(SNAP);
    const camp = structuredClone(snap.clients[0]!.campaigns[0]!);
    camp.id = "fresh-campaign";
    camp.today = { legPipes: camp.today.legPipes, picks: {} };
    snap.clients[0]!.campaigns.push(camp);
    const r = new ShadowSession(snap).compute();
    const v = r.clients[0]!.campaigns.find((x) => x.campaignId === "fresh-campaign")!;
    expect(v.points.length).toBeGreaterThan(0);
    expect(v.spendCents).toBe(0);
  });

  test("a campaign whose last leg nobody completed still gets a priced funnel and a budget proposal, labelled expected", () => {
    const snap = structuredClone(SNAP);
    const c = snap.clients[0]!.campaigns.find((x) => x.line.length > 1)!;
    const last = c.line.length - 1;
    for (const l of snap.observations.legs) if (l.campaignId === c.id && l.legIndex === last) l.reached = 0;
    // Nobody in the fleet completed that leg either: only its default prices it.
    for (const l of snap.observations.legs) if (l.legIndex === last) l.reached = 0;
    snap.legPriors = [{ from: c.line[last - 1]!, to: c.line[last]!, yieldRate: 0.2, source: "a stated benchmark" }];
    const v = new ShadowSession(snap).compute().clients[0]!.campaigns.find((x) => x.campaignId === c.id)!;
    const leg = v.legs[last]!;
    expect(leg.priced.label).toBe("expected");
    expect(leg.priced.yieldRate).toBeGreaterThan(0);
    expect(v.budget.valuePerDollar).not.toBeNull();
    expect(v.budget.label).toBe("expected");
    expect(v.funnels.today).not.toBeNull();
    expect(v.funnels.today!.label).toBe("expected");
    expect(v.funnels.engine.length).toBeGreaterThan(0);
  });

  test("an option with 169 picks and no outcome reads well below the options that produce, and is still explored", () => {
    const snap = structuredClone(SNAP);
    snap.settings = { ...snap.settings, memoryHalfLifeDays: 0 };
    const client = snap.clients[0]!;
    const c = client.campaigns[0]!;
    const audience = snap.catalogue.outcomes.find((o) => o.contentType === "audience")!.id;
    const point = Object.keys(c.today.picks).find((p) => p.endsWith(`|${audience}`))!;
    const cells = snap.observations.choices.filter((x) => x.point === point && x.brandId === client.brand.id);
    const perDecision = cells.reduce((s, x) => s + x.costCents, 0) / Math.max(1, cells.reduce((s, x) => s + x.decisions, 0));
    client.objects.push({ outcome: audience, dynasty: "icp-silent", version: 1, name: "An ICP that never produced", text: "Nobody here answers." });
    client.objects.push({ outcome: audience, dynasty: "icp-new", version: 1, name: "An ICP never tried", text: "Not tried yet." });
    const days = [...new Set(cells.map((x) => x.day))].sort((a, b) => a - b);
    let left = 169;
    for (const day of days) {
      const n = Math.min(left, Math.ceil(169 / days.length));
      if (n <= 0) break;
      snap.observations.choices.push({ point, option: "icp-silent", brandId: client.brand.id, campaignId: c.id, day, decisions: n, successes: 0, failures: n, costCents: n * perDecision });
      left -= n;
    }
    const v = new ShadowSession(snap).compute().clients[0]!.campaigns.find((x) => x.campaignId === c.id)!;
    const p = v.points.find((x) => x.point === point)!;
    const silent = p.options.find((o) => o.option === "icp-silent")!;
    const producers = p.options.filter((o) => o.successes > 0);
    expect(silent.decisions).toBeCloseTo(169, 0);
    expect(producers.length).toBeGreaterThan(0);
    for (const o of producers) expect(silent.valuePerDollar).toBeLessThan(o.valuePerDollar / 2);
    expect(p.engine).not.toBe("icp-silent");
    // Exploration still happens through sampling: a never-tried option keeps a share of picks.
    expect(p.options.find((o) => o.option === "icp-new")!.pickShare).toBeGreaterThan(0);
  });
});
