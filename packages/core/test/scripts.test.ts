import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SimulationSession, compileScript, libraryFromSources, readMaterials, worldFromData, type ScriptCode, type ScriptLibrary } from "../src";
import { SOURCES } from "../../../scripts/src";
import { LIBRARY, SCRIPTS_DIR, defaultWorld, worldData } from "./helpers";

/** The fictional world with one script's code replaced, and some scripts retired. */
function withCode(scriptId: string, code: ScriptCode, retire: string[] = []): SimulationSession {
  const data = worldData();
  for (const s of data.catalogue.scripts) if (retire.includes(s.id)) s.status = "retired";
  const script = data.catalogue.scripts.find((s) => s.id === scriptId)!;
  script.code = `test/${scriptId}`;
  const library: ScriptLibrary = { ...LIBRARY, [script.code]: code };
  return new SimulationSession(worldFromData(data, library));
}

describe("scripts are code", () => {
  it("every script's code is a file of scripts/, and the materials it calls are the ones the judge read from it", () => {
    const s = new SimulationSession(defaultWorld());
    for (const script of s.catalogue.scripts) {
      const file = `${SCRIPTS_DIR}${script.code}.ts`;
      expect(existsSync(file), script.id).toBe(true);
      expect(LIBRARY[script.code], script.id).toBeTypeOf("function");
      expect([...script.materials].sort(), script.id).toEqual([...readMaterials(readFileSync(file, "utf8"))].sort());
      expect(script.code).toBe(`${script.outcome}/${script.dynasty}/v${script.version}`);
      // The text pages show is the file itself (node scripts/build-sources.mjs after an edit).
      expect(SOURCES[script.code], script.id).toBe(readFileSync(file, "utf8"));
    }
  });

  it("the simulator runs that code: a script whose code makes nothing makes nothing", () => {
    const nothing = withCode("wr_short", () => null);
    nothing.run(10);
    const runs = nothing.runs.filter((r) => r.scriptId === "wr_short");
    expect(runs.length).toBeGreaterThan(20);
    expect(nothing.units.filter((u) => u.scriptId === "wr_short").length).toBe(0);
    const normal = new SimulationSession(defaultWorld());
    normal.run(10);
    expect(normal.units.filter((u) => u.scriptId === "wr_short").length).toBeGreaterThan(10);
  }, 120_000);

  it("the ledger measures what each run consumed, and an unexpected call joins the script's materials", () => {
    const s = withCode("wr_short", (ctx) => {
      ctx.get("email_found");
      ctx.get("template_written");
      ctx.get("brand_context");
      ctx.get("llm_completion");
      ctx.get("company_researched");
      const r = ctx.vendor.call("llm.complete", {});
      return r.ok ? { content: {} } : null;
    });
    expect(s.materialsOf(s.catalogue.script("wr_short")!)).not.toContain("company_researched");
    s.run(8);
    expect(s.materialsOf(s.catalogue.script("wr_short")!)).toContain("company_researched");
    expect(s.materialsOf(s.catalogue.script("wr_short")!)).not.toContain("rating");
  }, 120_000);
});

describe("script code as data", () => {
  it("a library built from the code as text runs the same world, byte for byte, as the files", () => {
    const fromFiles = new SimulationSession(defaultWorld());
    fromFiles.run(6);
    const fromText = new SimulationSession(worldFromData(worldData(), libraryFromSources(SOURCES)));
    fromText.run(6);
    const digest = (x: SimulationSession) => JSON.stringify({ days: x.days, units: x.units.length, ledger: x.ledger().standardCents });
    expect(digest(fromText)).toBe(digest(fromFiles));
  }, 120_000);

  it("refuses code that imports anything at run time, or exports no run function", () => {
    expect(() => compileScript('import { x } from "fs";\nexport default function run() { return x; }')).toThrow(/imports nothing/);
    expect(() => compileScript("export const a = 1;")).toThrow(/default function/);
    expect(compileScript('import type { ScriptContext } from "@gtm-factory/core";\nexport default function run(ctx: ScriptContext) { return { content: { day: ctx.day } }; }')).toBeTypeOf("function");
  });
});

