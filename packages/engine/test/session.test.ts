import { describe, expect, it } from "vitest";
import { SimulationSession, extendWorldWithPipe, fictionalWorld, type SimClient } from "../src";
import { seedCatalogue } from "./helpers";

describe("a running session", () => {
  it("serves its leads with a timeline of trials and outcomes", () => {
    const s = new SimulationSession(fictionalWorld(seedCatalogue(), { seed: 7, clients: 2 }));
    s.run(20);
    const leads = s.leads();
    expect(leads.length).toBeGreaterThan(0);
    for (const l of leads.slice(0, 50)) {
      expect(l.timeline[0]?.kind).toBe("trial");
      expect(l.timeline[0]?.day).toBe(l.createdDay);
    }
    const reached = leads.find((l) => l.timeline.some((e) => e.kind === "outcome" && e.occurrenceId));
    expect(reached).toBeDefined();
    const r = s.result();
    for (const run of r.runs.filter((x) => x.pipeId)) expect(run.campaignId).toBeDefined();
    expect(r.ledger.reconciles).toBe(true);
  });

  it("launches a client on the funnel it picked, and proposes funnels first", () => {
    const world = fictionalWorld(seedCatalogue(), { seed: 3, clients: 2 });
    const s = new SimulationSession(world);
    s.run(5);
    const offer = { id: "offer-new", brandId: "brand-new", name: "New offer", steps: [...world.clients[0]!.offer.steps], lifetimeRevenue: 5000 };
    const target = world.clients[0]!.campaign.target;
    const proposal = s.proposeFunnels(offer, target, { limit: 3 });
    expect(proposal.value).toBe(5000);
    expect(proposal.funnels.length).toBeGreaterThan(0);
    const picked = proposal.funnels[proposal.funnels.length - 1]!;
    const client: SimClient = {
      org: { id: "org-new", name: "New org" },
      brand: { id: "brand-new", orgId: "org-new", name: "New brand", icp: "Anyone" },
      offer,
      campaign: { id: "campaign-new", offerId: offer.id, target, dailyBudgetCents: 10000, status: "running", salesFunnel: picked.legs.map((l) => l.playId) },
      expertAudiences: [{ name: "Everyone", description: "Every lead.", rule: {} }],
    };
    s.addClient(client);
    s.run(3);
    expect(s.funnelOfCampaign("campaign-new")).toEqual(picked.legs.map((l) => l.playId));
    expect(s.spentCents("campaign-new")).toBeGreaterThan(0);
    s.setCampaignStatus("campaign-new", "paused");
    const before = s.spentCents("campaign-new");
    s.run(2);
    expect(s.spentCents("campaign-new")).toBe(before);
  });

  it("gives a pipe added while the world runs its workflows and truths", () => {
    const world = fictionalWorld(seedCatalogue(), { seed: 5, clients: 1 });
    const s = new SimulationSession(world);
    const any = world.catalogue.pipes[0]!;
    world.catalogue.add("pipes", { ...any, id: "new|pipe", name: "New pipe" });
    extendWorldWithPipe(world, "new|pipe");
    expect(world.catalogue.workflows.some((w) => w.pipeId === "new|pipe")).toBe(true);
    expect(world.truth.pipes.some((t) => t.pipeId === "new|pipe")).toBe(true);
    expect(world.catalogue.validate()).toEqual([]);
    s.run(2);
  });

  it("is deterministic with a launch in the middle", () => {
    const play = (seed: number) => {
      const s = new SimulationSession(fictionalWorld(seedCatalogue(), { seed, clients: 2 }));
      s.run(4);
      s.setCampaignBudget(s.clients[0]!.campaign.id, 5000);
      s.run(4);
      return JSON.stringify(s.result().days);
    };
    expect(play(11)).toBe(play(11));
  });
});
