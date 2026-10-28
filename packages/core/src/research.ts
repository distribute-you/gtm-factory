/**
 * What the Research page reads, from the Rating's own beliefs only: nothing here knows a hidden
 * truth. A running GTM Factory and the demo compute the same figures from the same inputs.
 */

import { createRng } from "./rng";

/** A candidate as the Rating believes it today: its rate of reaching the next milestone (mean and margin) and its cost. */
export interface BeliefView {
  id: string;
  rate: number;
  rateSd: number;
  /** Dollars per decision, believed. */
  cost: number;
}

/**
 * The chance each candidate is the best by value per dollar, from the beliefs: draw each rate
 * from its belief (a normal at its mean and margin, never below zero), keep the best per draw,
 * count. Seeded by the ids, so the same beliefs always give the same answer.
 */
export function chanceOfBest(candidates: readonly BeliefView[], draws = 4000): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of candidates) out[c.id] = 0;
  if (candidates.length === 0) return out;
  if (candidates.length === 1) return { [candidates[0]!.id]: 1 };
  const rng = createRng(candidates.map((c) => c.id).join("|"));
  for (let i = 0; i < draws; i++) {
    let best = -1;
    let bestId = candidates[0]!.id;
    for (const c of candidates) {
      const score = Math.max(0, c.rate + c.rateSd * rng.normal()) / Math.max(c.cost, 1e-6);
      if (score > best) {
        best = score;
        bestId = c.id;
      }
    }
    out[bestId]! += 1;
  }
  for (const k of Object.keys(out)) out[k]! /= draws;
  return out;
}

/** One day of picks at one place, each candidate as the Rating believed it that day. */
export interface DayOfPicks {
  candidates: { id: string; picks: number; meanScore: number; costCents: number; rateSd: number; rate: number }[];
}

/**
 * The value lost that day, as the Rating itself estimated it: the dollars spent on a candidate
 * it believed weaker than its best that day, weighted by how much weaker (spend x (1 - its value
 * per dollar / the best's)). It falls as the beliefs settle and the picks follow the best. Also
 * the best's margin that day (how sure the Rating was of it).
 */
export function estimatedRegret(day: DayOfPicks): { regretCents: number; bestMargin: number | null } {
  const best = [...day.candidates].sort((a, b) => b.meanScore - a.meanScore)[0];
  if (!best || best.meanScore <= 0) return { regretCents: 0, bestMargin: null };
  let lost = 0;
  for (const c of day.candidates) lost += c.picks * c.costCents * Math.max(0, 1 - c.meanScore / best.meanScore);
  return { regretCents: lost, bestMargin: best.rateSd };
}
