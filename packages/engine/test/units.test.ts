import { describe, expect, it } from "vitest";
import {
  Catalogue,
  StorageHouse,
  allocateBudget,
  candidateCuts,
  chainCostPerTarget,
  costForwardLine,
  legBreakdown,
  meets,
  pickFromMarket,
  scriptAccepts,
  scriptRecords,
  studySplits,
  valueBackwardLine,
  type ScriptContext,
  type SplitRecord,
  type Tactic,
} from "../src";
import { worldData } from "./helpers";

describe("the catalogue", () => {
  it("loads the fictional world's catalogue without an issue", () => {
    const c = new Catalogue(worldData().catalogue);
    expect(c.validate()).toEqual([]);
    expect(c.strategies.filter((s) => s.id.endsWith("#default"))).toHaveLength(c.legs.length);
  });

  it("finds where a leg's subject comes from by walking its scripts' subject Materials", () => {
    const c = new Catalogue(worldData().catalogue);
    expect([...c.rootsOf(c.leg("reply_judging")!)].sort()).toEqual(["start"]);
    // A campaign starting from Message sent reaches the reply judge through the follow-up.
    expect([...c.rootsOf(c.leg("reply_judging")!, new Set(["message_sent"]))].sort()).toEqual(["message_sent", "start"]);
    expect([...c.rootsOf(c.leg("ai_booking")!)]).toEqual(["lead_interested"]);
    expect(c.createsSubjects(c.leg("sourcing")!)).toBe(true);
    expect(c.createsSubjects(c.leg("llm")!)).toBe(false);
  });

  it("upgrades a dynasty (same dynasty, next version runs) and forks one (new dynasty, its parent named)", () => {
    const c = new Catalogue(worldData().catalogue);
    const v2 = c.upgrade("glm", { id: "glm-v2", name: "GLM 2" });
    expect(v2.version).toBe(2);
    expect(c.headOf("glm")?.id).toBe("glm-v2");
    expect(c.dynastiesOf("llm").map((s) => s.dynasty)).toEqual(["glm", "gemini_flash", "gemini_pro"]);
    const fork = c.fork("gemini_pro", { id: "pro-short", dynasty: "pro-short", name: "Gemini Pro, short prompts", kind: "ai", tactics: { tier: "pro" }, costCents: 3 });
    expect(fork.parentDynasty).toBe("gemini_pro");
    expect(c.dynastiesOf("llm")).toHaveLength(4);
  });
});

describe("typed tactics", () => {
  it("meets yes/no, list and number conditions", () => {
    const v = { country: "France", revenue: 7.5, hiring: true };
    expect(meets(v, { op: "in", tactic: "country", values: ["France", "Germany"] })).toBe(true);
    expect(meets(v, { op: "range", tactic: "revenue", min: 5 })).toBe(true);
    expect(meets(v, { op: "range", tactic: "revenue", max: 5 })).toBe(false);
    expect(meets(v, { op: "equals", tactic: "hiring", value: true })).toBe(true);
    expect(meets(v, { op: "notReached", outcomes: ["unsubscribed"] }, new Set(["unsubscribed"]))).toBe(false);
  });

  it("finds a number threshold (revenue) and a list grouping (country) and proposes them as one strategy", () => {
    const tactics: Tactic[] = [
      { id: "revenue", name: "Revenue", type: { kind: "number", unit: "$M" }, describes: ["company"], source: "data" },
      { id: "country", name: "Country", type: { kind: "list", values: ["US", "UK", "FR", "DE"] }, describes: ["lead"], source: "data" },
      { id: "hiring", name: "Hiring", type: { kind: "yesno" }, describes: ["company"], source: "judged" },
    ];
    const records: SplitRecord[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 6000; i++) {
      const revenue = Math.round(Math.exp(Math.log(0.5) + Math.log(100) * rand()) * 10) / 10;
      const country = ["US", "UK", "FR", "DE"][Math.floor(rand() * 4)]!;
      const hiring = rand() < 0.4;
      const p = 0.04 * (revenue >= 5 ? 2.5 : 1) * (country === "US" || country === "UK" ? 2 : 1);
      records.push({ values: { revenue, country, hiring }, success: rand() < p, stratum: `brand|month-${i % 2}` });
    }
    const study = studySplits(records, tactics);
    const conditions = study.proposal!.conditions;
    const revenue = conditions.find((c) => c.op === "range");
    const country = conditions.find((c) => c.op === "in");
    expect(revenue && revenue.op === "range" && revenue.min).toBeGreaterThanOrEqual(3);
    expect(revenue && revenue.op === "range" && revenue.min).toBeLessThanOrEqual(8);
    expect(country && country.op === "in" && [...country.values].sort()).toEqual(["UK", "US"]);
    expect(study.root.find((s) => s.tactic === "hiring")?.verdict ?? "noise").toBe("noise");
  });

  it("groups list values by their rate and cuts numbers at deciles", () => {
    const t: Tactic = { id: "x", name: "X", type: { kind: "number" }, describes: ["lead"], source: "data" };
    const records = Array.from({ length: 100 }, (_, i) => ({ values: { x: i }, success: i % 2 === 0, stratum: "s" }));
    expect(candidateCuts(t, records)).toHaveLength(9);
  });
});

