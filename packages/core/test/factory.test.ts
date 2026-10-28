import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { OURS, SimulationSession, convergence, shareOnBest, worldFromData, type PointConvergence } from "../src";
import { LIBRARY, defaultWorld, worldData } from "./helpers";

/** The default world, fixed seed, 60 days: shared by every test of this file. */
let s: SimulationSession;
let conv: PointConvergence[];
beforeAll(() => {
  s = new SimulationSession(defaultWorld());
  s.run(60);
  conv = convergence(s);
}, 180_000);

const picksOf = (point: string, campaignId: string) => {
  const out: Record<string, number> = {};
  for (const [o, arr] of s.pickSeries(point, campaignId)) out[o] = arr.reduce((x, y) => x + y, 0);
  return out;
};

describe("one seed, one history", () => {
  it("is byte identical on a rerun with the same seed, different with another", () => {
    const again = new SimulationSession(defaultWorld());
    again.run(60);
    const digest = (x: SimulationSession) => JSON.stringify({ days: x.days, picks: x.pickLog, ledger: x.ledger().standardCents, decisions: x.decisions.length });
    expect(digest(again)).toBe(digest(s));
    const other = new SimulationSession(defaultWorld(12));
    other.run(5);
    expect(JSON.stringify(other.days)).not.toBe(JSON.stringify(s.days.slice(0, 5)));
  }, 180_000);
});

