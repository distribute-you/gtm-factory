/**
 * The HTTP API (contract: factory-api.ts in the public core). JSON in and out,
 * errors as { error } in plain words. Served on the compose network only;
 * Caddy puts the owner's login in front of it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { PERFORMED_BY, START, type ApiCapacity, type ApiNewBrand, type ApiNewCampaign, type ApiNewObjectVersion, type ApiObjectDynasty, type ApiScriptStats, type ApiTaskAnswer, type ApiConnectStart } from "@gtm-factory/core";
import { one, q } from "./db";
import { OUTCOMES, FACTORIES, PERFORMERS, performerOfRow } from "./catalogue-seed";
import { loadCatalogue, newId, planOf, produce, milestoneLine, saveCatalogue, type Brand, type CampaignRow, type Unit } from "./factory";
import { judgeBrief } from "./brief";
import { brandOut, brandsOut, campaignFlows, campaignMilestones, campaignOut, campaignsOut, cents, evidenceForReads, ledgerOut, leadsOut, picksOut, placeLabel, planOut, plansFor, researchOut, runsOut, totalCounts, unitOut } from "./read";
import { answerTask, tasksOut } from "./tasks";
import { forkFromCode, sourceOf, upgradeFromCode } from "./code";
import { IMPORT_ON, shownBrand, shownBrandRow } from "./visibility";
import { accountsOut, setAccountRole } from "./accounts";
import { answerConnect, channels as connectChannels, connectState, disconnect, startConnect } from "./connect";
import { finishGoogle } from "./connect/google";
import { accountRow, type ConnectRow } from "./connect/store";
import { companiesOut, objectFigures, proposalsOut, seriesOut } from "./views";
import { WAITING, anyAdapter } from "./vendors";
import { isTicking, tickNow, TICK_SECONDS } from "./scheduler";
import { storageReport } from "./storage";
import { answerRequest, markSeen, pendingRequests, presenceOf } from "./pending";
import { CLAUDE_LOCAL } from "./vendors/claude-local";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function body<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "The body is not JSON.");
  }
}

function send(res: ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

const text = (v: unknown, name: string, max = 4000): string => {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${name} is required.`);
  if (v.length > max) throw new HttpError(400, `${name} is too long (${max} characters at most).`);
  return v.trim();
};

async function brandOr404(id: string): Promise<Brand> {
  const b = await one<Brand>(`SELECT * FROM brands b WHERE id = $1 AND ${shownBrandRow("b")}`, [id]);
  if (!b) throw new HttpError(404, "No such brand.");
  return b;
}

async function campaignOr404(id: string): Promise<CampaignRow> {
  const c = await one<CampaignRow>(`SELECT * FROM campaigns WHERE id = $1 AND ${shownBrand("brand_id")}`, [id]);
  if (!c) throw new HttpError(404, "No such campaign.");
  return c;
}

/** A campaign another party runs is read here, never launched, paused or capped. */
async function ownCampaignOr409(id: string): Promise<CampaignRow> {
  const c = await campaignOr404(id);
  if (c.factory !== FACTORIES.ours) throw new HttpError(409, `${performerOfRow(c.factory)} runs this campaign: this GTM Factory only reads it.`);
  return c;
}

type Handler = (req: IncomingMessage, params: string[], url: URL) => Promise<unknown>;
const routes: { method: string; re: RegExp; h: Handler }[] = [];
const route = (method: string, path: string, h: Handler) => routes.push({ method, re: new RegExp(`^${path.replace(/:[a-z]+/g, "([^/]+)")}/?$`), h });

route("GET", "/api/overview", async () => {
  const catalogue = await loadCatalogue();
  const brands = await q<Brand>(`SELECT * FROM brands b WHERE ${shownBrandRow("b")} ORDER BY created_at`);
  const campaigns = await q<CampaignRow>(`SELECT * FROM campaigns WHERE ${shownBrand("brand_id")} ORDER BY created_at DESC`);
  const spend = await one<{ today: number; total: number }>(
    `SELECT coalesce(sum(spend_micro) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS today, coalesce(sum(spend_micro), 0)::bigint AS total FROM runs WHERE brand_id IS NULL OR ${shownBrand("brand_id")}`,
  );
  const sched = await one<{ last_tick_at: string | null }>(`SELECT last_tick_at FROM scheduler_state WHERE id = 1`);
  return {
    now: new Date().toISOString(),
    catalogue: catalogue.snapshot(),
    brands: await brandsOut(brands),
    campaigns: await campaignsOut(campaigns),
    totals: { spentTodayCents: cents(spend?.today ?? 0), spentTotalCents: cents(spend?.total ?? 0), counts: await totalCounts() },
    recentPicks: await picksOut(catalogue, "", [], 20),
    recentRuns: await runsOut(catalogue, "", [], 20),
    pins: [
      { kind: "outcome", id: OUTCOMES.template, label: "Templates" },
      { kind: "outcome", id: OUTCOMES.llm, label: "LLMs" },
    ],
    scheduler: { lastTickAt: sched?.last_tick_at ? new Date(sched.last_tick_at).toISOString() : null, tickEverySeconds: TICK_SECONDS, running: isTicking(), waiting: anyAdapter() ? null : WAITING },
  };
});

