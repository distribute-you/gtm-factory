import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SimulationSession, convergence, hiddenBest, shareOnBest, worldFromData, type PointConvergence } from "../src";
import { RETIRED, defaultWorld, worldData } from "./helpers";

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

  it("every Unit at a leg's end carries the choices that led to it", () => {
    const end = s.units.find((o) => o.outcome === "lead_interested" && o.factory === "ours" && o.trace.some((d) => s.decisions[d]!.point === "email_replies|message_queued"))!;
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

  it("brand Units have dynasties too: an edit is a new version, the choice keeps the dynasty and serves its head", () => {
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
    const consumed = fresh.units.filter((o) => o.outcome === "message_written" && o.brandId === "brand-1" && o.day >= 12).map((o) => o.materials[outcome]);
    const servedIntro = consumed.map((id) => fresh.unit(id!)).filter((o) => o?.dynasty === "tpl-intro");
    for (const o of servedIntro) expect(o!.version).toBe(2);
    // A fork starts a new dynasty that competes.
    fresh.forkObject("brand-1", outcome, "tpl-story", { dynasty: "tpl-story-short", text: "Hi {{first_name}}, {{client_story}}." });
    expect(fresh.objectDynasties("brand-1", outcome)).toContain("tpl-story-short");
  }, 60_000);
});

