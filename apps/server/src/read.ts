/**
 * Read models served by the API (the contract in @gtm-factory/core
 * factory-api.ts). Every figure is computed here; the dashboard divides nothing.
 * Money: stored in micro-dollars, served in cents (fractions allowed).
 */

import {
  PERFORMED_BY,
  START,
  betaMean,
  betaVariance,
  buildLedger,
  chanceOfBest,
  estimatedRegret,
  chainCostPerTarget,
  costForwardLine,
  targetBreakdown,
  type ApiBrand,
  type ApiCampaign,
  type ApiCandidates,
  type ApiPick,
  type ApiLead,
  type ApiLedger,
  type ApiMilestone,
  type ApiMilestoneFlow,
  type ApiOutcomeCounts,
  type ApiPlanBranch,
  type ApiPlanNode,
  type ApiPlanPreview,
  type ApiScriptInput,
  type ApiRun,
  type ApiUnit,
  type Catalogue,
  type LedgerReport,
  type OutcomeId,
} from "@gtm-factory/core";
import { one, q } from "./db";
import { FACTORIES, OUTCOMES, performerOfRow } from "./catalogue-seed";
import { shownBrand } from "./visibility";
import { CAUSED_BY_US, loadCatalogue, loadEvidence, milestoneValue, planOf, milestoneLine, type Brand, type CampaignRow, type EvidenceState, type PlanNode, type Unit } from "./factory";

export const cents = (micro: number) => Math.round(micro / 100) / 100;

// ---------------------------------------------------------------------------
// Brands, campaigns
// ---------------------------------------------------------------------------

/** Brands as served, with their spend and the Units their leads reached (every campaign together). */
export async function brandsOut(brands: Brand[]): Promise<ApiBrand[]> {
  if (brands.length === 0) return [];
  const ids = brands.map((b) => b.id);
  const provided = await q<{ brand_id: string; n: number }>(`SELECT brand_id, count(*)::int AS n FROM brand_leads WHERE brand_id = ANY($1) GROUP BY 1`, [ids]);
  const spend = await q<{ brand_id: string; m: number }>(`SELECT brand_id, coalesce(sum(spend_micro), 0)::bigint AS m FROM runs WHERE brand_id = ANY($1) GROUP BY 1`, [ids]);
  const counts = await q<{ brand_id: string; outcome: string; n: number }>(
    `SELECT brand_id, outcome, count(DISTINCT subject_id)::int AS n FROM units WHERE subject_kind = 'lead' AND brand_id = ANY($1) GROUP BY 1, 2`,
    [ids],
  );
  const offers = await q<{ id: string; brand_id: string; name: string }>(`SELECT id, brand_id, name FROM offers WHERE brand_id = ANY($1) ORDER BY created_at, id`, [ids]);
  return brands.map((b) => {
    const c: ApiOutcomeCounts = {};
    for (const r of counts) if (r.brand_id === b.id) c[r.outcome] = r.n;
    return {
      id: b.id,
      name: b.name,
      orgId: b.org_id ?? b.id,
      orgName: b.org_name ?? b.name,
      offers: offers.filter((o) => o.brand_id === b.id).map((o) => ({ id: o.id, name: o.name })),
      website: b.website,
      offer: b.offer,
      icp: b.icp,
      lifetimeValueCents: b.lifetime_value_cents,
      test: b.test,
      providedLeads: provided.find((x) => x.brand_id === b.id)?.n ?? 0,
      createdAt: new Date(b.created_at).toISOString(),
      ...(b.factory !== FACTORIES.ours ? { performedBy: performerOfRow(b.factory) } : {}),
      spentTotalCents: cents(spend.find((x) => x.brand_id === b.id)?.m ?? 0),
      counts: c,
    };
  });
}

export async function brandOut(b: Brand): Promise<ApiBrand> {
  return (await brandsOut([b]))[0]!;
}

/** Units reached per outcome by every lead shown (a lead counts once per outcome). */
export async function totalCounts(): Promise<ApiOutcomeCounts> {
  const rows = await q<{ outcome: string; n: number }>(`SELECT outcome, count(DISTINCT subject_id)::int AS n FROM units WHERE subject_kind = 'lead' AND ${shownBrand("brand_id")} GROUP BY outcome`);
  const out: ApiOutcomeCounts = {};
  for (const r of rows) out[r.outcome] = r.n;
  return out;
}

/**
 * Units reached per outcome by each campaign's leads. A Message sent is reported by the mailbox
 * (another factory): it counts for the campaign of the message it reports.
 */
async function countsByCampaign(ids: string[]): Promise<Map<string, ApiOutcomeCounts>> {
  const rows = await q<{ campaign_id: string; outcome: string; n: number }>(
    `SELECT campaign_id, outcome, count(DISTINCT subject_id)::int AS n FROM (
       SELECT campaign_id, outcome, subject_id FROM units WHERE subject_kind = 'lead' AND campaign_id = ANY($1)
       UNION ALL
       SELECT q.campaign_id, s.outcome, s.subject_id FROM units q JOIN units s ON s.content->>'queued' = q.id AND s.campaign_id IS NULL
        WHERE q.campaign_id = ANY($1) AND q.subject_kind = 'lead'
     ) x GROUP BY 1, 2`,
    [ids],
  );
  const out = new Map<string, ApiOutcomeCounts>();
  for (const r of rows) {
    const c = out.get(r.campaign_id) ?? {};
    c[r.outcome] = r.n;
    out.set(r.campaign_id, c);
  }
  return out;
}

/** The milestones a campaign's Plan passes through (its last tick's), else the line it was created on. */
function lineOf(catalogue: Catalogue, c: CampaignRow): OutcomeId[] {
  if (c.plan) {
    const line = milestoneLine(catalogue, c.plan, c.start_outcome);
    if (line.length > 0) return line;
  }
  return c.line.slice(1).length > 0 ? c.line.slice(1) : [c.target ?? OUTCOMES.leadInterested];
}

