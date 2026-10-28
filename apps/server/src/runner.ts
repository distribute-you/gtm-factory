/**
 * The runner (GTM Factory v7): one generic loop for every Engine, running the code each script
 * keeps in the database, in the sandbox. At each tick a live campaign recomputes its Plan, then
 * serves each Engine of it, the most advanced first: the subjects holding the Unit the Engine
 * works on and not its outcome yet get a run of the script the Rating picks. A run's code asks
 * its Providers for what it needs (`ctx.get`): the stock first (this subject's latest Unit, the
 * brand's Unit of its picked dynasty, today's Rating), else the Provider orders a new piece from
 * that outcome's Engine (a run of its picked script, nested). A piece that only another milestone
 * can bring stops the run: it waits for that milestone. A run hands what it wants written to the
 * pieces it orders whose subject is the run (`ctx.ask`, read there as `ctx.request`). A vendor that
 * answers in minutes (pending.ts) stops the run the same way, and the run is tried again at a later
 * tick; a run tried again keeps the picks it was made under. A script runs only when every vendor
 * its code calls has a real adapter (vendors.ts); until then the Plan is computed and nothing runs.
 *
 * A script the client's team performs is never run here: the Plan's order becomes a task the
 * person answers (tasks.ts), whose answer becomes the Unit.
 */

import { PERFORMED_BY, START, meetsAll, type Catalogue, type Script, type TacticValue } from "@gtm-factory/core";
import { one, q } from "./db";
import { OUTCOMES, PERFORMERS, rowOfPerformer, WORLD } from "./catalogue-seed";
import { allowedScripts, choose, dayOf, enginesOf, newId, onSideOf, planOf, produce, milestoneLine, saveCatalogue, startRun, finishRun, todaysRating, type Brand, type CampaignRow, type EvidenceState, type Lead, type PlanNode, type RunHandle, type Unit } from "./factory";
import { canRun, compiledOf, somethingCanRun } from "./code";
import { personOfKey, unitHash } from "./mock-vendor";
import { adapterOf } from "./vendors";
import type { BridgeAnswer, BridgeOp } from "./sandbox";
import { openTask } from "./tasks";
import { flushPending } from "./pending";
import { storageFor } from "./storage";
import { accountsOf } from "./accounts";

export class CapReached extends Error {
  constructor(readonly spentMicro: number, readonly capMicro: number, readonly neededMicro: number) {
    super(`daily cap reached: spent ${(spentMicro / 10_000).toFixed(2)} cents of ${(capMicro / 10_000).toFixed(0)}, next run needs about ${(neededMicro / 10_000).toFixed(2)}`);
  }
}

export class NoOption extends Error {}

export interface CampaignCtx {
  catalogue: Catalogue;
  ev: EvidenceState;
  campaign: CampaignRow;
  brand: Brand;
  log: string[];
}

/** Subjects an Engine serves per tick, new subjects per tick, subjects in flight at most, nesting depth, passes of one run. */
const PER_ENGINE = 5;
const NEW_PER_TICK = 3;
const IN_FLIGHT_MAX = 25;
const MAX_DEPTH = 6;
const MAX_PASSES = 16;
const MAX_FAILED = 3;

const performerOf = (s: Script) => String(s.tactics[PERFORMED_BY] ?? PERFORMERS.ours);
const isTeam = (s: Script) => performerOf(s) === PERFORMERS.clientTeam;

/** The webhooks that report on an outcome once its Unit lands (the mailbox reporting a send), from the world the vendors mock. */
function reportersOn(catalogue: Catalogue, outcome: string): Script[] {
  return catalogue.scripts.filter((s) => s.status === "active" && s.webhook && canRun(s) && WORLD.truth.scripts[s.id]?.webhook?.on === outcome);
}

/**
 * The scripts of an Engine this campaign may order: kept by the brief, on its side, whose code is
 * here with a real adapter for every vendor it calls (or performed by the client's team: a task).
 * None of them: nothing runs and no pick is made there.
 */
