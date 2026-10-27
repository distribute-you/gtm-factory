import { describe, expect, it } from "vitest";
import { Catalogue, SimulationSession, START, salesFunnelId, salesPathId } from "../src";
import { defaultWorld, worldData } from "./helpers";

describe("sales paths and sales funnels are views with a name", () => {
  it("a path and a funnel get a short plain name on first sight, keep it, and never share it", () => {
    const c = new Catalogue(worldData().catalogue);
    const line = ["lead_interested", "meeting_booked"];
    const peek = c.peekSalesPath(START, line);
    expect(c.salesPaths).toHaveLength(0);
    const p = c.nameSalesPath(START, line);
    expect(p).toEqual(peek);
    expect(p.id).toBe(salesPathId(START, line));
    expect(p.name).toBe("Meetings booked from the market");
    const f = c.nameSalesFunnel(START, line, ["reply_judging", "ai_booking"]);
    expect(f.id).toBe(salesFunnelId(START, line, ["reply_judging", "ai_booking"]));
    expect(f.name).toBe("Reply judge to meetings booked");
    expect(f.pathId).toBe(p.id);
    const g = c.nameSalesFunnel(START, line, ["reply_judging", "team_booking"]);
    expect(g.name).toBe("Reply judge, Your team books to meetings booked");
    // Asked again: the same names, nothing renamed.
    expect(c.nameSalesFunnel(START, line, ["reply_judging", "ai_booking"]).name).toBe(f.name);
    expect(new Set(c.salesFunnels.map((x) => x.name)).size).toBe(c.salesFunnels.length);
    expect(c.funnelsOf(p.id).map((x) => x.id)).toEqual([f.id, g.id]);
  });

  it("tells two paths apart by the states they pass through before numbering them", () => {
    const c = new Catalogue(worldData().catalogue);
    expect(c.nameSalesPath(START, ["paid_client"]).name).toBe("Paid clients from the market");
    expect(c.nameSalesPath(START, ["lead_interested", "paid_client"]).name).toBe("Paid clients from the market, via leads interested");
    expect(c.nameSalesPath(START, ["lead_interested", "meeting_booked", "paid_client"]).name).toBe("Paid clients from the market, via leads interested and meetings booked");
    expect(c.nameSalesPath(START, ["lead_interested", "meeting_attended", "paid_client"]).name).toBe("Paid clients from the market, via leads interested and meetings attended");
  });

  it("a campaign's tree is read as a named sales funnel; one seed gives the same names", () => {
    const run = () => {
      const s = new SimulationSession(defaultWorld());
      s.run(12);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.catalogue.salesFunnels.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.catalogue.salesFunnels)).toBe(JSON.stringify(b.catalogue.salesFunnels));
    for (const c of a.campaigns()) {
      const f = a.salesFunnelOf(c);
      expect(f).not.toBeNull();
      expect(a.catalogue.salesFunnel(f!.id)?.name).toBe(f!.name);
      const line = a.catalogue.salesPath(f!.pathId)!.line;
      expect(line[line.length - 1]).toBe(c.target);
      expect(line).toEqual(a.pathOf(c));
    }
  });

  it("every leg a step runs through: the follow-up step runs the follow-up, the mailbox's replies, then the reply judge", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(12);
    const follow = s.campaigns().find((c) => c.start !== START)!;
    const steps = s.campaignLegs(follow);
    const main = steps[0]!.filter((p) => p.main).map((p) => p.legId);
    expect(main).toEqual(["follow_up", "follow_up_replies", "reply_judging"]);
    expect(steps[0]!.filter((p) => !p.main).map((p) => p.legId)).toContain("llm");
    // Each Material of the script a leg runs names the leg that supplies it.
    const judge = steps[0]!.find((p) => p.legId === "reply_judging")!;
    expect(judge.materials.find((m) => m.material === "reply_received")?.leg).toBe("follow_up_replies");
    expect(judge.materials.find((m) => m.material === "llm_completion")?.leg).toBe("llm");
  });
});
