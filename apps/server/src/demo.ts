/**
 * The demo brand: the public fictional world's client (Northwind Analytics), seeded once so this
 * GTM Factory is never empty. Its organization, brand, offer, the Units it starts with (its offer
 * in its words, its ICPs, its templates) and its three campaigns, PAUSED: a person launches one
 * to watch it run on the mocked vendors.
 */

import { START, type Script } from "@gtm-factory/core";
import { one, q } from "./db";
import { FACTORIES, PERFORMERS, WORLD, rowOfPerformer } from "./catalogue-seed";
import { newId } from "./factory";

export const DEMO_BRAND = "northwind";
const DEMO_ORG = "northwind-org";
const DEMO_OFFER = "northwind-offer";

export async function seedDemo(): Promise<boolean> {
  if (await one(`SELECT id FROM brands WHERE id = $1`, [DEMO_BRAND])) return false;
  const client = WORLD.clients[0]!;
  const seeds = client.seeds;
  const offerText = seeds.find((s) => s.outcome === "offer_described")?.text ?? client.offer.name;
  const icpText = seeds.find((s) => s.outcome === "audience_built")?.text ?? "";
  await q(
    `INSERT INTO brands (id, name, website, offer, icp, lifetime_value_cents, test, factory, org_id, org_name) VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9)`,
    [DEMO_BRAND, client.brand.name, "https://northwind.test.invalid", offerText, icpText, Math.round((client.offer.lifetimeRevenue ?? 6000) * 100), FACTORIES.ours, DEMO_ORG, client.org.name],
  );
  await q(`INSERT INTO offers (id, brand_id, name) VALUES ($1,$2,$3)`, [DEMO_OFFER, DEMO_BRAND, client.offer.name]);
  const performer = (scriptId: string) => {
    const s = WORLD.catalogue.scripts.find((x) => x.id === scriptId) as Script | undefined;
    return String(s?.tactics.performed_by ?? PERFORMERS.ours);
  };
  for (const s of seeds) {
    await q(
      `INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, factory, dynasty, version, name, parent_dynasty, content) VALUES ($1,$2,'brand',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId("unit"), s.outcome, DEMO_BRAND, DEMO_BRAND, rowOfPerformer(performer(s.scriptId)), s.dynasty, s.version, s.name, s.parentDynasty ?? null, JSON.stringify({ text: s.text, ...(s.conditions ? { conditions: s.conditions } : {}) })],
    );
  }
  for (const c of client.campaigns) {
    const read = WORLD.truth.briefs?.[c.id] ?? {};
    await q(
      `INSERT INTO campaigns (id, brand_id, offer_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, strategies, start_outcome, target, brief, verdicts, caps, test_days, description, budget_period_days)
       VALUES ($1,$2,$3,$4,'','',$5,'[]','paused',$6,'{}',$7,$8,$9,$10,$11,$12,$13,$14)`,
      [`northwind-${c.id.replace(/^campaign-/, "")}`, DEMO_BRAND, DEMO_OFFER, c.name, JSON.stringify([c.start ?? START, c.target]), c.dailyBudgetCents, c.start, c.target, c.brief, JSON.stringify(read.verdicts ?? {}), JSON.stringify(read.caps ?? {}), read.days ?? null, c.description ?? "", c.budgetPeriodDays ?? 1],
    );
  }
  return true;
}

/**
 * GTM Factory v10 on an existing app: the demo brand gets the campaigns the fictional world added
 * since it was seeded (PAUSED). No account is seeded: every account here is one a person connected
 * (owner 2026-10-28, nothing fake on factory). Runs at every boot; adds only what is missing.
 */
export async function seedAccounts(): Promise<number> {
  let added = 0;
  if (await one(`SELECT id FROM brands WHERE id = $1`, [DEMO_BRAND])) {
    for (const c of WORLD.clients[0]!.campaigns) {
      const id = `northwind-${c.id.replace(/^campaign-/, "")}`;
      if (await one(`SELECT id FROM campaigns WHERE id = $1`, [id])) continue;
      const read = WORLD.truth.briefs?.[c.id] ?? {};
      await q(
        `INSERT INTO campaigns (id, brand_id, offer_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, strategies, start_outcome, target, brief, verdicts, caps, test_days, description, budget_period_days)
         VALUES ($1,$2,$3,$4,'','',$5,'[]','paused',$6,'{}',$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, DEMO_BRAND, DEMO_OFFER, c.name, JSON.stringify([c.start ?? START, c.target]), c.dailyBudgetCents, c.start, c.target, c.brief, JSON.stringify(read.verdicts ?? {}), JSON.stringify(read.caps ?? {}), read.days ?? null, c.description ?? "", c.budgetPeriodDays ?? 1],
      );
      added++;
    }
    // The demo campaigns seeded before the campaign model get their description once.
    for (const c of WORLD.clients[0]!.campaigns) {
      if (c.description) await q(`UPDATE campaigns SET description = $2 WHERE id = $1 AND description = ''`, [`northwind-${c.id.replace(/^campaign-/, "")}`, c.description]);
    }
  }
  return added;
}
