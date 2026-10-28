/**
 * The framework glue (GTM Factory v6): the stored catalogue, Runs, the
 * ledger's common stock of Units with their traceability, the Supplier
 * rating's daily Rating, choices by Thompson sampling on the beliefs the
 * Rating reads, and each campaign's Plan, recomputed at every tick. Nothing
 * here knows a vendor.
 */

import { randomUUID } from "node:crypto";
import {
  Catalogue,
  EvidenceBook,
  PERFORMED_BY,
  START,
  betaMean,
  betaVariance,
  createRng,
  isOurs,
  meetsAll,
  prioritize,
  type CatalogueData,
  type Condition,
  type OutcomeId,
  type PricedCandidate,
  type Script,
  type Strategy,
} from "@gtm-factory/core";
import { engineSchema, one, pool, q } from "./db";
import { CONSUMER_OF, OUTCOMES, PERFORMERS, SEED_CATALOGUE, SEED_TEMPLATES, FACTORIES, V5_LEG_OUTPUT, appCode } from "./catalogue-seed";
import { hasCode } from "./code";
import { shownBrand } from "./visibility";
import type { CatalogueData as V5CatalogueData } from "./v5";
import type { Meter } from "./vendors/meter";

export const DAY_MS = 86_400_000;
export const dayOf = (d: Date | string | number = Date.now()) => Math.floor(new Date(d).getTime() / DAY_MS);
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** "Performed by" of a v5 factory id. */
const PERFORMER_OF_FACTORY: Record<string, string> = { ours: PERFORMERS.ours, client: PERFORMERS.client, client_team: PERFORMERS.clientTeam, mailbox: PERFORMERS.mailbox, distribute_you: PERFORMERS.production };

/** The id a v5 strategy keeps on v6: the outcome of the Engine it now filters, then its own name. */
export function strategyIdV6(oldId: string, outcome: OutcomeId): string {
  const suffix = oldId.includes("#") ? oldId.slice(oldId.indexOf("#") + 1) : oldId;
  return `${outcome}#${suffix}`;
}

/**
 * A catalogue stored on the v5 model (legs, factories, Bills of materials,
 * strategies per leg, named sales paths and funnels) on the v6 model: each
 * script makes its leg's output (one Engine per outcome), its materials are its
 * Bill of materials, its factory becomes its "Performed by" tactic, a strategy
 * filters the Engine its rules name; named sales paths are dropped. Scripts of
 * the seed keep the seed's definition (their code); what the stored one added
 * (versions, forks, retirements, the connector's production scripts) is kept.
 */
export function catalogueToV6(stored: V5CatalogueData): CatalogueData {
  const seed: CatalogueData = JSON.parse(JSON.stringify(SEED_CATALOGUE));
  const legs = new Map((stored.legs ?? []).map((l) => [l.id, l]));
  const outputOf = (legId: string) => legs.get(legId)?.output ?? V5_LEG_OUTPUT[legId] ?? null;
  const out: CatalogueData = { tracks: [...(stored.leadTracks ?? [])], outcomes: [], scripts: [], tactics: [], strategies: [] };
  for (const t of seed.tracks) if (!out.tracks.some((x) => x.id === t.id)) out.tracks.push(t);
  for (const { referenceLeg, ...o } of stored.outcomes ?? []) {
    const ref = referenceLeg ? (stored.scripts ?? []).find((s) => s.legId === referenceLeg)?.dynasty : undefined;
    out.outcomes.push({ ...o, ...(ref ? { reference: ref } : {}) });
  }
  for (const o of seed.outcomes) {
    const i = out.outcomes.findIndex((x) => x.id === o.id);
    if (i < 0) out.outcomes.push(o);
    else if (!out.outcomes[i]!.reference && o.reference) out.outcomes[i] = { ...out.outcomes[i]!, reference: o.reference };
  }
  for (const s of stored.scripts ?? []) {
    const mine = seed.scripts.find((x) => x.id === s.id);
    if (mine) {
      out.scripts.push({ ...mine, status: s.status });
      continue;
    }
    const outcome = outputOf(s.legId);
    if (!outcome) continue;
    const leg = legs.get(s.legId);
    const seedHead = seed.scripts.find((x) => x.dynasty === s.dynasty);
    out.scripts.push({
      id: s.id,
      outcome,
      dynasty: s.dynasty,
      version: s.version,
      name: s.name,
      ...(s.parentDynasty ? { parentDynasty: s.parentDynasty } : {}),
      kind: s.kind,
      // A version or fork of one of our scripts runs our code; another party's script is only read.
      code: seedHead ? seedHead.code : leg?.factory === "ours" ? appCode(s.dynasty) : `${leg?.factory ?? "other"}/${s.dynasty}`,
      materials: s.materials.map((m) => m.outcome).filter((m) => m !== outcome),
      tactics: { ...s.tactics, [PERFORMED_BY]: PERFORMER_OF_FACTORY[leg?.factory ?? "ours"] ?? leg?.factory ?? PERFORMERS.ours },
      costCents: s.costCents,
      ...(leg?.webhook ? { webhook: true } : {}),
      status: s.status,
      ...(s.provider ? { provider: s.provider } : {}),
      ...(s.description ? { description: s.description } : {}),
    });
  }
  for (const s of seed.scripts) if (!out.scripts.some((x) => x.id === s.id)) out.scripts.push(s);
  const tactics = new Map<string, CatalogueData["tactics"][number]>();
  for (const t of [...seed.tactics, ...(stored.tactics ?? [])]) {
    const mine = tactics.get(t.id);
    if (!mine) tactics.set(t.id, JSON.parse(JSON.stringify(t)));
    else if (mine.type.kind === "list" && t.type.kind === "list") mine.type = { kind: "list", values: [...new Set([...mine.type.values, ...t.type.values])] };
  }
  out.tactics = [...tactics.values()];
  for (const st of stored.strategies ?? []) {
    if (st.id.endsWith("#default")) continue;
    // A strategy filters the Engine its rules name: a rule on a Material filters that Material's Engine.
    const material = st.rules.find((r) => r.material)?.material;
    const outcome = material ?? outputOf(st.legId);
    if (!outcome) continue;
    const id = strategyIdV6(st.id, outcome);
    if (out.strategies.some((x) => x.id === id)) continue;
    const s: Strategy = { id, name: st.name, outcome, conditions: st.rules.flatMap((r) => r.conditions) };
    if (st.subject) s.subject = st.subject;
    if (st.proposed) s.proposed = st.proposed;
    if (st.retired) s.retired = st.retired;
    out.strategies.push(s);
  }
  for (const st of seed.strategies) if (!out.strategies.some((x) => x.id === st.id)) out.strategies.push(st);
  return out;
}