/** The milestones a campaign's Plan passes through this tick, start excluded, Target last (empty before its first tick). */
function lineServed(catalogue: Catalogue, c: CampaignRow): OutcomeId[] {
  return c.plan ? milestoneLine(catalogue, c.plan, c.start_outcome) : [];
}

export async function campaignsOut(rows: CampaignRow[]): Promise<ApiCampaign[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);
  const spend = await q<{ campaign_id: string; today: number; total: number }>(
    `SELECT campaign_id, coalesce(sum(spend_micro) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::bigint AS today, coalesce(sum(spend_micro), 0)::bigint AS total
       FROM runs WHERE campaign_id = ANY($1) GROUP BY 1`,
    [ids],
  );
  const counts = await countsByCampaign(ids);
  const catalogue = await loadCatalogue();
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((c) => {
    const s = spend.find((x) => x.campaign_id === c.id);
    const capReachedOn = c.cap_reached_on ? new Date(c.cap_reached_on).toISOString().slice(0, 10) : null;
    return {
      id: c.id,
      brandId: c.brand_id,
      offerId: c.offer_id ?? `offer_${c.brand_id}`,
      name: c.name,
      line: lineServed(catalogue, c),
      start: c.start_outcome,
      target: c.target ?? c.line[c.line.length - 1] ?? OUTCOMES.leadInterested,
      status: c.status,
      dailyBudgetCents: Number(c.daily_budget_cents),
      volume: c.volume ?? null,
      spentTodayCents: cents(s?.today ?? 0),
      spentTotalCents: cents(s?.total ?? 0),
      capReached: capReachedOn === today,
      brief: c.brief ?? "",
      verdicts: c.verdicts ?? {},
      caps: c.caps ?? {},
      endsAt: c.ends_on ? new Date(c.ends_on).toISOString() : null,
      counts: counts.get(c.id) ?? {},
      createdAt: new Date(c.created_at).toISOString(),
      launchedAt: c.launched_at ? new Date(c.launched_at).toISOString() : null,
      lastTickAt: c.last_tick_at ? new Date(c.last_tick_at).toISOString() : null,
      ...(c.factory !== FACTORIES.ours ? { performedBy: performerOfRow(c.factory) } : {}),
    };
  });
}

export async function campaignOut(c: CampaignRow): Promise<ApiCampaign> {
  return (await campaignsOut([c]))[0]!;
}

// ---------------------------------------------------------------------------
// Milestones and Plans
// ---------------------------------------------------------------------------

interface MilestoneEstimate {
  from: OutcomeId;
  to: OutcomeId;
  engines: OutcomeId[];
  costPerAttempt: number;
  yieldRate: number;
  label: "expected" | "measured";
}

/** A line of milestones on the wire: attempts per Target Unit, the cost of each outcome alone and its cost from Start. */
function milestonesOut(line: MilestoneEstimate[]): ApiMilestone[] {
  const chain = line.map((l) => ({ costPerAttempt: l.costPerAttempt, yieldRate: l.yieldRate }));
  const per = targetBreakdown(chain);
  const forward = costForwardLine(chain);
  const finite = (x: number) => (Number.isFinite(x) ? x : 0);
  return line.map((l, i) => ({
    from: l.from,
    to: l.to,
    engines: l.engines,
    costPerAttemptCents: Math.round(l.costPerAttempt * 10000) / 100,
    yieldRate: l.yieldRate,
    attemptsPerTarget: finite(per[i]!.attemptsPerTarget),
    costOfOutcomeCents: Math.round(finite(l.yieldRate > 0 ? l.costPerAttempt / l.yieldRate : 0) * 10000) / 100,
    costFromStartCents: Math.round(finite(forward[i]!) * 10000) / 100,
    costPerTargetCents: Math.round(finite(per[i]!.costPerTarget) * 100),
    label: l.label,
  }));
}

/** Per milestone of a Plan's line, the Engines the subject goes through to get there (from the Plan), Target first down. */
function enginesPerMilestone(plan: PlanNode | null, line: OutcomeId[]): Map<OutcomeId, OutcomeId[]> {
  const out = new Map<OutcomeId, OutcomeId[]>(line.map((m) => [m, []]));
  // Each Engine of the Plan belongs to the nearest milestone above it (a milestone to itself), in the order they run.
  const walk = (n: PlanNode, owner: OutcomeId) => {
    const mine = out.has(n.outcome) ? n.outcome : owner;
    for (const m of n.materials) walk(m, mine);
    if (n.scriptId && !out.get(mine)!.includes(n.outcome)) out.get(mine)!.push(n.outcome);
  };
  if (plan && line.length > 0) walk(plan, line[line.length - 1]!);
  return out;
}

/** A lead reached an outcome when it holds it, or a higher milestone of the same Track. */
function reachedBy(catalogue: Catalogue, outcome: string): string[] {
  const o = catalogue.outcome(outcome);
  if (!o?.track) return [outcome];
  return catalogue.outcomes.filter((x) => x.track?.track === o.track!.track && x.track.rank >= o.track!.rank).map((x) => x.id);
}

/** A campaign's Plan: its last tick's, else (a campaign never ticked here, another party's) the one it would run now. */
export async function planFor(catalogue: Catalogue, c: CampaignRow): Promise<PlanNode | null> {
  if (c.plan) return c.plan;
  const brand = await one<Brand>(`SELECT * FROM brands WHERE id = $1`, [c.brand_id]);
  if (!brand) return null;
  return planOf(catalogue, await evidenceForReads(catalogue), { ...c, target: c.target ?? c.line[c.line.length - 1] ?? OUTCOMES.leadInterested, verdicts: c.verdicts ?? {} }, brand);
}

/**
 * The milestones a campaign runs, as it stands, each measured on what the ledger holds: attempts
 * are the leads the campaign served that held the milestone before (every lead it served, from
 * Start), its yield the share of them that reached the next one because of our outreach, its cost
 * what the campaign's runs at the Engines between them spent.
 */
