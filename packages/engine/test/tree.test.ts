import { describe, expect, it } from "vitest";
import { SimulationSession, START, worldFromData, type WorldData } from "../src";
import { worldData } from "./helpers";

/** Brand-4 alone, one script per leg, its campaign free to pick any channel: cold email or ads both reach an interested lead. */
function freeWorld(): WorldData {
  const w = worldData();
  const keep = new Set(["rating_pooled", "offer_client", "icp_client_states", "tpl_copywriter", "ctx_full", "glm", "gemini_pro", "src_filters", "id_merge", "ef_lookup", "cr_site", "wr_research", "ce_morning", "mb_send", "mb_replies", "rj_ai", "ad_search", "web_signup"]);
  for (const s of w.catalogue.scripts) if (!keep.has(s.id)) s.status = "retired";
  const c = w.clients.find((x) => x.brand.id === "brand-4")!;
  c.seeds = c.seeds.filter((s) => s.dynasty === "offer" || s.dynasty === "icp-client" || s.dynasty === "tpl-story");
  c.campaigns = [{ ...c.campaigns[0]!, conditions: [], target: "lead_interested", dailyBudgetCents: 3000 }];
  c.offer.outcomeValues = { lead_interested: 40 };
  w.clients = [c];
  w.settings = { ...w.settings, splitEveryDays: 1000 };
  return w;
}

describe("the production tree is rebuilt at every tick", () => {
  it("follows the best-rated way up and shifts when the ratings change", () => {
    const s = new SimulationSession(worldFromData(freeWorld()));
    const c = s.campaigns()[0]!;
    const firstStep = (days: number) => {
      const seen: string[] = [];
      for (let d = 0; d < days; d++) {
        s.step();
        seen.push(s.nextOf(c, START)!);
      }
      return seen;
    };
    const before = firstStep(40);
    const settled = before[before.length - 1]!;
    const share = (xs: string[], x: string) => xs.filter((y) => y === x).length / xs.length;
    expect(share(before.slice(-10), settled)).toBeGreaterThanOrEqual(0.7);
    // The world changes: the way up the tree settled on stops working; the ratings follow, and the tree with them.
    for (const p of s.playsFor(c, START, settled)) s.world.truth.legs[p.id]!.base = 0;
    const after = firstStep(60);
    expect(share(after.slice(-15), settled)).toBeLessThanOrEqual(0.2);
  }, 120_000);

  it("a reactive campaign pushes a landed Unit up: each step goes from the lead state it holds to the next one toward the Target", () => {
    const w = worldData();
    // A second way up from an interested lead: the client's team closes at once (rarely).
    w.catalogue.legs.push({ id: "quick_close", name: "Your team closes at once", output: "paid_client", factory: "client_team", maturity: { durationDays: 7, outcomesRequired: 10, delayMeanDays: 2, horizonDays: 8 } });
    w.catalogue.scripts.push({ id: "qc_call", legId: "quick_close", dynasty: "qc_call", version: 1, name: "One call", kind: "human", materials: [{ outcome: "lead_interested" }], tactics: {}, costCents: 0, status: "active" });
    w.truth.legs.quick_close = { base: 0.002, delayMeanDays: 2, horizonDays: 8 };
    w.truth.scripts.qc_call = { costCents: 0 };
    const c1 = w.clients.find((x) => x.brand.id === "brand-1")!;
    c1.campaigns.push({ id: "campaign-1p", brandId: "brand-1", offerId: "offer-1", name: "Paid clients from every interested lead", start: "lead_interested", target: "paid_client", dailyBudgetCents: 2000, status: "running", strategies: {} });
    const s = new SimulationSession(worldFromData(w));
    s.run(40);
    const camp = s.campaign("campaign-1p")!;
    const steps = s.campaignAttempts(camp.id);
    expect(steps.length).toBeGreaterThan(100);
    const firsts = steps.filter((a) => a.from === "lead_interested");
    // Every step goes up toward the Target; the better way up takes most of the pushes.
    for (const a of steps) expect(s.stepsFrom(camp, a.from)).toContain(a.to);
    const viaBooking = firsts.filter((a) => a.to === "meeting_booked").length;
    expect(viaBooking / firsts.length).toBeGreaterThan(0.6);
    expect(firsts.some((a) => a.to === "paid_client")).toBe(true);
    // A Unit reaching the next lead state is pushed on, step after step.
    expect(steps.some((a) => a.from === "meeting_booked" && a.to === "meeting_attended")).toBe(true);
    expect(steps.some((a) => a.from === "meeting_attended" && a.to === "paid_client")).toBe(true);
  }, 120_000);
});

