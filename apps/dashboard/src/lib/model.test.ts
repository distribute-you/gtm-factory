import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel, costPerOutcomeSeries, diffWords, leadTracks, objectDynasties, pluggedAt, pointsOf, scopeFigures, variablesOf } from "./model";
import { WORLD, replay, type LoggedAction } from "./world";
import { formatRatePct, formatRoi, formatUsd } from "./format";

describe("the world the dashboard plays", () => {
  it("replays the same history byte for byte", () => {
    const a = replay(WORLD.seed, [], 8).session;
    const b = replay(WORLD.seed, [], 8).session;
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
  });

  it("replays logged actions on their day: pause, strategy, an edit that makes a new version", () => {
    const base = replay(WORLD.seed, [], 2).session;
    const c = base.campaigns()[0]!;
    const outcome = WORLD.catalogue.outcomes.find((o) => o.contentType === "text_with_variables")!.id;
    const dyn = base.objectDynasties(c.brandId, outcome)[0]!;
    const actions: LoggedAction[] = [
      { day: 2, action: { type: "status", campaignId: c.id, status: "paused" } },
      { day: 3, action: { type: "objectVersion", brandId: c.brandId, outcome, dynasty: dyn, text: "Hello {{first_name}}" } },
    ];
    const { session, applied } = replay(WORLD.seed, actions, 5);
    expect(applied).toHaveLength(2);
    expect(session.days[3]!.spendCents[c.id] ?? 0).toBe(0);
    expect(session.objectHead(c.brandId, outcome, dyn)?.version).toBeGreaterThan(1);
  });
});

describe("read models", () => {
  const { world, session } = replay(WORLD.seed, [], 20);
  const model = buildModel(world, session);

  it("names the lead tracks with the owner's word and never mixes them", () => {
    expect(leadTracks(model.catalogue).map((t) => t.label)).toEqual(["CRM lifecycle track", "Website visits track"]);
  });

  it("our spend adds up to the ledger's spend of our runs", () => {
    const f = scopeFigures(model, model.campaigns);
    const ours = session.runs.filter((r) => model.catalogue.factory(r.factory)?.ours).reduce((s, r) => s + r.spendCents, 0);
    expect(f.spendCents).toBe(ours);
    expect(session.ledger().reconciles).toBe(true);
  });

  it("lists every input choice of a campaign with beliefs and the hidden best", () => {
    const points = pointsOf(model, model.campaigns[0]!);
    expect(points.length).toBeGreaterThan(5);
    const graded = points.filter((p) => p.options.length > 1 && p.options.some((o) => o.isHiddenBest));
    expect(graded.length).toBeGreaterThan(5);
  });

  it("shows where a provider pipe is plugged and the best script at each input", () => {
    const multi = model.catalogue.pipes.map((p) => pluggedAt(model, p.id)).filter((l) => l.length >= 2);
    expect(multi.length).toBeGreaterThan(0);
  });

  it("lists object dynasties with their versions", () => {
    const outcome = model.catalogue.outcomes.find((o) => o.contentType === "text_with_variables")!.id;
    const d = objectDynasties(model, outcome, model.clients[0]!.brand.id);
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d.some((x) => x.versions.length > 1)).toBe(true);
  });

  it("cost per outcome over time is null before the first outcome, never zero", () => {
    expect(costPerOutcomeSeries([100, 100, 100], [0, 0, 2])).toEqual([null, null, 1.5]);
  });
});

describe("text with variables", () => {
  it("diffs two versions word by word and lists the variables", () => {
    const d = diffWords("Hi {{first_name}}, how are you", "Hi {{first_name}}, how is {{company}}");
    expect(d.filter((p) => p.kind === "add").map((p) => p.text).join("")).toContain("{{company}}");
    expect(d.filter((p) => p.kind === "del").map((p) => p.text).join("")).toContain("are");
    expect(variablesOf("Hi {{first_name}} at {{company}} {{first_name}}")).toEqual(["first_name", "company"]);
  });
});

describe("formats", () => {
  it("prints rates whole, a decimal only below 1%", () => {
    expect(formatRatePct(0.236)).toBe("24%");
    expect(formatRatePct(0.006)).toBe("0.6%");
    expect(formatRatePct(0.0004)).toBe("<0.1%");
    expect(formatRoi(3.42)).toBe("3.4×");
    expect(formatUsd(1234)).toBe("$1,234");
  });
});

describe("the dashboard knows no outcome, pipe or script by name", () => {
  it("no source line tests for a template, an LLM or an ICP", () => {
    const root = join(__dirname, "..");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      const code = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      expect(code, f).not.toMatch(/["'`](template_written|llm_completion|audience_built|llm|template|icp)["'`|]/i);
    }
  });
});
