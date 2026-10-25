import { it } from "vitest";
import { SimulationSession } from "../src";
import { defaultWorld } from "./helpers";

it("scratch2", () => {
  const s = new SimulationSession(defaultWorld());
  s.run(40);
  const out: string[] = [];
  for (const c of ["campaign-2", "campaign-1"]) {
    const e = s.economics(c);
    out.push(`${c} exp ${e.expected.value} meas ${e.measured.value} spend ${e.spendCents} msp ${e.measured.spendCents} cutoff ${e.measured.cutoffDay}`);
    for (const l of e.legs) out.push(`   ${l.from}>${l.to} att ${l.attempts} reached ${l.reached} y ${l.yieldRate} c ${l.costPerAttempt}`);
    out.push("   play " + s.beliefsAt("play:lead_interested>meeting_booked", c).map((b) => `${b.option} r ${b.rate.toFixed(3)} c ${b.cost.toFixed(3)} n ${b.decisions.toFixed(0)} s ${b.successes.toFixed(1)}`).join(" | "));
  }
  console.log(out.join("\n"));
}, 600_000);
