import { describe, expect, it } from "vitest";
import { Catalogue, PERFORMED_BY, START } from "@gtm-factory/core";
import { SEED_CATALOGUE, OUTCOMES, PERFORMERS } from "../src/catalogue-seed";
import { stripDashes, parseJsonObject } from "../src/vendors/llm";
import { topOfReply } from "../src/vendors/mail";

process.env.DATABASE_URL ??= "postgresql://x@127.0.0.1:1/x";

describe("catalogue", () => {
  const cat = new Catalogue(JSON.parse(JSON.stringify(SEED_CATALOGUE)));
  it("validates: one Engine per outcome, the public world's scripts and this app's own", () => {
    expect(cat.validate()).toEqual([]);
    for (const s of cat.scripts) expect(s.tactics[PERFORMED_BY], s.id).toBeDefined();
    expect(cat.script("provided_list_v2")).toMatchObject({ dynasty: "provided_list", version: 2, outcome: OUTCOMES.leadFound });
  });
  it("seeds every script's code: one version per code key, its materials read from its literal ctx.get names", async () => {
    const { seedSources } = await import("../src/code");
    const { validateSource } = await import("../src/sandbox");
    const sources = await seedSources();
    for (const s of cat.scripts) {
      const src = sources[s.code];
      expect(src, s.id).toBeTypeOf("string");
      expect([...validateSource(src!).materials].sort(), s.id).toEqual([...s.materials].sort());
    }
  });
});

describe("the Plan", () => {
  it("goes from the Target down to Start through the Engines whose scripts have code; a kept strategy filters, none routes around", async () => {
    const { planOf, enginesOf, milestoneLine } = await import("../src/factory");
    const { setKnownCode, seedSources } = await import("../src/code");
    setKnownCode(Object.keys(await seedSources()));
    const { EvidenceBook } = await import("@gtm-factory/core");
    const ev = { book: new EvidenceBook({ catalogue: cat0(), brandIds: () => ["b"], groupOf: () => "all", parentOf: () => null }), day: 1, tallies: new Map(), catalogue: cat0() };
    const cat = cat0();
    const campaign = { id: "c", brand_id: "b", factory: "ours", target: OUTCOMES.leadInterested, start_outcome: START, verdicts: {} } as never;
    const brand = { id: "b", lifetime_value_cents: 100_000 } as never;
    const plan = planOf(cat, ev, campaign, brand);
    const engines = enginesOf(plan);
    for (const e of [OUTCOMES.leadInterested, OUTCOMES.leadFound]) expect(engines).toContain(e);
    expect(engines.indexOf(OUTCOMES.leadInterested)).toBeLessThan(engines.indexOf(OUTCOMES.leadFound));
    expect(milestoneLine(cat, plan, START)).toEqual([OUTCOMES.replyReceived, OUTCOMES.leadInterested]);
    const find = (n: typeof plan, o: string): typeof plan | null => (n.outcome === o ? n : n.materials.map((m) => find(m, o)).find(Boolean) ?? null);
    const listed = planOf(cat, ev, { ...(campaign as object), verdicts: { [OUTCOMES.leadFound]: "lead_found#provided_list" } } as never, brand);
    expect(find(listed, OUTCOMES.leadFound)?.scriptId).toBe("provided_list_v2");
    const none = planOf(cat, ev, { ...(campaign as object), verdicts: { [OUTCOMES.leadFound]: "none" } } as never, brand);
    expect(find(none, OUTCOMES.leadFound)?.scriptId ?? null).toBeNull();
  });
});

const cat0 = () => new Catalogue(JSON.parse(JSON.stringify(SEED_CATALOGUE)));

describe("copy guards", () => {
  it("strips em and en dashes from a message", () => {
    expect(stripDashes("Hi Anna — quick one – really")).toBe("Hi Anna, quick one, really");
    expect(stripDashes("no dash here")).toBe("no dash here");
  });
  it("reads the first JSON object of an answer", () => {
    expect(parseJsonObject<{ a: number }>('Sure: {"a": 1} done')).toEqual({ a: 1 });
    expect(() => parseJsonObject("nothing")).toThrow();
  });
  it("keeps only what the person wrote above the quoted thread", () => {
    expect(topOfReply("Yes, let us talk.\n\nOn Mon, Oct 26, 2026 Kevin wrote:\n> hello")).toBe("Yes, let us talk.");
  });
});