describe("expected and measured return", () => {
  it("agree within their confidence intervals, on the same basis (subjects made from the start), for every campaign with 20 Targets or more", () => {
    let checked = 0;
    for (const c of s.campaigns()) {
      const e = s.economics(c.id);
      if (e.measured.targets < 20) continue;
      checked++;
      expect(e.expected.value, c.id).not.toBeNull();
      expect(e.expected.low!, c.id).toBeLessThanOrEqual(e.measured.high!);
      expect(e.measured.low!, c.id).toBeLessThanOrEqual(e.expected.high!);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("credit through traceability", () => {
  it("every Unit at a milestone carries the picks that led to it", () => {
    const reply = s.units.find((u) => u.outcome === "reply_received" && u.scriptId === "mb_replies" && u.campaignId === "campaign-outbound")!;
    const points = reply.trace.map((d) => s.decisions[d]!.point);
    for (const p of ["lead_interested|reply_received", "lead_found|audience_built", "message_written|template_written", "message_written|llm_completion", "message_written|email_found"]) expect(points).toContain(p);
  });

  it("a template that only changes the reply wins the template pick", () => {
    // Every template lets the writer write (same yield); only the reply changes.
    const pc = conv.filter((x) => x.point.endsWith("|template_written")).sort((a, b) => b.picks - a.picks)[0]!;
    for (const best of Object.values(pc.bestByCampaign)) expect(best).toBe("tpl-story");
    // It takes the largest share of the picks, more than at the start.
    const late = new Map<string, number>();
    for (const [cand, arr] of s.pickSeries(pc.point)) late.set(cand, arr.slice(50, 60).reduce((x, y) => x + y, 0));
    expect([...late].sort((a, b) => b[1] - a[1])[0]![0]).toBe("tpl-story");
    expect(shareOnBest(pc, 50, 60)).toBeGreaterThan(shareOnBest(pc, 0, 10) ?? 0);
  });

  it("a fork starts from its parent's belief; an upgrade keeps its dynasty's", () => {
    const fresh = new SimulationSession(defaultWorld());
    fresh.run(15);
    const point = "reply_received|llm_completion";
    fresh.catalogue.fork("glm", { id: "glm-terse", dynasty: "glm-terse", name: "GLM, terse prompt", kind: "ai", tactics: { tier: "fast", performed_by: OURS }, costCents: 1 });
    fresh.catalogue.upgrade("gemini_flash", { id: "gemini-flash-2", name: "Gemini Flash 2" });
    const flashBefore = fresh.beliefsAt(point, "campaign-outbound").find((b) => b.candidate === "gemini_flash")!;
    const all = ["glm", "gemini_flash", "gemini_pro", "glm-terse"];
    const parent = fresh.belief(point, "glm", all, fresh.clients[0]!.brand.id, fresh.day);
    const child = fresh.belief(point, "glm-terse", all, fresh.clients[0]!.brand.id, fresh.day);
    const mean = (b: typeof parent) => b.posterior.alpha / (b.posterior.alpha + b.posterior.beta);
    expect(mean(child)).toBeCloseTo(mean(parent), 2);
    fresh.run(2);
    const flashAfter = fresh.beliefsAt(point, "campaign-outbound").find((b) => b.candidate === "gemini_flash")!;
    expect(flashAfter.decisions).toBeGreaterThan(flashBefore.decisions * 0.8);
    expect(flashAfter.decisions).toBeGreaterThan(0);
    const ran = fresh.runs.filter((r) => r.day === fresh.day - 1 && r.scriptId?.startsWith("gemini")).map((r) => r.scriptId);
    expect(ran).not.toContain("gemini_flash");
  }, 120_000);

  it("brand Units have dynasties too: an edit is a new version, the pick keeps the dynasty and serves its head", () => {
    const fresh = new SimulationSession(defaultWorld());
    fresh.run(10);
    const brand = fresh.clients[0]!.brand.id;
    const outcome = "template_written";
    const before = fresh.objectDynasties(brand, outcome);
    const v2 = fresh.addObjectVersion(brand, outcome, "tpl-intro", { text: "Hi {{first_name}}, {{company}} could {{benefit}}. Open to a call?" });
    expect(v2.version).toBe(2);
    expect(fresh.objectDynasties(brand, outcome)).toEqual(before);
    expect(fresh.objectHead(brand, outcome, "tpl-intro")?.id).toBe(v2.id);
    fresh.run(5);
    const served = fresh.units.filter((u) => u.outcome === "message_written" && u.day >= 11).map((u) => fresh.unit(u.materials[outcome]!)).filter((u) => u?.dynasty === "tpl-intro");
    for (const u of served) expect(u!.version).toBe(2);
    fresh.forkObject(brand, outcome, "tpl-story", { dynasty: "tpl-story-short", text: "Hi {{first_name}}, {{client_story}}." });
    expect(fresh.objectDynasties(brand, outcome)).toContain("tpl-story-short");
  }, 120_000);
});

describe("one script per run", () => {
  it("a pick is made once per order and point: a failed run ends that order, never a fallback", () => {
    const seen = new Set<string>();
    for (const d of s.decisions) {
      const k = `${d.orderId}|${d.point}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it("one Run is one script executed: one Unit or none", () => {
    const perRun = new Map<string, number>();
    for (const u of s.units) perRun.set(u.runId, (perRun.get(u.runId) ?? 0) + 1);
    for (const r of s.runs) {
      if (!r.engine) continue;
      expect(r.scriptId).toBeDefined();
      expect(perRun.get(r.id) ?? 0).toBeLessThanOrEqual(1);
    }
  });
});

describe("ICPs and strategies are proposed from splits", () => {
  it("a finer ICP the AI proposed enters and competes", () => {
    const proposals = s.proposals.filter((p) => p.kind === "audience");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    for (const p of proposals) {
      const u = s.unit(p.createdId)!;
      expect(u.parentDynasty).toBeDefined();
      expect(picksOf("lead_found|audience_built", p.campaignId!)[u.dynasty!] ?? 0).toBeGreaterThan(0);
    }
  });

  it("proposes a strategy from a split on scripts' tactics", () => {
    expect(s.proposals.some((p) => p.kind === "strategy")).toBe(true);
  });
});

describe("the pick lives on the Material", () => {
  it("the same LLM Engine called by two scripts converges to two different scripts", () => {
    const writer = conv.find((x) => x.point === "reply_received|llm_completion")!;
    const judge = conv.find((x) => x.point === "lead_interested|llm_completion")!;
    expect(new Set(Object.values(writer.bestByCampaign))).not.toEqual(new Set(Object.values(judge.bestByCampaign)));
    expect(shareOnBest(judge, 50, 60)).toBeGreaterThan(0.5);
  });
});

describe("the Supplier rating", () => {
  it("makes a Rating each day that every picking script consumes, and the Rating drives the pick", () => {
    const brand = s.clients[0]!.brand.id;
    expect(s.units.filter((u) => u.outcome === "rating" && u.brandId === brand).length).toBe(60);
    const data = worldData();
    data.catalogue.scripts.find((x) => x.id === "rating_pooled")!.tactics.reads_evidence = false;
    const flat = new SimulationSession(worldFromData(data, LIBRARY));
    flat.run(30);
    const informed = new SimulationSession(defaultWorld());
    informed.run(30);
    const shareAt = (x: SimulationSession) => shareOnBest(convergence(x).find((p) => p.point === "lead_interested|llm_completion")!, 20, 30)!;
    expect(shareAt(informed)).toBeGreaterThan(shareAt(flat) + 0.2);
  }, 180_000);
});

describe("other parties", () => {
  it("are counted, and add no value to our return", () => {
    expect(s.units.filter((u) => u.performedBy !== OURS).length).toBeGreaterThan(20);
    let ours = 0;
    let other = 0;
    for (const d of s.days) for (const c of Object.keys(d.valueOurs)) ours += d.valueOurs[c]!;
    for (const d of s.days) for (const c of Object.keys(d.valueOther)) other += d.valueOther[c]!;
    for (const c of s.campaigns()) expect(s.economics(c.id).valueOurs).toBe(s.days.reduce((x, d) => x + (d.valueOurs[c.id] ?? 0), 0));
    expect(ours).toBeGreaterThan(0);
    expect(other).toBeGreaterThanOrEqual(0);
  });

  it("are measured for reliability against the outcome's reference script", () => {
    const rel = s.reliability();
    expect(rel.find((r) => r.producer === "crm_sync")?.isReference).toBe(true);
    expect(rel.find((r) => r.producer === "rj_ai")!.agreements).toBeGreaterThan(10);
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

describe("the core knows no outcome by name", () => {
  it("no line of the core tests for a template, an LLM, an ICP or a message", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of readdirSync(src)) {
      const code = readFileSync(`${src}/${f}`, "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      expect(code.join("\n"), f).not.toMatch(/["'`](template|llm|icp|audience_built|template_written|llm_completion|message_sent|follow_up|reply_received)/i);
    }
  });
});
