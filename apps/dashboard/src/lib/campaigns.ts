/**
 * Read models of the campaign pages: which pipes a campaign plays, which leg each of its
 * choice points serves, and its legs with leads needed. Read off the catalogue and the engine.
 */

import { hiddenTruth, legBreakdown, type Campaign, type OutcomeId, type Pipe, type WorldClient } from "@gtm-factory/engine";
import { campaignLine, linePipes } from "./funnels";
import type { Model } from "./model";

function memo<T>(model: Model, key: string, f: () => T): T {
  if (model.memo.has(key)) return model.memo.get(key) as T;
  const v = f();
  model.memo.set(key, v);
  return v;
}

/** The leg end each choice point of a campaign is scored on (cached per day). */
export function legEndOfPoints(model: Model, campaign: Campaign): Map<string, OutcomeId> {
  return memo(model, `legEnd:${campaign.id}`, () => {
    const out = new Map<string, OutcomeId>();
    campaign.line.forEach((to, k) => {
      for (const point of hiddenTruth(model.session, campaign, k).keys()) if (!out.has(point)) out.set(point, to);
    });
    return out;
  });
}

/** Every pipe a campaign runs through today, in the order its funnel line draws them. */
export function playedPipes(model: Model, campaign: Campaign): Pipe[] {
  return linePipes(campaignLine(model, campaign));
}

/** A campaign's legs as decisions read them, with the leads each leg needs per target outcome. */
export function campaignLegs(model: Model, campaign: Campaign) {
  const legs = model.session.legEstimates(campaign);
  const priced = legs.every((l) => l.yieldRate !== null && l.costPerAttempt !== null);
  const per = priced ? legBreakdown(legs.map((l) => ({ costPerAttempt: l.costPerAttempt!, yieldRate: l.yieldRate! }))) : legs.map(() => null);
  return legs.map((l, i) => ({ ...l, leadsNeeded: per[i]?.leadsNeeded ?? null, costPerTarget: per[i]?.costPerTarget ?? null }));
}

/** A campaign id no other campaign holds. */
export function freshCampaignId(model: Model, base: string): string {
  const taken = new Set(model.campaigns.map((c) => c.id));
  let i = 1;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** The script of another factory that states who to reach (a pipe whose output holds an audience). */
export function clientAudienceScript(model: Model): string | null {
  const outcome = model.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired);
  if (!outcome) return null;
  const pipe = model.catalogue.providersOf(outcome.id).find((p) => !model.catalogue.isOurs(p));
  return pipe ? model.catalogue.dynastiesOf(pipe.id)[0]?.id ?? null : null;
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