describe("the v6 model", () => {
  it("moves a catalogue stored on v5 (legs, factories, Bills of materials, production legs, named paths) onto v6", async () => {
    const { catalogueToV6, choicePointV6 } = await import("../src/factory");
    const stored = {
      leadTracks: [{ id: "crm_lifecycle", name: "CRM lifecycle" }],
      outcomes: SEED_CATALOGUE.outcomes.map(({ reference, ...o }) => ({ ...o, ...(reference ? { referenceLeg: "reply_judging" } : {}) })),
      factories: [{ id: "ours", name: "Our factory", ours: true }, { id: "distribute_you", name: "distribute.you production", ours: false }],
      legs: [
        { id: "writer", name: "Message writer", output: "message_written", factory: "ours", maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 } },
        { id: "reply_judging", name: "Reply judge", output: "lead_interested", factory: "ours", maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 } },
        { id: "dy:lead_found>lead_interested", name: "Lead to lead interested", output: "lead_interested", factory: "distribute_you", maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 } },
      ],
      scripts: [
        { id: "claude_haiku_5_5", legId: "llm", dynasty: "claude_haiku_5_5", version: 1, name: "Claude Haiku 5.5", kind: "ai", materials: [], tactics: { tier: "fast" }, costCents: 0.1, status: "retired" },
        { id: "llm_judge", legId: "reply_judging", dynasty: "llm_judge", version: 1, name: "AI reply judge", kind: "ai", materials: [{ outcome: "reply_received" }], tactics: {}, costCents: 0.2, status: "active" },
        { id: "dy:wf:x", legId: "dy:lead_found>lead_interested", dynasty: "dy:wf:x", version: 3, name: "X", kind: "ai", materials: [{ outcome: "lead_found" }, { outcome: "template_written" }], tactics: { channel: "Cold email" }, costCents: 0, status: "active" },
      ],
      tactics: [{ id: "channel", name: "Channel", type: { kind: "list", values: ["Cold email", "LinkedIn"] }, describes: ["script"], source: "data" }],
      strategies: [{ id: "writer#pro_llm", name: "Pro LLM at the writer", legId: "writer", rules: [{ material: "llm_completion", conditions: [{ op: "equals", tactic: "tier", value: "pro" }] }] }],
      salesPaths: [{ id: "path:start>lead_interested", name: "Leads interested from the market", start: "start", line: ["lead_interested"] }],
    };
    const v6 = catalogueToV6(stored as never);
    const cat = new Catalogue(v6);
    expect(cat.validate()).toEqual([]);
    expect("legs" in v6).toBe(false);
    expect(cat.script("claude_haiku_5_5")?.status).toBe("retired");
    const x = cat.script("dy:wf:x")!;
    expect(x).toMatchObject({ outcome: "lead_interested", materials: ["lead_found", "template_written"], version: 3 });
    expect(x.tactics[PERFORMED_BY]).toBe(PERFORMERS.production);
    expect(cat.strategy("llm_completion#pro_llm")).toMatchObject({ outcome: "llm_completion", conditions: [{ op: "equals", tactic: "tier", value: "pro" }] });
    expect(cat.outcome("lead_interested")?.reference).toBe("llm_judge");
    expect("routings" in v6).toBe(false);
    expect(cat.tactic("channel")?.type).toMatchObject({ kind: "list", values: expect.arrayContaining(["Cold email", "LinkedIn"]) });
    const outputs = new Map([["writer", "message_written"], ["sourcing", "lead_found"], ["dy:lead_found>lead_interested", "lead_interested"]]);
    expect(choicePointV6("writer|llm_completion", outputs)).toBe("message_written|llm_completion");
    expect(choicePointV6("sourcing", outputs)).toBe("email_found|lead_found");
    expect(choicePointV6("dy:lead_found>lead_interested", outputs)).toBe("campaign|lead_interested");
    expect(choicePointV6("message_written|template_written", outputs)).toBe("message_written|template_written");
  });

  it("keeps from a brief only what the catalogue holds", async () => {
    const { cleanVerdict } = await import("../src/brief");
    const { setKnownCode, seedSources } = await import("../src/code");
    setKnownCode(Object.keys(await seedSources()));
    const cat = new Catalogue(JSON.parse(JSON.stringify(SEED_CATALOGUE)));
    const v = cleanVerdict(cat, { verdicts: { lead_found: "lead_found#provided_list", email_found: "nope", paid_client: "none", llm_completion: "llm_completion#pro-models" }, caps: { message_queued: 30, x: 3 }, days: 30 });
    expect(v).toEqual({ verdicts: { lead_found: "lead_found#provided_list", llm_completion: "llm_completion#pro-models" }, caps: { message_queued: 30 }, days: 30 });
  });
});