function orderable(ctx: CampaignCtx, engine: string): Script[] {
  return allowedScripts(ctx.catalogue, engine, ctx.campaign).filter((s) => !s.webhook && onSideOf(ctx.campaign, s) && (canRun(s) || isTeam(s)));
}

/** Recompute the campaign's Plan for this tick and keep it. */
async function replan(ctx: CampaignCtx): Promise<PlanNode> {
  const c = ctx.campaign;
  const templates = await one<{ n: number }>(`SELECT count(DISTINCT dynasty)::int AS n FROM units WHERE outcome = $1 AND NOT retired AND (brand_id = $2 OR brand_id IS NULL)`, [OUTCOMES.template, c.brand_id]);
  const plan = planOf(ctx.catalogue, ctx.ev, c, ctx.brand, templates?.n ?? 0);
  await q(`UPDATE campaigns SET plan = $2 WHERE id = $1`, [c.id, JSON.stringify(plan)]);
  return plan;
}

/** For each Engine of a Plan, the Engine that calls it (the Target's caller is the campaign). */
function callers(plan: PlanNode): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (n: PlanNode, consumer: string) => {
    if (!out.has(n.outcome)) out.set(n.outcome, consumer);
    for (const m of n.materials) walk(m, n.outcome);
  };
  walk(plan, "campaign");
  return out;
}

/** One tick of one campaign: its Plan, then each Engine of it, the most advanced first. */
export async function runCampaign(ctx: CampaignCtx): Promise<void> {
  const plan = await replan(ctx);
  // Nothing can run (no lead script has its vendors connected): the Plan is computed and kept, and nothing runs (no pick, no run).
  if (!somethingCanRun(ctx.catalogue)) return;
  const caller = callers(plan);
  for (const engine of enginesOf(plan)) {
    const kind = ctx.catalogue.outcome(engine)?.subject;
    if (kind !== "lead") continue; // a brand's, a company's or a run's piece is ordered by the run that needs it
    try {
      await serveEngine(ctx, engine, caller.get(engine) ?? "campaign");
    } catch (e) {
      if (e instanceof CapReached) throw e;
      if (e instanceof NoOption) continue;
      console.error(`[campaign ${ctx.campaign.id}] ${engine}: ${e instanceof Error ? e.stack : String(e)}`);
    }
  }
}

interface Lot {
  lead: Lead | null;
  /** Picks this run is made under (its own, and the brand Units it was served). */
  choices: string[];
}