const V6_DATA = "004_v6_data";

/**
 * The rows stored on v5 move onto v6, once, in one transaction with the
 * catalogue: each run names its Engine, each choice point is `consumer|outcome`,
 * each campaign states its Target and the strategy it keeps per Engine, and
 * each leg's storage becomes its Engine's. Budgets and statuses are not touched.
 */
async function moveRowsToV6(stored: V5CatalogueData, catalogue: Catalogue): Promise<void> {
  const outputs = new Map<string, string>(Object.entries(V5_LEG_OUTPUT));
  for (const l of stored.legs ?? []) outputs.set(l.id, l.output);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [leg, outcome] of outputs) await client.query(`UPDATE runs SET engine = $2 WHERE pipe_id = $1 AND engine IS NULL`, [leg, outcome]);
    await client.query(`UPDATE runs SET engine = pipe_id WHERE engine IS NULL`);
    // A choice point: the leg's own script was chosen at the Engine of its output, for the Engine that consumes it.
    const points = (await client.query<{ point: string }>(`SELECT DISTINCT point FROM choices`)).rows.map((r) => r.point);
    for (const p of points) {
      const next = choicePointV6(p, outputs);
      if (next !== p) await client.query(`UPDATE choices SET point = $2 WHERE point = $1`, [p, next]);
    }
    const campaigns = (await client.query<{ id: string; line: string[]; strategies: Record<string, string> }>(`SELECT id, line, strategies FROM campaigns`)).rows;
    for (const c of campaigns) {
      const verdicts: Record<string, string> = {};
      for (const [legId, sid] of Object.entries(c.strategies ?? {})) {
        const st = (stored.strategies ?? []).find((x) => x.id === sid);
        const outcome = st?.rules.find((r) => r.material)?.material ?? outputs.get(legId);
        if (outcome && !sid.endsWith("#default")) verdicts[outcome] = strategyIdV6(sid, outcome);
      }
      for (const [o, sid] of Object.entries(verdicts)) if (!catalogue.strategy(sid)) delete verdicts[o];
      await client.query(`UPDATE campaigns SET target = coalesce(target, $2), verdicts = $3 WHERE id = $1`, [c.id, c.line[c.line.length - 1] ?? OUTCOMES.leadInterested, JSON.stringify(verdicts)]);
    }
    for (const [leg, outcome] of outputs) {
      const from = `pipe_${leg}`;
      const exists = (await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [from])).rowCount;
      if (!exists || !/^[a-z0-9_]+$/.test(leg)) continue;
      const to = engineSchema(outcome);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${to}`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${to}.kv (tbl text NOT NULL, key text NOT NULL, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tbl, key))`);
      await client.query(`INSERT INTO ${to}.kv (tbl, key, value, updated_at) SELECT tbl, key, value, updated_at FROM ${from}.kv ON CONFLICT (tbl, key) DO NOTHING`);
    }
    await client.query(`INSERT INTO catalogue_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [JSON.stringify(catalogue.snapshot())]);
    await client.query(`INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`, [V6_DATA]);
    await client.query("COMMIT");
    console.log(`[catalogue] moved onto v6: ${points.length} choice points, ${campaigns.length} campaigns`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** A v5 choice point (`leg|material`, or `leg` for the leg's own script) on v6 (`consumer|outcome`). */
export function choicePointV6(point: string, outputs: ReadonlyMap<string, string>): string {
  if (point.includes("|")) {
    const [leg, material] = point.split("|") as [string, string];
    const consumer = outputs.get(leg);
    return consumer ? `${consumer}|${material}` : point;
  }
  const outcome = outputs.get(point);
  if (!outcome) return point;
  // A production leg's script is chosen for the campaign; ours for the Engine that calls it in our Plan.
  return `${point.startsWith("dy:") ? "campaign" : (CONSUMER_OF[outcome] ?? "campaign")}|${outcome}`;
}

/** Load the stored catalogue, moved onto the v6 model if stored before it, merging seed objects it does not hold yet (by id). */
export async function loadCatalogue(): Promise<Catalogue> {
  const row = await one<{ data: Record<string, unknown> }>(`SELECT data FROM catalogue_state WHERE id = 1`);
  const data = row?.data;
  if (data && "legs" in data) {
    const v5 = data as unknown as V5CatalogueData;
    const cat = new Catalogue(catalogueToV6(v5));
    const issues = cat.validate();
    if (issues.length > 0) throw new Error(`catalogue invalid after the move to v6: ${issues.map((i) => `${i.kind} ${i.id}: ${i.message}`).join("; ")}`);
    await moveRowsToV6(v5, cat);
    return cat;
  }
  const stored: CatalogueData = (data as unknown as CatalogueData) ?? JSON.parse(JSON.stringify(SEED_CATALOGUE));
  let changed = !row;
  for (const kind of ["tracks", "outcomes", "scripts", "tactics", "strategies"] as const) {
    const list = stored[kind] as Array<{ id: string }>;
    for (const item of SEED_CATALOGUE[kind] as Array<{ id: string }>) {
      if (!list.some((x) => x.id === item.id)) {
        list.push(JSON.parse(JSON.stringify(item)));
        changed = true;
        // A new version of a dynasty is an upgrade: it retires the versions before it that still run.
        const s = item as Script;
        if (kind === "scripts" && s.status === "active") for (const x of list as Script[]) if (x.dynasty === s.dynasty && x.version < s.version && x.status === "active") x.status = "retired";
      }
    }
  }
  const cat = new Catalogue(stored);
  const issues = cat.validate();
  if (issues.length > 0) throw new Error(`catalogue invalid: ${issues.map((i) => `${i.kind} ${i.id}: ${i.message}`).join("; ")}`);
  if (changed) {
    await saveCatalogue(cat);
    if (!row) await q(`INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`, [V6_DATA]);
  }
  return cat;
}

/**
 * Retire every active script whose code is a branch of this app's pre-v7 code (`app/...`): its
 * dynasty keeps its stats, and a later version with code in the database takes over.
 */
export async function retirePreV7Scripts(): Promise<number> {
  const cat = await loadCatalogue();
  const old = cat.scripts.filter((s) => s.status === "active" && s.code.startsWith("app/"));
  for (const s of old) cat.retire("scripts", s.id);
  if (old.length > 0) await saveCatalogue(cat);
  return old.length;
}

export async function saveCatalogue(cat: Catalogue): Promise<void> {
  await q(`INSERT INTO catalogue_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [JSON.stringify(cat.snapshot())]);
}

