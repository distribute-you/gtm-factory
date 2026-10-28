import { beforeAll, describe, expect, it } from "vitest";
import { SimulationSession } from "../src";
import { defaultWorld } from "./helpers";

let s: SimulationSession;
let brand: string;
beforeAll(() => {
  s = new SimulationSession(defaultWorld());
  s.run(30);
  brand = s.clients[0]!.brand.id;
}, 180_000);

const accountOf = (scriptId: string) => s.units.filter((u) => u.scriptId === scriptId && typeof u.content?.account === "string").map((u) => String(u.content!.account));
const roleOf = (id: string) => s.accountsOf(brand).find((a) => a.id === id)?.role;

describe("connected accounts", () => {
  it("each account is a Unit of the brand with its channel, its role and its counts", () => {
    const outcome = s.accountOutcome()!;
    const accounts = s.accountsOf(brand);
    expect(accounts.length).toBe(7);
    for (const a of accounts) expect(s.objectHead(brand, outcome, a.id)?.content?.role).toBe(a.role);
    // Several accounts share a role on a channel: three AI agent mailboxes.
    expect(accounts.filter((a) => a.channel === "Email" && a.role === "AI agent")).toHaveLength(3);
  });

  it("a sending script picks the account itself, among those with its role: the mailboxes share the load", () => {
    const used = accountOf("ce_morning");
    expect(used.length).toBeGreaterThan(100);
    for (const id of new Set(used)) expect(roleOf(id)).toBe("AI agent");
    const counts = ["mb-alex", "mb-sam", "mb-jo"].map((id) => used.filter((x) => x === id).length);
    expect(Math.min(...counts)).toBeGreaterThan(0.25 * Math.max(...counts));
  });

  it("same thread, same address: a follow-up leaves from the mailbox the first message left from", () => {
    const followUps = s.units.filter((u) => u.outcome === "follow_up_queued" && typeof u.content?.account === "string");
    expect(followUps.length).toBeGreaterThan(5);
    for (const f of followUps) {
      const sent = s.unit(f.materials.message_sent!)!;
      expect(f.content!.account).toBe(sent.content!.account);
    }
  });

  it("every message of the outbound campaign goes out from the AI agent; the brief kept that strategy per Engine", () => {
    const c = s.campaign("campaign-outbound")!;
    expect(c.verdicts?.message_queued).toBe("message_queued#ai-agent");
    const sent = s.units.filter((u) => u.campaignId === c.id && typeof u.content?.account === "string" && u.content?.via === "sent");
    expect(sent.length).toBeGreaterThan(50);
    for (const u of sent) expect(roleOf(String(u.content!.account))).toBe("AI agent");
  });

  it("messages are read on every account, whatever its role", () => {
    const read = s.units.filter((u) => u.outcome === "message_received").map((u) => u.content?.role);
    for (const role of ["Personal", "Pro", "AI agent"]) expect(read).toContain(role);
  });

  it("a welcome goes once per new client, from the Pro number", () => {
    const welcomes = s.units.filter((u) => u.outcome === "welcomed");
    expect(welcomes.length).toBeGreaterThan(0);
    expect(new Set(welcomes.map((u) => u.subject)).size).toBe(welcomes.length);
    for (const w of welcomes) expect(roleOf(String(w.content!.account))).toBe("Pro");
  });

  it("an answer on the Pro number is a task for the client's team, never sent by the agent", () => {
    const answers = s.units.filter((u) => u.outcome === "answered_by_you");
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      expect(a.performedBy).toBe("Client's team");
      expect(roleOf(String(a.content!.account))).toBe("Pro");
    }
  });

  it("changing an account's role is a new version of its Unit, and the scripts follow at once", () => {
    const t = new SimulationSession(defaultWorld());
    t.run(5);
    const b = t.clients[0]!.brand.id;
    t.setAccountRole(b, "mb-jo", "Personal");
    expect(t.accountsOf(b).find((a) => a.id === "mb-jo")?.role).toBe("Personal");
    t.run(3);
    const after = t.units.filter((u) => u.scriptId === "ce_morning" && u.day >= 6).map((u) => u.content?.account);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toContain("mb-jo");
  }, 120_000);
});
