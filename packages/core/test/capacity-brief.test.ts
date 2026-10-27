import { beforeAll, describe, expect, it } from "vitest";
import { SimulationSession } from "../src";
import { defaultWorld } from "./helpers";

let s: SimulationSession;
beforeAll(() => {
  s = new SimulationSession(defaultWorld());
  s.run(45);
}, 120_000);

const outcomeOf = (scriptId: string | null | undefined) => (scriptId ? s.catalogue.script(scriptId)?.outcome : undefined);

describe("capacity", () => {
  it("a script out of capacity today leaves today's picks; the order waits for tomorrow, nothing is lost", () => {
    const call = s.catalogue.script("cl_call")!;
    expect(call.capacity?.perDay).toBe(6);
    const perDay = new Map<number, number>();
    for (const r of s.runs.filter((x) => x.scriptId === "cl_call")) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(6);
    // Days at capacity are followed by more calls: the orders waited, they did not fail.
    const full = [...perDay].filter(([, n]) => n === 6).map(([d]) => d);
    expect(full.length).toBeGreaterThanOrEqual(3);
    expect(full.some((d) => (perDay.get(d + 1) ?? 0) > 0)).toBe(true);
    // The Plan ignores today's limits: it names the script even on a day it is full.
    expect(s.allowedScripts(s.campaign("campaign-outbound")!, "paid_client", false).map((x) => x.id)).toContain("cl_call");
  });

  it("a person types the capacity of a Client's team script; changing it changes the next day", () => {
    const t = new SimulationSession(defaultWorld());
    t.run(25);
    t.catalogue.setCapacity("cl_call", { perDay: 2, daysPerUnit: 7 });
    t.run(10);
    const late = t.runs.filter((r) => r.scriptId === "cl_call" && r.day >= 25);
    const perDay = new Map<number, number>();
    for (const r of late) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe("the strategy brief", () => {
  it("is judged once per Engine: an Engine judged out is never run for that campaign, and the Plan routes around it", () => {
    const ads = s.campaign("campaign-ads")!;
    expect(ads.verdicts?.reply_received).toBe("none");
    expect(s.runs.filter((r) => r.campaignId === ads.id && outcomeOf(r.scriptId) === "reply_received").length).toBe(0);
    const outbound = s.campaign("campaign-outbound")!;
    expect(outbound.verdicts?.lead_visited).toBe("none");
    expect(s.runs.filter((r) => r.campaignId === outbound.id && outcomeOf(r.scriptId) === "lead_visited").length).toBe(0);
    expect(s.routingOf(outbound).line).not.toContain("lead_visited");
  });

  it("a kept strategy filters the scripts of its Engine, and a stated cap and test length hold", () => {
    const t = new SimulationSession(defaultWorld());
    t.setVerdict("campaign-outbound", "reply_received", "reply_received#cold-email");
    t.run(15);
    const replies = t.runs.filter((r) => r.campaignId === "campaign-outbound" && r.day >= 1 && t.catalogue.script(r.scriptId ?? "")?.outcome === "reply_received");
    expect(replies.length).toBeGreaterThan(0);
    for (const r of replies) expect(t.catalogue.script(r.scriptId!)!.tactics.channel).toBe("Cold email");
    // The ads brief: at most 120 visits a day, for 30 days.
    const ads = s.campaign("campaign-ads")!;
    expect(ads.caps?.lead_visited).toBe(120);
    expect(ads.endDay).toBe(30);
    const visits = new Map<number, number>();
    for (const r of s.runs.filter((x) => x.campaignId === ads.id && outcomeOf(x.scriptId) === "lead_visited")) visits.set(r.day, (visits.get(r.day) ?? 0) + 1);
    expect(Math.max(...visits.values())).toBeLessThanOrEqual(120);
    expect(Math.max(...visits.keys())).toBeLessThan(30);
    expect(ads.status).toBe("paused");
  }, 120_000);

  it("a strategy on the subject: nobody who asked to stop is written to again, by any campaign", () => {
    const stopped = new Map<string, number>();
    for (const u of s.units) if (u.outcome === "unsubscribed") stopped.set(u.subject, Math.min(stopped.get(u.subject) ?? Infinity, u.day));
    expect(stopped.size).toBeGreaterThan(3);
    const written = s.units.filter((x) => (x.outcome === "message_written" || x.outcome === "follow_up_queued") && stopped.has(x.subject));
    expect(written.length).toBeGreaterThan(0);
    for (const u of written) expect(u.day, u.subject).toBeLessThanOrEqual(stopped.get(u.subject)!);
  });
});

describe("team tasks", () => {
  it("a person's script opens a task; the answer becomes the Unit, a no stops the order, an unanswered task closes on its due day", () => {
    const t = new SimulationSession(defaultWorld());
    t.run(25);
    const open = t.tasks();
    expect(open.length).toBeGreaterThan(2);
    for (const k of open) expect(t.catalogue.script(k.scriptId)?.form?.length).toBeGreaterThan(0);
    for (const k of open) expect(k.dueDay).toBeGreaterThanOrEqual(t.day - 1);
    const [yes, no] = open as [(typeof open)[number], (typeof open)[number]];
    t.answerTask(yes.id, { paid: true, amount: 6000, notes: "Signed the yearly plan" });
    const landed = t.units.find((u) => u.runId === yes.id.replace(/^task:/, ""))!;
    expect(landed.content).toMatchObject({ paid: true, notes: "Signed the yearly plan" });
    t.answerTask(no.id, { paid: false, notes: "Went with a competitor" });
    expect(t.units.some((u) => u.runId === no.id.replace(/^task:/, ""))).toBe(false);
    expect(t.tasks().map((x) => x.id)).not.toContain(no.id);
    expect(() => t.answerTask(no.id, { paid: true })).toThrow(/not open/);
  }, 120_000);
});
