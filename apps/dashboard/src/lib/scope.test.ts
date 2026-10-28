import { describe, expect, it } from "vitest";
import { buildModel, convergenceOf, leadRows, scopedCampaigns, scopedLedger, scopedRuns } from "./model";
import { resolveScope, scopeBrandIds, type ScopeOrg } from "./scope";
import { WORLD, replay } from "./world";

describe("the switch at the top of the sidebar scopes every page", () => {
  const orgs: ScopeOrg[] = [
    { id: "o1", name: "One", brands: [{ id: "b1", name: "B1", offers: [{ id: "x1", name: "X1" }, { id: "x2", name: "X2" }] }, { id: "b2", name: "B2", offers: [] }] },
    { id: "o2", name: "Two", brands: [{ id: "b3", name: "B3", offers: [] }] },
  ];

  it("opens on the first brand and offer; All brands and All offers stay explicit picks", () => {
    expect(resolveScope(orgs, null)).toEqual({ orgId: "o1", brandId: "b1", offerId: "x1" });
    expect(resolveScope(orgs, { orgId: "o1", brandId: null, offerId: null })).toEqual({ orgId: "o1", brandId: null, offerId: null });
    expect(resolveScope(orgs, { orgId: "o1", brandId: "b1", offerId: null })).toEqual({ orgId: "o1", brandId: "b1", offerId: null });
    // All brands covers every brand of the organization, never another organization's.
    expect(scopeBrandIds(orgs, { orgId: "o1", brandId: null, offerId: null })).toEqual(["b1", "b2"]);
    expect(scopeBrandIds(orgs, { orgId: "o1", brandId: "b2", offerId: null })).toEqual(["b2"]);
  });

  const { world, session } = replay(WORLD.seed, [], 12);
  const model = buildModel(world, session);
  const brand = model.clients[0]!.brand.id;

  it("each page's read model holds only the scope's data", () => {
    // Campaigns, runs and the ledger: another brand's scope holds nothing of this one.
    expect(scopedCampaigns(model, brand).length).toBe(model.campaigns.filter((c) => c.brandId === brand).length);
    expect(scopedCampaigns(model, "another-brand")).toEqual([]);
    expect(scopedRuns(model, "another-brand")).toEqual([]);
    expect(scopedLedger(model, "another-brand").totalSpendCents).toBe(0);
    expect(scopedLedger(model, brand).reconciles).toBe(true);
    // Leads: only the brand's people.
    for (const l of leadRows(model, brand)) expect(l.person.brandId).toBe(brand);
    expect(leadRows(model, "another-brand")).toEqual([]);
    // Research: only the picks of the scope's campaigns (two scopes that must differ).
    const one = model.campaigns[0]!.id;
    const scoped = convergenceOf(model, new Set([one]));
    const all = convergenceOf(model, null);
    const picks = (xs: typeof all) => xs.reduce((x, p) => x + p.picks, 0);
    expect(picks(scoped)).toBeGreaterThan(0);
    expect(picks(scoped)).toBeLessThan(picks(all));
    for (const p of scoped) expect(Object.keys(p.bestByCampaign)).toEqual([one]);
  }, 120_000);
});
