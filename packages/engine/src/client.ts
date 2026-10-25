/**
 * The client model: org > brand > offer, the ICP in plain words, audiences,
 * campaigns and leads. Pure data plus a few helpers.
 */

import type { Catalogue, StepKey } from "./catalogue";

export interface Org {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  orgId: string;
  name: string;
  /** The ideal customer profile, in the client's own words. */
  icp: string;
}

/** A lifetime revenue figure and where it comes from. */
export interface LifetimeRevenue {
  /** Dollars. */
  amount: number;
  /** "stated" by the client, or the fleet median when the client did not state one. */
  label: "stated" | "expected";
}

export interface Offer {
  id: string;
  brandId: string;
  name: string;
  /** The steps this business has (a business with no signup never walks a signup). */
  steps: StepKey[];
  /** Lifetime revenue of a paid client, dollars, when the client stated it. */
  lifetimeRevenue?: number;
  /** Value of other target outcomes, dollars, when stated. */
  outcomeValues?: Record<StepKey, number>;
}

/** A condition on lead attributes: each listed attribute must take one of the values. */
export type SegmentRule = Record<string, string[]>;

export interface Audience {
  id: string;
  brandId: string;
  name: string;
  description: string;
  rule: SegmentRule;
  /** "expert" = proposed from the ICP; "discovered" = a winning segment the data found. */
  source: "expert" | "discovered";
  /** Segments never served again (losing segments). */
  exclusions: SegmentRule[];
}

export interface Campaign {
  id: string;
  offerId: string;
  /** The outcome this campaign is for (paid client by default). */
  target: StepKey;
  /** Spend per day, cents. */
  dailyBudgetCents: number;
  /** Total spend cap, cents. */
  maxBudgetCents?: number;
  /** Cap on leads served. */
  maxVolume?: number;
  status: "running" | "paused";
  /** The sales funnel the client launched (play ids from Start). Unset: the engine picks the funnel itself. */
  salesFunnel?: string[];
}

export interface Lead {
  id: string;
  brandId: string;
  attributes: Record<string, string>;
  /** Highest rank reached on each lead track, for this brand. */
  states: Record<string, number>;
}

export function matchesRule(attributes: Record<string, string>, rule: SegmentRule): boolean {
  for (const [attr, values] of Object.entries(rule)) {
    const v = attributes[attr];
    if (v === undefined || !values.includes(v)) return false;
  }
  return true;
}

/** Is a lead inside an audience (its rule, none of its exclusions)? */
export function inAudience(attributes: Record<string, string>, audience: Audience): boolean {
  return matchesRule(attributes, audience.rule) && !audience.exclusions.some((x) => matchesRule(attributes, x));
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/**
 * Lifetime revenue is asked, never blocking: stated when the client gave it,
 * else the fleet median of stated ones, labelled expected.
 */
export function resolveLifetimeRevenue(offer: Offer, fleetOffers: readonly Offer[]): LifetimeRevenue | null {
  if (offer.lifetimeRevenue !== undefined && offer.lifetimeRevenue > 0) return { amount: offer.lifetimeRevenue, label: "stated" };
  const m = median(fleetOffers.map((o) => o.lifetimeRevenue ?? NaN));
  return m === null ? null : { amount: m, label: "expected" };
}

/** Value of reaching a target outcome for an offer. */
export function targetValue(
  offer: Offer,
  target: StepKey,
  fleetOffers: readonly Offer[],
  catalogue: Catalogue,
): LifetimeRevenue | null {
  const stated = offer.outcomeValues?.[target];
  if (stated !== undefined) return { amount: stated, label: "stated" };
  const ltr = resolveLifetimeRevenue(offer, fleetOffers);
  const step = catalogue.step(target);
  // The lifetime revenue is the value of the top state of a lead track (a paid client).
  if (step?.leadState && isTopOfTrack(catalogue, step.leadState.leadTrack, step.leadState.rank)) return ltr;
  const m = median(fleetOffers.map((o) => o.outcomeValues?.[target] ?? NaN));
  return m === null ? null : { amount: m, label: "expected" };
}

function isTopOfTrack(catalogue: Catalogue, leadTrack: string, rank: number): boolean {
  return !catalogue.steps.some((s) => s.leadState?.leadTrack === leadTrack && s.leadState.rank > rank);
}

/** Expert step: the client's ICP in plain words becomes 2 or 3 natural-language audiences. */
export interface AudienceProposal {
  name: string;
  description: string;
  rule: SegmentRule;
}

/** Whoever writes the proposals (a person, an LLM, a rule set) implements this. */
export type AudienceExpert = (brand: Brand) => AudienceProposal[];

export function audiencesFromExpert(brand: Brand, expert: AudienceExpert): Audience[] {
  const proposals = expert(brand);
  if (proposals.length < 1 || proposals.length > 3) {
    throw new Error(`the expert step proposes 1 to 3 audiences, got ${proposals.length}`);
  }
  return proposals.map((p, i) => ({
    id: `${brand.id}:audience:${i + 1}`,
    brandId: brand.id,
    name: p.name,
    description: p.description,
    rule: p.rule,
    source: "expert",
    exclusions: [],
  }));
}
