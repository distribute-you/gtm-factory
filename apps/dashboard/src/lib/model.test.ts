import { describe, expect, it } from "vitest";
import { buildModel, costPerOutcomeSeries, leadTracks, salesPaths, scopeFigures, segmentStudy, explainChoice } from "./model";
import { DEFAULT_SCENARIO, SCENARIOS, buildWorld, replay, type LoggedAction } from "./world";
import { audiencesFromIcp } from "./expert";
import { formatRatePct, formatRoi, formatUsd } from "./format";

describe("the world the dashboard plays", () => {
  it("replays the same history byte for byte", () => {
    const a = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, [], 12).session.result();
    const b = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, [], 12).session.result();
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
  });

  it("uses fictional clients only and opens with an unstated lifetime revenue", () => {
    for (const s of SCENARIOS) {
      const w = buildWorld(s, s.seed);
      expect(w.clients.length).toBe(s.clients);
      expect(w.clients.some((c) => c.offer.lifetimeRevenue === undefined)).toBe(true);
    }
  });

  it("replays logged actions on their day: launch, pause, catalogue edits", () => {
    const base = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, [], 3);
    const c = base.session.clients[0]!;
    const funnel = base.session.proposeFunnels(c.offer, c.campaign.target, { brandId: c.brand.id, limit: 1 }).funnels[0]!;
    const actions: LoggedAction[] = [
      {
        day: 3,
        action: {
          type: "launch",
          client: { ...c, campaign: { ...c.campaign, id: "campaign-x1", salesFunnel: funnel.legs.map((l) => l.playId) }, expertAudiences: [] },
        },
      },
      { day: 4, action: { type: "status", campaignId: c.campaign.id, status: "paused" } },
      { day: 4, action: { type: "retire", kind: "pipes", id: funnel.legs[0]!.pipeId } },
    ];
    const { session, applied } = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, actions, 8);
    expect(applied).toHaveLength(3);
    expect(session.clients.map((x) => x.campaign.id)).toContain("campaign-x1");
    expect(session.result().days[6]!.spendCents[c.campaign.id] ?? 0).toBe(0);
    const again = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, actions, 8).session.result();
    expect(JSON.stringify(again.days)).toBe(JSON.stringify(session.result().days));
  });
});

describe("read models", () => {
  const { world, session } = replay(DEFAULT_SCENARIO, DEFAULT_SCENARIO.seed, [], 30);
  const model = buildModel(world, session);

  it("names the lead tracks with the owner's word and never mixes them", () => {
    const tracks = leadTracks(model.catalogue);
    expect(tracks.map((t) => t.label)).toEqual(["CRM lifecycle track", "Website visits track"]);
    const states = tracks.flatMap((t) => t.states.map((s) => s.state));
    expect(new Set(states).size).toBe(states.length);
  });

  it("spend of every client adds up to the ledger to the cent", () => {
    const f = scopeFigures(model, model.clients);
    expect(f.spendCents).toBe(model.result.ledger.totalSpendCents);
    expect(model.result.ledger.reconciles).toBe(true);
  });

  it("counts every occurrence once, in the scope of its lead's campaign", () => {
    const all = scopeFigures(model, model.clients);
    const parts = model.clients.map((c) => scopeFigures(model, [c]));
    for (const [k, v] of Object.entries(all.outcomes)) expect(parts.reduce((s, p) => s + (p.outcomes[k] ?? 0), 0)).toBe(v);
    expect(Object.values(all.outcomes).reduce((s, x) => s + x, 0)).toBe(model.result.occurrences.length);
  });

  it("cost per outcome over time is null before the first outcome, never zero", () => {
    expect(costPerOutcomeSeries([100, 100, 100], [0, 0, 2])).toEqual([null, null, 1.5]);
  });

  it("finds sales paths from Start to a top lead state", () => {
    const paths = salesPaths(model.catalogue);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) expect(p[0]).toBe("start");
  });

  it("explains choices in words, never with a raw id", () => {
    for (const c of model.result.choices.slice(-50)) expect(explainChoice(model, c)).not.toMatch(/#default|\|/);
  });

  it("runs the segment study on mature leads", () => {
    const study = segmentStudy(model, model.clients[0]!);
    expect(study.records).toBeGreaterThan(0);
  });
});

describe("expert step and formats", () => {
  it("turns an ICP into 1 to 3 audiences", () => {
    expect(audiencesFromIcp("Founders of small software startups in Europe")).toHaveLength(3);
    expect(audiencesFromIcp("anyone").length).toBeGreaterThanOrEqual(1);
  });

  it("prints rates whole, a decimal only below 1%", () => {
    expect(formatRatePct(0.236)).toBe("24%");
    expect(formatRatePct(0.006)).toBe("0.6%");
    expect(formatRatePct(0.0004)).toBe("<0.1%");
    expect(formatRoi(3.42)).toBe("3.4×");
    expect(formatUsd(1234)).toBe("$1,234");
  });
});