route("GET", "/api/catalogue", async () => (await loadCatalogue()).snapshot());

route("GET", "/api/brands", async () => brandsOut(await q<Brand>(`SELECT * FROM brands b WHERE ${shownBrandRow("b")} ORDER BY created_at`)));

route("POST", "/api/brands", async (req) => {
  const b = await body<ApiNewBrand>(req);
  const name = text(b.name, "Name", 200);
  let website = text(b.website, "Website", 500);
  if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
  try {
    new URL(website);
  } catch {
    throw new HttpError(400, "The website is not a valid address.");
  }
  const offer = text(b.offer, "Offer");
  const icp = text(b.icp, "ICP");
  const ltv = b.lifetimeValueCents == null ? null : Number(b.lifetimeValueCents);
  if (ltv !== null && !(Number.isFinite(ltv) && ltv > 0)) throw new HttpError(400, "Lifetime revenue must be a positive amount.");
  const leads = Array.isArray(b.leads) ? b.leads : [];
  if (leads.length > 5000) throw new HttpError(400, "5,000 leads at most per list.");
  const id = newId("brand");
  await q(`INSERT INTO brands (id, name, website, offer, icp, lifetime_value_cents, test, org_id, org_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$1,$2)`, [id, name, website, offer, icp, ltv, !!b.test]);
  await q(`INSERT INTO offers (id, brand_id, name) VALUES ($1,$2,$3)`, [`offer_${id}`, id, offer.slice(0, 200)]);
  let pos = 0;
  for (const l of leads) {
    const email = typeof l.email === "string" && l.email.includes("@") ? l.email.trim().toLowerCase() : null;
    if (!email && !(l.firstName && (l.company || l.domain))) continue;
    await q(`INSERT INTO brand_leads (id, brand_id, position, email, first_name, last_name, company, title, domain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      newId("bl"), id, pos++, email, l.firstName ?? null, l.lastName ?? null, l.company ?? null, l.title ?? null, l.domain ?? email?.split("@")[1] ?? null,
    ]);
  }
  // What the client typed lands through the client's webhooks (another factory): the offer and the ICP.
  await produce(null, OUTCOMES.offer, { kind: "brand", id }, { text: offer }, { factory: FACTORIES.client, brandId: id, name: `${name} offer` });
  await produce(null, OUTCOMES.audience, { kind: "brand", id }, { text: icp }, { factory: FACTORIES.client, brandId: id, name: `${name} ICP` });
  return brandOut((await brandOr404(id))!);
});

route("GET", "/api/brands/:id/plans", async (_req, [id]) => {
  const catalogue = await loadCatalogue();
  return plansFor(catalogue, await brandOr404(id!));
});

route("GET", "/api/campaigns", async () => campaignsOut(await q<CampaignRow>(`SELECT * FROM campaigns WHERE ${shownBrand("brand_id")} ORDER BY created_at DESC`)));

route("POST", "/api/campaigns", async (req) => {
  const b = await body<ApiNewCampaign>(req);
  const brand = await brandOr404(text(b.brandId, "Brand"));
  if (brand.factory !== FACTORIES.ours) throw new HttpError(409, `${performerOfRow(brand.factory)} runs this brand's campaigns: this GTM Factory only reads them.`);
  const catalogue = await loadCatalogue();
  // A Campaign sells one offer of its brand.
  const offerId = text(b.offerId, "Offer", 200);
  if (!(await one(`SELECT 1 FROM offers WHERE id = $1 AND brand_id = $2`, [offerId, brand.id]))) throw new HttpError(400, "That offer is not one of this brand's.");
  // A Campaign fixes its start, its Target, its budget and its brief; its Plan is recomputed at every tick.
  const start = typeof b.start === "string" && b.start ? b.start : START;
  const target = text(b.target, "Target", 200);
  if (!catalogue.outcome(target)) throw new HttpError(400, "No such Target.");
  if (start !== START && !catalogue.outcome(start)) throw new HttpError(400, "No such start outcome.");
  const budget = Math.round(Number(b.dailyBudgetCents ?? 1000));
  if (!(budget >= 1 && budget <= 100_000)) throw new HttpError(400, "The daily cap must be between 1 cent and $1,000.");
  const volume = b.volume ? { units: Math.round(Number(b.volume.units)), periodDays: Math.round(Number(b.volume.periodDays)) } : null;
  if (volume && !(volume.units >= 1 && volume.periodDays >= 1)) throw new HttpError(400, "A volume is at least 1 new subject over at least 1 day.");
  const brief = typeof b.brief === "string" ? b.brief.trim().slice(0, 4000) : "";
  const id = newId("camp");
  let read;
  try {
    read = await judgeBrief(catalogue, brief);
  } catch (e) {
    throw new HttpError(502, `The brief could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  // A staff test brand reads its provided list only, so nobody outside staff is ever sourced.
  if (brand.test) read.verdicts[OUTCOMES.leadFound] = "lead_found#provided_list";
  const draft = { id, brand_id: brand.id, factory: FACTORIES.ours, target, start_outcome: start, verdicts: read.verdicts } as CampaignRow;
  const plan = planOf(catalogue, await evidenceForReads(catalogue), draft, brand);
  const line = milestoneLine(catalogue, plan, start);
  if (line.length === 0 || line[line.length - 1] !== target) throw new HttpError(400, "No Plan reaches that Target from that start for this brand.");
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM campaigns WHERE brand_id = $1`, [brand.id]);
  await q(
    `INSERT INTO campaigns (id, brand_id, offer_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, strategies, start_outcome, volume, target, brief, verdicts, caps, ends_on, plan, test_days)
     VALUES ($1,$2,$16,$3,$4,$5,$6,'[]','paused',$7,'{}',$8,$9,$10,$11,$12,$13,$14,$15,$17)`,
    [id, brand.id, `${brand.name} ${(n?.n ?? 0) + 1}`, "", "", JSON.stringify([start, ...line]), budget, start, volume ? JSON.stringify(volume) : null, target, brief, JSON.stringify(read.verdicts), JSON.stringify(read.caps), null, JSON.stringify(plan), offerId, read.days],
  );
  await q(`INSERT INTO campaign_events (campaign_id, kind, detail) VALUES ($1, 'created', $2)`, [id, JSON.stringify({ dailyBudgetCents: budget, brief, verdicts: read.verdicts, caps: read.caps, days: read.days, confidence: read.confidence })]);
  return campaignOut(await campaignOr404(id));
});

route("GET", "/api/campaigns/:id", async (_req, [id]) => {
  const c = await campaignOr404(id!);
  const catalogue = await loadCatalogue();
  const brand = await brandOr404(c.brand_id);
  const byDay = await q<{ day: string; m: number }>(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(spend_micro)::bigint AS m FROM runs WHERE campaign_id = $1 GROUP BY 1 ORDER BY 1`, [c.id]);
  const ev = await evidenceForReads(catalogue);
  // A campaign another party runs: the places its own picks were made at.
  const used = new Set((await q<{ point: string }>(`SELECT DISTINCT point FROM choices WHERE campaign_id = $1`, [c.id])).map((r) => r.point));
  return {
    campaign: await campaignOut(c),
    brand: await brandOut(brand),
    milestones: await campaignMilestones(catalogue, c),
    plan: await planOut(catalogue, c),
    flows: await campaignFlows(catalogue, c),
    spendByDay: byDay.map((d) => ({ day: d.day, cents: cents(d.m) })),
    candidates: (await researchOut(catalogue, ev, brand.id)).filter((p) => c.factory === FACTORIES.ours || used.has(p.id)),
    recentPicks: await picksOut(catalogue, "campaign_id = $1", [c.id], 30),
    recentRuns: await runsOut(catalogue, "campaign_id = $1", [c.id], 30),
    events: await q(`SELECT kind, detail, at FROM campaign_events WHERE campaign_id = $1 ORDER BY at DESC LIMIT 20`, [c.id]),
  };
});

route("POST", "/api/campaigns/:id/launch", async (_req, [id]) => {
  const c = await ownCampaignOr409(id!);
  // A test of a stated length ends that many days after its launch.
  await q(
    `UPDATE campaigns SET status = 'live', launched_at = coalesce(launched_at, now()), ends_on = coalesce(ends_on, CASE WHEN test_days IS NULL THEN NULL ELSE (now() AT TIME ZONE 'UTC')::date + test_days END) WHERE id = $1`,
    [c.id],
  );
  await q(`INSERT INTO campaign_events (campaign_id, kind) VALUES ($1, 'launched')`, [c.id]);
  // The first tick runs now rather than at the next minute.
  setTimeout(() => void tickNow(), 500);
  return campaignOut(await campaignOr404(c.id));
});

route("POST", "/api/campaigns/:id/pause", async (_req, [id]) => {
  const c = await ownCampaignOr409(id!);
  await q(`UPDATE campaigns SET status = 'paused' WHERE id = $1`, [c.id]);
  await q(`INSERT INTO campaign_events (campaign_id, kind) VALUES ($1, 'paused')`, [c.id]);
  return campaignOut(await campaignOr404(c.id));
});

route("PATCH", "/api/campaigns/:id", async (req, [id]) => {
  const c = await ownCampaignOr409(id!);
  const b = await body<{ dailyBudgetCents?: number }>(req);
  const budget = Math.round(Number(b.dailyBudgetCents));
  if (!(budget >= 1 && budget <= 100_000)) throw new HttpError(400, "The daily cap must be between 1 cent and $1,000.");
  await q(`UPDATE campaigns SET daily_budget_cents = $2, cap_reached_on = NULL WHERE id = $1`, [c.id, budget]);
  await q(`INSERT INTO campaign_events (campaign_id, kind, detail) VALUES ($1, 'cap_changed', $2)`, [c.id, JSON.stringify({ dailyBudgetCents: budget })]);
  return campaignOut(await campaignOr404(c.id));
});

route("GET", "/api/leads", async (_req, _p, url) => {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of [["campaignId", "l.campaign_id"], ["brandId", "l.brand_id"]] as const) {
    const v = url.searchParams.get(k);
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  const leads = await leadsOut(where.join(" AND "), params);
  const state = url.searchParams.get("state");
  return state ? leads.filter((l) => l.state === state) : leads;
});

route("GET", "/api/leads/:id", async (_req, [id]) => {
  const catalogue = await loadCatalogue();
  const [lead] = await leadsOut("l.id = $1", [id]);
  if (!lead) throw new HttpError(404, "No such lead.");
  const occs = await q<Unit>(`SELECT * FROM units WHERE subject_id = $1 ORDER BY created_at`, [id]);
  return {
    lead,
    units: occs.map(unitOut),
    runs: (await runsOut(catalogue, "lead_id = $1", [id], 100)).reverse(),
    picks: (await picksOut(catalogue, "lead_id = $1 OR id = ANY($2)", [id, [...new Set(occs.flatMap((o) => o.traceability))]], 100)).reverse(),
  };
});

route("POST", "/api/leads/:id/outcomes", async (req, [id]) => {
  const b = await body<{ outcome?: string }>(req);
  if (b.outcome !== OUTCOMES.paidClient) throw new HttpError(400, "Only a paid client can be reported here.");
  const lead = await one<{ id: string; brand_id: string; campaign_id: string | null; factory: string }>(`SELECT l.id, l.brand_id, l.campaign_id, b.factory FROM leads l JOIN brands b ON b.id = l.brand_id WHERE l.id = $1`, [id]);
  if (!lead) throw new HttpError(404, "No such lead.");
  if (lead.factory !== FACTORIES.ours) throw new HttpError(409, `${performerOfRow(lead.factory)} reports this lead's outcomes: this GTM Factory only reads them.`);
  const interested = await one<Unit>(`SELECT * FROM units WHERE subject_id = $1 AND outcome = $2 ORDER BY created_at DESC LIMIT 1`, [id, OUTCOMES.leadInterested]);
  const already = await one(`SELECT 1 FROM units WHERE subject_id = $1 AND outcome = $2`, [id, OUTCOMES.paidClient]);
  if (!already) {
    await produce(null, OUTCOMES.paidClient, { kind: "lead", id: id! }, { reportedBy: "The client's team" }, { factory: FACTORIES.clientTeam, brandId: lead.brand_id, campaignId: lead.campaign_id, traceability: interested?.traceability ?? [] });
  }
  return { ok: true };
});

route("GET", "/api/objects", async (_req, _p, url) => {
  const outcome = url.searchParams.get("outcome") ?? OUTCOMES.template;
  const catalogue = await loadCatalogue();
  const rows = await q<Unit>(`SELECT * FROM units WHERE outcome = $1 AND dynasty IS NOT NULL AND (brand_id IS NULL OR ${shownBrand("brand_id")}) ${IMPORT_ON ? "" : "AND factory <> 'distribute_you'"} ORDER BY dynasty, version`, [outcome]);
  const research = await researchOut(catalogue);
  const byDynasty = new Map<string, Unit[]>();
  for (const r of rows) byDynasty.set(r.dynasty!, [...(byDynasty.get(r.dynasty!) ?? []), r]);
  const out: ApiObjectDynasty[] = [];
  for (const [dynasty, versions] of byDynasty) {
    const head = versions[versions.length - 1]!;
    out.push({
      dynasty,
      outcome,
      parentDynasty: versions[0]!.parent_dynasty,
      brandId: head.brand_id,
      versions: versions.map((v) => ({ id: v.id, version: v.version ?? 1, name: v.name ?? dynasty, content: String(v.content?.text ?? JSON.stringify(v.content)), createdAt: new Date(v.created_at).toISOString(), head: v.id === head.id })),
      stats: research.flatMap((p) => p.candidates.filter((o) => o.id === dynasty).map((o) => ({ place: p.id, placeLabel: p.label, picks: o.picks, successes: o.successes, rateMean: o.rateMean }))),
      retired: head.retired,
    });
  }
  const figures = await objectFigures(catalogue, outcome, [...byDynasty].map(([dynasty, vs]) => ({ dynasty, brandId: vs[vs.length - 1]!.brand_id, runId: vs[vs.length - 1]!.run_id, factory: vs[vs.length - 1]!.factory })));
  return out.map((d) => ({ ...d, ...figures.get(`${d.brandId}|${d.dynasty}`) }));
});

/** Spend and Units per day: the Today charts. */
route("GET", "/api/series", async (_req, _p, url) => seriesOut(url.searchParams.get("brandId")));

/** The companies of the leads: one research of a company serves every lead there. */
route("GET", "/api/companies", async (_req, _p, url) => companiesOut(await loadCatalogue(), url.searchParams.get("brandId")));

/** What the splits proposed (finer ICPs, strategies). */
route("GET", "/api/proposals", async () => proposalsOut());

route("POST", "/api/objects", async (req) => {
  const b = await body<ApiNewObjectVersion>(req);
  const outcome = text(b.outcome, "Outcome", 100);
  if (outcome !== OUTCOMES.template) throw new HttpError(400, "Only templates can be written here.");
  const name = text(b.name, "Name", 200);
  const content = text(b.content, "Content", 20_000);
  let dynasty: string;
  let version = 1;
  let parent: string | null = null;
  if (b.dynasty) {
    const head = await one<{ version: number; brand_id: string | null; factory: string }>(`SELECT version, brand_id, factory FROM units WHERE outcome = $1 AND dynasty = $2 ORDER BY version DESC LIMIT 1`, [outcome, b.dynasty]);
    if (!head) throw new HttpError(404, "No such dynasty.");
    if (head.factory !== FACTORIES.ours) throw new HttpError(409, `${performerOfRow(head.factory)} writes this dynasty: fork it to make one of ours.`);
    dynasty = b.dynasty;
    version = head.version + 1;
  } else {
    dynasty = newId("tpl");
    if (b.parentDynasty) {
      const p = await one(`SELECT 1 FROM units WHERE outcome = $1 AND dynasty = $2`, [outcome, b.parentDynasty]);
      if (!p) throw new HttpError(404, "No such parent dynasty.");
      parent = b.parentDynasty;
    }
  }
  await produce(null, outcome, { kind: "brand", id: dynasty }, { text: content }, { factory: FACTORIES.ours, dynasty, version, name, parentDynasty: parent, brandId: b.brandId ?? null, traceability: [] });
  return { dynasty, version };
});

async function scriptsOut(outcome: string | null, only?: string): Promise<ApiScriptStats[]> {
  const catalogue = await loadCatalogue();
  const research = await researchOut(catalogue);
  const stats = await q<{ script_id: string; n: number; today: number; m: number }>(
    `SELECT script_id, count(*)::int AS n, (count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int AS today, coalesce(sum(spend_micro),0)::bigint AS m FROM runs GROUP BY 1`,
  );
  const outputs = await q<{ script_id: string; n: number }>(`SELECT r.script_id, count(*)::int AS n FROM units o JOIN runs r ON r.id = o.run_id GROUP BY 1`);
  // What each script's runs consumed, measured in the ledger.
  const sources = new Map((await q<{ key: string; source: string }>(`SELECT key, source FROM script_code`)).map((r) => [r.key, r.source]));
  const consumed = await q<{ script_id: string; outcome: string }>(`SELECT DISTINCT r.script_id, u.outcome FROM runs r CROSS JOIN LATERAL unnest(r.consumed) AS c(id) JOIN units u ON u.id = c.id`);
  return catalogue.scripts
    .filter((s) => (!outcome || s.outcome === outcome) && (!only || s.id === only))
    .map((s): ApiScriptStats => {
      const measured = consumed.filter((x) => x.script_id === s.id).map((x) => x.outcome);
      const st = stats.find((x) => x.script_id === s.id);
      return {
        id: s.id,
        dynasty: s.dynasty,
        version: s.version,
        outcome: s.outcome,
        name: s.name,
        kind: s.kind,
        status: s.status,
        provider: s.provider?.name ?? null,
        performedBy: String(s.tactics[PERFORMED_BY] ?? PERFORMERS.ours),
        tactics: s.tactics,
        code: s.code,
        source: sources.get(s.code),
        materials: measured.length > 0 ? measured : s.materials,
        materialsLabel: measured.length > 0 ? "measured" : "judged",
        capacity: { perDay: s.capacity?.perDay ?? null, daysPerUnit: s.capacity?.daysPerUnit ?? null },
        costCentsPrior: s.costCents,
        runs: st?.n ?? 0,
        runsToday: st?.today ?? 0,
        spentCents: cents(st?.m ?? 0),
        outputs: outputs.find((x) => x.script_id === s.id)?.n ?? 0,
        places: research.flatMap((p) => p.candidates.filter((o) => o.id === s.dynasty).map((o) => ({ place: p.id, placeLabel: p.label, picks: o.picks, successes: o.successes, rateMean: o.rateMean, costMeanCents: o.costMeanCents }))),
      };
    });
}

route("GET", "/api/scripts", async (_req, _p, url) => scriptsOut(url.searchParams.get("outcome")));

/** Capacity of a script, typed by a person: Units per day at most, days one Unit takes. */
route("POST", "/api/scripts/:id/capacity", async (req, [id]) => {
  const b = await body<ApiCapacity>(req);
  const catalogue = await loadCatalogue();
  if (!catalogue.script(id!)) throw new HttpError(404, "No such script.");
  const num = (v: unknown, name: string): number | undefined => {
    if (v === null || v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!(Number.isFinite(n) && n >= 0 && n <= 100_000)) throw new HttpError(400, `${name} must be a number of 0 or more.`);
    return n;
  };
  const perDay = num(b.perDay, "Units per day");
  const daysPerUnit = num(b.daysPerUnit, "Days per Unit");
  catalogue.setCapacity(id!, { ...(perDay !== undefined ? { perDay: Math.floor(perDay) } : {}), ...(daysPerUnit !== undefined ? { daysPerUnit } : {}) });
  await saveCatalogue(catalogue);
  return (await scriptsOut(null, id!))[0]!;
});

for (const action of ["retire", "restore"] as const) {
  route("POST", `/api/scripts/:id/${action}`, async (_req, [id]) => {
    const catalogue = await loadCatalogue();
    if (!catalogue.script(id!)) throw new HttpError(404, "No such script.");
    catalogue[action]("scripts", id!);
    await saveCatalogue(catalogue);
    return { ok: true };
  });
}

route("GET", "/api/research", async () => researchOut(await loadCatalogue()));

route("GET", "/api/picks", async (_req, _p, url) => {
  const catalogue = await loadCatalogue();
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of [["campaignId", "campaign_id"], ["leadId", "lead_id"]] as const) {
    const v = url.searchParams.get(k);
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  return picksOut(catalogue, where.join(" AND "), params, 200);
});

/** Work the Plan ordered from the client's team, oldest first. */
route("GET", "/api/tasks", async (_req, _p, url) => {
  const where: string[] = [shownBrand("t.brand_id")];
  const params: unknown[] = [];
  for (const [k, col] of [["brandId", "t.brand_id"], ["status", "t.status"]] as const) {
    const v = url.searchParams.get(k);
    if (v) {
      params.push(v);
      where.push(`${col} = $${params.length}`);
    }
  }
  return tasksOut(await loadCatalogue(), where.join(" AND "), params);
});

/** The person's answer: it becomes the Unit's content (the outcome happened), or the run ends with none. */
route("POST", "/api/tasks/:id/answer", async (req, [id]) => {
  const b = await body<ApiTaskAnswer>(req);
  if (!b.values || typeof b.values !== "object") throw new HttpError(400, "values is required.");
  let r: Awaited<ReturnType<typeof answerTask>>;
  try {
    r = await answerTask(id!, b.values);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  if (r === "not_found") throw new HttpError(404, "No such task.");
  if (r === "already") throw new HttpError(409, "This task is already answered.");
  return (await tasksOut(await loadCatalogue(), "t.id = $1", [id]))[0]!;
});

/** The brand's connected accounts, their role and counts. */
route("GET", "/api/accounts", async (_req, _p, url) => {
  const brandId = url.searchParams.get("brandId");
  if (!brandId) throw new HttpError(400, "brandId is required.");
  if (!(await one(`SELECT id FROM brands b WHERE id = $1 AND ${shownBrandRow("b")}`, [brandId]))) throw new HttpError(404, "No such brand.");
  return accountsOut(brandId);
});

/** Give an account another role: scripts asking for a role pick among the accounts carrying it. */
route("PATCH", "/api/accounts/:id", async (req, [id]) => {
  const b = await body<{ role?: string }>(req);
  const tactic = (await loadCatalogue()).tactic("account_role");
  const roles = tactic && tactic.type.kind === "list" ? tactic.type.values.map(String) : [];
  if (!b.role || !roles.includes(b.role)) throw new HttpError(400, `role must be one of: ${roles.join(", ")}.`);
  const a = await setAccountRole(id!, b.role);
  if (!a) throw new HttpError(404, "No such account.");
  return a;
});

/** What can be connected on this host, and how. */
route("GET", "/api/connect/channels", async () => connectChannels());

async function roleOr400(role: unknown): Promise<string> {
  const tactic = (await loadCatalogue()).tactic("account_role");
  const roles = tactic && tactic.type.kind === "list" ? tactic.type.values.map(String) : [];
  if (typeof role !== "string" || !roles.includes(role)) throw new HttpError(400, `role must be one of: ${roles.join(", ")}.`);
  return role;
}

/** Start connecting an account: it exists at once, "connecting", and says what to show next (a sign-in page, a code, a question). */
route("POST", "/api/accounts/connect", async (req) => {
  const b = await body<ApiConnectStart>(req);
  await brandOr404(text(b.brandId, "brandId"));
  const role = await roleOr400(b.role);
  try {
    return connectState(await startConnect({ ...b, role }));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});

async function accountOr404(id: string): Promise<ConnectRow> {
  const row = await accountRow(id);
  if (!row || !(await one(`SELECT id FROM brands b WHERE id = $1 AND ${shownBrandRow("b")}`, [row.brand_id]))) throw new HttpError(404, "No such account.");
  return row;
}

/** Where a connection stands: poll it while a code is on screen. */
route("GET", "/api/accounts/:id/connect", async (_req, [id]) => connectState(await accountOr404(id!)));

/** Answer what the account asks (a pairing code, a login): the next step comes back. */
route("POST", "/api/accounts/:id/connect/input", async (req, [id]) => {
  const row = await accountOr404(id!);
  const b = await body<{ values?: Record<string, string> }>(req);
  if (!b.values || typeof b.values !== "object") throw new HttpError(400, "values is required.");
  try {
    return connectState(await answerConnect(row, b.values));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
});

/** Disconnect: stop reading it and forget its credentials. */
route("DELETE", "/api/accounts/:id", async (_req, [id]) => {
  await disconnect(await accountOr404(id!));
  return { ok: true };
});

/** A script version's code, as stored (immutable). */
// The client's own Claude (the GTM Factory Mac app). Its loop polls the waiting requests (each
// poll says the app is online), has the client's Claude write each one, and posts the text back;
// the next tick lands it as an LLM completion, at $0. This host has one owner login, so the app
// serves every brand of this host.
route("GET", "/api/claude/requests", async () => {
  await markSeen(CLAUDE_LOCAL);
  const list = await pendingRequests(CLAUDE_LOCAL);
  return { requests: list.map((r) => ({ id: r.id, brandId: r.brandId, prompt: String(r.request.prompt ?? ""), askedAt: r.askedAt })) };
});

route("POST", "/api/claude/requests/:id/answer", async (req, [id]) => {
  const b = await body<{ text?: unknown; model?: unknown }>(req);
  const answer = text(b.text, "Text", 100_000);
  const model = typeof b.model === "string" && b.model.trim() ? b.model.trim().slice(0, 100) : "claude";
  await markSeen(CLAUDE_LOCAL);
  const r = await answerRequest(CLAUDE_LOCAL, id!, { text: answer, model });
  if (r === "missing") throw new HttpError(404, "No such request.");
  if (r === "closed") throw new HttpError(409, "This request no longer waits for an answer.");
  return { id, status: "answered" };
});

route("GET", "/api/claude/status", async () => presenceOf(CLAUDE_LOCAL));

route("GET", "/api/scripts/:id/code", async (_req, [id]) => {
  const s = (await loadCatalogue()).script(id!);
  if (!s) throw new HttpError(404, "No such script.");
  const source = await sourceOf(s.code);
  if (source === null) throw new HttpError(404, "This script's code is not in the database.");
  return { scriptId: s.id, code: s.code, source };
});

/** A new version of a script's dynasty from code text: it must compile in the sandbox and name its Providers with literals. */
route("POST", "/api/scripts/:id/versions", async (req, [id]) => {
  const b = await body<{ source?: string; name?: string }>(req);
  const source = text(b.source, "Code", 100_000);
  const catalogue = await loadCatalogue();
  const s = catalogue.script(id!);
  if (!s) throw new HttpError(404, "No such script.");
  let next;
  try {
    next = await upgradeFromCode(catalogue, s.dynasty, source, typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 200) : undefined);
  } catch (e) {
    throw new HttpError(400, `This code cannot become a version: ${e instanceof Error ? e.message : String(e)}`);
  }
  await saveCatalogue(next);
  return (await scriptsOut(null, next.headOf(s.dynasty)!.id))[0]!;
});

/** A new dynasty forked from a script, with its own code: it starts from its parent's belief. */
route("POST", "/api/scripts/:id/forks", async (req, [id]) => {
  const b = await body<{ source?: string; name?: string }>(req);
  const source = text(b.source, "Code", 100_000);
  const name = text(b.name, "Name", 200);
  const catalogue = await loadCatalogue();
  const s = catalogue.script(id!);
  if (!s) throw new HttpError(404, "No such script.");
  let made;
  try {
    made = await forkFromCode(catalogue, s.dynasty, source, name);
  } catch (e) {
    throw new HttpError(400, `This code cannot become a fork: ${e instanceof Error ? e.message : String(e)}`);
  }
  await saveCatalogue(made.catalogue);
  return (await scriptsOut(null, made.id))[0]!;
});

route("GET", "/api/ledger", async () => ledgerOut(await loadCatalogue()));

route("GET", "/api/storage/:engine", async (_req, [engine]) => storageReport(engine!));

/** The connector's last runs: what it read, wrote and skipped, and the per-client check against production. */
route("GET", "/api/connector", async () =>
  q(`SELECT id, factory, started_at, finished_at, since, ok, error, report FROM connector_runs ORDER BY started_at DESC LIMIT 10`),
);

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  // Google comes back here after the sign-in: finish the connection, then back to the page.
  if (req.method === "GET" && url.pathname === "/api/connect/google/callback") {
    try {
      const id = await finishGoogle(url.searchParams.get("state") ?? "", url.searchParams.get("code"), url.searchParams.get("error"));
      res.writeHead(302, { location: `/accounts/${id ? `?account=${encodeURIComponent(id)}` : "?connect=expired"}` });
    } catch (e) {
      console.error(`[api] google callback: ${e instanceof Error ? e.message : String(e)}`);
      res.writeHead(302, { location: "/accounts/?connect=failed" });
    }
    return void res.end();
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    try {
      return send(res, 200, await r.h(req, m.slice(1).map(decodeURIComponent), url));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(`[api] ${req.method} ${url.pathname}: ${e instanceof Error ? e.stack : String(e)}`);
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  send(res, 404, { error: `No route ${req.method} ${url.pathname}.` });
}

export { placeLabel };