/** Seed template dynasties once (brand Units produced by the template writing pipe). */
export async function seedTemplates(): Promise<void> {
  for (const t of SEED_TEMPLATES) {
    const exists = await one(`SELECT id FROM units WHERE outcome = $1 AND dynasty = $2 LIMIT 1`, [OUTCOMES.template, t.dynasty]);
    if (exists) continue;
    await q(
      `INSERT INTO units (id, outcome, subject_kind, subject_id, factory, dynasty, version, name, content) VALUES ($1, $2, 'brand', $3, $4, $3, 1, $5, $6)`,
      [newId("unit"), OUTCOMES.template, t.dynasty, FACTORIES.ours, t.name, JSON.stringify({ text: t.content })],
    );
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Brand {
  id: string;
  name: string;
  website: string;
  offer: string;
  icp: string;
  lifetime_value_cents: number | null;
  test: boolean;
  created_at: string;
  /** Who runs this brand's campaigns (a stored `factory` id): ours, or another party read by a connector. */
  factory: string;
  /** The organization (the client account) it belongs to. */
  org_id: string | null;
  org_name: string | null;
  /** Where the client's team is told about a task, when the client gave an address. */
  team_email: string | null;
}

export interface CampaignRow {
  id: string;
  brand_id: string;
  /** The offer it sells. */
  offer_id: string | null;
  name: string;
  /** History: the v5 sales funnel and line a campaign was created on (the Plan is recomputed at every tick). */
  funnel_id: string;
  funnel_name: string;
  line: string[];
  plays: string[];
  status: "paused" | "live";
  /** The most dollars it spends per budget period, cents. */
  daily_budget_cents: number;
  /** Days of one budget period (1 = a day). */
  budget_period_days?: number;
  /** What it does, written from its strategy (editable). */
  description?: string;
  /** The outcome it orders. */
  target: string;
  /** Its strategy, in the client's words. */
  brief: string;
  /** What the judge read in the brief, per Engine: the strategy kept, or "none". */
  verdicts: Record<string, string>;
  /** Most runs per day the brief allows at an Engine. */
  caps: Record<string, number>;
  /** The day a test of a stated length ends. */
  ends_on: string | null;
  /** Its Plan at the last tick (a view). */
  plan: PlanNode | null;
  /** START (the campaign pulls on its target), or the outcome whose Units it pushes. */
  start_outcome: string;
  volume: { units: number; periodDays: number } | null;
  created_at: string;
  launched_at: string | null;
  last_tick_at: string | null;
  cap_reached_on: string | null;
  /** Who runs it (a stored `factory` id): ours (the scheduler ticks it), or another party read by a connector (never ticked here). */
  factory: string;
}

export interface Lead {
  id: string;
  brand_id: string;
  campaign_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  domain: string | null;
  title: string | null;
  linkedin_url: string | null;
  source: string;
  source_ref: string | null;
  data: Record<string, unknown>;
}

/** One Unit of the ledger's stock: one piece of an outcome, about one subject. */
export interface Unit {
  id: string;
  outcome: string;
  subject_kind: string;
  subject_id: string;
  brand_id: string | null;
  campaign_id: string | null;
  run_id: string | null;
  factory: string;
  dynasty: string | null;
  version: number | null;
  parent_dynasty: string | null;
  name: string | null;
  retired: boolean;
  content: Record<string, unknown> | null;
  traceability: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Runs and Units
// ---------------------------------------------------------------------------

export interface RunHandle {
  id: string;
  /** The Engine: the outcome the script makes. */
  engine: string;
  scriptId: string;
  campaignId: string | null;
  brandId: string | null;
  leadId: string | null;
  /** Choices made for this run (its own traceability). */
  choices: string[];
  /** Units consumed (its Bill of materials, served). */
  consumed: Unit[];
}

export async function startRun(engine: string, scriptId: string, ctx: { campaignId: string | null; brandId: string | null; leadId: string | null }, choices: string[] = []): Promise<RunHandle> {
  const id = newId("run");
  await q(`INSERT INTO runs (id, pipe_id, engine, script_id, campaign_id, brand_id, lead_id, status) VALUES ($1, $2, $2, $3, $4, $5, $6, 'running')`, [id, engine, scriptId, ctx.campaignId, ctx.brandId, ctx.leadId]);
  if (choices.length) await q(`UPDATE choices SET run_id = $1 WHERE id = ANY($2)`, [id, choices]);
  return { id, engine, scriptId, campaignId: ctx.campaignId, brandId: ctx.brandId, leadId: ctx.leadId, choices: [...choices], consumed: [] };
}

export async function finishRun(run: RunHandle, status: "ok" | "no_outcome" | "failed" | "refused", note: string, meter: Meter | null): Promise<void> {
  const lines = meter?.lines ?? [];
  for (const l of lines) await q(`INSERT INTO run_costs (run_id, vendor, item, quantity, micro) VALUES ($1, $2, $3, $4, $5)`, [run.id, l.vendor, l.item, l.quantity, l.micro]);
  await q(`UPDATE runs SET status = $2, note = $3, spend_micro = $4, consumed = $5, inputs = $6, finished_at = now() WHERE id = $1`, [
    run.id,
    status,
    note.slice(0, 2000),
    meter?.totalMicro ?? 0,
    run.consumed.map((o) => o.id),
    Math.max(1, run.consumed.filter((o) => o.subject_kind !== "object").length || 1),
  ]);
}

/** The traceability a Unit of this run carries: its run's choices and those of everything it consumed. */
export function traceOf(run: RunHandle, extra: string[] = []): string[] {
  return [...new Set([...run.consumed.flatMap((o) => o.traceability), ...run.choices, ...extra])];
}

export async function produce(
  run: RunHandle | null,
  outcome: string,
  subject: { kind: "lead" | "brand" | "run"; id: string },
  content: Record<string, unknown> | null,
  opts: { factory?: string; traceability?: string[]; brandId?: string | null; campaignId?: string | null; dynasty?: string; version?: number; name?: string; parentDynasty?: string | null } = {},
): Promise<Unit> {
  const id = newId("unit");
  const trace = opts.traceability ?? (run ? traceOf(run) : []);
  const rows = await q<Unit>(
    `INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, run_id, factory, dynasty, version, name, parent_dynasty, content, traceability)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      id,
      outcome,
      subject.kind,
      subject.id,
      opts.brandId ?? run?.brandId ?? null,
      opts.campaignId ?? run?.campaignId ?? null,
      run?.id ?? null,
      opts.factory ?? FACTORIES.ours,
      opts.dynasty ?? null,
      opts.version ?? null,
      opts.name ?? null,
      opts.parentDynasty ?? null,
      content ? JSON.stringify(content) : null,
      trace,
    ],
  );
  if (subject.kind === "lead") await q(`UPDATE leads SET updated_at = now() WHERE id = $1`, [subject.id]);
  return rows[0]!;
}

export async function unitsOf(leadId: string, outcome?: string): Promise<Unit[]> {
  return outcome
    ? q<Unit>(`SELECT * FROM units WHERE subject_id = $1 AND outcome = $2 ORDER BY created_at`, [leadId, outcome])
    : q<Unit>(`SELECT * FROM units WHERE subject_id = $1 ORDER BY created_at`, [leadId]);
}

/**
 * The stock lookup of a Specification: the latest Unit of an outcome about a
 * subject that conforms (younger than `maxAgeDays` when the consumer asks so).
 */
export async function fromStock(spec: { outcome: string; subject: string; dynasty?: string; maxAgeDays?: number }): Promise<Unit | null> {
  return one<Unit>(
    `SELECT * FROM units WHERE outcome = $1 AND subject_id = $2 AND NOT retired AND ($3::text IS NULL OR dynasty = $3) AND ($4::float IS NULL OR created_at > now() - ($4::float * interval '1 day')) ORDER BY created_at DESC LIMIT 1`,
    [spec.outcome, spec.subject, spec.dynasty ?? null, spec.maxAgeDays ?? null],
  );
}

/**
 * The Supplier rating, an auxiliary cost center: once a day per brand its
 * pipe reads the ledger and the traceability and makes the Rating every
 * choosing pipe takes as a Material (served from the stock the rest of the day).
 */
export async function todaysRating(brandId: string): Promise<Unit> {
  const today = todayUtc();
  const existing = await one<Unit>(`SELECT * FROM units WHERE outcome = $1 AND subject_id = $2 AND created_at >= $3::date ORDER BY created_at DESC LIMIT 1`, [OUTCOMES.rating, brandId, today]);
  if (existing) return existing;
  const run = await startRun(OUTCOMES.rating, "rating_pooled", { campaignId: null, brandId, leadId: null });
  const u = await produce(run, OUTCOMES.rating, { kind: "brand", id: brandId }, { day: today, reads: "ledger and traceability" }, { brandId, traceability: [] });
  await finishRun(run, "ok", "Rated every candidate at every choice point", null);
  return u;
}

// ---------------------------------------------------------------------------
// Evidence and choices
// ---------------------------------------------------------------------------

/** Days from a decision to the milestone it is credited at (the reply judged), mean and horizon, per point. */
function pointDelay(point: string): { mean: number; horizon: number } {
  const [consumer, outcome] = point.split("|");
  if (consumer === OUTCOMES.leadInterested || outcome === OUTCOMES.leadInterested) return { mean: 0, horizon: 1 };
  if (consumer === OUTCOMES.followUpQueued || outcome === OUTCOMES.followUpQueued) return { mean: 6, horizon: 14 };
  return { mean: 2.5, horizon: 14 };
}

/**
 * A Unit counts in a rate or a unit cost only if our outreach caused it: a Unit whose producer
 * states its cause (`content.causedByOutreach`) counts when that answer is true, never when it is
 * false or unknown; a Unit stating none is ours (owner rule 2026-10-27). Counts of states reached
 * count every Unit. SQL on a `units u`.
 */
export const CAUSED_BY_US = `(NOT (u.content ? 'causedByOutreach') OR u.content->>'causedByOutreach' = 'true')`;

export interface EvidenceState {
  book: EvidenceBook;
  day: number;
  /** Per point and option: decisions, successes, cents spent. */
  tallies: Map<string, { picks: number; successes: number; failures: number; spentMicro: number }>;
  catalogue: Catalogue;
}

/**
 * Rebuild the evidence book from the stored choices. A decision is counted per
 * (choice, lead): reached when the lead's Lead interested carries the choice on
 * its traceability, failed when the lead ended without it (judged not
 * interested or unsubscribed, no email, or no reply 16 days after our last
 * email), pending otherwise. Its cost is the spend on that lead from the
 * decision on (a batch run's spend split over the leads it produced).
 */
export async function loadEvidence(catalogue: Catalogue): Promise<EvidenceState> {
  const brands = (await q<{ id: string }>(`SELECT id FROM brands WHERE ${shownBrand("id")} ORDER BY created_at`)).map((b) => b.id);
  const parents = new Map<string, string>();
  for (const s of catalogue.scripts) if (s.parentDynasty) parents.set(s.dynasty, s.parentDynasty);
  for (const o of await q<{ dynasty: string; parent_dynasty: string }>(`SELECT DISTINCT dynasty, parent_dynasty FROM units WHERE parent_dynasty IS NOT NULL`)) parents.set(o.dynasty, o.parent_dynasty);
  const book = new EvidenceBook({ catalogue, brandIds: () => brands, groupOf: () => "all", parentOf: (o) => parents.get(o) ?? null, memoryHalfLifeDays: 60 });
  const day = dayOf();
  const tallies = new Map<string, { picks: number; successes: number; failures: number; spentMicro: number }>();

  const choices = await q<{ id: string; point: string; chosen: string; brand_id: string; lead_id: string | null; run_id: string | null; options: { id: string }[]; created_at: string }>(
    `SELECT id, point, chosen, brand_id, lead_id, run_id, options, created_at FROM choices WHERE ${shownBrand("brand_id")}`,
  );
  // A success counts only when our outreach caused it (a Unit stating another cause, or none known, is not ours).
  const occs = await q<{ subject_id: string; outcome: string; traceability: string[]; run_id: string | null; created_at: string; ours: boolean }>(
    `SELECT subject_id, outcome, traceability, run_id, created_at, ${CAUSED_BY_US} AS ours FROM units u WHERE subject_kind = 'lead' AND (u.brand_id IS NULL OR ${shownBrand("u.brand_id")})`,
  );
  const runs = await q<{ id: string; lead_id: string | null; spend_micro: number; status: string; engine: string; created_at: string }>(`SELECT id, lead_id, spend_micro, status, engine, created_at FROM runs WHERE brand_id IS NULL OR ${shownBrand("brand_id")}`);

  const byLead = new Map<string, { trace: Set<string>; interestedTrace: Set<string> | null; ended: boolean; lastSend: number | null; runs: { at: number; micro: number }[] }>();
  const lead = (id: string) => {
    let l = byLead.get(id);
    if (!l) byLead.set(id, (l = { trace: new Set(), interestedTrace: null, ended: false, lastSend: null, runs: [] }));
    return l;
  };
  // A batch run (sourcing) spends for every lead it produced.
  const producedBy = new Map<string, string[]>();
  for (const o of occs) {
    const l = lead(o.subject_id);
    for (const c of o.traceability) l.trace.add(c);
    if (o.outcome === OUTCOMES.leadInterested && o.ours) l.interestedTrace = new Set(o.traceability);
    if (o.outcome === OUTCOMES.notInterested || o.outcome === OUTCOMES.unsubscribed) l.ended = true;
    if (o.run_id && o.outcome === OUTCOMES.leadFound) producedBy.set(o.run_id, [...(producedBy.get(o.run_id) ?? []), o.subject_id]);
  }
  for (const r of runs) {
    const at = new Date(r.created_at).getTime();
    const leads = r.lead_id ? [r.lead_id] : producedBy.get(r.id) ?? [];
    for (const lid of leads) lead(lid).runs.push({ at, micro: r.spend_micro / leads.length });
    if (r.lead_id && r.engine === OUTCOMES.emailFound && r.status === "no_outcome") lead(r.lead_id).ended = true;
    if (r.lead_id && (r.engine === OUTCOMES.messageSent || r.engine === OUTCOMES.messageQueued || r.engine === OUTCOMES.followUpQueued) && r.status === "ok") {
      const l = lead(r.lead_id);
      l.lastSend = Math.max(l.lastSend ?? 0, at);
    }
  }
  for (const c of choices) if (c.lead_id) lead(c.lead_id).trace.add(c.id);
  const leadsOfChoice = new Map<string, string[]>();
  for (const [lid, l] of byLead) for (const cid of l.trace) leadsOfChoice.set(cid, [...(leadsOfChoice.get(cid) ?? []), lid]);

  const now = Date.now();
  for (const c of choices) {
    const d = pointDelay(c.point);
    book.offer(c.point, c.options.map((o) => o.id), d.mean, d.horizon);
    const cday = dayOf(c.created_at);
    const at = new Date(c.created_at).getTime();
    const key = `${c.point}\u0000${c.chosen}`;
    const tally = tallies.get(key) ?? { picks: 0, successes: 0, failures: 0, spentMicro: 0 };
    for (const lid of leadsOfChoice.get(c.id) ?? []) {
      const l = byLead.get(lid)!;
      const success = l.interestedTrace?.has(c.id) ?? false;
      const quiet = l.lastSend !== null && now - l.lastSend > 16 * DAY_MS && !l.interestedTrace;
      const failed = !success && (l.ended || quiet || (l.interestedTrace !== null && !success));
      const micro = l.runs.filter((r) => r.at >= at - 1000).reduce((s, r) => s + r.micro, 0);
      book.bump(c.point, c.chosen, c.brand_id, cday, "t", 1);
      if (success) book.bump(c.point, c.chosen, c.brand_id, cday, "s", 1);
      if (failed) book.bump(c.point, c.chosen, c.brand_id, cday, "f", 1);
      book.bump(c.point, c.chosen, c.brand_id, cday, "c", micro / 10_000);
      tally.picks += 1;
      tally.successes += success ? 1 : 0;
      tally.failures += failed ? 1 : 0;
      tally.spentMicro += micro;
    }
    tallies.set(key, tally);
  }
  return { book, day, tallies, catalogue };
}

export interface OptionDef {
  id: string;
  label: string;
}

/** Is a script performed on the side of this campaign? Ours runs ours and other parties'; a campaign another party runs, never ours. */
export function onSideOf(campaign: Pick<CampaignRow, "factory">, s: Script): boolean {
  const by = s.tactics[PERFORMED_BY] ?? PERFORMERS.ours;
  return campaign.factory === FACTORIES.ours ? by !== PERFORMERS.production : by !== PERFORMERS.ours;
}

/**
 * The scripts (dynasty heads) a campaign may run at an Engine: the strategy the
 * judge kept for it ("none": no script), within the scripts on its side. A
 * campaign of ours orders only scripts whose code runs here.
 */
export function allowedScripts(catalogue: Catalogue, outcome: string, campaign: CampaignRow): Script[] {
  const verdict = campaign.verdicts?.[outcome];
  if (verdict === "none") return [];
  const strategy = verdict ? catalogue.strategy(verdict) : undefined;
  const conditions: Condition[] = strategy?.conditions ?? [];
  return catalogue.scriptsOf(outcome).filter((s) => onSideOf(campaign, s) && meetsAll(s.tactics, conditions));
}

/** The value of reaching a milestone (a Lead interested) for a brand: its lifetime revenue times the expected closing rate. */
export function milestoneValue(brand: Brand): number {
  const ltv = (brand.lifetime_value_cents ?? 200_000) / 100;
  return ltv * 0.1;
}

const rng = createRng(`factory-${Date.now()}`);

/** The choice point where an Engine's script is chosen for this app's Plan: `consumer|outcome`. */
export const pointOf = (outcome: string, consumer: string = CONSUMER_OF[outcome] ?? "campaign"): string => `${consumer}|${outcome}`;

/**
 * One choice: Thompson sampling on value per dollar, on the beliefs today's
 * Rating reads, recorded with every candidate's score and the reason in plain words.
 */
export async function choose(
  ev: EvidenceState,
  args: { point: string; options: OptionDef[]; campaign: CampaignRow; brand: Brand; leadId: string | null },
): Promise<{ choiceId: string; chosen: string }> {
  if (args.options.length === 0) throw new Error(`no candidate at ${args.point}`);
  const ids = args.options.map((o) => o.id);
  const d = pointDelay(args.point);
  ev.book.offer(args.point, ids, d.mean, d.horizon);
  const priced: PricedCandidate[] = ids.map((id) => ({ id, ...ev.book.belief(args.point, id, ids, args.brand.id, ev.day) }));
  const value = milestoneValue(args.brand);
  const result = prioritize(priced, value, rng);
  const label = (id: string) => args.options.find((o) => o.id === id)?.label ?? id;
  const tally = (id: string) => ev.tallies.get(`${args.point}\u0000${id}`);
  const chosen = result.candidates.find((o) => o.id === result.pickedId)!;
  const others = result.candidates.filter((o) => o.id !== result.pickedId);
  const reason =
    others.length === 0
      ? `${label(result.pickedId)} is the only one open here (the strategy, and vendors with quota left).`
      : `${label(result.pickedId)} drew ${chosen.sampledScore.toFixed(2)} dollars of value per dollar, above ${others.map((o) => `${label(o.id)} ${o.sampledScore.toFixed(2)}`).join(", ")}. ` +
        `Its mean is ${chosen.meanScore.toFixed(2)} after ${tally(result.pickedId)?.picks ?? 0} decisions; wide beliefs still get tried.`;
  const id = newId("ch");
  const [consumer, material] = args.point.split("|") as [string, string];
  await q(
    `INSERT INTO choices (id, campaign_id, brand_id, lead_id, point, pipe_id, material, chosen, options, reason, day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, args.campaign.id, args.brand.id, args.leadId, args.point, consumer, material, result.pickedId, JSON.stringify(result.candidates.map((o) => {
      // The belief each candidate was picked on: its rate, the margin on it and its cost (what Research's estimated regret reads).
      const p = priced.find((x) => x.id === o.id)!;
      return { ...o, label: label(o.id), rate: betaMean(p.posterior), rateSd: Math.sqrt(betaVariance(p.posterior)), costCents: p.cost.mean * 100 };
    })), reason, ev.day],
  );
  return { choiceId: id, chosen: result.pickedId };
}

// ---------------------------------------------------------------------------
// The Plan
// ---------------------------------------------------------------------------

/**
 * A node of a campaign's Plan: an outcome, the script its Engine runs now
 * (the Rating's best by mean value per dollar among the scripts the brief
 * keeps), and the Plan of each outcome that script calls. An Engine another
 * party performs is not chosen by us: every one of its scripts reports, so the
 * Plan goes through all of them.
 */
export interface PlanNode {
  outcome: OutcomeId;
  scriptId: string | null;
  candidates: number;
  materials: PlanNode[];
}

/** A campaign's Plan for this tick: from its Target down to Start. */
export function planOf(catalogue: Catalogue, ev: EvidenceState, campaign: CampaignRow, brand: Brand, templates = 0): PlanNode {
  const node = (consumer: string, o: OutcomeId, seen: Set<string>): PlanNode => {
    const out = catalogue.outcome(o);
    if (o === START || o === campaign.start_outcome && consumer !== "campaign" || seen.has(o) || out?.contentType === "rating") return { outcome: o, scriptId: null, candidates: 0, materials: [] };
    const scripts = allowedScripts(catalogue, o, campaign).filter((s) => !s.webhook);
    if (scripts.length === 0) return { outcome: o, scriptId: null, candidates: out?.subject === "brand" && o === OUTCOMES.template ? templates : 0, materials: [] };
    const point = `${consumer}|${o}`;
    const ids = scripts.map((s) => s.dynasty);
    const score = (s: Script) => {
      const b = ev.book.belief(point, s.dynasty, ids, brand.id, ev.day);
      return betaMean(b.posterior) / Math.max(b.cost.mean, 1e-6);
    };
    // The scripts the campaign's side chooses among: ours whose code runs here, or the other party's own for a campaign it runs.
    const ours = scripts.filter((s) => (campaign.factory === FACTORIES.ours ? isOurs(s) && hasCode(s) : s.tactics[PERFORMED_BY] === PERFORMERS.production));
    const best = (ours.length > 0 ? ours : scripts).reduce((a, b) => (score(b) > score(a) ? b : a));
    const expand = ours.length > 0 ? [best] : scripts;
    const next = new Set(seen).add(o);
    const materials: OutcomeId[] = [];
    for (const s of expand) for (const m of s.materials) if (!materials.includes(m)) materials.push(m);
    return { outcome: o, scriptId: best.id, candidates: scripts.length, materials: materials.map((m) => node(o, m, next)) };
  };
  return node("campaign", campaign.target, new Set());
}

/** The Engines of a Plan, the Target first, then down: the order a tick serves them (the most advanced Units first). */
export function enginesOf(plan: PlanNode): OutcomeId[] {
  const out: OutcomeId[] = [];
  const queue: PlanNode[] = [plan];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n.scriptId && !out.includes(n.outcome)) out.push(n.outcome);
    queue.push(...n.materials);
  }
  return out;
}

/** The milestones a Plan passes through, along the chain that carries its subject, from the start to the Target. */
export function milestoneLine(catalogue: Catalogue, plan: PlanNode, start: OutcomeId): OutcomeId[] {
  const line: OutcomeId[] = [];
  let node: PlanNode | undefined = plan;
  const seen = new Set<string>();
  while (node && node.outcome !== start && !seen.has(node.outcome)) {
    seen.add(node.outcome);
    if (catalogue.isMilestone(node.outcome) || node === plan) line.unshift(node.outcome);
    node = node.materials.find((m) => catalogue.outcome(m.outcome)?.subject === "lead");
  }
  return line;
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export async function spentTodayMicro(campaignId: string): Promise<number> {
  const r = await one<{ m: number }>(`SELECT coalesce(sum(spend_micro), 0)::bigint AS m FROM runs WHERE campaign_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [campaignId]);
  return r?.m ?? 0;
}

/** Days since the epoch (UTC) at which a campaign's current budget period began. */
function periodStartDay(periodDays: number): number {
  const today = Math.floor(Date.now() / 86_400_000);
  return today - (today % Math.max(1, periodDays));
}

/** Our spend of a campaign since its current budget period began (a day, a week, a month). */
export async function spentInPeriodMicro(c: Pick<CampaignRow, "id" | "budget_period_days">): Promise<number> {
  const from = periodStartDay(c.budget_period_days ?? 1) * 86_400;
  const r = await one<{ m: number }>(`SELECT coalesce(sum(spend_micro), 0)::bigint AS m FROM runs WHERE campaign_id = $1 AND created_at >= to_timestamp($2)`, [c.id, from]);
  return r?.m ?? 0;
}

/** New subjects a campaign found since its current volume period began. */
export async function foundInVolumePeriod(c: Pick<CampaignRow, "id" | "volume">): Promise<number> {
  if (!c.volume) return 0;
  const from = periodStartDay(c.volume.periodDays) * 86_400;
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM leads WHERE campaign_id = $1 AND created_at >= to_timestamp($2)`, [c.id, from]);
  return r?.n ?? 0;
}

/** Expected spend of one run of a script: its measured mean over its last 20 finished runs, else its prior. */
export async function expectedRunMicro(catalogue: Catalogue, scriptId: string, extraMicro = 0): Promise<number> {
  const r = await one<{ m: number | null; n: number }>(
    `SELECT avg(spend_micro)::float AS m, count(*)::int AS n FROM (SELECT spend_micro FROM runs WHERE script_id = $1 AND status IN ('ok','no_outcome') ORDER BY created_at DESC LIMIT 20) t`,
    [scriptId],
  );
  const prior = (catalogue.script(scriptId)?.costCents ?? 1) * 10_000;
  return (r && r.n >= 3 && r.m !== null ? Math.max(r.m, prior * 0.2) : prior) + extraMicro;
}
