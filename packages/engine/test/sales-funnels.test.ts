import { describe, expect, it } from "vitest";
import { Catalogue, SimulationSession, START, salesFunnelId, salesPathId } from "../src";
import { defaultWorld, worldData } from "./helpers";

describe("sales paths and sales funnels are named catalogue objects", () => {
  it("a path and a funnel get a plain name on first sight, keep it, and never share it", () => {
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
    expect(f.pathId).toBe(p.id);
    const g = c.nameSalesFunnel(START, line, ["reply_judging", "team_booking"]);
    expect(g.name).not.toBe(f.name);
    // Asked again: the same names, nothing renamed.
    expect(c.nameSalesFunnel(START, line, ["reply_judging", "ai_booking"]).name).toBe(f.name);
    expect(new Set(c.salesFunnels.map((x) => x.name)).size).toBe(c.salesFunnels.length);
    expect(c.funnelsOf(p.id).map((x) => x.id)).toEqual([f.id, g.id]);
  });

  it("a campaign runs a named sales funnel; one seed gives the same names", () => {
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
      expect(a.catalogue.salesPath(f!.pathId)?.line).toEqual(c.line);
    }
  });

  it("every pipe a leg runs through: the follow-up leg runs the follow-up, the mailbox's replies, then the reply judge", () => {
    const s = new SimulationSession(defaultWorld());
    s.run(12);
    const follow = s.campaigns().find((c) => c.start !== START)!;
    const legs = s.campaignPipes(follow);
    const main = legs[0]!.filter((p) => p.main).map((p) => p.pipeId);
    expect(main).toEqual(["follow_up", "follow_up_replies", "reply_judging"]);
    expect(legs[0]!.filter((p) => !p.main).map((p) => p.pipeId)).toContain("llm");
  });
});
