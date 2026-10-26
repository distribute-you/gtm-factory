import { it } from "vitest";
import { SimulationSession, convergence, shareOnBest } from "../src";
import { defaultWorld } from "./helpers";
it("probe", () => {
  const t0 = Date.now();
  const s = new SimulationSession(defaultWorld(Number(process.env.SEED ?? 11)));
  s.run(Number(process.env.DAYS ?? 60));
  console.log("ms", Date.now() - t0, "runs", s.runs.length, "units", s.units.length, "dec", s.decisions.length, "pushes", s.pushes.length);
  for (const c of s.campaigns()) { const e = s.economics(c.id); console.log("C", c.id, "spend", e.spendCents, "valueOurs", e.valueOurs, "other", e.valueOther, "exp", e.expected.value?.toFixed(2), "meas", e.measured.value?.toFixed(2), e.measured.targets, JSON.stringify(e.legs.map(l=>[l.attempts,l.reached]))); }
  for (const pc of convergence(s)) console.log("P", pc.point, pc.picks, JSON.stringify(pc.bestByCampaign), shareOnBest(pc, 50, 60)?.toFixed(2), shareOnBest(pc, 0, 10)?.toFixed(2));
  for (const p of s.proposals) if (p.kind === "audience") console.log("PR", p.day, p.campaignId);
  const point = process.env.POINT;
  if (point) {
    for (const c of ["campaign-1", "campaign-2", "campaign-3"]) console.log("B", c, JSON.stringify(s.beliefsAt(point, c).map((b) => [b.option, +(b.rate * 100).toFixed(2), +b.cost.toFixed(3), Math.round(b.decisions), +b.successes.toFixed(1)])));
    const sr = s.pickSeries(point, "campaign-1");
    console.log("S", JSON.stringify([...sr].map(([o, a]) => [o, a.join(",")])));
  }
});
