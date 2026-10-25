import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SimulationSession, convergence, hiddenBest, shareOnBest, type PointConvergence } from "../src";
import { defaultWorld } from "./helpers";

/** The default world, fixed seed, 60 days: shared by every test of this file. */
let s: SimulationSession;
let conv: PointConvergence[];
beforeAll(() => {
  s = new SimulationSession(defaultWorld());
  s.run(60);
  conv = convergence(s);
}, 120_000);

const picksOf = (point: string, campaignId: string) => {
  const out: Record<string, number> = {};
  for (const [o, arr] of s.pickSeries(point, campaignId)) out[o] = arr.reduce((x, y) => x + y, 0);
  return out;
};

describe("the universal prioritizer converges", () => {
  it("every choice point with 200 picks or more ends with 80% or more on the hidden best option, share rising", () => {
    const big = conv.filter((pc) => pc.picks >= 200);
    expect(big.length).toBeGreaterThanOrEqual(12);
    for (const pc of big) {
      const end = shareOnBest(pc, 50, 60)!;
      const start = shareOnBest(pc, 0, 10) ?? 0;
      expect(end, pc.point).toBeGreaterThanOrEqual(0.8);
      expect(end, pc.point).toBeGreaterThan(start);
    }
  });

  it("is byte identical on a rerun with the same seed, different with another", () => {
    const again = new SimulationSession(defaultWorld());
    again.run(60);
    const digest = (x: SimulationSession) => JSON.stringify({ days: x.days, choices: x.choices, ledger: x.ledger().standardCents, decisions: x.decisions.length });
    expect(digest(again)).toBe(digest(s));
    const other = new SimulationSession(defaultWorld(12));
    other.run(5);
    expect(JSON.stringify(other.days)).not.toBe(JSON.stringify(s.days.slice(0, 5)));
  }, 120_000);
});

