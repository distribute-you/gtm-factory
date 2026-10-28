import { describe, expect, it } from "vitest";
import {
  Catalogue,
  StorageHouse,
  allocateBudget,
  candidateCuts,
  chainCostPerTarget,
  costForwardLine,
  meets,
  studySplits,
  targetBreakdown,
  valueBackwardLine,
  type ScriptContext,
  type SplitRecord,
  type Tactic,
  type UnitView,
  type VendorAnswer,
} from "../src";
import { LIBRARY, worldData } from "./helpers";

describe("the catalogue", () => {
  it("loads the fictional world's catalogue without an issue: one Engine per outcome, a default strategy each", () => {
    const c = new Catalogue(worldData().catalogue);
    expect(c.validate()).toEqual([]);
    for (const e of c.engines()) expect(c.strategy(`${e}#default`), e).toBeDefined();
    expect(c.engines()).toContain("reply_received");
    // Cold email and LinkedIn are two scripts of one Engine: a channel is a tactic of a script.
    expect(new Set(c.scriptsOf("reply_received").map((s) => s.tactics.channel))).toEqual(new Set(["Cold email", "LinkedIn", "WhatsApp"]));
  });

  it("tells which scripts create their subject: those that call no Provider of a subject outcome", () => {
    const c = new Catalogue(worldData().catalogue);
    expect(c.createsSubjects(c.script("src_filters")!)).toBe(true);
    expect(c.createsSubjects(c.script("glm")!)).toBe(false);
    expect(c.subjectOf(c.script("rj_ai")!)).toBe("reply_received");
    expect(c.subjectOf(c.script("wr_short")!)).toBe("email_found");
  });

  it("upgrades a dynasty (same dynasty, next version runs) and forks one (new dynasty, its parent named, its code copied)", () => {
    const c = new Catalogue(worldData().catalogue);
    const v2 = c.upgrade("glm", { id: "glm-v2", name: "GLM 2" });
    expect(v2.version).toBe(2);
    expect(c.headOf("glm")?.id).toBe("glm-v2");
    expect(c.scriptsOf("llm_completion").map((s) => s.dynasty)).toEqual(["glm", "gemini_flash", "gemini_pro"]);
    const fork = c.fork("gemini_pro", { id: "pro-short", dynasty: "pro-short", name: "Gemini Pro, short prompts", kind: "ai", tactics: { tier: "pro" }, costCents: 3 });
    expect(fork.parentDynasty).toBe("gemini_pro");
    expect(fork.code).toBe(c.script("gemini_pro")!.code);
    expect(c.scriptsOf("llm_completion")).toHaveLength(4);
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

describe("Engine storage", () => {
  it("hands a script its own Engine's storage and nothing that reaches another one", () => {
    const house = new StorageHouse();
    const a = house.forEngine("lead_found");
    const b = house.forEngine("email_found");
    a.set("picked", "p1", 3);
    expect(b.get("picked", "p1")).toBeUndefined();
    expect(house.forEngine("lead_found").get("picked", "p1")).toBe(3);
    // The storage a script holds offers four calls on its own tables: no Engine id, no way out.
    expect(Object.keys(a).sort()).toEqual(["count", "delete", "get", "set"]);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("keeps a script's own business rules in its code and its storage: a recontact window, a retry window", () => {
    const house = new StorageHouse();
    const view = (outcome: string, subject: string): UnitView => ({ id: `${outcome}:${subject}`, outcome, subject, ageDays: 0, content: {} });
    const ctx = (day: number, tactics: Record<string, number>, engine: string, answer: (name: string, args: Record<string, unknown>) => VendorAnswer): ScriptContext => ({
      subject: "b:p9",
      brand: "b",
      day,
      tactics,
      storage: house.forEngine(engine),
      get: (o) => view(o, o === "lead_identified" ? "b:p9" : "b"),
      vendor: { call: (name, args) => answer(name, args ?? {}) },
      wait: () => {
        throw new Error("no wait here");
      },
      accounts: () => [],
    });
    // Sourcing: the market draws person 1, 1, 2...; a person picked within the window is skipped.
    let i = 0;
    const market = (name: string): VendorAnswer => (name === "market.draw" ? { ok: true, data: { key: `b:p${[1, 1, 2][i++ % 3]}` } } : { ok: true, data: {} });
    const pick = LIBRARY["lead_found/src_filters/v1"]!;
    expect(pick(ctx(0, { recontact_days: 30 }, "lead_found", market))?.found).toBe("b:p1");
    expect(pick(ctx(1, { recontact_days: 30 }, "lead_found", market))?.found).toBe("b:p2");
    i = 0;
    expect(pick(ctx(40, { recontact_days: 30 }, "lead_found", market))).toEqual({ found: "b:p1", content: { recontact: true } });
    // Email finding: a lead it failed on is not tried again within its retry window.
    const lookup = LIBRARY["email_found/ef_lookup/v1"]!;
    let calls = 0;
    const fail = (): VendorAnswer => (calls++, { ok: false, data: {} });
    expect(lookup(ctx(5, { retry_days: 30 }, "email_found", fail))).toBeNull();
    expect(lookup(ctx(10, { retry_days: 30 }, "email_found", fail))).toBeNull();
    expect(calls).toBe(1);
    expect(lookup(ctx(40, { retry_days: 30 }, "email_found", () => ({ ok: true, data: { email: "a@b.c" } })))?.content?.email).toBe("a@b.c");
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
    expect(targetBreakdown(meeting).map((l) => Math.round(l.attemptsPerTarget * 100) / 100)).toEqual([625, 12.5, 5]);
    const v = valueBackwardLine(meeting, 2100);
    expect(v.values.map((x) => Math.round(x * 100) / 100)).toEqual([2.24, 162, 410, 2100]);
  });
  it("funds actions by value per dollar and prices the marginal dollar", () => {
    const r = allocateBudget([{ id: "a", valuePerDollar: 6, capacity: 300 }, { id: "b", valuePerDollar: 3, capacity: 1000 }], 500);
    expect(r.funded.map((f) => f.amount)).toEqual([300, 200]);
    expect(r.dollarPrice).toBe(3);
  });
});

describe("the release", () => {
  it("every page shows the release the core package carries", async () => {
    const { RELEASE } = await import("../src");
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(RELEASE).toBe(`v${pkg.version.split(".")[1]}`);
  });
});
