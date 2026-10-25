import { it } from "vitest";
import { SimulationSession, hiddenBest } from "../src";
import { defaultWorld } from "./helpers";

it("scratch", () => {
  const t0 = Date.now();
  const s = new SimulationSession(defaultWorld());
  const marks = [10, 30, 60];
  const out: string[] = [];
  for (const m of marks) {
    s.run(m - s.day);
    out.push(`day ${s.day} t=${Date.now() - t0}ms attempts=${s.attemptCount()} decisions=${s.decisions.length} occ=${s.occurrences.length}`);
  }
  for (const c of s.campaigns()) {
    const hb = hiddenBest(s, c);
    const e = s.economics(c.id);
    out.push(`${c.id} spend $${(e.spendCents/100).toFixed(0)} valueOurs ${e.valueOurs} exp ${e.expected.value?.toFixed(2)} [${e.expected.low?.toFixed(2)},${e.expected.high?.toFixed(2)}] meas ${e.measured.value?.toFixed(2)} [${e.measured.low?.toFixed(2)},${e.measured.high?.toFixed(2)}] targets ${e.measured.targets} legs ${e.legs.map(l=>`${l.to}:${l.attempts}/${l.reached}`).join(" ")}`);
    for (const [point, h] of hb) {
      const series = s.pickSeries(point, c.id);
      let total = 0; let last = 0; let lastBest = 0; let first = 0; let firstBest = 0;
      for (const [o, arr] of series) for (let d = 0; d < arr.length; d++) { total += arr[d]!; if (d >= 50) { last += arr[d]!; if (o === h.best) lastBest += arr[d]!; } if (d < 10) { first += arr[d]!; if (o === h.best) firstBest += arr[d]!; } }
      if (h.options.length < 2) continue;
      const opts = h.options.map(o => `${o.option}=${(o.perDollar).toFixed(3)}`).join(" ");
      out.push(`  ${point} picks=${total} best=${h.best} first=${first ? (firstBest/first*100).toFixed(0) : "-"}% last=${last ? (lastBest/last*100).toFixed(0) : "-"}% | ${opts}`);
    }
  }
  console.log(out.join("\n"));
}, 600_000);
