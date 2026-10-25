import { it } from "vitest";
import { SimulationSession, convergence, shareOnBest } from "../src";
import { defaultWorld } from "./helpers";

it("scratch", () => {
  const t0 = Date.now();
  const s = new SimulationSession(defaultWorld(Number(process.env.SEED ?? 11)));
  s.run(60);
  const out: string[] = [`t=${Date.now() - t0}`];
  for (const pc of convergence(s)) out.push(`${pc.point.padEnd(48)} picks ${String(pc.picks).padStart(6)} d10 ${(100 * (shareOnBest(pc, 0, 10) ?? 0)).toFixed(0)} d30 ${(100 * (shareOnBest(pc, 20, 30) ?? 0)).toFixed(0)} d60 ${(100 * (shareOnBest(pc, 50, 60) ?? 0)).toFixed(0)}`);
  for (const c of s.campaigns()) { const e = s.economics(c.id); out.push(`${c.id} exp ${e.expected.value?.toFixed(1)} [${e.expected.low?.toFixed(1)},${e.expected.high?.toFixed(1)}] meas ${e.measured.value?.toFixed(1)} [${e.measured.low?.toFixed(1)},${e.measured.high?.toFixed(1)}] n ${e.measured.targets}`); }
  console.log(out.join("\n"));
}, 600_000);