async function serveEngine(ctx: CampaignCtx, engine: string, consumer: string): Promise<void> {
  const c = ctx.campaign;
  const scripts = orderable(ctx, engine);
  if (scripts.length === 0) return;
  const point = `${consumer}|${engine}`;
  const verdict = c.verdicts?.[engine];
  const strategy = verdict && verdict !== "none" ? ctx.catalogue.strategy(verdict) : undefined;
  const cap = c.caps?.[engine];
  const today = async () => (await one<{ n: number }>(`SELECT count(*)::int AS n FROM runs WHERE campaign_id = $1 AND engine = $2 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [c.id, engine]))?.n ?? 0;
  const underCap = async () => cap === undefined || (await today()) < cap;

  // Subjects waiting at what each script works on.
  const bySubject = new Map<string, Script[]>();
  for (const s of scripts) {
    const m = ctx.catalogue.subjectOf(s);
    if (m) bySubject.set(m, [...(bySubject.get(m) ?? []), s]);
  }
  for (const [material, candidates] of bySubject) {
    const leads = await waitingAt(ctx, material, engine);
    for (const lead of leads) {
      if (!(await underCap())) return;
      if (strategy?.subject?.length) {
        const reached = new Set((await q<{ outcome: string }>(`SELECT DISTINCT outcome FROM units WHERE subject_id = $1`, [lead.id])).map((r) => r.outcome));
        if (!meetsAll((lead.data ?? {}) as Record<string, TacticValue>, strategy.subject, reached)) continue;
      }
      const lot: Lot = { lead, choices: [] };
      const picked = await pick(ctx, point, candidates, lot);
      await runScript(ctx, picked, lot, 0);
    }
  }

  // Scripts that find new subjects in the market: only a campaign that starts there, only as many as stay in flight.
  const creating = scripts.filter((s) => ctx.catalogue.createsSubjects(s));
  if (creating.length === 0 || c.start_outcome !== START) return;
  const inFlight = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM leads l WHERE l.campaign_id = $1 AND l.created_at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM units u WHERE u.subject_id = l.id AND u.outcome = $2)
       AND (SELECT count(*) FROM runs r WHERE r.lead_id = l.id AND r.status IN ('failed','no_outcome','refused')) = 0`,
    [c.id, c.target],
  );
  const want = Math.min(NEW_PER_TICK, IN_FLIGHT_MAX - (inFlight?.n ?? 0));
  for (let i = 0; i < want; i++) {
    if (!(await underCap())) return;
    const lot: Lot = { lead: null, choices: [] };
    const picked = await pick(ctx, point, creating, lot);
    const made = await runScript(ctx, picked, lot, 0);
    if (!made || made === "waiting") return;
  }
}

/** The leads of this campaign (or, for a campaign started by a pushed Unit, of its brand) holding `material` and not `engine`'s outcome yet. */
async function waitingAt(ctx: CampaignCtx, material: string, engine: string): Promise<Lead[]> {
  const c = ctx.campaign;
  const rows = await q<Lead>(
    `SELECT l.* FROM leads l
      WHERE (l.campaign_id = $1 OR ($6 <> 'start' AND l.brand_id = $5 AND EXISTS (SELECT 1 FROM units s WHERE s.subject_id = l.id AND s.outcome = $6)))
        AND EXISTS (SELECT 1 FROM units u WHERE u.subject_id = l.id AND u.outcome = $2)
        AND NOT EXISTS (SELECT 1 FROM units x WHERE x.subject_id = l.id AND x.outcome = $3)
        AND NOT EXISTS (SELECT 1 FROM units e WHERE e.subject_id = l.id AND e.outcome = ANY($4))
        AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.lead_id = l.id AND r.engine = $3 AND r.status IN ('no_outcome','refused'))
        AND (SELECT count(*) FROM runs r WHERE r.lead_id = l.id AND r.engine = $3 AND r.status = 'failed') < ${MAX_FAILED}
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.outcome = $3 AND t.campaign_id = $1)
      ORDER BY l.updated_at LIMIT ${PER_ENGINE * 3}`,
    [c.id, material, engine, [OUTCOMES.notInterested, OUTCOMES.unsubscribed], c.brand_id, c.start_outcome],
  );
  const store = storageFor(engine);
  const out: Lead[] = [];
  for (const l of rows) {
    const until = await store.get<number>("wake", `${c.id}:${l.id}`);
    if (until && until > Date.now()) continue;
    out.push(l);
    if (out.length >= PER_ENGINE) break;
  }
  return out;
}

/**
 * The Rating's pick at a candidate place (one recorded pick, credited later through traceability).
 * A run that stopped before it was recorded (a missing milestone, a vendor answering later) keeps
 * its pick: tried again for the same subject, it is made under the same pick, so the same work is
 * asked again.
 */
async function pickAt(ctx: CampaignCtx, point: string, options: { id: string; label: string }[], lot: Lot): Promise<string> {
  if (lot.lead) {
    const open = await one<{ id: string; chosen: string }>(
      `SELECT id, chosen FROM choices WHERE campaign_id = $1 AND lead_id = $2 AND point = $3 AND run_id IS NULL AND created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 1`,
      [ctx.campaign.id, lot.lead.id, point],
    );
    if (open && !lot.choices.includes(open.id) && options.some((o) => o.id === open.chosen)) {
      lot.choices.push(open.id);
      return open.chosen;
    }
  }
  const { choiceId, chosen } = await choose(ctx.ev, { point, options, campaign: ctx.campaign, brand: ctx.brand, leadId: lot.lead?.id ?? null });
  lot.choices.push(choiceId);
  return chosen;
}

/** The Rating's pick among the scripts that may run. */
async function pick(ctx: CampaignCtx, point: string, candidates: Script[], lot: Lot): Promise<Script> {
  const heads = candidates.map((s) => ctx.catalogue.headOf(s.dynasty) ?? s);
  const chosen = await pickAt(ctx, point, heads.map((s) => ({ id: s.dynasty, label: s.name })), lot);
  return heads.find((s) => s.dynasty === chosen)!;
}

const companyKey = (lead: Lead) => `co:${(lead.domain ?? lead.company ?? lead.id).toLowerCase()}`;

/** The client's own list of people (provided when the brand was added), in order. */
async function providedList(brandId: string): Promise<string[]> {
  return (await q<{ id: string }>(`SELECT id FROM brand_leads WHERE brand_id = $1 ORDER BY position`, [brandId])).map((r) => `bl:${r.id}`);
}

/** An Engine's storage, read whole before a run (the code reads it synchronously), written back after. */
async function loadStorage(engine: string): Promise<Map<string, unknown>> {
  const { engineSchema } = await import("./db");
  const rows = await q<{ tbl: string; key: string; value: unknown }>(`SELECT tbl, key, value FROM ${engineSchema(engine)}.kv`);
  return new Map(rows.map((r) => [`${r.tbl}\u0000${r.key}`, r.value]));
}

const FIRST = ["Ava", "Liam", "Noor", "Mateo", "Ines", "Owen", "Sofia", "Ravi", "Lena", "Hugo", "Maya", "Felix", "Zoe", "Arjun", "Clara", "Theo"];
const LAST = ["Moreau", "Becker", "Okafor", "Lindqvist", "Rossi", "Tanaka", "Novak", "Haddad", "Silva", "Kowalski", "Dubois", "Meyer"];
const CO = ["Bluefield Systems", "Northgate Labs", "Silverline Group", "Brightworks Studio", "Clearpath Logistics", "Oakbridge Health", "Swiftcraft Software", "Stoneloop Foods"];

/** A subject found by a script: a person of the client's list, or of the (fictional) market. Found again: the same lead. */
async function leadOf(ctx: CampaignCtx, key: string): Promise<Lead> {
  const existing = await one<Lead>(`SELECT * FROM leads WHERE brand_id = $1 AND source_ref = $2`, [ctx.brand.id, key]);
  if (existing) {
    await q(`UPDATE leads SET campaign_id = $2, updated_at = now() WHERE id = $1`, [existing.id, ctx.campaign.id]);
    return { ...existing, campaign_id: ctx.campaign.id };
  }
  const id = newId("lead");
  if (key.startsWith("bl:")) {
    const b = await one<{ email: string | null; first_name: string | null; last_name: string | null; company: string | null; title: string | null; domain: string | null }>(`SELECT * FROM brand_leads WHERE id = $1`, [key.slice(3)]);
    const rows = await q<Lead>(
      `INSERT INTO leads (id, brand_id, campaign_id, first_name, last_name, email, company, domain, title, source, source_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'provided_list',$10) RETURNING *`,
      [id, ctx.brand.id, ctx.campaign.id, b?.first_name ?? null, b?.last_name ?? null, b?.email ?? null, b?.company ?? null, b?.domain ?? null, b?.title ?? null, key],
    );
    return rows[0]!;
  }
  const p = personOfKey(key);
  const h = (salt: string, n: number) => Math.floor(unitHash(key, salt) * n);
  const first = FIRST[h("f", FIRST.length)]!;
  const last = LAST[h("l", LAST.length)]!;
  const company = CO[Math.floor((p?.index ?? h("c", 997)) / 5) % CO.length]!;
  const domain = `${company.split(" ")[0]!.toLowerCase()}.test.invalid`;
  const rows = await q<Lead>(
    `INSERT INTO leads (id, brand_id, campaign_id, first_name, last_name, email, company, domain, title, source, source_ref, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'test_market',$10,$11) RETURNING *`,
    [id, ctx.brand.id, ctx.campaign.id, first, last, `${first}.${last}@${domain}`.toLowerCase(), company, domain, String(p?.values.seniority ?? "Head of operations"), key, JSON.stringify(p?.values ?? {})],
  );
  return rows[0]!;
}

const view = (u: Unit, day: number) => ({ id: u.id, outcome: u.outcome, subject: u.subject_id, ageDays: day - dayOf(u.created_at), content: u.content ?? {} });

/**
 * Run a script's code for one subject (or none, for a script that finds its subject). Passes of
 * the code replay until every piece it asks for is in hand; then the run is recorded, its Unit
 * lands, and the webhooks that report on that outcome run. Returns the Unit, null (nothing made,
 * or not ready: a missing milestone, a vendor answering later), or "waiting" (a task, or the
 * script's own wait). `request` is the Request of the run that ordered this one, for a piece
 * whose subject is the run.
 */
export async function runScript(ctx: CampaignCtx, script: Script, lot: Lot, depth: number, subjectKind?: "brand" | "run" | "company", request: Record<string, unknown> | null = null): Promise<Unit | null | "waiting"> {
  if (depth > MAX_DEPTH) return null;
  if (isTeam(script)) {
    await openTask(ctx, script, lot.lead, lot.choices);
    return "waiting";
  }
  const code = await compiledOf(script.code);
  if (!code) throw new NoOption(`no code ${script.code} in the database`);
  const day = dayOf();
  const storage = await loadStorage(script.outcome);
  // The brand's accounts and their counts, read once: the script picks among those with the role it asks for.
  const accounts = await accountsOf(ctx.brand.id);
  const written = new Map<string, unknown>();
  const deleted = new Set<string>();
  const served = new Map<string, Unit>();
  const list = await providedList(ctx.brand.id);
  const leadsSoFar = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM leads WHERE brand_id = $1`, [ctx.brand.id]))?.n ?? 0;
  let draw = leadsSoFar * 61;
  const subject = lot.lead ? (subjectKind === "company" ? companyKey(lot.lead) : lot.lead.id) : subjectKind === "brand" ? ctx.brand.id : null;

  let result: { content?: Record<string, unknown>; found?: string } | null = null;
  for (let pass = 0; ; pass++) {
    if (pass >= MAX_PASSES) return null;
    const nth = new Map<string, number>();
    let need: { outcome: string; n: number; request: Record<string, unknown> | null } | null = null;
    let waitDays: number | null = null;
    let asked: Record<string, unknown> | null = null;
    let later = false;
    const bridge = (op: BridgeOp, args: unknown[]): BridgeAnswer => {
      const key = `${String(args[0])}\u0000${String(args[1])}`;
      switch (op) {
        case "get": {
          const o = String(args[0]);
          const n = nth.get(o) ?? 0;
          nth.set(o, n + 1);
          const u = served.get(`${o}#${n}`);
          if (u) return { v: view(u, day) };
          need = { outcome: o, n, request: asked };
          return { stop: "need" };
        }
        case "ask":
          asked = args[0] && typeof args[0] === "object" ? (args[0] as Record<string, unknown>) : null;
          return { v: null };
        case "vendor": {
          const name = String(args[0]);
          const adapter = adapterOf(name);
          if (!adapter) throw new NoOption(`no adapter for the vendor ${name}`);
          const answer = adapter({ script, name, args: (args[1] ?? null) as Record<string, unknown> | null, subject, brandId: ctx.brand.id, day, draw: draw++, unit: (id) => [...served.values()].find((u) => u.id === id), providedList: list, brand: ctx.brand });
          if (answer.pending) {
            later = true;
            return { stop: "pending" };
          }
          return { v: { ok: answer.ok, data: answer.data } };
        }
        case "accounts":
          return { v: accounts.filter((a) => a.channel === String(args[0]) && a.role === String(args[1])) };
        case "wait":
          waitDays = Number(args[0]);
          return { stop: "wait" };
        case "storage.get":
          return { v: deleted.has(key) ? undefined : written.has(key) ? written.get(key) : storage.get(key) };
        case "storage.set":
          written.set(key, args[2]);
          deleted.delete(key);
          return { v: null };
        case "storage.delete":
          deleted.add(key);
          written.delete(key);
          return { v: null };
        case "storage.count": {
          const t = String(args[0]);
          const live = new Set([...storage.keys(), ...written.keys()].filter((k) => k.startsWith(`${t}\u0000`) && !deleted.has(k)));
          return { v: live.size };
        }
      }
    };
    const out = code.run({ subject, brand: ctx.brand.id, day, tactics: script.tactics, request }, bridge);
    await flushPending();
    // A vendor answers later: the run stops like a run missing a milestone, and a later tick tries it again.
    if (later) return null;
    if (out.kind === "done") {
      result = out.result;
      break;
    }
    if (out.kind === "error") {
      const run = await startRun(script.outcome, script.id, { campaignId: ctx.campaign.id, brandId: ctx.brand.id, leadId: lot.lead?.id ?? null }, lot.choices);
      run.consumed = [...new Map([...served.values()].map((u) => [u.id, u])).values()];
      await finishRun(run, "failed", `The script's code failed: ${out.message}`, null);
      return null;
    }
    if (waitDays !== null) {
      if (lot.lead) await storageFor(script.outcome).set("wake", `${ctx.campaign.id}:${lot.lead.id}`, Date.now() + Math.max(1, waitDays) * 86_400_000);
      return "waiting";
    }
    const wanted = need as { outcome: string; n: number; request: Record<string, unknown> | null } | null;
    if (!wanted) return null;
    const got = await obtain(ctx, script, wanted.outcome, wanted.n, lot, depth, wanted.request);
    if (!got) return null;
    served.set(`${wanted.outcome}#${wanted.n}`, got);
  }

  // The code ran to its end with every piece in hand: the run is recorded, its notes kept.
  const run = await startRun(script.outcome, script.id, { campaignId: ctx.campaign.id, brandId: ctx.brand.id, leadId: lot.lead?.id ?? null }, lot.choices);
  run.consumed = [...new Map([...served.values()].map((u) => [u.id, u])).values()];
  const store = storageFor(script.outcome);
  for (const [k, v] of written) {
    const [t, key] = k.split("\u0000") as [string, string];
    await store.set(t, key, v as never);
  }
  for (const k of deleted) {
    const [t, key] = k.split("\u0000") as [string, string];
    await store.delete(t, key);
  }
  if (!result) {
    await finishRun(run, "no_outcome", "No outcome this time.", null);
    return null;
  }
  const unit = await landUnit(ctx, script, run, lot, result, subjectKind);
  await finishRun(run, "ok", "No metered spend.", null);
  // The webhooks reporting on this outcome (the mailbox reporting a send) report now.
  if (lot.lead && unit.subject_kind === "lead") for (const r of reportersOn(ctx.catalogue, unit.outcome)) await runScript(ctx, r, { lead: lot.lead, choices: [] }, depth + 1);
  return unit;
}