export async function campaignMilestones(catalogue: Catalogue, c: CampaignRow): Promise<ApiMilestone[]> {
  const line = lineOf(catalogue, c);
  const engines = enginesPerMilestone(await planFor(catalogue, c), line);
  const segment = (engine: string): OutcomeId => (line.includes(engine) ? engine : ([...engines].find(([, e]) => e.includes(engine))?.[0] ?? line[0]!));
  const spend = await q<{ engine: string; m: number }>(`SELECT coalesce(engine, pipe_id) AS engine, coalesce(sum(spend_micro), 0)::bigint AS m FROM runs WHERE campaign_id = $1 GROUP BY 1`, [c.id]);
  const spentAt = new Map<OutcomeId, number>();
  for (const r of spend) spentAt.set(segment(r.engine), (spentAt.get(segment(r.engine)) ?? 0) + r.m);
  const est: MilestoneEstimate[] = [];
  let from = c.start_outcome;
  for (const to of line) {
    const a = await one<{ attempts: number; reached: number }>(
      `WITH served AS (SELECT DISTINCT lead_id FROM choices WHERE campaign_id = $1 AND lead_id IS NOT NULL),
            held AS (SELECT s.lead_id FROM served s WHERE $2::text = 'start' OR EXISTS (SELECT 1 FROM units u WHERE u.subject_id = s.lead_id AND u.outcome = ANY($3) AND ${CAUSED_BY_US}))
       SELECT (SELECT count(*) FROM held)::int AS attempts,
              (SELECT count(DISTINCT u.subject_id) FROM units u JOIN held h ON h.lead_id = u.subject_id WHERE u.outcome = ANY($4) AND ${CAUSED_BY_US})::int AS reached`,
      [c.id, from, reachedBy(catalogue, from), reachedBy(catalogue, to)],
    );
    const attempts = a?.attempts ?? 0;
    est.push({ from, to, engines: engines.get(to) ?? [to], costPerAttempt: attempts > 0 ? (spentAt.get(to) ?? 0) / 1_000_000 / attempts : 0, yieldRate: attempts > 0 ? a!.reached / attempts : 0, label: attempts > 0 ? "measured" : "expected" });
    from = to;
  }
  return milestonesOut(est);
}

interface RunLite {
  id: string;
  script_id: string;
  engine: string | null;
  lead_id: string | null;
  spend_micro: number;
  consumed: string[];
}

interface UnitLite {
  id: string;
  outcome: string;
  subject_kind: string;
  run_id: string | null;
  dynasty: string | null;
  name: string | null;
}

/** The brand inputs (ICPs, templates) a set of runs consumed: per input, the share of the runs that used each version. */
function inputsOf(catalogue: Catalogue, runs: readonly RunLite[], units: ReadonlyMap<string, UnitLite>): ApiScriptInput[] {
  const per = new Map<string, Map<string, { label: string; n: number }>>();
  const runsUsing = new Map<string, number>();
  for (const r of runs) {
    const seen = new Set<string>();
    for (const id of r.consumed) {
      const u = units.get(id);
      if (!u || u.subject_kind !== "brand" || !u.dynasty) continue;
      if (catalogue.outcome(u.outcome)?.contentType === "rating") continue;
      const versions = per.get(u.outcome) ?? new Map<string, { label: string; n: number }>();
      const v = versions.get(u.dynasty) ?? { label: u.name ?? u.dynasty, n: 0 };
      v.n += 1;
      versions.set(u.dynasty, v);
      per.set(u.outcome, versions);
      if (!seen.has(u.outcome)) runsUsing.set(u.outcome, (runsUsing.get(u.outcome) ?? 0) + 1);
      seen.add(u.outcome);
    }
  }
  return [...per].map(([material, versions]) => {
    const total = [...versions.values()].reduce((x, v) => x + v.n, 0);
    return {
      material,
      label: catalogue.outcome(material)?.label ?? material,
      versions: [...versions].map(([id, v]) => ({ id, label: v.label, share: total > 0 ? v.n / total : 0 })).sort((a, b) => b.share - a.share || a.id.localeCompare(b.id)),
    };
  });
}

/**
 * A campaign's Plan as a tree of what ran over the last 7 days (the public
 * simulator's treeNode, on this app's ledger). At each node, every script that
 * made the outcome for this campaign is a branch: its runs, its Units, its
 * share, its cost per Unit, the brand inputs it used, the Plan's pick marked
 * current (a pick that has not run yet still shows). Under a branch, the
 * outcomes its script calls, each a node from what the campaign ran there (a
 * piece made for each run, an LLM completion, only from the runs of this branch
 * that consumed it). A branch calling the same outcomes as one already drawn
 * is not repeated below: sameBelow.
 */
