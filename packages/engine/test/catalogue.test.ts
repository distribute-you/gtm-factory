import { describe, expect, it } from "vitest";
import { START, defaultPlayId, followsStrategy, loadSeedCatalogue } from "../src";
import { readSeed, smallCatalogue } from "./helpers";

describe("seed catalogue", () => {
  it("loads and validates", () => {
    const { catalogue, issues, notes } = loadSeedCatalogue(readSeed());
    expect(issues).toEqual([]);
    expect(catalogue.channels.length).toBe(53);
    expect(catalogue.steps.length).toBe(22);
    expect(catalogue.pipes.length).toBe(92);
    expect(catalogue.leadTracks.map((t) => t.id)).toEqual(["crm_lifecycle", "website_visits"]);
    expect(catalogue.triggers.length).toBeGreaterThanOrEqual(32);
    // Every pipe has its default play.
    for (const p of catalogue.pipes) expect(catalogue.play(defaultPlayId(p.id))).toBeDefined();
    // The loader says out loud what it had to complete.
    for (const n of notes) expect(n).toMatch(/added as a condition trigger/);
  });

  it("reads lead states and their lead track from the data", () => {
    const { catalogue } = loadSeedCatalogue(readSeed());
    expect(catalogue.step("meeting_booked")?.leadState).toEqual({ state: "meeting_booked", leadTrack: "crm_lifecycle", rank: 2 });
    expect(catalogue.step("website_visit")?.leadState).toEqual({ state: "lead_visited", leadTrack: "website_visits", rank: 1 });
    expect(catalogue.pipesFrom(START).length).toBeGreaterThan(0);
  });

  it("has no word we never use", () => {
    expect(JSON.stringify(readSeed()).toLowerCase()).not.toContain("agency");
  });
});

describe("catalogue at run time", () => {
  it("adds, retires and removes pipes", () => {
    const c = smallCatalogue();
    expect(c.validate()).toEqual([]);
    c.add("pipes", { id: "x|start_to_booked", channel: "ads", from: START, to: "booked", mode: "proactive", triggerId: null, maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0 } });
    expect(c.pipesInto("booked").map((p) => p.id)).toContain("x|start_to_booked");
    c.retire("pipes", "x|start_to_booked");
    expect(c.pipesInto("booked").map((p) => p.id)).not.toContain("x|start_to_booked");
    c.remove("pipes", "x|start_to_booked");
    expect(c.pipe("x|start_to_booked")).toBeUndefined();
    expect(c.play(defaultPlayId("x|start_to_booked"))).toBeUndefined();
  });

  it("retiring a channel takes its pipes out", () => {
    const c = smallCatalogue();
    c.retire("channels", "ads");
    expect(c.pipesFrom(START).map((p) => p.id)).toEqual(["email|start_to_interested"]);
  });

  it("flags invalid objects", () => {
    const c = smallCatalogue();
    c.add("pipes", { id: "bad", channel: "nope", from: "ghost", to: "interested", mode: "reactive", triggerId: null, maturity: { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0 } });
    const messages = c.validate().map((i) => i.message);
    expect(messages).toContain('unknown from step "ghost"');
    expect(messages).toContain('unknown channel "nope"');
    expect(messages).toContain("a reactive pipe waits on one trigger");
  });

  it("strategies filter workflows and slot options on their own subject", () => {
    const c = smallCatalogue();
    c.add("tactics", { id: "short", name: "Short message", appliesTo: "slot_option" });
    c.add("tactics", { id: "research", name: "Researches the company", appliesTo: "workflow" });
    c.add("strategies", { id: "brief", name: "Brief and researched", required: ["short", "research"], excluded: [] });
    c.add("plays", { id: "email-brief", pipeId: "email|start_to_interested", strategyId: "brief" });
    c.add("workflows", { id: "w1", dynasty: "w1", pipeId: "email|start_to_interested", kind: "ai", slots: ["template"], tactics: ["research"], costPerTrialCents: 10, status: "active" });
    c.add("workflows", { id: "w2", dynasty: "w2", pipeId: "email|start_to_interested", kind: "rules", slots: ["template"], tactics: [], costPerTrialCents: 5, status: "active" });
    c.add("slotOptions", { id: "t1", slot: "template", name: "Short", pipeId: "email|start_to_interested", tactics: ["short"], costPerTrialCents: 0, status: "active" });
    c.add("slotOptions", { id: "t2", slot: "template", name: "Long", pipeId: "email|start_to_interested", tactics: [], costPerTrialCents: 0, status: "active" });
    const play = c.play("email-brief")!;
    expect(c.workflowsFor(play).map((w) => w.id)).toEqual(["w1"]);
    expect(c.slotOptionsFor(play, "template").map((o) => o.id)).toEqual(["t1"]);
    const def = c.play(defaultPlayId("email|start_to_interested"))!;
    expect(c.workflowsFor(def).map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(followsStrategy(["a"], { id: "s", name: "s", required: [], excluded: ["a"] })).toBe(false);
  });
});