async function landUnit(ctx: CampaignCtx, script: Script, run: RunHandle, lot: Lot, result: { content?: Record<string, unknown>; found?: string }, subjectKind?: "brand" | "run" | "company"): Promise<Unit> {
  const kind = ctx.catalogue.outcome(script.outcome)?.subject ?? "lead";
  const factory = rowOfPerformer(performerOf(script));
  if (result.found) {
    const lead = await leadOf(ctx, result.found);
    lot.lead = lead;
    await q(`UPDATE runs SET lead_id = $2 WHERE id = $1`, [run.id, lead.id]);
    return produce(run, script.outcome, { kind: "lead", id: lead.id }, result.content ?? {}, { factory });
  }
  if (kind === "brand" || subjectKind === "brand") return produce(run, script.outcome, { kind: "brand", id: ctx.brand.id }, result.content ?? {}, { factory, brandId: ctx.brand.id, dynasty: script.dynasty, version: 1, name: script.name });
  if (kind === "run" || subjectKind === "run") return produce(run, script.outcome, { kind: "run", id: run.id }, result.content ?? {}, { factory });
  if (kind === "company" && lot.lead) return produce(run, script.outcome, { kind: "lead", id: companyKey(lot.lead) }, result.content ?? {}, { factory });
  if (!lot.lead) throw new Error(`${script.id} makes ${script.outcome} about a person, and has none`);
  return produce(run, script.outcome, { kind: "lead", id: lot.lead.id }, result.content ?? {}, { factory });
}