export async function planOut(catalogue: Catalogue, c: CampaignRow): Promise<ApiPlanNode | null> {
  const plan = await planFor(catalogue, c);
  if (!plan) return null;
  const runs = await q<RunLite>(`SELECT id, script_id, engine, lead_id, spend_micro::bigint AS spend_micro, consumed FROM runs WHERE campaign_id = $1 AND created_at >= now() - interval '7 days'`, [c.id]);
  const made = await q<UnitLite>(`SELECT u.id, u.outcome, u.subject_kind, u.run_id, u.dynasty, u.name FROM units u JOIN runs r ON r.id = u.run_id WHERE r.campaign_id = $1 AND r.created_at >= now() - interval '7 days'`, [c.id]);
  const consumedIds = [...new Set(runs.flatMap((r) => r.consumed))];
  const consumed = consumedIds.length > 0 ? await q<UnitLite>(`SELECT id, outcome, subject_kind, run_id, dynasty, name FROM units WHERE id = ANY($1)`, [consumedIds]) : [];
  const units = new Map<string, UnitLite>([...made, ...consumed].map((u) => [u.id, u]));
  const madeBy = new Map<string, number>();
  for (const u of made) if (u.run_id) madeBy.set(u.run_id, (madeBy.get(u.run_id) ?? 0) + 1);
  const engineOf = (r: RunLite) => r.engine ?? catalogue.script(r.script_id)?.outcome ?? "";
  const runsAt = new Map<string, RunLite[]>();
  for (const r of runs) runsAt.set(engineOf(r), [...(runsAt.get(engineOf(r)) ?? []), r]);
  const unitsOf = (rs: RunLite[]) => rs.reduce((n, r) => n + (madeBy.get(r.id) ?? 0), 0);

  const treeNode = (outcome: string, planNode: PlanNode | undefined, seen: ReadonlySet<string>, only?: RunLite[]): ApiPlanNode => {
    const here = only ?? runsAt.get(outcome) ?? [];
    const groups = new Map<string, RunLite[]>();
    for (const r of here) groups.set(r.script_id, [...(groups.get(r.script_id) ?? []), r]);
    if (planNode?.scriptId && !groups.has(planNode.scriptId)) groups.set(planNode.scriptId, []);
    const next = new Set(seen).add(outcome);
    const totalUnits = [...groups.values()].reduce((n, rs) => n + unitsOf(rs), 0);
    const callsOf = (id: string) => (catalogue.script(id)?.materials ?? []).filter((m) => catalogue.outcome(m)?.subject !== "brand" && m !== c.start_outcome && !next.has(m)).sort().join(",");
    const busiest = [...groups].sort((a, b) => unitsOf(b[1]) - unitsOf(a[1]) || b[1].length - a[1].length)[0]?.[0];
    const lead = planNode?.scriptId && groups.has(planNode.scriptId) ? planNode.scriptId : busiest;
    const drawn = new Set<string>();
    if (lead) drawn.add(callsOf(lead));
    const branches: ApiPlanBranch[] = [];
    for (const [scriptId, rs] of groups) {
      const script = catalogue.script(scriptId);
      const n = unitsOf(rs);
      const spend = rs.reduce((x, r) => x + Number(r.spend_micro), 0);
      const current = planNode?.scriptId === scriptId;
      const calls = callsOf(scriptId);
      const sameBelow = scriptId !== lead && drawn.has(calls) && calls !== "";
      if (scriptId !== lead) drawn.add(calls);
      const children: ApiPlanNode[] = [];
      if (!sameBelow && script) {
        for (const m of script.materials) {
          const o = catalogue.outcome(m);
          if (!o || o.subject === "brand" || m === c.start_outcome || next.has(m)) continue;
          const childPlan = current ? planNode?.materials.find((x) => x.outcome === m) : undefined;
          // A piece made for each run (an LLM completion) is read only from the runs of this branch that consumed it.
          let onlyRuns: RunLite[] | undefined;
          if (o.subject === "run") {
            const makers = new Set<string>();
            for (const r of rs) for (const id of r.consumed) {
              const u = units.get(id);
              if (u?.outcome === m && u.run_id) makers.add(u.run_id);
            }
            onlyRuns = (runsAt.get(m) ?? []).filter((r) => makers.has(r.id));
          }
          if (!(onlyRuns ?? runsAt.get(m))?.length && !childPlan?.scriptId) continue;
          children.push(treeNode(m, childPlan, next, onlyRuns));
        }
      }
      branches.push({
        scriptId,
        runs: rs.length,
        units: n,
        share: totalUnits > 0 ? n / totalUnits : here.length > 0 ? rs.length / here.length : current ? 1 : 0,
        costPerUnitCents: n > 0 ? cents(spend) / n : null,
        current,
        inputs: inputsOf(catalogue, rs, units),
        children,
        sameBelow,
      });
    }
    // The Plan's pick first (drawn in full), then by share.
    branches.sort((a, b) => Number(b.current) - Number(a.current) || b.share - a.share || a.scriptId.localeCompare(b.scriptId));
    return { outcome, scriptId: planNode?.scriptId ?? null, candidates: planNode?.candidates ?? groups.size, branches };
  };
  return treeNode(plan.outcome, plan, new Set());
}

/**
 * What a campaign's subjects went through over the last 7 days: each person
 * counted once per milestone of the campaign's line (reached because of our
 * outreach), from the previous line milestone they had reached (else the
 * start), by the first script that got them there.
 */
export async function campaignFlows(catalogue: Catalogue, c: CampaignRow): Promise<ApiMilestoneFlow[]> {
  const line = lineOf(catalogue, c);
  if (line.length === 0) return [];
  const rows = await q<{ subject_id: string; outcome: string; script_id: string | null; created_at: string }>(
    `SELECT DISTINCT ON (u.subject_id, u.outcome) u.subject_id, u.outcome, r.script_id, u.created_at
       FROM units u LEFT JOIN runs r ON r.id = u.run_id
      WHERE u.campaign_id = $1 AND u.outcome = ANY($2) AND u.created_at >= now() - interval '7 days' AND u.subject_kind = 'lead' AND ${CAUSED_BY_US}
      ORDER BY u.subject_id, u.outcome, u.created_at`,
    [c.id, line],
  );
  const bySubject = new Map<string, typeof rows>();
  for (const r of rows) bySubject.set(r.subject_id, [...(bySubject.get(r.subject_id) ?? []), r]);
  const subjects = bySubject.size;
  const flows = new Map<string, { from: string; to: string; who: Set<string>; by: Map<string, Set<string>> }>();
  for (const [subject, reached] of bySubject) {
    for (const r of reached) {
      const k = line.indexOf(r.outcome);
      const earlier = reached.filter((x) => line.indexOf(x.outcome) < k && x.created_at <= r.created_at).sort((a, b) => line.indexOf(b.outcome) - line.indexOf(a.outcome))[0];
      const from = earlier?.outcome ?? c.start_outcome;
      const key = `${from}>${r.outcome}`;
      const f = flows.get(key) ?? { from, to: r.outcome, who: new Set<string>(), by: new Map<string, Set<string>>() };
      f.who.add(subject);
      const sc = r.script_id ?? "";
      f.by.set(sc, (f.by.get(sc) ?? new Set<string>()).add(subject));
      flows.set(key, f);
    }
  }
  return [...flows.values()]
    .map((f) => ({
      from: f.from,
      to: f.to,
      subjects: f.who.size,
      share: subjects > 0 ? f.who.size / subjects : 0,
      by: [...f.by]
        .map(([scriptId, who]) => ({ scriptId, name: catalogue.script(scriptId)?.name ?? (scriptId || "Another party"), subjects: who.size, share: f.who.size > 0 ? who.size / f.who.size : 0 }))
        .sort((a, b) => b.subjects - a.subjects || a.scriptId.localeCompare(b.scriptId)),
    }))
    .sort((a, b) => line.indexOf(a.to) - line.indexOf(b.to) || b.subjects - a.subjects);
}

