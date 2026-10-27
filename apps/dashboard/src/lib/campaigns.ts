/**
 * Read models of the campaign pages: which milestone each of its choice points serves, and
 * its milestones with attempts and cost per Target. Read off the catalogue and the simulator.
 */

import { isOurs, targetBreakdown, type Campaign, type OutcomeId, type WorldClient } from "@gtm-factory/core";
import type { Model } from "./model";

/** The milestone each choice point of a campaign is scored on. */
export function milestoneOfPoints(model: Model, campaign: Campaign): Map<string, OutcomeId> {
  const out = new Map<string, OutcomeId>();
  for (const p of model.session.choicePoints()) {
    if (p.campaignId !== campaign.id) continue;
    const m = model.session.milestoneOfPoint(p.point, campaign.id);
    if (m) out.set(p.point, m);
  }
  return out;
}

/**
 * A campaign's milestones as decisions read them: attempts per Target Unit, the cost of
 * this outcome alone and the cost from Start (cumulative, the one the return reads).
 */
export function campaignMilestones(model: Model, campaign: Campaign) {
  const rows = model.session.milestoneEstimates(campaign);
  const costs = model.session.milestoneCosts(campaign);
  const priced = rows.length > 0 && rows.every((l) => l.yieldRate !== null && l.costPerAttempt !== null && l.yieldRate > 0);
  const per = priced ? targetBreakdown(rows.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! }))) : rows.map(() => null);
  return rows.map((l, i) => ({ ...l, attemptsPerTarget: per[i]?.attemptsPerTarget ?? null, costPerTarget: per[i]?.costPerTarget ?? null, costOfOutcome: costs[i]?.costOfOutcome ?? null, costFromStart: costs[i]?.costFromStart ?? null }));
}

/** A campaign id no other campaign holds. */
export function freshCampaignId(model: Model, base: string): string {
  const taken = new Set(model.campaigns.map((c) => c.id));
  let i = 1;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** The script another party performs that states who to reach (the client's own words for its audience). */
export function clientAudienceScript(model: Model): string | null {
  const outcome = model.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired);
  if (!outcome) return null;
  return model.catalogue.scriptsOf(outcome.id).find((s) => !isOurs(s))?.id ?? null;
}

/** A brand-new client, its objects (other than who to reach) copied from a client of the world. */
export function newClient(model: Model, input: { name: string; audienceText: string; offerOutcomes: OutcomeId[]; lifetimeRevenue?: number; outcomeValues?: Record<string, number> }): WorldClient {
  const n = model.clients.length + 1;
  let k = n;
  while (model.clients.some((c) => c.brand.id === `brand-${k}`)) k++;
  const brandId = `brand-${k}`;
  const from = model.clients[0];
  const audience = model.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired)?.id;
  const seeds = (from?.seeds ?? []).filter((s) => model.catalogue.outcome(s.outcome)?.subject === "brand" && s.outcome !== audience).map((s) => ({ ...s }));
  const script = clientAudienceScript(model);
  if (audience && script && input.audienceText.trim()) seeds.push({ outcome: audience, scriptId: script, dynasty: "stated-by-client", version: 1, name: "The client's words", text: input.audienceText.trim(), conditions: [] });
  return {
    org: { id: `org-${k}`, name: input.name },
    brand: { id: brandId, orgId: `org-${k}`, name: input.name, tactics: { ...(from?.brand.tactics ?? {}) } },
    offer: {
      id: `offer-${k}`,
      brandId,
      name: `${input.name} main offer`,
      outcomes: input.offerOutcomes,
      ...(input.lifetimeRevenue ? { lifetimeRevenue: input.lifetimeRevenue } : {}),
      ...(input.outcomeValues ? { outcomeValues: input.outcomeValues } : {}),
    },
    campaigns: [],
    seeds,
    connected: [],
    truthMultiplier: 1,
    organicPerDay: 0,
  };
}