describe("Providers", () => {
  it("two scripts of one Engine calling different Providers both run, each served what it called", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(20);
    const consumed = (scriptId: string) => s.runs.filter((r) => r.scriptId === scriptId && r.consumed.length > 0).map((r) => r.consumed.map((id) => s.unit(id)!.outcome));
    const short = consumed("wr_short");
    const research = consumed("wr_research");
    expect(short.length).toBeGreaterThan(20);
    expect(research.length).toBeGreaterThan(20);
    for (const r of short) expect(r).not.toContain("company_researched");
    for (const r of research) expect(r).toContain("company_researched");
    // No company research is ordered for a subject only the short writer served.
    const researched = new Set(s.units.filter((u) => u.outcome === "company_researched").map((u) => u.subject));
    const companyOf = (r: { consumed: string[] }) => s.person(s.unit(r.consumed.find((id) => s.unit(id)!.outcome === "email_found")!)!.subject)?.companyId;
    const shortOnly = s.runs.filter((r) => r.scriptId === "wr_short" && r.consumed.length > 0).map(companyOf);
    expect(shortOnly.filter((c) => c && researched.has(c)).length).toBeLessThan(shortOnly.length);
  }, 120_000);

  it("get() hands the caller a piece it has not received; calling it again makes a new one, as long as the run's budget lasts", () => {
    const greedy = withCode(
      "wr_short",
      (ctx) => {
        const a = ctx.get("llm_completion");
        const b = ctx.get("llm_completion");
        const r = ctx.vendor.call("llm.complete", {});
        return r.ok ? { content: { a: a.id, b: b.id } } : null;
      },
      ["wr_research"],
    );
    greedy.run(6);
    const written = greedy.units.filter((u) => u.scriptId === "wr_short");
    expect(written.length).toBeGreaterThan(10);
    for (const u of written) {
      const { a, b } = u.content as { a: string; b: string };
      expect(a).not.toBe(b);
      expect(greedy.unit(a)!.outcome).toBe("llm_completion");
      expect(greedy.unit(b)!.outcome).toBe("llm_completion");
    }
    // A script that never stops asking for a new piece stops where the budget ends: nothing is written, nothing overspent.
    const endless = withCode(
      "wr_short",
      (ctx) => {
        for (;;) ctx.get("llm_completion");
      },
      ["wr_research"],
    );
    endless.run(3);
    expect(endless.units.filter((u) => u.scriptId === "wr_short").length).toBe(0);
    for (const d of endless.days) for (const c of endless.campaigns()) expect(d.spendCents[c.id] ?? 0).toBeLessThanOrEqual(c.dailyBudgetCents);
    expect(endless.units.filter((u) => u.outcome === "llm_completion").length).toBeGreaterThan(100);
  }, 120_000);

  it("freshness is the script's call: a script unhappy with an old piece asks again and a new one is made", () => {
    const fresh = withCode(
      "wr_short",
      (ctx) => {
        ctx.get("email_found");
        ctx.get("template_written");
        let context = ctx.get("brand_context");
        for (let k = 0; k < 4 && context.ageDays > 5; k++) context = ctx.get("brand_context");
        ctx.get("llm_completion");
        const r = ctx.vendor.call("llm.complete", {});
        return r.ok ? { content: { context: context.id } } : null;
      },
      ["wr_research"],
    );
    fresh.run(20);
    const contexts = fresh.units.filter((u) => u.outcome === "brand_context" && u.brandId === fresh.clients[0]!.brand.id).sort((x, y) => x.day - y.day);
    expect(contexts.length).toBeGreaterThanOrEqual(3);
    for (const u of fresh.units.filter((x) => x.scriptId === "wr_short")) {
      const used = fresh.unit((u.content as { context: string }).context)!;
      expect(u.day - used.day).toBeLessThanOrEqual(6);
    }
  }, 120_000);
});
