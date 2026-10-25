import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel, costPerOutcomeSeries, diffWords, leadTracks, objectDynasties, pluggedAt, pointsOf, scopeFigures, variablesOf } from "./model";
import { WORLD, replay, type LoggedAction } from "./world";
import { DEFAULT_PINS, pinHref, togglePin } from "./pins";
import { pinnedPage } from "./pinned";
import { formatRatePct, formatRoi, formatUsd } from "./format";
import { campaignLine, linePipes, rankedLine } from "./funnels";
import { playedPipes } from "./campaigns";
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

describe("pins are configuration", () => {
  const { world, session } = replay(WORLD.seed, [], 6);
  const model = buildModel(world, session);

  it("the world ships two pins, and pinning any other outcome or pipe gives it a page with no new code", () => {
    expect(DEFAULT_PINS).toHaveLength(2);
    for (const p of DEFAULT_PINS) expect(pinnedPage(model, p, null).kind).toBe(p.kind);
    // Pin an object outcome nobody pinned: it gets a menu entry and a page listing its dynasties.
    const other = model.catalogue.outcomes.find((o) => o.subject === "object" && !DEFAULT_PINS.some((p) => p.id === o.id) && session.objectVersions(model.clients[0]!.brand.id, o.id).length > 0)!;
    const pins = togglePin(DEFAULT_PINS, { kind: "outcome", id: other.id, label: other.plural ?? other.label });
    expect(pins).toHaveLength(3);
    expect(pinHref(pins[2]!)).toContain(encodeURIComponent(`outcome:${other.id}`));
    const page = pinnedPage(model, pins[2]!, null);
    expect(page.kind === "outcome" && page.dynasties.length).toBeGreaterThan(0);
    // And a pipe: its scripts, where it is plugged, its pipe storage.
    const pipe = model.catalogue.pipes.find((p) => p.inputs.length > 0 && !DEFAULT_PINS.some((x) => x.id === p.id))!;
    const pipePage = pinnedPage(model, { kind: "pipe", id: pipe.id, label: pipe.name }, null);
    expect(pipePage.kind === "pipe" && pipePage.dynasties.length).toBeGreaterThan(0);
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

describe("a funnel line and its plays describe the same pipes", () => {
  const { world, session } = replay(WORLD.seed, [], 20);
  const model = buildModel(world, session);

  it("for every campaign, the pipes drawn in its funnel line are exactly the pipes of its plays", () => {
    for (const c of model.campaigns) {
      const line = campaignLine(model, c);
      const drawn = line.legs.flatMap((l) => l.parts.flatMap((p) => [...p.side, p.pipe].map((x) => x.id)));
      expect(new Set(drawn)).toEqual(new Set(playedPipes(model, c).map((p) => p.id)));
      // Each leg ends on its lead state, through its play.
      line.legs.forEach((l, k) => {
        expect(l.parts.at(-1)?.output).toBe(c.line[k]);
        expect(l.parts.at(-1)?.pipe.id).toBe(session.playsToday(c)[k]);
      });
      // Every pipe whose inputs this campaign chose today is drawn.
      for (const p of session.choicePoints().filter((x) => x.campaignId === c.id)) {
        const consumer = model.catalogue.pipe(p.point.split("|")[0]!);
        if (!consumer) continue;
        const picked = [...session.pickSeries(p.point, c.id).values()].some((arr) => arr.slice(-7).some((n) => n > 0));
        const onLine = drawn.includes(consumer.id);
        if (picked && !onLine) {
          // Only a pipe the leg does not run today (another option at an input) may be left out.
          const alternatives = session.choicePoints().filter((x) => x.campaignId === c.id && !x.point.startsWith("play:"));
          expect(alternatives.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the follow-up campaign draws Follow-up due, the follow-up email, the reply, the reply judge, the interested lead", () => {
    const follow = model.campaigns.find((c) => c.entry.kind === "trigger")!;
    const line = campaignLine(model, follow);
    expect(line.trigger?.id).toBe(follow.entry.kind === "trigger" ? follow.entry.triggerId : null);
    expect(line.legs[0]!.parts.map((p) => [p.pipe.id, p.output])).toEqual([
      ["follow_up", "reply_received"],
      ["reply_judging", "lead_interested"],
    ]);
    expect(linePipes(line).map((p) => p.id)).toEqual(playedPipes(model, follow).map((p) => p.id));
  });

  it("a proposed funnel draws every pipe its plays list offers, and has a name", () => {
    const f = proposeFunnels(model, model.clients[0]!.offer.outcomes, "meeting_booked", 150)[0]!;
    const line = rankedLine(model, f);
    expect(line.funnel?.name).toBeTruthy();
    expect(line.legs.map((l) => l.parts.at(-1)?.pipe.id)).toEqual(f.legs.map((l) => l.pipeId));
    expect(linePipes(line).length).toBeGreaterThanOrEqual(f.legs.length);
  });
});

describe("shadow mode on a snapshot of the simulation (fictional data)", () => {
  it("every client reconciles with its own books and shows today beside the engine", async () => {
    const { ShadowSession, selfProduction, snapshotFromSimulation } = await import("@gtm-factory/engine");
    const { clientRows, pointOptions } = await import("./shadow-model");
    const { world, session } = replay(WORLD.seed, [], 20);
    const snapshot = selfProduction(snapshotFromSimulation(session));
    const shadow = new ShadowSession(snapshot);
    const s = { snapshot, session: shadow, report: shadow.compute(), origin: "test" };
    const rows = clientRows(s);
    expect(rows.length).toBe(world.clients.length);
    expect(rows.every((r) => r.view.reconciliation.reconciles)).toBe(true);
    const v = rows[0]!.view.campaigns[0]!;
    expect(v.salesPath.name).toBeTruthy();
    for (const p of v.points) {
      const { shown } = pointOptions(p);
      if (p.today) expect(shown.map((o) => o.option)).toContain(p.today);
      expect(shown.map((o) => o.option)).toContain(p.engine);
    }
  });
});
