/**
 * Delayed outcomes. A reply can land 21 days after the email: a trial made 3
 * days ago has not had its full chance yet. Instead of waiting, each trial
 * counts for the share of its outcomes already due at its age (the delay
 * distribution's CDF): effective trials = sum over trials of F(age).
 */

import type { Counts } from "./stats";

/** Delay distribution as a CDF by whole day: cdf[d] = P(delay <= d days | outcome happens). */
export interface DelayDistribution {
  cdf: readonly number[];
}

/** Build a distribution from a probability mass function by day (normalised). */
export function delayFromPmf(pmf: readonly number[]): DelayDistribution {
  const total = pmf.reduce((s, x) => s + Math.max(0, x), 0);
  if (total <= 0) return { cdf: [1] };
  let acc = 0;
  const cdf = pmf.map((x) => {
    acc += Math.max(0, x) / total;
    return Math.min(1, acc);
  });
  cdf[cdf.length - 1] = 1;
  return { cdf };
}

/**
 * Geometric delays with a given mean, truncated at `horizonDays` (the rest
 * lands on the last day). `fixedDays` of the mean are certain (a Unit
 * advances one leg per tick): nothing lands before them.
 */
export function geometricDelay(meanDays: number, horizonDays: number, fixedDays = 0): DelayDistribution {
  if (meanDays <= 0 || horizonDays <= 0) return { cdf: [1] };
  const shift = Math.max(0, Math.min(Math.floor(fixedDays), Math.floor(meanDays), horizonDays));
  const q = 1 / (1 + Math.max(0, meanDays - shift));
  const pmf: number[] = [];
  for (let d = 0; d <= horizonDays; d++) pmf.push(d < shift ? 0 : q * Math.pow(1 - q, d - shift));
  return delayFromPmf(pmf);
}

/** Instant outcomes: everything is known the day the trial is made. */
export const NO_DELAY: DelayDistribution = { cdf: [1] };

/** Empirical distribution from the delays (days) of outcomes in a mature cohort. */
export function empiricalDelay(delaysDays: readonly number[], horizonDays: number): DelayDistribution {
  const pmf = new Array<number>(horizonDays + 1).fill(0);
  for (const d of delaysDays) pmf[Math.min(Math.max(0, Math.floor(d)), horizonDays)]! += 1;
  return delayFromPmf(pmf);
}

/** F(age): share of eventual outcomes already observed for a trial of this age. */
export function delayCdfAt(dist: DelayDistribution, ageDays: number): number {
  if (ageDays < 0) return 0;
  const i = Math.floor(ageDays);
  if (i >= dist.cdf.length) return 1;
  return dist.cdf[i] ?? 1;
}

/** Sum over trials of F(age): how many full trials the observed ones are worth today. */
export function effectiveTrials(agesDays: readonly number[], dist: DelayDistribution): number {
  let s = 0;
  for (const a of agesDays) s += delayCdfAt(dist, a);
  return s;
}

/** Trials made on a given day (age) and the successes already observed from them. */
export interface Cohort {
  ageDays: number;
  trials: number;
  successes: number;
}

/** Censoring-corrected counts: successes over effective trials. */
export function censoredCounts(cohorts: readonly Cohort[], dist: DelayDistribution): Counts {
  let trials = 0;
  let successes = 0;
  for (const c of cohorts) {
    trials += c.trials * delayCdfAt(dist, c.ageDays);
    successes += c.successes;
  }
  return { successes, trials: Math.max(trials, successes) };
}

/** Flash (everything to date) and mature (only cohorts old enough) views of the same figure. */
export interface MaturityViews {
  flash: Counts & { spend: number };
  mature: Counts & { spend: number };
  /** True when the mature view holds enough outcomes to be read on its own. */
  isMature: boolean;
}

export interface CohortWithSpend extends Cohort {
  spend: number;
}

export function maturityViews(
  cohorts: readonly CohortWithSpend[],
  maturity: { durationDays: number; outcomesRequired: number },
): MaturityViews {
  const flash = { successes: 0, trials: 0, spend: 0 };
  const mature = { successes: 0, trials: 0, spend: 0 };
  for (const c of cohorts) {
    flash.successes += c.successes;
    flash.trials += c.trials;
    flash.spend += c.spend;
    if (c.ageDays >= maturity.durationDays) {
      mature.successes += c.successes;
      mature.trials += c.trials;
      mature.spend += c.spend;
    }
  }
  return { flash, mature, isMature: mature.successes >= maturity.outcomesRequired };
}
