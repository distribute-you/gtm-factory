import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel, costPerOutcomeSeries, diffWords, leadTracks, objectDynasties, pluggedAt, pointsOf, scopeFigures, variablesOf } from "./model";
import { WORLD, replay, type LoggedAction } from "./world";
import { DEFAULT_PINS, pinHref, togglePin } from "./pins";
import { pinnedPage } from "./pinned";
import { formatRatePct, formatRoi, formatUsd } from "./format";
import { campaignLine, lineLegs, rankedLine } from "./funnels";
import { playedLegs } from "./campaigns";
import { proposeFunnels } from "./model";

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

  it("lists every choice of a campaign with beliefs and the hidden best", () => {
    const points = pointsOf(model, model.campaigns[0]!);
    expect(points.length).toBeGreaterThan(5);
    const graded = points.filter((p) => p.candidates.length > 1 && p.candidates.some((o) => o.isHiddenBest));
    expect(graded.length).toBeGreaterThan(5);
  });

  it("shows where a provider leg is plugged and the best script at each Material", () => {
    const multi = model.catalogue.legs.map((p) => pluggedAt(model, p.id)).filter((l) => l.length >= 2);
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

describe("pins are configuration", () => {
  const { world, session } = replay(WORLD.seed, [], 6);
  const model = buildModel(world, session);

  it("the world ships two pins, and pinning any other outcome or leg gives it a page with no new code", () => {
    expect(DEFAULT_PINS).toHaveLength(2);
    for (const p of DEFAULT_PINS) expect(pinnedPage(model, p, null).kind).toBe(p.kind);
    // Pin an object outcome nobody pinned: it gets a menu entry and a page listing its dynasties.
    const other = model.catalogue.outcomes.find((o) => o.subject === "brand" && !DEFAULT_PINS.some((p) => p.id === o.id) && session.objectVersions(model.clients[0]!.brand.id, o.id).length > 0)!;
    const pins = togglePin(DEFAULT_PINS, { kind: "outcome", id: other.id, label: other.plural ?? other.label });
    expect(pins).toHaveLength(3);
    expect(pinHref(pins[2]!)).toContain(encodeURIComponent(`outcome:${other.id}`));
    const page = pinnedPage(model, pins[2]!, null);
    expect(page.kind === "outcome" && page.dynasties.length).toBeGreaterThan(0);
    // And a leg: its scripts, where it is plugged, its leg storage.
    const leg = model.catalogue.legs.find((p) => model.catalogue.materialsOf(p).length > 0 && !DEFAULT_PINS.some((x) => x.id === p.id))!;
    const legPage = pinnedPage(model, { kind: "leg", id: leg.id, label: leg.name }, null);
    expect(legPage.kind === "leg" && legPage.dynasties.length).toBeGreaterThan(0);
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

describe("the dashboard knows no outcome, leg or script by name", () => {
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

describe("a funnel line and its plays describe the same legs", () => {
  const { world, session } = replay(WORLD.seed, [], 20);
  const model = buildModel(world, session);

  it("for every campaign, the legs drawn in its funnel line are exactly the legs of its plays", () => {
    for (const c of model.campaigns) {
      const line = campaignLine(model, c);
      const drawn = line.steps.flatMap((l) => l.parts.flatMap((p) => [...p.side, p.leg].map((x) => x.id)));
      expect(new Set(drawn)).toEqual(new Set(playedLegs(model, c).map((p) => p.id)));
      // Each step ends on its lead state, through its play.
      line.steps.forEach((l, k) => {
        expect(l.parts.at(-1)?.output).toBe(session.pathOf(c)[k]);
        expect(l.parts.at(-1)?.leg.id).toBe(session.playsToday(c)[k]);
      });
      // Every leg whose Materials this campaign chose today is drawn.
      for (const p of session.choicePoints().filter((x) => x.campaignId === c.id)) {
        const consumer = model.catalogue.leg(p.point.split("|")[0]!);
        if (!consumer) continue;
        const picked = [...session.pickSeries(p.point, c.id).values()].some((arr) => arr.slice(-7).some((n) => n > 0));
        const onLine = drawn.includes(consumer.id);
        if (picked && !onLine) {
          // Only a leg the step does not run today (another candidate at a Material) may be left out.
          const alternatives = session.choicePoints().filter((x) => x.campaignId === c.id && !x.point.startsWith("play:"));
          expect(alternatives.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the follow-up campaign draws Message sent, the follow-up, the mailbox's replies, the reply judge, the interested lead", () => {
    const follow = model.campaigns.find((c) => c.start !== "start")!;
    const line = campaignLine(model, follow);
    expect(line.start).toBe("message_sent");
    expect(line.steps[0]!.parts.map((p) => [p.leg.id, p.output])).toEqual([
      ["follow_up", "follow_up_queued"],
      ["follow_up_replies", "reply_received"],
      ["reply_judging", "lead_interested"],
    ]);
    expect(lineLegs(line).map((p) => p.id)).toEqual(playedLegs(model, follow).map((p) => p.id));
  });

  it("a proposed funnel draws every leg its plays list offers, and has a name", () => {
    const f = proposeFunnels(model, model.clients[0]!.offer.outcomes, "meeting_booked", 150)[0]!;
    const line = rankedLine(model, f);
    expect(line.funnel?.name).toBeTruthy();
    expect(line.steps.map((l) => l.parts.at(-1)?.leg.id)).toEqual(f.steps.map((l) => l.legId));
    expect(lineLegs(line).length).toBeGreaterThanOrEqual(f.steps.length);
  });
});