describe("leg storage", () => {
  it("hands a script its own leg's storage and nothing that reaches another one", () => {
    const house = new StorageHouse();
    const a = house.forLeg("sourcing");
    const b = house.forLeg("identity");
    a.set("picked", "p1", 3);
    expect(b.get("picked", "p1")).toBeUndefined();
    expect(house.forLeg("sourcing").get("picked", "p1")).toBe(3);
    // The storage a script holds offers four calls on its own tables: no leg id, no way out.
    expect(Object.keys(a).sort()).toEqual(["count", "delete", "get", "set"]);
    expect(Object.isFrozen(a)).toBe(true);
    const ctx: ScriptContext = { storage: a, day: 0, tactics: {} };
    expect(Object.keys(ctx).sort()).toEqual(["day", "storage", "tactics"]);
  });

  it("keeps a script's own business rules in its leg storage: recontact window, retry window", () => {
    const house = new StorageHouse();
    const ctx = (day: number, tactics: Record<string, number>): ScriptContext => ({ storage: house.forLeg("p"), day, tactics });
    let i = 0;
    const market = { draw: () => [1, 1, 2][i++ % 3]!, inIcp: () => true, keyOf: (x: number) => `b:p${x}` };
    expect(pickFromMarket(ctx(0, { recontact_days: 30 }), market)?.index).toBe(1);
    expect(pickFromMarket(ctx(1, { recontact_days: 30 }), market)?.index).toBe(2);
    const later = pickFromMarket(ctx(40, { recontact_days: 30 }), { ...market, draw: () => 1 });
    expect(later).toEqual({ index: 1, recontact: true });
    scriptRecords(ctx(5, { retry_days: 30 }), "lead-1", false);
    expect(scriptAccepts(ctx(10, { retry_days: 30 }), "lead-1")).toBe(false);
    expect(scriptAccepts(ctx(40, { retry_days: 30 }), "lead-1")).toBe(true);
  });
});

describe("the two calculations", () => {
  const meeting = [
    { costPerAttempt: 1, yieldRate: 0.02 },
    { costPerAttempt: 2, yieldRate: 0.4 },
    { costPerAttempt: 10, yieldRate: 0.2 },
  ];
  it("costs forward and values backward", () => {
    expect(costForwardLine(meeting).map((x) => Math.round(x * 100) / 100)).toEqual([50, 130, 700]);
    expect(chainCostPerTarget(meeting)).toBeCloseTo(700, 9);
    expect(legBreakdown(meeting).map((l) => Math.round(l.leadsNeeded * 100) / 100)).toEqual([625, 12.5, 5]);
    const v = valueBackwardLine(meeting, 2100);
    expect(v.values.map((x) => Math.round(x * 100) / 100)).toEqual([2.24, 162, 410, 2100]);
  });
  it("funds actions by value per dollar and prices the marginal dollar", () => {
    const r = allocateBudget([{ id: "a", valuePerDollar: 6, capacity: 300 }, { id: "b", valuePerDollar: 3, capacity: 1000 }], 500);
    expect(r.funded.map((f) => f.amount)).toEqual([300, 200]);
    expect(r.dollarPrice).toBe(3);
  });
});