/**
 * A Provider: the piece a run asks for. From the stock (this subject's latest Unit, the brand's
 * Unit of the dynasty the Rating picks, today's Rating); a second ask, or none in stock, orders a
 * new one from that outcome's Engine. A milestone, or what the script works on, is never ordered
 * here: the run waits for it.
 */
async function obtain(ctx: CampaignCtx, consumer: Script, outcome: string, n: number, lot: Lot, depth: number, request: Record<string, unknown> | null = null): Promise<Unit | null> {
  const out = ctx.catalogue.outcome(outcome);
  if (!out) return null;
  if (outcome === OUTCOMES.rating || out.contentType === "rating") return todaysRating(ctx.brand.id);
  const point = `${consumer.outcome}|${outcome}`;
  if (out.subject === "lead") {
    if (!lot.lead) return null;
    if (n === 0) {
      const u = await one<Unit>(`SELECT * FROM units WHERE subject_id = $1 AND outcome = $2 ORDER BY created_at DESC LIMIT 1`, [lot.lead.id, outcome]);
      if (u) return u;
    }
    if (outcome === ctx.catalogue.subjectOf(consumer) || ctx.catalogue.isMilestone(outcome) || outcome === ctx.campaign.start_outcome) return null;
    return order(ctx, point, outcome, lot, depth);
  }
  if (out.subject === "company") {
    if (!lot.lead) return null;
    if (n === 0) {
      const u = await one<Unit>(`SELECT * FROM units WHERE subject_id = $1 AND outcome = $2 ORDER BY created_at DESC LIMIT 1`, [companyKey(lot.lead), outcome]);
      if (u) return u;
    }
    return order(ctx, point, outcome, lot, depth, "company");
  }
  if (out.subject === "brand" && n === 0) {
    const held = await q<Unit>(
      `SELECT DISTINCT ON (dynasty) * FROM units WHERE outcome = $1 AND NOT retired AND (brand_id = $2 OR brand_id IS NULL) ORDER BY dynasty, version DESC, created_at DESC`,
      [outcome, ctx.brand.id],
    );
    if (held.length > 0) {
      if (held.length === 1) return held[0]!;
      const named = held.map((u) => ({ id: u.dynasty ?? u.id, label: u.name ?? u.dynasty ?? u.id }));
      const chosen = await pickAt(ctx, point, named, lot);
      return held.find((u) => (u.dynasty ?? u.id) === chosen)!;
    }
  }
  // A piece whose subject is the run gets the Request the ordering run asked.
  return order(ctx, point, outcome, lot, depth, out.subject === "brand" ? "brand" : "run", out.subject === "brand" ? null : request);
}

/** Order a new piece from an Engine: the Rating picks its script, which runs (nested) for the same subject. */
async function order(ctx: CampaignCtx, point: string, outcome: string, lot: Lot, depth: number, subjectKind?: "brand" | "run" | "company", request: Record<string, unknown> | null = null): Promise<Unit | null> {
  const scripts = orderable(ctx, outcome);
  if (scripts.length === 0) return null;
  const inner: Lot = { lead: lot.lead, choices: [] };
  const picked = await pick(ctx, point, scripts, inner);
  const u = await runScript(ctx, picked, inner, depth + 1, subjectKind, request);
  return u && u !== "waiting" ? u : null;
}