describe("scripts declare their own Bill of materials", () => {
  it("two scripts of one leg with different Bills of materials both run, each served exactly its own", () => {
    const w = worldData();
    const short = w.catalogue.scripts.find((x) => x.id === "wr_short")!;
    short.materials = short.materials.filter((m) => m.outcome !== "company_researched");
    const s = new SimulationSession(worldFromData(w));
    s.run(15);
    const runs = s.runs.filter((r) => r.legId === "writer");
    const consumed = (r: (typeof runs)[number]) => r.consumed.map((id) => s.unit(id)!.outcome).sort();
    const shortRuns = runs.filter((r) => r.scriptId === "wr_short");
    const researchRuns = runs.filter((r) => r.scriptId === "wr_research");
    expect(shortRuns.length).toBeGreaterThan(20);
    expect(researchRuns.length).toBeGreaterThan(20);
    for (const r of shortRuns) expect(consumed(r)).toEqual(short.materials.map((m) => m.outcome).sort());
    for (const r of researchRuns) expect(consumed(r)).toContain("company_researched");
    // No company research is ordered for a lead only the short writer served.
    const researched = new Set(s.units.filter((u) => u.outcome === "company_researched").map((u) => u.subject));
    const onlyShort = shortRuns.map((r) => s.unit(r.consumed.find((id) => s.unit(id)!.outcome === "email_found")!)!.subject).filter((p) => !researchRuns.some((x) => x.consumed.some((id) => s.unit(id)!.subject === p)));
    expect(onlyShort.filter((p) => researched.has(s.person(p)?.companyId ?? "")).length).toBeLessThan(onlyShort.length);
  }, 120_000);

  it("a Specification names the outcome, never a producer: it reaches whichever producer leg is picked", () => {
    const w = worldData();
    // A second leg making LLM completions, with its own fast and pro scripts.
    w.catalogue.legs.push({ id: "llm_eu", name: "LLM (EU hosting)", output: "llm_completion", factory: "ours", maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 } });
    w.catalogue.scripts.push({ id: "eu_fast", legId: "llm_eu", dynasty: "eu_fast", version: 1, name: "EU fast", kind: "ai", materials: [], tactics: { tier: "fast" }, costCents: 1, status: "active" });
    w.catalogue.scripts.push({ id: "eu_pro", legId: "llm_eu", dynasty: "eu_pro", version: 1, name: "EU pro", kind: "ai", materials: [], tactics: { tier: "pro" }, costCents: 4, status: "active" });
    w.truth.legs.llm_eu = { base: 1, delayMeanDays: 0, horizonDays: 0 };
    w.truth.scripts.eu_fast = { costCents: 1 };
    w.truth.scripts.eu_pro = { costCents: 4 };
    // The writer's research script declares it: its LLM completion must come from a pro model.
    const wr = w.catalogue.scripts.find((x) => x.id === "wr_research")!;
    wr.materials = wr.materials.map((m) => (m.outcome === "llm_completion" ? { ...m, conditions: [{ op: "equals", tactic: "tier", value: "pro" }] } : m));
    const s = new SimulationSession(worldFromData(w));
    s.run(15);
    const served = s.runs
      .filter((r) => r.scriptId === "wr_research")
      .map((r) => s.unit(r.consumed.find((id) => s.unit(id)!.outcome === "llm_completion")!)!);
    expect(served.length).toBeGreaterThan(50);
    for (const u of served) expect(s.catalogue.script(u.scriptId!)!.tactics.tier).toBe("pro");
    const legs = new Set(served.map((u) => u.legId));
    expect([...legs].sort()).toEqual(["llm", "llm_eu"]);
    // The other writer script declares no condition: it is served fast models too.
    const short = s.runs.filter((r) => r.scriptId === "wr_short").map((r) => s.catalogue.script(s.unit(r.consumed.find((id) => s.unit(id)!.outcome === "llm_completion")!)!.scriptId!)!.tactics.tier);
    expect(short).toContain("fast");
  }, 120_000);
});
