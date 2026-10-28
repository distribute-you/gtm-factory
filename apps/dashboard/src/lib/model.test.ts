import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel, costPerOutcomeSeries, diffWords, leadTracks, objectDynasties, pluggedAt, pointsOf, scopeFigures, variablesOf } from "./model";
import { WORLD, replay, type LoggedAction } from "./world";
import { DEFAULT_PINS, pinHref, togglePin } from "./pins";
import { pinnedPage } from "./pinned";
import { formatRatePct, formatRoi, formatUsd } from "./format";
import { campaignPlanLine, draftPlanLine, flowsOf, planTreeOf } from "./plan";
import type { TreeBranch, TreeNode } from "@/components/plan-tree";
import { OURS } from "@gtm-factory/core";

describe("the world the dashboard plays", () => {
  it("replays the same history byte for byte", () => {
    const a = replay(WORLD.seed, [], 8).session;
    const b = replay(WORLD.seed, [], 8).session;
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
  });

  it("replays logged actions on their day: pause, an edit that makes a new version", () => {
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

  it("names the tracks and never mixes them", () => {
    expect(leadTracks(model.catalogue).map((t) => t.label)).toEqual(["CRM lifecycle track", "Website visits track", "Conversation track"]);
  });

  it("our spend adds up to the ledger's spend of our runs", () => {
    const f = scopeFigures(model, model.campaigns);
    const ours = session.runs.filter((r) => r.performedBy === OURS).reduce((s, r) => s + r.spendCents, 0);
    expect(f.spendCents).toBe(ours);
    expect(session.ledger().reconciles).toBe(true);
  });

  it("lists every pick of a campaign with beliefs and the chance each candidate is the best, never a hidden truth", () => {
    const points = pointsOf(model, model.campaigns[0]!);
    expect(points.length).toBeGreaterThan(5);
    for (const p of points) if (p.candidates.length > 0) expect(p.candidates.reduce((x, o) => x + o.chanceBest, 0)).toBeCloseTo(1, 6);
    expect(JSON.stringify(points)).not.toMatch(/"(truth|isHiddenBest)"/);
  });

  it("shows who calls an Engine and the best script for each caller", () => {
    const multi = model.catalogue.engines().map((o) => pluggedAt(model, o)).filter((l) => l.length >= 2);
    expect(multi.length).toBeGreaterThan(0);
  });

  it("lists object dynasties with their versions", () => {
    const outcome = model.catalogue.outcomes.find((o) => o.contentType === "text_with_variables")!.id;
    const d = objectDynasties(model, outcome, model.clients[0]!.brand.id);
    expect(d.length).toBeGreaterThanOrEqual(2);
  });

  it("cost per outcome over time is null before the first outcome, never zero", () => {
    expect(costPerOutcomeSeries([100, 100, 100], [0, 0, 2])).toEqual([null, null, 1.5]);
  });
});

describe("pins are configuration", () => {
  const { world, session } = replay(WORLD.seed, [], 6);
  const model = buildModel(world, session);

  it("the world ships two pins, and pinning any other outcome gives it a page with no new code", () => {
    expect(DEFAULT_PINS).toHaveLength(2);
    for (const p of DEFAULT_PINS) expect(pinnedPage(model, p, null).kind).toBe(p.kind);
    // Pin an object outcome nobody pinned: it gets a menu entry and a page listing its dynasties.
    const other = model.catalogue.outcomes.find((o) => o.subject === "brand" && !DEFAULT_PINS.some((p) => p.id === o.id) && session.objectVersions(model.clients[0]!.brand.id, o.id).length > 0)!;
    const pins = togglePin(DEFAULT_PINS, { kind: "outcome", id: other.id, label: other.plural ?? other.label });
    expect(pins).toHaveLength(3);
    expect(pinHref(pins[2]!)).toContain(encodeURIComponent(`outcome:${other.id}`));
    const page = pinnedPage(model, pins[2]!, null);
    expect(page.kind === "outcome" && page.dynasties.length).toBeGreaterThan(0);
    // And an outcome made per subject: its Engine's scripts, who calls it, its storage.
    const engine = model.catalogue.engines().find((o) => model.catalogue.outcome(o)?.subject === "lead" && model.catalogue.scriptsOf(o).length > 1)!;
    const enginePage = pinnedPage(model, { kind: "outcome", id: engine, label: engine }, null);
    expect(enginePage.kind === "outcome" && enginePage.scripts.length).toBeGreaterThan(1);
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

describe("the dashboard knows no outcome or script by name", () => {
  it("no source line tests for a template, an LLM or an ICP", () => {
    for (const f of sourceFiles(join(__dirname, ".."))) {
      const code = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      expect(code, f).not.toMatch(/["'`](template_written|llm_completion|audience_built|llm|template|icp)["'`|]/i);
    }
  });
});

/** Every source file under a folder (tests and generated code left out). */
function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === "node_modules" || f === ".next" || f === "out") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts") && f !== "sources.ts") files.push(p);
    }
  };
  walk(root);
  return files;
}

describe("the v6 vocabulary", () => {
  it("no retired word in the dashboard, the core or the scripts: product copy and code names alike", () => {
    const words = /\b(routings?|choices?|chosen|pipes?|legs?|steps?|plays?|specifications?|options?|sales funnels?|sales paths?)\b/i;
    const roots = [join(__dirname, ".."), join(__dirname, "../../../../packages/core/src"), join(__dirname, "../../../../scripts/src")];
    for (const root of roots) {
      for (const f of sourceFiles(root)) {
        // The HTML tag of a select's entry is the platform's word, not ours.
        const text = readFileSync(f, "utf8").replace(/<\/?option\b/g, "<entry");
        const hit = text.split("\n").find((l) => words.test(l));
        expect(hit, f).toBeUndefined();
      }
    }
  });
});

describe("a campaign's Plan line", () => {
  const { world, session } = replay(WORLD.seed, [], 20);
  const model = buildModel(world, session);

  it("goes from the campaign's start to its Target, through every milestone its Plan passes", () => {
    for (const c of model.campaigns) {
      const line = campaignPlanLine(model, c);
      expect(line.start).toBe(c.start);
      expect(line.parts.at(-1)?.outcome).toBe(c.target);
      const drawn = line.parts.map((p) => p.outcome);
      for (const m of session.milestoneLine(c)) expect(drawn).toContain(m);
      for (const p of line.parts) expect(model.catalogue.script(p.scriptId!)?.outcome).toBe(p.outcome);
    }
  });

  it("the follow-up campaign draws Message sent, the follow-up, the reply, the interested person", () => {
    const follow = model.campaigns.find((c) => c.start !== "start")!;
    const line = campaignPlanLine(model, follow);
    expect(line.start).toBe("message_sent");
    expect(line.parts.map((p) => p.outcome)).toEqual(["follow_up_queued", "reply_received", "lead_interested"]);
  });

  it("a new campaign's Plan reaches its Target", () => {
    const d = draftPlanLine(model, model.clients[0]!.brand.id, "start", "meeting_booked");
    expect(d.parts.at(-1)?.outcome).toBe("meeting_booked");
    expect(d.line.at(-1)).toBe("meeting_booked");
  });

  it("the Plan tree shows what ran: the LinkedIn branch has no email finding under it", () => {
    const outbound = model.campaigns.find((c) => c.id === "campaign-outbound")!;
    const tree = planTreeOf(model, outbound)!;
    const walk = (n: TreeNode): TreeNode[] => [n, ...n.branches.flatMap((b) => b.children.flatMap(walk))];
    const replies = walk(tree).filter((n) => n.outcome === "reply_received").flatMap((n) => n.branches);
    expect(replies.length).toBeGreaterThanOrEqual(2);
    const below = (b: TreeBranch): string[] => b.children.flatMap((n) => [n.outcome, ...n.branches.flatMap(below)]);
    const li = replies.find((b) => b.dynasty === "li_connect");
    if (li) expect(below(li)).not.toContain("email_found");
    expect(walk(tree).every((n) => n.branches.filter((b) => b.current).length <= 1)).toBe(true);
    expect(flowsOf(model, outbound).length).toBeGreaterThan(0);
  });
});