describe("expected and measured return", () => {
  it("agree within their confidence intervals, same formula, for every campaign with 30 outcomes or more", () => {
    let checked = 0;
    for (const c of s.campaigns()) {
      const e = s.economics(c.id);
      if (e.measured.targets < 30) continue;
      checked++;
      expect(e.expected.value, c.id).not.toBeNull();
      // The two intervals overlap.
      expect(e.expected.low!, c.id).toBeLessThanOrEqual(e.measured.high!);
      expect(e.measured.low!, c.id).toBeLessThanOrEqual(e.expected.high!);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("credit through traceability", () => {
  it("a template that only changes the end outcome wins the template input choice", () => {
    // Every template lets the writer write (same step yield); only the reply changes.
    const pc = conv.find((x) => x.point === "writer|template_written")!;
    for (const best of Object.values(pc.bestByCampaign)) expect(best).toBe("tpl-story");
    expect(shareOnBest(pc, 50, 60)).toBeGreaterThanOrEqual(0.8);
  });

  it("every occurrence at a leg's end carries the input choices that led to it", () => {
    const end = s.occurrences.find((o) => o.outcome === "lead_interested" && o.factory === "ours")!;
    const points = end.trace.map((d) => s.decisions[d]!.point);
    for (const p of ["sourcing|audience_built", "identity|lead_found", "writer|template_written", "writer|llm_completion", "reply_judging|llm_completion"]) expect(points).toContain(p);
  });

  it("a fork starts from its parent's belief; an upgrade keeps its dynasty's", () => {
    const fresh = new SimulationSession(defaultWorld());
    fresh.run(15);
    const point = "writer|llm_completion";
    const before = fresh.beliefsAt(point, "campaign-1").find((b) => b.option === "glm")!;
    fresh.catalogue.fork("glm", { id: "glm-terse", dynasty: "glm-terse", name: "GLM, terse prompt", kind: "ai", tactics: { tier: "fast" }, costCents: 1 });
    fresh.catalogue.upgrade("gemini_flash", { id: "gemini-flash-2", name: "Gemini Flash 2" });
    const flashBefore = fresh.beliefsAt(point, "campaign-1").find((b) => b.option === "gemini_flash")!;
    // Before the fork has any decision of its own, its belief is its parent's.
    const at = fresh.belief.bind(fresh);
    const parent = at(point, "glm", ["glm", "gemini_flash", "gemini_pro", "glm-terse"], "brand-1", fresh.day);
    const child = at(point, "glm-terse", ["glm", "gemini_flash", "gemini_pro", "glm-terse"], "brand-1", fresh.day);
    expect(child.posterior.alpha / (child.posterior.alpha + child.posterior.beta)).toBeCloseTo(parent.posterior.alpha / (parent.posterior.alpha + parent.posterior.beta), 2);
    fresh.run(1);
    expect(before.rate).toBeGreaterThan(0);
    // The upgrade is the same option: its stats carry on, its new version runs.
    const flashAfter = fresh.beliefsAt(point, "campaign-1").find((b) => b.option === "gemini_flash")!;
    expect(flashAfter.decisions).toBeGreaterThan(flashBefore.decisions * 0.9);
    expect(flashAfter.decisions).toBeGreaterThan(0);
    const ran = fresh.runs.filter((r) => r.day === fresh.day - 1 && r.pipeId === "llm").map((r) => r.scriptId);
    expect(ran).not.toContain("gemini_flash");
  }, 60_000);

  it("object occurrences have dynasties too: an edit is a new version, the input choice keeps the dynasty and serves its head", () => {
    const fresh = new SimulationSession(defaultWorld());
    fresh.run(10);
    const outcome = "template_written";
    const before = fresh.objectDynasties("brand-1", outcome);
    const statsBefore = fresh.beliefsAt(`writer|${outcome}`, "campaign-1").find((b) => b.option === "tpl-intro")!;
    const v2 = fresh.addObjectVersion("brand-1", outcome, "tpl-intro", { text: "Hi {{first_name}}, {{company}} could {{benefit}}. Open to a call?" });
    expect(v2.version).toBe(2);
    expect(fresh.objectDynasties("brand-1", outcome)).toEqual(before);
    expect(fresh.objectHead("brand-1", outcome, "tpl-intro")?.id).toBe(v2.id);
    const statsAfter = fresh.beliefsAt(`writer|${outcome}`, "campaign-1").find((b) => b.option === "tpl-intro")!;
    expect(statsAfter.decisions).toBe(statsBefore.decisions);
    fresh.run(5);
    const consumed = fresh.occurrences.filter((o) => o.outcome === "message_written" && o.brandId === "brand-1" && o.day >= 11).map((o) => o.inputs[outcome]);
    const servedIntro = consumed.map((id) => fresh.occurrence(id!)).filter((o) => o?.dynasty === "tpl-intro");
    for (const o of servedIntro) expect(o!.version).toBe(2);
    // A fork starts a new dynasty that competes.
    fresh.forkObject("brand-1", outcome, "tpl-story", { dynasty: "tpl-story-short", text: "Hi {{first_name}}, {{client_story}}." });
    expect(fresh.objectDynasties("brand-1", outcome)).toContain("tpl-story-short");
  }, 60_000);
});

describe("one script per run", () => {
  it("an input choice is made once per attempt: a failed run is the end of that attempt, never a fallback", () => {
    const seen = new Set<string>();
    for (const d of s.decisions) {
      const k = `${d.attemptId}|${d.point}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it("each run is one script, and a run produces at most one occurrence per subject it processed", () => {
    const perRun = new Map<string, number>();
    for (const o of s.occurrences) perRun.set(o.runId, (perRun.get(o.runId) ?? 0) + 1);
    for (const r of s.runs) {
      if (!r.pipeId) continue;
      expect(r.scriptId).toBeDefined();
      expect(perRun.get(r.id) ?? 0).toBeLessThanOrEqual(Math.max(1, r.subjects));
    }
  });
});

describe("ICPs and templates are competing occurrences", () => {
  it("two ICP sentences compete and the better hidden one takes most picks; a finer ICP the AI proposed enters and competes", () => {
    const icpPoint = "sourcing|audience_built";
    const picks = picksOf("ads|audience_built", "campaign-4");
    expect(picks["icp-revenue"]!).toBeGreaterThan(4 * (picks["icp-client"] ?? 0));
    const proposals = s.proposals.filter((p) => p.kind === "audience");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    for (const p of proposals) {
      const occ = s.occurrence(p.createdId)!;
      expect(occ.parentDynasty).toBeDefined();
      expect(picksOf(icpPoint, p.campaignId!)[occ.dynasty!] ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("the choice lives on the input", () => {
  it("the same LLM pipe plugged at two inputs converges to two different scripts", () => {
    const writer = conv.find((x) => x.point === "writer|llm_completion")!;
    const judge = conv.find((x) => x.point === "reply_judging|llm_completion")!;
    expect(new Set(Object.values(writer.bestByCampaign))).toEqual(new Set(["glm"]));
    expect(new Set(Object.values(judge.bestByCampaign))).toEqual(new Set(["gemini_pro"]));
    expect(shareOnBest(writer, 50, 60)).toBeGreaterThanOrEqual(0.8);
    expect(shareOnBest(judge, 50, 60)).toBeGreaterThanOrEqual(0.8);
  });

  it("a strategy forcing a script at one input does not touch the other input", () => {
    // campaign-3 plays the writer with "pro models only" at its LLM input.
    expect(Object.keys(picksOf("writer|llm_completion", "campaign-3"))).toEqual(["gemini_pro"]);
    expect(Object.keys(picksOf("reply_judging|llm_completion", "campaign-3")).length).toBeGreaterThan(1);
  });

  it("a campaign's strategy filters scripts by a recontact-window tactic", () => {
    // campaign-2 plays identity with "recontact after 60 days or more" at its lead input.
    expect(picksOf("identity|lead_found", "campaign-2")["src_filters_30"] ?? 0).toBe(0);
    expect(picksOf("identity|lead_found", "campaign-1")["src_filters_30"] ?? 0).toBeGreaterThan(0);
  });

  it("proposes a strategy from a split on scripts' tactics", () => {
    expect(s.proposals.some((p) => p.kind === "strategy" && p.point !== null)).toBe(true);
    expect(s.proposals.some((p) => p.kind === "strategy" && p.conditions.some((c) => c.op === "in" && c.tactic === "country"))).toBe(true);
  });
});

describe("triggers", () => {
  it("a delay-unless trigger fires only for subjects without the unless outcome, and each event is an occurrence", () => {
    expect(s.triggerEvents.length).toBeGreaterThan(100);
    for (const e of s.triggerEvents) {
      const occ = s.occurrence(e.occurrenceId)!;
      expect(occ.outcome).toBe("follow_up_due");
      expect(occ.subject).toBe(e.subject);
      const replied = s.reachedBy(e.subject).get("reply_received");
      // No reply landed in the 4 days before the event.
      if (replied !== undefined) expect(replied < e.day - 4 || replied >= e.day).toBe(true);
    }
    expect(s.days.reduce((x, d) => x + (d.attempts["campaign-1f"] ?? 0), 0)).toBeGreaterThan(100);
  });
});

describe("other factories", () => {
  it("are counted, and add no value to our pipes' return", () => {
    const organic = s.occurrences.filter((o) => o.factory === "organic");
    expect(organic.length).toBeGreaterThan(20);
    let ours = 0;
    let other = 0;
    for (const d of s.days) for (const c of Object.keys(d.valueOurs)) ours += d.valueOurs[c]!;
    for (const d of s.days) for (const c of Object.keys(d.valueOther)) other += d.valueOther[c]!;
    expect(other).toBeGreaterThan(0);
    for (const c of s.campaigns()) expect(s.economics(c.id).valueOurs).toBe(s.days.reduce((x, d) => x + (d.valueOurs[c.id] ?? 0), 0));
    expect(ours).toBeGreaterThan(other);
  });

  it("measure reliability against the reference pipe, and there is no Reporter object anywhere", () => {
    const rel = s.reliability();
    expect(rel.find((r) => r.producer === "crm_import")?.isReference).toBe(true);
    const judge = rel.find((r) => r.producer === "reply_judging")!;
    expect(judge.agreements).toBeGreaterThan(10);
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of readdirSync(src)) expect(readFileSync(`${src}/${f}`, "utf8")).not.toMatch(/Reporter|lineage/);
  });
});

describe("the ledger", () => {
  it("reconciles to the cent", () => {
    const l = s.ledger();
    expect(l.reconciles).toBe(true);
    expect(l.standardChargedCents - l.reuseGainCents + l.runsProducingNone.totalCents).toBe(l.totalSpendCents);
    expect(l.reuseGainCents).toBeGreaterThan(0);
  });
});

describe("the engine knows no object by name", () => {
  it("no line of the engine tests for a template, an LLM or an ICP", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of readdirSync(src)) {
      const code = readFileSync(`${src}/${f}`, "utf8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      expect(code.join("\n"), f).not.toMatch(/["'`](template|llm|icp|audience_built|template_written|llm_completion)/i);
    }
  });
});

void hiddenBest;
