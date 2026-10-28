/**
 * Reads behind the Today charts, the Companies page and the ICPs page (factory API: GET /series,
 * GET /companies, GET /proposals, and the figures on GET /objects). The simulator serves the same
 * routes in the browser; a field only a simulator knows (its world's hidden truth) is left out here.
 */

import type { ApiCompany, ApiObjectDynasty, ApiProposal, ApiSeries, Catalogue } from "@gtm-factory/core";
import { q } from "./db";
import { cents } from "./read";
import { performerOfRow } from "./catalogue-seed";
import { shownBrand } from "./visibility";

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Spend and Units landed per UTC day, from the first day anything ran to today (brand filter optional). */
export async function seriesOut(brandId: string | null): Promise<ApiSeries> {
  const brand = brandId ? `AND brand_id = $1` : "";
  const params = brandId ? [brandId] : [];
  const spend = await q<{ day: string; m: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(spend_micro)::bigint AS m FROM runs WHERE brand_id IS NOT NULL AND ${shownBrand("brand_id")} ${brand} GROUP BY 1`,
    params,
  );
  const units = await q<{ day: string; outcome: string; n: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, outcome, count(*)::int AS n FROM units
      WHERE subject_kind = 'lead' AND subject_id NOT LIKE 'co:%' AND brand_id IS NOT NULL AND ${shownBrand("brand_id")} ${brand} GROUP BY 1, 2`,
    params,
  );
  const known = [...spend.map((r) => r.day), ...units.map((r) => r.day)].sort();
  if (known.length === 0) return { days: [], spendCents: [], outcomes: {} };
  const days: string[] = [];
  for (let t = Date.parse(`${known[0]}T00:00:00Z`); t <= Date.now(); t += DAY_MS) days.push(isoDay(t));
  const at = new Map(days.map((d, i) => [d, i]));
  const spendCents = days.map(() => 0);
  for (const r of spend) if (at.has(r.day)) spendCents[at.get(r.day)!] = cents(Number(r.m));
  const outcomes: Record<string, number[]> = {};
  for (const r of units) if (at.has(r.day)) (outcomes[r.outcome] ??= days.map(() => 0))[at.get(r.day)!] = r.n;
  return { days, spendCents, outcomes };
}

/** The companies of the leads (one key per domain or name), with what one research of each served. */
export async function companiesOut(catalogue: Catalogue, brandId: string | null): Promise<ApiCompany[]> {
  const rows = await q<{ key: string; brand_id: string; name: string; leads: number; lead_id: string; reached: string[] | null; researched_at: string | null; uses: number }>(
    `WITH l AS (
       SELECT id, brand_id, company, 'co:' || lower(coalesce(domain, company, id)) AS key FROM leads
        WHERE ${shownBrand("brand_id")} ${brandId ? "AND brand_id = $1" : ""}
     )
     SELECT l.key, l.brand_id, max(coalesce(l.company, substr(l.key, 4))) AS name, count(*)::int AS leads, min(l.id) AS lead_id,
            (SELECT array_agg(DISTINCT u.outcome) FROM units u WHERE u.subject_id IN (SELECT id FROM l l2 WHERE l2.key = l.key)) AS reached,
            (SELECT min(u.created_at) FROM units u WHERE u.subject_id = l.key) AS researched_at,
            (SELECT count(*)::int FROM runs r WHERE r.consumed && ARRAY(SELECT u.id FROM units u WHERE u.subject_id = l.key)) AS uses
       FROM l GROUP BY l.key, l.brand_id`,
    brandId ? [brandId] : [],
  );
  const rank = (o: string) => catalogue.outcome(o)?.track?.rank ?? -1;
  return rows.map((r) => {
    const furthest = [...(r.reached ?? [])].filter((o) => rank(o) >= 0).sort((a, b) => rank(b) - rank(a))[0] ?? null;
    return { id: r.key, name: r.name, brandId: r.brand_id, values: {}, leads: r.leads, leadId: r.lead_id, furthest, researchedAt: r.researched_at ? new Date(r.researched_at).toISOString() : null, researchUses: r.uses };
  });
}

/** What splits proposed: this GTM Factory runs no split study yet, so nothing (the route answers, empty). */
export async function proposalsOut(): Promise<ApiProposal[]> {
  return [];
}

/** Picks to date and the 7-day share of each object dynasty, per brand, and the script that wrote its head. */
export async function objectFigures(catalogue: Catalogue, outcome: string, heads: { dynasty: string; brandId: string | null; runId: string | null; factory: string }[]): Promise<Map<string, Pick<ApiObjectDynasty, "picks" | "share" | "producer" | "proposed">>> {
  const picks = await q<{ brand_id: string; chosen: string; n: number; recent: number }>(
    `SELECT brand_id, chosen, count(*)::int AS n, count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS recent FROM choices WHERE material = $1 GROUP BY 1, 2`,
    [outcome],
  );
  const recentTotal = new Map<string, number>();
  for (const p of picks) recentTotal.set(p.brand_id, (recentTotal.get(p.brand_id) ?? 0) + p.recent);
  const runIds = heads.map((h) => h.runId).filter((x): x is string => !!x);
  const scripts = new Map((await q<{ id: string; script_id: string }>(`SELECT id, script_id FROM runs WHERE id = ANY($1)`, [runIds])).map((r) => [r.id, r.script_id]));
  const out = new Map<string, Pick<ApiObjectDynasty, "picks" | "share" | "producer" | "proposed">>();
  for (const h of heads) {
    const p = picks.find((x) => x.brand_id === h.brandId && x.chosen === h.dynasty);
    const total = recentTotal.get(h.brandId ?? "") ?? 0;
    const s = h.runId ? catalogue.script(scripts.get(h.runId) ?? "") : undefined;
    out.set(`${h.brandId}|${h.dynasty}`, {
      picks: p?.n ?? 0,
      share: total > 0 ? (p?.recent ?? 0) / total : 0,
      producer: s ? { scriptId: s.id, name: s.name, performedBy: String(s.tactics.performed_by ?? performerOfRow(h.factory)) } : null,
      proposed: null,
    });
  }
  return out;
}