/** Expected or measured cost per attempt and yield of a milestone, for one brand (falls back to the fleet, then to stated defaults). */
async function milestoneEstimator(brandId: string): Promise<(from: string, to: string) => { costPerAttempt: number; yieldRate: number; label: "expected" | "measured" } | null> {
  const fleet = await one<{ sent: number; spend: number; leads: number }>(
    `SELECT (SELECT count(DISTINCT lead_id) FROM runs WHERE engine = 'message_queued' AND status = 'ok')::int AS sent,
            (SELECT coalesce(sum(spend_micro),0) FROM runs WHERE engine <> 'paid_client')::bigint AS spend,
            (SELECT count(*) FROM leads)::int AS leads`,
  );
  const mine = await one<{ sent: number; interested: number; paid: number }>(
    `SELECT (SELECT count(DISTINCT lead_id) FROM runs WHERE engine = 'message_queued' AND status = 'ok' AND brand_id = $1)::int AS sent,
            (SELECT count(DISTINCT subject_id) FROM units WHERE outcome = 'lead_interested' AND brand_id = $1)::int AS interested,
            (SELECT count(DISTINCT subject_id) FROM units WHERE outcome = 'paid_client' AND brand_id = $1)::int AS paid`,
    [brandId],
  );
  return (from, to) => {
    if (from === START) {
      const measured = (fleet?.sent ?? 0) >= 50 && (fleet?.leads ?? 0) > 0;
      // Stated defaults: about 4 cents per lead attempted (reveal, check, writing, send), 1% interested per lead emailed.
      const cost = measured ? fleet!.spend / 1_000_000 / fleet!.leads : 0.04;
      const prior = { rate: 0.01, strength: 200 };
      return { costPerAttempt: cost, yieldRate: ((mine?.interested ?? 0) + prior.rate * prior.strength) / ((mine?.sent ?? 0) + prior.strength), label: measured ? "measured" : "expected" };
    }
    if (to === OUTCOMES.paidClient) {
      const prior = { rate: 0.1, strength: 20 };
      return { costPerAttempt: 0, yieldRate: ((mine?.paid ?? 0) + prior.rate * prior.strength) / ((mine?.interested ?? 0) + prior.strength), label: (mine?.interested ?? 0) >= 10 ? "measured" : "expected" };
    }
    return null;
  };
}

/** What a new campaign of this brand would run toward each Target today: the milestones of its Plan, priced, ranked by value per dollar. */
export async function plansFor(catalogue: Catalogue, brand: Brand): Promise<ApiPlanPreview[]> {
  const ev = await evidenceForReads(catalogue);
  const estimate = await milestoneEstimator(brand.id);
  const ltv = (brand.lifetime_value_cents ?? 200_000) / 100;
  const out: ApiPlanPreview[] = [];
  const targets = catalogue.outcomes.filter((o) => o.track && !o.retired).map((o) => o.id);
  for (const target of targets) {
    const draft: CampaignRow = { id: "draft", brand_id: brand.id, offer_id: null, name: "", funnel_id: "", funnel_name: "", line: [START, target], plays: [], status: "paused", daily_budget_cents: 0, target, brief: "", verdicts: brand.test ? { [OUTCOMES.leadFound]: "lead_found#provided_list" } : {}, caps: {}, ends_on: null, plan: null, start_outcome: START, volume: null, created_at: "", launched_at: null, last_tick_at: null, cap_reached_on: null, factory: FACTORIES.ours };
    const plan = planOf(catalogue, ev, draft, brand);
    const line = milestoneLine(catalogue, plan, START);
    if (line.length === 0) continue;
    const engines = enginesPerMilestone(plan, line);
    const est: MilestoneEstimate[] = [];
    let from: string = START;
    let ok = true;
    for (const to of line) {
      const e = estimate(from, to);
      if (!e) {
        ok = false;
        break;
      }
      est.push({ from, to, engines: engines.get(to) ?? [to], ...e });
      from = to;
    }
    if (!ok) continue;
    // A Target below the top of its Track is worth the lifetime revenue times the expected yield of each milestone up the Track.
    let value = ltv;
    const t = catalogue.outcome(target)!.track!;
    let at: string = target;
    for (const up of catalogue.outcomes.filter((x) => x.track?.track === t.track && x.track.rank > t.rank && !x.retired).sort((a, b) => a.track!.rank - b.track!.rank)) {
      const e = estimate(at, up.id);
      if (!e) continue;
      value *= e.yieldRate;
      at = up.id;
    }
    const costPerTarget = chainCostPerTarget(est);
    out.push({
      target,
      line,
      milestones: milestonesOut(est),
      costPerTargetCents: Math.round((Number.isFinite(costPerTarget) ? costPerTarget : 0) * 100),
      valuePerDollar: costPerTarget > 0 && Number.isFinite(costPerTarget) ? value / costPerTarget : 0,
      label: est.every((e) => e.label === "measured") ? "measured" : "expected",
    });
  }
  return out.sort((a, b) => b.valuePerDollar - a.valuePerDollar);
}

// ---------------------------------------------------------------------------
// Picks, candidates, scripts
// ---------------------------------------------------------------------------

const labelOf = (catalogue: Catalogue, o: string) => (o === "campaign" ? "Campaign" : (catalogue.outcome(o)?.label ?? o));

/** What was picked at a place: a script of the called outcome's Engine, or the version of a brand input (an ICP, a template) a script used. */
function kindAt(catalogue: Catalogue, place: string): ApiPick["kind"] {
  const material = place.split("|")[1];
  const o = material ? catalogue.outcome(material) : undefined;
  return o?.subject === "brand" && o.contentType !== "rating" ? "input" : "script";
}