describe("one script per run", () => {
  it("a choice is made once per attempt: a failed run is the end of that attempt, never a fallback", () => {
    const seen = new Set<string>();
    for (const d of s.decisions) {
      const k = `${d.attemptId}|${d.point}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it("one Run is one script executed: one Unit or none", () => {
    const perRun = new Map<string, number>();
    for (const o of s.units) perRun.set(o.runId, (perRun.get(o.runId) ?? 0) + 1);
    for (const r of s.runs) {
      if (!r.pipeId) continue;
      expect(r.scriptId).toBeDefined();
      expect(perRun.get(r.id) ?? 0).toBeLessThanOrEqual(1);
    }
  });
});

describe("ICPs and templates are competing Units", () => {
  it("two ICP sentences compete and the better hidden one takes most picks; a finer ICP the AI proposed enters and competes", () => {
    const icpPoint = "sourcing|audience_built";
    const picks = picksOf("ads|audience_built", "campaign-4");
    expect(picks["icp-revenue"]!).toBeGreaterThan(4 * (picks["icp-client"] ?? 0));
    const proposals = s.proposals.filter((p) => p.kind === "audience");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    for (const p of proposals) {
      const u = s.unit(p.createdId)!;
      expect(u.parentDynasty).toBeDefined();
      expect(picksOf(icpPoint, p.campaignId!)[u.dynasty!] ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("the choice lives on the Material", () => {
  it("the same LLM pipe plugged at two Materials converges to two different scripts", () => {
    const writer = conv.find((x) => x.point === "writer|llm_completion")!;
    const judge = conv.find((x) => x.point === "reply_judging|llm_completion")!;
    expect(new Set(Object.values(writer.bestByCampaign))).toEqual(new Set(["glm"]));
    expect(new Set(Object.values(judge.bestByCampaign))).toEqual(new Set(["gemini_pro"]));
    expect(shareOnBest(writer, 50, 60)).toBeGreaterThanOrEqual(0.8);
    expect(shareOnBest(judge, 50, 60)).toBeGreaterThanOrEqual(0.8);
  });

  it("a strategy forcing a script at one Material does not touch the other one", () => {
    // campaign-3 plays the writer with "pro models only" at its LLM completion Material.
    expect(Object.keys(picksOf("writer|llm_completion", "campaign-3"))).toEqual(["gemini_pro"]);
    expect(Object.keys(picksOf("reply_judging|llm_completion", "campaign-3")).length).toBeGreaterThan(1);
  });

  it("a campaign's strategy filters scripts by a recontact-window tactic", () => {
    // campaign-2 plays identity with "recontact after 60 days or more" at its Lead found Material.
    expect(picksOf("identity|lead_found", "campaign-2")["src_filters_30"] ?? 0).toBe(0);
    expect(picksOf("identity|lead_found", "campaign-1")["src_filters_30"] ?? 0).toBeGreaterThan(0);
  });

  it("proposes a strategy from a split on scripts' tactics", () => {
    expect(s.proposals.some((p) => p.kind === "strategy" && p.point !== null)).toBe(true);
    expect(s.proposals.some((p) => p.kind === "strategy" && p.conditions.some((c) => c.op === "in" && c.tactic === "country"))).toBe(true);
  });
});

describe("the Campaign orders production", () => {
  it("pull serves the most advanced Units first: a Unit landing at a lead state of the line is taken into the next leg the day it lands", () => {
    let taken = 0;
    for (const c of s.campaigns().filter((x) => s.isProactive(x))) {
      for (const a of s.campaignAttempts(c.id)) {
        if (a.legIndex === 0) continue;
        const u = s.unit(a.startUnit!)!;
        expect(u.outcome, c.id).toBe(c.line[a.legIndex - 1]);
        expect(a.startDay - u.day, `${c.id} ${u.id}`).toBeLessThanOrEqual(1);
        taken++;
      }
    }
    expect(taken).toBeGreaterThan(500);
  });

  it("upstream never produces more than downstream asked: every new subject is one order of its Campaign, within its volume", () => {
    const data = worldData();
    const c2 = data.clients.find((c) => c.brand.id === "brand-2")!.campaigns[0]!;
    c2.volume = { units: 40, periodDays: 1 };
    const v = new SimulationSession(worldFromData(data));
    v.run(12);
    const made = v.madeFromMarket(c2.id);
    expect(Math.max(...made)).toBeLessThanOrEqual(40);
    expect(made.reduce((x, y) => x + y, 0)).toBeGreaterThan(200);
    for (let d = 0; d < 12; d++) {
      const sourcing = v.runs.filter((r) => r.day === d && r.campaignId === c2.id && r.pipeId && v.catalogue.createsSubjects(v.catalogue.pipe(r.pipeId)!)).length;
      expect(sourcing, `day ${d}`).toBeLessThanOrEqual(made[d]!);
    }
  }, 60_000);

  it("a reactive campaign pushes each landed Unit of its start outcome into its first pipe, as far as its budget allows", () => {
    const follow = s.campaign("campaign-1f")!;
    expect(follow.start).toBe("message_sent");
    const sent = s.units.filter((u) => u.outcome === "message_sent" && u.brandId === follow.brandId);
    const pushed = new Map(s.pushes.filter((p) => p.campaignId === follow.id).map((p) => [p.unitId, p]));
    expect(pushed.size).toBeGreaterThan(1000);
    for (const p of pushed.values()) expect(p.day).toBe(s.unit(p.unitId)!.day);
    // Every Unit sent to a subject not yet at the campaign's target is pushed.
    const missed = sent.filter((u) => !pushed.has(u.id) && !(s.reachedBy(u.subject).get("lead_interested")! <= u.day));
    expect(missed.length).toBeLessThan(sent.length * 0.05);
    for (const d of s.days) expect(d.spendCents[follow.id] ?? 0).toBeLessThanOrEqual(follow.dailyBudgetCents);
    // No budget: Units are still pushed, nothing runs.
    const z = new SimulationSession(defaultWorld());
    z.setCampaignBudget("campaign-1f", 0);
    z.run(10);
    expect(z.pushes.filter((p) => p.campaignId === "campaign-1f").length).toBeGreaterThan(50);
    expect(z.runs.filter((r) => r.campaignId === "campaign-1f").length).toBe(0);
  }, 60_000);

  it("the follow-up pipe waits its days since the last message through its script's tactic: no trigger", () => {
    const runs = s.runs.filter((r) => r.pipeId === "follow_up");
    expect(runs.length).toBeGreaterThan(500);
    for (const r of runs) {
      const sent = r.consumed.map((id) => s.unit(id)!).find((u) => u.outcome === "message_sent")!;
      const wait = Number(s.catalogue.script(r.scriptId!)!.tactics.wait_days);
      expect(wait).toBe(4);
      expect(r.day - sent.day).toBeGreaterThanOrEqual(wait);
    }
    expect("triggers" in worldData().catalogue).toBe(false);
  });
});

describe("the ledger is the common stock", () => {
  it("two producers feeding one outcome share one stock: a later leg serves itself Units from both", () => {
    const producers = new Set<string>();
    for (const a of s.campaignAttempts("campaign-1")) if (a.legIndex === 1) producers.add(s.unit(a.startUnit!)!.pipeId ?? "");
    expect(producers.has("reply_judging")).toBe(true);
    expect([...producers].filter((p) => p !== "reply_judging").length).toBeGreaterThanOrEqual(1);
  });

  it("a Specification with a freshness condition ignores a stale Unit and orders a new one", () => {
    // campaign-2 plays the writer with "Brand context younger than 30 days"; brand-1 has no such condition.
    const ctx = (b: string) => s.units.filter((u) => u.outcome === "brand_context" && u.brandId === b).sort((x, y) => x.day - y.day);
    expect(ctx("brand-1")).toHaveLength(1);
    const fresh = ctx("brand-2");
    expect(fresh.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < fresh.length; i++) expect(fresh[i]!.day - fresh[i - 1]!.day).toBeGreaterThanOrEqual(30);
    for (const r of s.runs.filter((x) => x.pipeId === "writer" && x.campaignId === "campaign-2")) {
      const used = r.consumed.map((id) => s.unit(id)!).find((u) => u.outcome === "brand_context")!;
      // Served while younger than 30 days; the writer runs it at most a tick later.
      expect(r.day - used.day).toBeLessThanOrEqual(30);
    }
  });
});

describe("the Supplier rating", () => {
  it("makes a Rating each tick that every choosing pipe consumes, and the Rating drives the choice", () => {
    const ratings = s.units.filter((u) => u.outcome === "rating" && u.brandId === "brand-1");
    expect(ratings.length).toBe(60);
    for (const r of s.runs.filter((x) => x.pipeId === "writer" && x.day === 40)) {
      const rating = r.consumed.map((id) => s.unit(id)!).find((u) => u.outcome === "rating")!;
      expect(r.day - rating.day).toBeLessThanOrEqual(1);
    }
    // The same world with a Rating that reads no evidence: every option stays at its prior.
    const data = worldData();
    data.catalogue.scripts.find((x) => x.id === "rating_pooled")!.tactics.reads_evidence = false;
    const flat = new SimulationSession(worldFromData(data));
    flat.run(30);
    const shareAt = (x: SimulationSession) => {
      const pc = convergence(x).find((p) => p.point === "email_finding|lead_identified")!;
      return shareOnBest(pc, 20, 30)!;
    };
    const informed = new SimulationSession(defaultWorld());
    informed.run(30);
    expect(shareAt(informed)).toBeGreaterThan(0.75);
    expect(shareAt(flat)).toBeLessThan(0.65);
  }, 120_000);
});

describe("other factories", () => {
  it("are counted, and add no value to our pipes' return", () => {
    const organic = s.units.filter((o) => o.factory === "organic");
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

describe("the code knows no object by name", () => {
  it("no line of the engine tests for a template, an LLM or an ICP, and the retired objects are gone", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of readdirSync(src)) {
      const text = readFileSync(`${src}/${f}`, "utf8");
      const code = text.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      expect(code.join("\n"), f).not.toMatch(/["'`](template|llm|icp|audience_built|template_written|llm_completion|message_sent|follow_up)/i);
      for (const w of RETIRED) expect(text, f).not.toMatch(w);
    }
  });
});

void hiddenBest;