/** A place in words: "<Engine> · <n> scripts" or "<Outcome> · <n> Units" (without a count: "<Engine> · its scripts"). */
export function placeLabel(catalogue: Catalogue, place: string, n?: number): string {
  const [consumer, material] = place.split("|") as [string, string | undefined];
  const what = labelOf(catalogue, material ?? consumer);
  const unit = kindAt(catalogue, place) === "input";
  if (n === undefined) return `${what} · its ${unit ? "Units" : "scripts"}`;
  return `${what} · ${n} ${unit ? (n === 1 ? "Unit" : "Units") : n === 1 ? "script" : "scripts"}`;
}

export async function picksOut(catalogue: Catalogue, where: string, params: unknown[], limit = 50): Promise<ApiPick[]> {
  const rows = await q<{ id: string; created_at: string; campaign_id: string; brand_id: string; lead_id: string | null; point: string; chosen: string; options: { id: string; label: string; meanScore: number; sampledScore: number }[]; reason: string }>(
    `SELECT * FROM choices WHERE ${shownBrand("brand_id")} ${where ? `AND (${where})` : ""} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  const credited = await q<{ c: string }>(`SELECT DISTINCT unnest(traceability) AS c FROM units WHERE outcome = $1`, [OUTCOMES.leadInterested]);
  const creditedSet = new Set(credited.map((r) => r.c));
  return rows.map((r) => ({
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    campaignId: r.campaign_id,
    brandId: r.brand_id,
    leadId: r.lead_id,
    kind: kindAt(catalogue, r.point),
    place: r.point,
    // An input pick reads "<input> used": its place is the input outcome's label, its pick the version's name.
    placeLabel: kindAt(catalogue, r.point) === "input" ? labelOf(catalogue, r.point.split("|")[1]!) : placeLabel(catalogue, r.point),
    picked: r.chosen,
    pickedLabel: r.options.find((o) => o.id === r.chosen)?.label ?? r.chosen,
    candidates: r.options.map((o) => ({ id: o.id, label: o.label, meanScore: o.meanScore, sampledScore: o.sampledScore })),
    reason: r.reason,
    credited: creditedSet.has(r.id),
  }));
}

function candidateLabel(catalogue: Catalogue, id: string, objectNames: Map<string, string>): string {
  return catalogue.headOf(id)?.name ?? catalogue.script(id)?.name ?? objectNames.get(id) ?? id;
}

let evidenceCache: { at: number; ev: Promise<EvidenceState> } | null = null;

/** The evidence book for reads: rebuilt at most once a minute (the pages poll; the scheduler rebuilds its own). */
export function evidenceForReads(catalogue: Catalogue): Promise<EvidenceState> {
  if (!evidenceCache || Date.now() - evidenceCache.at > 60_000) {
    const ev = loadEvidence(catalogue);
    evidenceCache = { at: Date.now(), ev };
    ev.catch(() => (evidenceCache = null));
  }
  return evidenceCache.ev;
}

export async function researchOut(catalogue: Catalogue, ev?: EvidenceState, brandFilter?: string): Promise<ApiCandidates[]> {
  const e = ev ?? (await evidenceForReads(catalogue));
  const objectNames = new Map((await q<{ dynasty: string; name: string }>(`SELECT DISTINCT ON (dynasty) dynasty, name FROM units WHERE dynasty IS NOT NULL ORDER BY dynasty, version DESC`)).map((r) => [r.dynasty, r.name]));
  const anyBrand = brandFilter ?? (await one<{ id: string }>(`SELECT id FROM brands WHERE ${shownBrand("id")} ORDER BY created_at LIMIT 1`))?.id ?? "none";
  // Each candidate's share of the picks made at its place over the last 7 days.
  const recent = await q<{ point: string; chosen: string; n: number }>(`SELECT point, chosen, count(*)::int AS n FROM choices WHERE created_at > now() - interval '7 days' AND ${shownBrand("brand_id")} GROUP BY 1, 2`);
  const brand = await one<Brand>(`SELECT * FROM brands WHERE id = $1`, [anyBrand]);
  const value = brand ? milestoneValue(brand) : 200;
  // The brand inputs each script used over the last 7 days (its runs' consumed brand Units).
  const recentRuns = await q<RunLite>(`SELECT id, script_id, engine, lead_id, spend_micro::bigint AS spend_micro, consumed FROM runs WHERE created_at > now() - interval '7 days' AND (brand_id IS NULL OR ${shownBrand("brand_id")})${brandFilter ? " AND brand_id = $1" : ""}`, brandFilter ? [brandFilter] : []);
  const inputIds = [...new Set(recentRuns.flatMap((r) => r.consumed))];
  const inputUnits = new Map((inputIds.length > 0 ? await q<UnitLite>(`SELECT id, outcome, subject_kind, run_id, dynasty, name FROM units WHERE id = ANY($1) AND subject_kind = 'brand'`, [inputIds]) : []).map((u) => [u.id, u]));
  const daily = await researchDaily();
  const points: ApiCandidates[] = [];
  for (const [point, held] of e.book.pointCandidates) {
    // A brand input's versions compete inside each script's row, never as a place of their own.
    if (kindAt(catalogue, point) === "input") continue;
    const ids = [...held];
    const [consumer, material] = point.split("|");
    points.push({
      id: point,
      consumer: consumer!,
      material: material ?? consumer!,
      label: placeLabel(catalogue, point, ids.length),
      candidates: ids.map((id) => {
        const b = e.book.belief(point, id, ids, anyBrand, e.day);
        const t = e.tallies.get(`${point}\u0000${id}`);
        const rate = betaMean(b.posterior);
        return {
          id,
          label: candidateLabel(catalogue, id, objectNames),
          rateMean: rate,
          rateSd: Math.sqrt(betaVariance(b.posterior)),
          chanceBest: 0,
          costMeanCents: b.cost.mean * 100,
          meanScore: (rate * value) / Math.max(b.cost.mean, 1e-6),
          share: (() => {
            const here = recent.filter((x) => x.point === point);
            const total = here.reduce((a, x) => a + x.n, 0);
            return total > 0 ? (here.find((x) => x.chosen === id)?.n ?? 0) / total : 0;
          })(),
          picks: t?.picks ?? 0,
          successes: t?.successes ?? 0,
          spentCents: cents(t?.spentMicro ?? 0),
          inputs: inputsOf(catalogue, recentRuns.filter((r) => catalogue.script(r.script_id)?.dynasty === id || r.script_id === id), inputUnits),
        };
      }),
      daily: daily.get(point) ?? [],
    });
  }
  for (const p of points) {
    const chance = chanceOfBest(p.candidates.map((c) => ({ id: c.id, rate: c.rateMean, rateSd: c.rateSd, cost: c.costMeanCents / 100 })));
    for (const c of p.candidates) c.chanceBest = chance[c.id] ?? 0;
  }
  return points.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Each place's picks day by day, as the Rating believed it then (the options stored with each
 * pick): the shares, the value lost to candidates it believed weaker than its best, and the
 * margin on its best. A pick stored without its belief (before this was recorded) counts no regret.
 */
async function researchDaily(): Promise<Map<string, ApiCandidates["daily"]>> {
  const counts = await q<{ point: string; day: string; chosen: string; n: number }>(
    `SELECT point, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, chosen, count(*)::int AS n FROM choices WHERE ${shownBrand("brand_id")} GROUP BY 1, 2, 3`,
  );
  const beliefs = await q<{ point: string; day: string; options: { id: string; meanScore?: number; rate?: number; rateSd?: number; costCents?: number }[] }>(
    `SELECT DISTINCT ON (point, 2) point, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, options FROM choices WHERE ${shownBrand("brand_id")} ORDER BY point, 2, created_at DESC`,
  );
  const out = new Map<string, ApiCandidates["daily"]>();
  for (const b of beliefs) {
    const here = counts.filter((c) => c.point === b.point && c.day === b.day);
    const picks = here.reduce((x, c) => x + c.n, 0);
    const opts = Array.isArray(b.options) ? b.options : [];
    const r = estimatedRegret({ candidates: opts.map((o) => ({ id: o.id, picks: here.find((c) => c.chosen === o.id)?.n ?? 0, meanScore: o.meanScore ?? 0, costCents: o.costCents ?? 0, rate: o.rate ?? 0, rateSd: o.rateSd ?? 0 })) });
    const known = opts.some((o) => o.rateSd !== undefined);
    const day = { day: `${b.day}T00:00:00.000Z`, picks, shares: Object.fromEntries(here.map((c) => [c.chosen, picks > 0 ? c.n / picks : 0])), regretCents: r.regretCents, bestMargin: known ? r.bestMargin : null };
    out.set(b.point, [...(out.get(b.point) ?? []), day]);
  }
  for (const v of out.values()) v.sort((a, b) => (a.day < b.day ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------------------
// Runs, leads
// ---------------------------------------------------------------------------

interface RunRow {
  id: string;
  created_at: string;
  campaign_id: string | null;
  brand_id: string | null;
  pipe_id: string;
  engine: string | null;
  script_id: string;
  lead_id: string | null;
  status: ApiRun["status"] | "running";
  note: string;
  spend_micro: number;
  consumed: string[];
  source_ref: string | null;
}

export async function runsOut(catalogue: Catalogue, where: string, params: unknown[], limit = 50): Promise<ApiRun[]> {
  const rows = await q<RunRow>(`SELECT * FROM runs WHERE (brand_id IS NULL OR ${shownBrand("brand_id")}) ${where ? `AND (${where})` : ""} ORDER BY created_at DESC LIMIT ${limit}`, params);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const costs = await q<{ run_id: string; vendor: string; item: string; quantity: number; micro: number }>(`SELECT run_id, vendor, item, quantity, micro FROM run_costs WHERE run_id = ANY($1)`, [ids]);
  const produced = await q<{ run_id: string; id: string; outcome: string }>(`SELECT run_id, id, outcome FROM units WHERE run_id = ANY($1)`, [ids]);
  return rows.map((r) => ({
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    campaignId: r.campaign_id,
    brandId: r.brand_id,
    engine: r.engine ?? r.pipe_id,
    scriptId: r.script_id,
    scriptName: catalogue.script(r.script_id)?.name ?? r.script_id,
    performedBy: String(catalogue.script(r.script_id)?.tactics[PERFORMED_BY] ?? performerOfRow(r.source_ref ? "distribute_you" : FACTORIES.ours)),
    leadId: r.lead_id,
    status: r.status === "running" ? "ok" : r.status,
    note: r.status === "running" ? "Running" : r.note,
    spendCents: cents(r.spend_micro),
    produced: produced.filter((p) => p.run_id === r.id).map((p) => ({ id: p.id, outcome: p.outcome })),
    consumed: r.consumed,
    costs: costs.filter((c) => c.run_id === r.id).map((c) => ({ vendor: c.vendor, item: c.item, quantity: c.quantity, cents: cents(c.micro) })),
  }));
}

const LINE_ORDER = [OUTCOMES.leadFound, OUTCOMES.emailFound, OUTCOMES.messageWritten, OUTCOMES.messageQueued, OUTCOMES.messageSent, OUTCOMES.followUpQueued, OUTCOMES.replyReceived, OUTCOMES.notInterested, OUTCOMES.unsubscribed, OUTCOMES.leadInterested, OUTCOMES.paidClient];

export async function leadsOut(where: string, params: unknown[], limit = 500): Promise<ApiLead[]> {
  const rows = await q<{ id: string; brand_id: string; campaign_id: string | null; first_name: string | null; last_name: string | null; email: string | null; company: string | null; title: string | null; updated_at: string; reached: string[] | null }>(
    `SELECT l.*, (SELECT array_agg(DISTINCT outcome) FROM units o WHERE o.subject_id = l.id) AS reached
       FROM leads l WHERE ${shownBrand("l.brand_id")} ${where ? `AND (${where})` : ""} ORDER BY l.updated_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => {
    const reached = [...(r.reached ?? [])];
    const state = [...LINE_ORDER].reverse().find((o) => reached.includes(o)) ?? OUTCOMES.leadFound;
    return {
      id: r.id,
      brandId: r.brand_id,
      campaignId: r.campaign_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || r.id,
      email: r.email,
      company: r.company,
      title: r.title,
      state,
      reached,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  });
}

export function unitOut(o: Unit): ApiUnit {
  return { id: o.id, outcome: o.outcome, at: new Date(o.created_at).toISOString(), runId: o.run_id, performedBy: performerOfRow(o.factory), traceability: o.traceability, content: o.content };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** The every-path report from the engine, computed in micro-dollars (exact), served in cents. */
export async function ledgerOut(catalogue: Catalogue): Promise<ApiLedger> {
  const shown = `(brand_id IS NULL OR ${shownBrand("brand_id")})`;
  const runs = await q<{ id: string; engine: string; spend_micro: number; consumed: string[]; inputs: number; campaign_id: string | null; script_id: string; created_at: string; status: string }>(
    `SELECT id, coalesce(engine, pipe_id) AS engine, spend_micro, consumed, inputs, campaign_id, script_id, created_at, status FROM runs WHERE status <> 'running' AND ${shown}`,
  );
  const occs = await q<{ id: string; outcome: string; subject_id: string; run_id: string | null; created_at: string }>(`SELECT id, outcome, subject_id, run_id, created_at FROM units WHERE run_id IS NOT NULL AND ${shown}`);
  const runIds = new Set(runs.map((r) => r.id));
  const occIds = new Set(occs.map((o) => o.id));
  const report = buildLedger(
    runs.map((r) => ({
      id: r.id,
      engine: r.engine,
      target: r.engine,
      day: Math.floor(new Date(r.created_at).getTime() / 86_400_000),
      spendCents: Math.round(r.spend_micro),
      consumed: r.consumed.filter((c) => occIds.has(c)),
      inputs: r.inputs,
      campaignId: r.campaign_id ?? undefined,
      scriptId: r.script_id,
      ...(r.status === "failed" || r.status === "refused" ? { abnormalLoss: r.status } : {}),
    })),
    occs.filter((o) => runIds.has(o.run_id!)).map((o) => ({ id: o.id, outcome: o.outcome, subject: o.subject_id, runId: o.run_id!, day: Math.floor(new Date(o.created_at).getTime() / 86_400_000) })),
  );
  // Rescale the micro-dollar report to cents for the wire.
  const scaled: LedgerReport = {
    ...report,
    totalSpendCents: cents(report.totalSpendCents),
    standardCents: {},
    consumptions: {},
    standardChargedCents: cents(report.standardChargedCents),
    reuseGainCents: cents(report.reuseGainCents),
    runsProducingNone: {
      normalLossCents: cents(report.runsProducingNone.normalLossCents),
      abnormalLossCents: cents(report.runsProducingNone.abnormalLossCents),
      supportCents: cents(report.runsProducingNone.supportCents),
      totalCents: cents(report.runsProducingNone.totalCents),
    },
    decide: report.decide.map((d) => ({ ...d, spendCents: cents(d.spendCents), costPerInput: d.costPerInput === null ? null : d.costPerInput / 10_000, costPerOutcome: d.costPerOutcome === null ? null : d.costPerOutcome / 10_000 })),
    report: report.report.map((r) => ({ ...r, productionCents: cents(r.productionCents), inputsValue: r.inputsValue / 10_000, unitCost: r.unitCost === null ? null : r.unitCost / 10_000 })),
  };
  const byDay = await q<{ day: string; m: number }>(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(spend_micro)::bigint AS m FROM runs WHERE ${shown} GROUP BY 1 ORDER BY 1`);
  const byEngine = await q<{ engine: string; n: number; m: number }>(`SELECT coalesce(engine, pipe_id) AS engine, count(*)::int AS n, sum(spend_micro)::bigint AS m FROM runs WHERE ${shown} GROUP BY 1 ORDER BY 3 DESC`);
  const outputs = await q<{ engine: string; n: number }>(`SELECT coalesce(r.engine, r.pipe_id) AS engine, count(*)::int AS n FROM units o JOIN runs r ON r.id = o.run_id WHERE (r.brand_id IS NULL OR ${shownBrand("r.brand_id")}) GROUP BY 1`);
  const byScript = await q<{ script_id: string; n: number; m: number }>(`SELECT script_id, count(*)::int AS n, sum(spend_micro)::bigint AS m FROM runs WHERE ${shown} GROUP BY 1 ORDER BY 3 DESC`);
  const byVendor = await q<{ vendor: string; item: string; qty: number; m: number }>(`SELECT vendor, item, sum(quantity)::float AS qty, sum(micro)::bigint AS m FROM run_costs WHERE run_id IN (SELECT id FROM runs WHERE ${shown}) GROUP BY 1, 2 ORDER BY 4 DESC`);
  const byCampaign = await q<{ id: string; name: string; m: number }>(`SELECT c.id, c.name, coalesce(sum(r.spend_micro), 0)::bigint AS m FROM campaigns c LEFT JOIN runs r ON r.campaign_id = c.id WHERE ${shownBrand("c.brand_id")} GROUP BY 1, 2 ORDER BY 3 DESC`);
  const total = await one<{ m: number }>(`SELECT coalesce(sum(spend_micro), 0)::bigint AS m FROM runs WHERE ${shown}`);
  return {
    totalCents: cents(total?.m ?? 0),
    byDay: byDay.map((d) => ({ day: d.day, cents: cents(d.m) })),
    byEngine: byEngine.map((p) => ({ engine: p.engine, runs: p.n, spentCents: cents(p.m), outputs: outputs.find((o) => o.engine === p.engine)?.n ?? 0 })),
    byScript: byScript.map((s) => ({ scriptId: s.script_id, name: catalogue.script(s.script_id)?.name ?? s.script_id, runs: s.n, spentCents: cents(s.m) })),
    byVendor: byVendor.map((v) => ({ vendor: v.vendor, item: v.item, quantity: v.qty, cents: cents(v.m) })),
    byCampaign: byCampaign.map((c) => ({ campaignId: c.id, name: c.name, spentCents: cents(c.m) })),
    report: scaled,
    runs: await runsOut(catalogue, "", [], 100),
  };
}
