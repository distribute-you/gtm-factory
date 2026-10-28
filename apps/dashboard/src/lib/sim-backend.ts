/**
 * The simulator as a backend: it answers the factory API (packages/core/src/factory-api.ts)
 * from the running SimulationSession, in the browser, with no network. Every page reads the
 * factory API only, so the public demo and a running GTM Factory render the same pages; only
 * the data source differs. Figures come from the session: nothing here divides on a page's
 * behalf that a running backend would not serve too.
 */

import {
  OURS,
  START,
  chanceOfBest,
  describeCondition,
  estimatedRegret,
  isOurs,
  type ApiCompany,
  type ApiProposal,
  type ApiSeries,
  type ApiBrand,
  type ApiCampaign,
  type ApiCampaignDetail,
  type ApiCandidate,
  type ApiCandidates,
  CONNECT_CHANNELS,
  type ApiConnectedAccount,
  type ApiLead,
  type ApiLeadDetail,
  type ApiLedger,
  type ApiMilestone,
  type ApiMilestoneFlow,
  type ApiObjectDynasty,
  type ApiOverview,
  type ApiPick,
  type ApiPlanNode,
  type ApiPlanPreview,
  type ApiRun,
  type ApiScriptInput,
  type ApiScriptStats,
  type ApiTask,
  type ApiUnit,
  type Campaign,
  type OutcomeId,
  type PlanTreeNode,
  type Script,
  type ScriptInput,
  type WorldClient,
} from "@gtm-factory/core";
import { candidateLabel, companyName, engineName, explainPick, headScript, leadRows, materialsOfScript, objectDynasties, outcomeLabel, personName, pointInfo, previewPlan, scopeFigures, scopeReturn, type Model } from "./model";
import { campaignMilestones, freshCampaignId, newClient } from "./campaigns";
import type { SimAction } from "./world";
import { SOURCES } from "@gtm-factory/scripts";

/** The simulated day being shown is the anchor (now, or the fixed date of the shipped example data): day d is (shown day - d) days before it. */
let shownDay = 0;
let anchorMs: number | null = null;
export function setAnchor(ms: number | null): void {
  anchorMs = ms;
}
export const isoOfDay = (day: number): string => new Date((anchorMs ?? Date.now()) - (shownDay - day) * 86_400_000).toISOString();

export class SimHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** What the backend needs from the simulator context: the model of the day and the logged actions. */
export interface SimBackendHost {
  model: Model;
  dispatch: (action: SimAction) => string | null;
}

export function simRoute(host: SimBackendHost, method: string, rawPath: string, body: unknown): unknown {
  const { model } = host;
  shownDay = model.day;
  const url = new URL(rawPath, "http://sim");
  const p = url.pathname.replace(/\/$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const q = (k: string) => url.searchParams.get(k);
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (status: number, msg: string): never => {
    throw new SimHttpError(status, msg);
  };
  const act = (a: SimAction) => {
    const err = host.dispatch(a);
    if (err) fail(400, err);
  };

  if (method === "GET") {
    if (p[0] === "overview") return overview(model);
    if (p[0] === "catalogue") return model.catalogue.snapshot();
    if (p[0] === "brands" && p.length === 1) return model.clients.map((c) => brandOf(model, c));
    if (p[0] === "brands" && p[2] === "plans") return plansOf(model, p[1]!);
    if (p[0] === "campaigns" && p.length === 1) return model.campaigns.map((c) => campaignOf(model, c));
    if (p[0] === "campaigns" && p.length === 2) {
      const c = model.campaigns.find((x) => x.id === p[1]) ?? fail(404, `No campaign "${p[1]}".`);
      return campaignDetail(model, c);
    }
    if (p[0] === "leads" && p.length === 1) return leadsOf(model, q("brandId"), q("campaignId"), q("state"));
    if (p[0] === "leads" && p.length === 2) return leadDetail(model, p[1]!) ?? fail(404, `No lead "${p[1]}".`);
    if (p[0] === "objects") return objectsOf(model, q("outcome") ?? fail(400, "Name an outcome."));
    if (p[0] === "scripts") return scriptsOf(model, q("outcome"));
    if (p[0] === "research") return research(model);
    if (p[0] === "series") return seriesOf(model, q("brandId"));
    if (p[0] === "companies") return companiesOf(model, q("brandId"));
    if (p[0] === "proposals") return proposalsOf(model, q("brandId"));
    if (p[0] === "picks") return picksOf(model, new Set(model.campaigns.filter((c) => !q("campaignId") || c.id === q("campaignId")).map((c) => c.id)), 50);
    if (p[0] === "tasks") return tasksOf(model, q("brandId"));
    if (p[0] === "accounts") return accountsOf(model, q("brandId") ?? fail(400, "Name a brand."));
    if (p[0] === "connect" && p[1] === "channels") return CONNECT_CHANNELS.map((c) => ({ ...c, available: false, unavailableReason: "The demo shows example data. Connect your own accounts on your own GTM Factory." }));
    if (p[0] === "ledger") return ledgerOf(model);
  }
  if (method === "POST" || method === "PATCH") {
    if (p[0] === "campaigns" && p.length === 3 && (p[2] === "launch" || p[2] === "pause")) {
      act({ type: "status", campaignId: p[1]!, status: p[2] === "launch" ? "running" : "paused" });
      return { ok: true };
    }
    if (p[0] === "campaigns" && p.length === 2 && method === "PATCH") {
      act({ type: "budget", campaignId: p[1]!, dailyBudgetCents: Number(b.dailyBudgetCents) });
      return { ok: true };
    }
    if (p[0] === "scripts" && p.length === 3 && (p[2] === "retire" || p[2] === "restore")) {
      act({ type: p[2], kind: "scripts", id: p[1]! });
      return { ok: true };
    }
    if (p[0] === "scripts" && p[2] === "capacity") {
      const cap = { ...(b.perDay != null ? { perDay: Number(b.perDay) } : {}), ...(b.daysPerUnit != null ? { daysPerUnit: Number(b.daysPerUnit) } : {}) };
      act({ type: "capacity", scriptId: p[1]!, capacity: cap });
      return { ok: true };
    }
    if (p[0] === "tasks" && p[2] === "answer") {
      act({ type: "answerTask", taskId: p[1]!, values: (b.values ?? {}) as Record<string, string | number | boolean> });
      return { ok: true };
    }
    if (p[0] === "accounts" && p.length === 2 && method === "PATCH") {
      const brandId = model.clients.find((c) => model.session.accountsOf(c.brand.id).some((a) => a.id === p[1]))?.brand.id ?? fail(404, `No account "${p[1]}".`);
      act({ type: "accountRole", brandId, accountId: p[1]!, role: String(b.role) });
      return { ok: true };
    }
    if (p[0] === "accounts" && p[1] === "connect") fail(501, "The demo shows example data. Connect your own accounts on your own GTM Factory.");
    if (p[0] === "brands" && p.length === 1) {
      const tracked = model.tracks.flatMap((t) => t.states.map((x) => x.outcome));
      const client = newClient(model, { name: String(b.name ?? "New client"), audienceText: String(b.icp ?? ""), offerOutcomes: tracked, ...(b.lifetimeValueCents ? { lifetimeRevenue: Number(b.lifetimeValueCents) / 100 } : {}) });
      act({ type: "launch", client });
      return brandOf(host.model, client);
    }
    if (p[0] === "campaigns" && p.length === 1) {
      const client = model.clients.find((c) => c.brand.id === b.brandId) ?? fail(400, "Pick a brand.");
      const id = freshCampaignId(model, `campaign-${client.brand.id.replace(/^brand-/, "")}`);
      const target = String(b.target ?? "");
      const campaign: Campaign = {
        id,
        brandId: client.brand.id,
        offerId: String(b.offerId ?? client.offer.id),
        name: `${outcomeLabel(model.catalogue, target)} for ${client.brand.name}`,
        start: String(b.start ?? START),
        target,
        dailyBudgetCents: Math.round(Number(b.dailyBudgetCents ?? 0)),
        status: "paused",
        brief: String(b.brief ?? ""),
        ...(b.volume ? { volume: b.volume as { units: number; periodDays: number } } : {}),
      };
      act({ type: "launch", client: { ...client, campaigns: [campaign], seeds: [], accounts: [] } });
      return campaignOf(host.model, host.model.session.campaign(id) ?? campaign);
    }
    if (p[0] === "objects") {
      const brandId = String(b.brandId ?? model.clients[0]?.brand.id ?? "");
      if (b.parentDynasty) act({ type: "objectFork", brandId, outcome: String(b.outcome), parentDynasty: String(b.parentDynasty), dynasty: `${String(b.parentDynasty)}-fork-d${model.day}`, text: String(b.content), name: String(b.name) });
      else act({ type: "objectVersion", brandId, outcome: String(b.outcome), dynasty: String(b.dynasty), text: String(b.content), name: String(b.name) });
      return { ok: true };
    }
  }
  return fail(404, `The simulator does not answer ${method} ${url.pathname}.`);
}

// ---------------------------------------------------------------------------

function brandOf(model: Model, c: WorldClient): ApiBrand {
  const spent = c.campaigns.reduce((x, k) => x + model.session.spentCents(k.id), 0);
  return {
    id: c.brand.id,
    name: c.brand.name,
    orgId: c.org.id,
    orgName: c.org.name,
    offers: [{ id: c.offer.id, name: c.offer.name }],
    website: "",
    offer: c.offer.name,
    icp: c.seeds.find((s) => model.catalogue.outcome(s.outcome)?.contentType === "audience")?.text ?? "",
    lifetimeValueCents: c.offer.lifetimeRevenue ? Math.round(c.offer.lifetimeRevenue * 100) : null,
    test: false,
    providedLeads: 0,
    createdAt: isoOfDay(0),
    spentTotalCents: spent,
  };
}

function countsOf(model: Model, ids: Set<string>): Record<OutcomeId, number> {
  const out: Record<OutcomeId, number> = {};
  for (const d of model.session.days) for (const [cid, per] of Object.entries(d.outcomes)) if (ids.has(cid)) for (const [o, n] of Object.entries(per)) out[o] = (out[o] ?? 0) + n;
  return out;
}

function campaignOf(model: Model, c: Campaign): ApiCampaign {
  const last = model.session.days[model.session.days.length - 1];
  const today = last?.spendCents[c.id] ?? 0;
  return {
    id: c.id,
    brandId: c.brandId,
    offerId: c.offerId,
    name: c.name,
    line: model.session.milestoneLine(c),
    start: c.start,
    target: c.target,
    status: c.status === "running" ? "live" : "paused",
    dailyBudgetCents: c.dailyBudgetCents,
    volume: c.volume ?? null,
    spentTodayCents: today,
    spentTotalCents: model.session.spentCents(c.id),
    capReached: today >= c.dailyBudgetCents,
    brief: c.brief,
    verdicts: { ...(c.verdicts ?? {}) },
    caps: { ...(c.caps ?? {}) },
    endsAt: c.endDay !== undefined ? isoOfDay(c.endDay) : null,
    counts: countsOf(model, new Set([c.id])),
    createdAt: isoOfDay(0),
    launchedAt: isoOfDay(0),
    lastTickAt: model.day > 0 ? isoOfDay(model.day) : null,
  };
}

function inputsOut(model: Model, inputs: readonly ScriptInput[]): ApiScriptInput[] {
  return inputs.map((i) => ({ material: i.material, label: outcomeLabel(model.catalogue, i.material), versions: i.versions.map((v) => ({ id: v.id, label: v.label ?? v.id, share: v.share })) }));
}

function treeOut(model: Model, n: PlanTreeNode): ApiPlanNode {
  return {
    outcome: n.outcome,
    scriptId: n.scriptId,
    candidates: n.candidates,
    branches: n.branches.map((b) => ({
      scriptId: b.scriptId,
      runs: b.runs,
      units: b.units,
      share: b.share,
      costPerUnitCents: b.costPerUnit == null ? null : Math.round(b.costPerUnit * 100),
      current: b.current,
      inputs: inputsOut(model, b.inputs),
      children: b.children.map((x) => treeOut(model, x)),
      sameBelow: b.sameBelow,
    })),
  };
}

function milestonesOut(model: Model, c: Campaign): ApiMilestone[] {
  return campaignMilestones(model, c).map((m) => ({
    from: m.from,
    to: m.to,
    engines: [m.to],
    costPerAttemptCents: Math.round((m.costPerAttempt ?? 0) * 100),
    yieldRate: m.yieldRate ?? 0,
    attemptsPerTarget: m.attemptsPerTarget ?? 0,
    costOfOutcomeCents: Math.round((m.costOfOutcome ?? 0) * 100),
    costFromStartCents: Math.round((m.costFromStart ?? 0) * 100),
    costPerTargetCents: Math.round((m.costPerTarget ?? 0) * 100),
    label: m.label,
  }));
}

function flowsOut(model: Model, c: Campaign): ApiMilestoneFlow[] {
  return model.session.flows(c).map((f) => ({ ...f, by: f.by.map((x) => ({ ...x, name: model.catalogue.script(x.scriptId)?.name ?? x.scriptId })) }));
}

function candidatesOf(model: Model, c: Campaign, point: string): ApiCandidates {
  const info = pointInfo(model.catalogue, point);
  const series = model.session.pickSeries(point, c.id);
  const recent = new Map<string, number>();
  let total = 0;
  for (const [o, arr] of series) {
    const n = arr.slice(-7).reduce((x, y) => x + y, 0);
    recent.set(o, n);
    total += n;
  }
  const beliefs = model.session.beliefsAt(point, c.id);
  const chance = chanceOfBest(beliefs.map((b) => ({ id: b.candidate, rate: b.rate, rateSd: b.rateSd, cost: b.cost })));
  const candidates: ApiCandidate[] = beliefs.map((b) => ({
    id: b.candidate,
    label: candidateLabel(model, point, b.candidate, c.brandId),
    rateMean: b.rate,
    rateSd: b.rateSd,
    costMeanCents: Math.round(b.cost * 100),
    meanScore: b.valuePerDollar,
    chanceBest: chance[b.candidate] ?? 0,
    share: total > 0 ? (recent.get(b.candidate) ?? 0) / total : 0,
    picks: series.get(b.candidate)?.reduce((x, y) => x + y, 0) ?? 0,
    successes: b.successes,
    spentCents: spentByDynasty(model, c).get(b.candidate) ?? 0,
    inputs: info.kind === "script" ? inputsOut(model, model.session.inputsOf(b.candidate, c.id)) : [],
  }));
  const daily = model.session.pickLog
    .filter((p) => p.point === point && p.campaignId === c.id)
    .map((p) => {
      const picks = p.candidates.reduce((x, o) => x + o.picks, 0);
      const r = estimatedRegret({ candidates: p.candidates });
      return { day: isoOfDay(p.day), picks, shares: Object.fromEntries(p.candidates.map((o) => [o.id, picks > 0 ? o.picks / picks : 0])), regretCents: r.regretCents, bestMargin: r.bestMargin };
    });
  return { id: point, consumer: info.consumer, material: info.material, label: info.title, candidates, campaignId: c.id, daily };
}

/** The places where a campaign's scripts compete. The brand's competing inputs (ICPs, templates) ride on the row of the script that used them. */
function scriptPlaces(model: Model, c: Campaign): string[] {
  return [...new Set(model.session.candidatePlaces().filter((x) => x.campaignId === c.id).map((x) => x.point))].filter((pt) => pointInfo(model.catalogue, pt).kind === "script");
}

/** Cents a campaign spent on each script dynasty. */
function spentByDynasty(model: Model, c: Campaign): Map<string, number> {
  const key = `spentByDynasty:${c.id}`;
  const hit = model.memo.get(key) as Map<string, number> | undefined;
  if (hit) return hit;
  const out = new Map<string, number>();
  for (const r of model.session.runs) {
    if (r.campaignId !== c.id || !r.scriptId) continue;
    const d = model.catalogue.script(r.scriptId)?.dynasty ?? r.scriptId;
    out.set(d, (out.get(d) ?? 0) + r.spendCents);
  }
  model.memo.set(key, out);
  return out;
}

function campaignDetail(model: Model, c: Campaign): ApiCampaignDetail {
  const client = model.clients.find((x) => x.brand.id === c.brandId)!;
  const tree = model.session.planTree(c);
  const points = scriptPlaces(model, c);
  return {
    campaign: campaignOf(model, c),
    brand: brandOf(model, client),
    milestones: milestonesOut(model, c),
    plan: tree ? treeOut(model, tree) : null,
    flows: flowsOut(model, c),
    spendByDay: model.session.days.map((d) => ({ day: isoOfDay(d.day).slice(0, 10), cents: d.spendCents[c.id] ?? 0 })),
    candidates: points.map((pt) => candidatesOf(model, c, pt)),
    recentPicks: picksOf(model, new Set([c.id]), 20),
    recentRuns: runsOf(model, (r) => r.campaignId === c.id, 20),
  };
}

function picksOf(model: Model, ids: Set<string>, limit: number): ApiPick[] {
  const out: ApiPick[] = [];
  const all = model.session.pickLog;
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const r = all[i]!;
    if (!ids.has(r.campaignId)) continue;
    const brandId = model.campaigns.find((x) => x.id === r.campaignId)?.brandId ?? "";
    const info = pointInfo(model.catalogue, r.point);
    out.push({
      id: `${r.day}:${r.campaignId}:${r.point}`,
      at: isoOfDay(r.day),
      campaignId: r.campaignId,
      brandId,
      leadId: null,
      kind: info.kind === "unit" ? "input" : "script",
      place: r.point,
      placeLabel: info.kind === "unit" ? outcomeLabel(model.catalogue, info.material) : engineName(model.catalogue, info.material),
      picked: r.pickedId,
      pickedLabel: candidateLabel(model, r.point, r.pickedId, brandId),
      candidates: r.candidates.map((x) => ({ id: x.id, label: candidateLabel(model, r.point, x.id, brandId), meanScore: x.meanScore, sampledScore: x.meanScore })),
      reason: explainPick(model, r),
      credited: false,
    });
  }
  return out;
}

function runsOf(model: Model, keep: (r: (typeof model.session.runs)[number]) => boolean, limit: number): ApiRun[] {
  const produced = new Map<string, { id: string; outcome: OutcomeId }[]>();
  for (const u of model.session.units) {
    const l = produced.get(u.runId);
    if (l) l.push({ id: u.id, outcome: u.outcome });
    else produced.set(u.runId, [{ id: u.id, outcome: u.outcome }]);
  }
  const out: ApiRun[] = [];
  const all = model.session.runs;
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const r = all[i]!;
    if (!keep(r) || !r.scriptId) continue;
    const s = model.catalogue.script(r.scriptId);
    const made = produced.get(r.id) ?? [];
    const lead = made.map((m) => model.session.unit(m.id)).find((u) => u && model.catalogue.outcome(u.outcome)?.subject === "lead");
    out.push({
      id: r.id,
      at: isoOfDay(r.day),
      campaignId: r.campaignId ?? null,
      brandId: r.campaignId ? (model.campaigns.find((c) => c.id === r.campaignId)?.brandId ?? null) : null,
      engine: s?.outcome ?? r.engine ?? "",
      scriptId: r.scriptId,
      scriptName: s?.name ?? r.scriptId,
      performedBy: r.performedBy,
      leadId: lead?.subject ?? null,
      status: made.length > 0 ? "ok" : "no_outcome",
      note: made.length > 0 ? `Made ${made.map((m) => outcomeLabel(model.catalogue, m.outcome)).join(", ")}.` : "No outcome this time.",
      spendCents: r.spendCents,
      produced: made,
      consumed: r.consumed,
      costs: [],
    });
  }
  return out;
}

function overview(model: Model): ApiOverview {
  const ids = new Set(model.campaigns.map((c) => c.id));
  const last = model.session.days[model.session.days.length - 1];
  return {
    now: isoOfDay(model.day),
    catalogue: model.catalogue.snapshot(),
    brands: model.clients.map((c) => brandOf(model, c)),
    campaigns: model.campaigns.map((c) => campaignOf(model, c)),
    totals: { spentTodayCents: Object.values(last?.spendCents ?? {}).reduce((x, y) => x + y, 0), spentTotalCents: model.campaigns.reduce((x, c) => x + model.session.spentCents(c.id), 0), counts: countsOf(model, ids) },
    recentPicks: picksOf(model, ids, 20),
    recentRuns: runsOf(model, () => true, 20),
    scheduler: { lastTickAt: model.day > 0 ? isoOfDay(model.day) : null, tickEverySeconds: 86_400, running: true },
    pins: model.world.catalogue ? undefined : undefined,
  };
}

function plansOf(model: Model, brandId: string): ApiPlanPreview[] {
  const targets = model.tracks.flatMap((t) => [...t.states].reverse().map((s) => s.outcome));
  return targets.map((target) => {
    const { line } = previewPlan(model, brandId, START, target);
    const sibling = model.campaigns.find((c) => c.brandId === brandId && c.target === target && c.start === START);
    const ms = sibling ? milestonesOut(model, sibling) : [];
    const cost = ms[ms.length - 1]?.costFromStartCents ?? 0;
    const value = sibling ? model.session.economics(sibling.id).expected.value ?? 0 : 0;
    return { target, line, milestones: ms, costPerTargetCents: cost, valuePerDollar: value, label: sibling ? "measured" : "expected" };
  });
}

function leadOf(model: Model, personId: string): ApiLead | null {
  const p = model.session.person(personId);
  if (!p) return null;
  const reached = model.session.reachedBy(personId);
  let state: OutcomeId = "";
  let best = -1;
  for (const t of model.tracks) for (const s of t.states) if (reached.has(s.outcome) && s.rank > best) ((best = s.rank), (state = s.outcome));
  const last = Math.max(0, ...reached.values());
  return { id: p.id, brandId: p.brandId, campaignId: model.session.campaignsOfSubject(p.id)[0] ?? null, name: personName(p.id), email: null, company: companyName(p.companyId), title: null, state: state || ([...reached.keys()][0] ?? ""), reached: [...reached.keys()], updatedAt: isoOfDay(last) };
}

function leadsOf(model: Model, brandId: string | null, campaignId: string | null, state: string | null): ApiLead[] {
  const out: ApiLead[] = [];
  for (const p of model.session.people()) {
    if (brandId && p.brandId !== brandId) continue;
    if (campaignId && !model.session.campaignsOfSubject(p.id).includes(campaignId)) continue;
    if (state && !model.session.reachedBy(p.id).has(state)) continue;
    const l = leadOf(model, p.id);
    if (l && l.reached.length > 0) out.push(l);
    if (out.length >= 500) break;
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function leadDetail(model: Model, id: string): ApiLeadDetail | null {
  const lead = leadOf(model, id);
  if (!lead) return null;
  const p = model.session.person(id)!;
  const units: ApiUnit[] = model.session.units
    .filter((u) => u.subject === id || u.subject === p.companyId)
    .map((u) => ({ id: u.id, outcome: u.outcome, at: isoOfDay(u.day), runId: u.runId, performedBy: u.performedBy, traceability: u.trace.map(String), content: (u.content as Record<string, unknown>) ?? null }));
  const runIds = new Set(units.map((u) => u.runId));
  return { lead, units, runs: runsOf(model, (r) => runIds.has(r.id), 100), picks: [] };
}

function objectsOf(model: Model, outcome: OutcomeId): ApiObjectDynasty[] {
  const out: ApiObjectDynasty[] = [];
  const figures = new Map(objectDynasties(model, outcome, null).map((d) => [`${d.brandId}|${d.dynasty}`, d]));
  for (const c of model.clients) {
    const versions = model.session.objectVersions(c.brand.id, outcome);
    for (const d of [...new Set(versions.map((v) => v.dynasty!))]) {
      const vs = versions.filter((v) => v.dynasty === d).sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
      out.push({
        dynasty: d,
        outcome,
        parentDynasty: vs[0]!.parentDynasty ?? null,
        brandId: c.brand.id,
        versions: vs.map((v, i) => ({ id: v.id, version: v.version ?? 1, name: v.name ?? d, content: v.text ?? JSON.stringify(v.content ?? {}), createdAt: isoOfDay(v.day), head: i === vs.length - 1 })),
        stats: [],
        retired: false,
        ...objectFigures(model, figures.get(`${c.brand.id}|${d}`), vs[0]!.id),
      });
    }
  }
  return out;
}

function objectFigures(model: Model, d: ReturnType<typeof objectDynasties>[number] | undefined, firstId: string): Pick<ApiObjectDynasty, "picks" | "share" | "producer" | "proposed"> {
  const s = d?.head.scriptId ? model.catalogue.script(d.head.scriptId) : undefined;
  const p = model.session.proposals.find((x) => x.kind === "audience" && x.createdId === firstId);
  return {
    picks: d?.picks ?? 0,
    share: d?.share ?? 0,
    producer: s ? { scriptId: s.id, name: headScript(model.catalogue, s.dynasty)?.name ?? s.name, performedBy: isOurs(s) ? OURS : String(s.tactics.performed_by ?? OURS) } : null,
    proposed: p ? { at: isoOfDay(p.day), subjects: p.study.proposal?.all.trials ?? 0 } : null,
  };
}

/** Spend, Units and value per day for one brand's campaigns (or all). */
function seriesOf(model: Model, brandId: string | null): ApiSeries {
  const campaigns = model.campaigns.filter((c) => !brandId || c.brandId === brandId);
  const f = scopeFigures(model, campaigns);
  return {
    days: f.dailySpendCents.map((_, d) => isoOfDay(d)),
    spendCents: f.dailySpendCents,
    outcomes: f.dailyOutcomes,
    valueCents: f.dailyValueOurs.map((v) => Math.round(v * 100)),
    expectedReturn: scopeReturn(model, campaigns).expected,
  };
}

/** Companies the brand's leads belong to: one research of a company serves every lead of it. */
function companiesOf(model: Model, brandId: string | null): ApiCompany[] {
  const leads = leadRows(model, brandId);
  const by = new Map<string, typeof leads>();
  for (const l of leads) by.set(l.person.companyId, [...(by.get(l.person.companyId) ?? []), l]);
  const researched = new Map<string, number>();
  const unitCompany = new Map<string, string>();
  for (const u of model.session.units) {
    if (!by.has(u.subject)) continue;
    unitCompany.set(u.id, u.subject);
    if (model.catalogue.outcome(u.outcome)?.subject === "company") researched.set(u.subject, Math.min(researched.get(u.subject) ?? u.day, u.day));
  }
  const uses = new Map<string, number>();
  for (const u of model.session.units)
    for (const id of Object.values(u.materials)) {
      const cid = unitCompany.get(id);
      if (cid) uses.set(cid, (uses.get(cid) ?? 0) + 1);
    }
  const companyTactics = model.catalogue.tactics.filter((t) => t.describes.includes("company")).map((t) => t.id);
  return [...by].map(([id, ls]) => {
    let furthest: { outcome: OutcomeId; rank: number } | null = null;
    for (const l of ls) for (const st of Object.values(l.states)) if (st && (!furthest || st.rank > furthest.rank)) furthest = { outcome: st.outcome, rank: st.rank };
    const values: Record<string, string | number | boolean> = {};
    for (const t of companyTactics) if (ls[0]!.person.values[t] !== undefined) values[t] = ls[0]!.person.values[t] as string | number | boolean;
    const day = researched.get(id);
    return { id, name: companyName(id), brandId: ls[0]!.person.brandId, values, leads: ls.length, leadId: ls[0]!.person.id, furthest: furthest?.outcome ?? null, researchedAt: day === undefined ? null : isoOfDay(day), researchUses: uses.get(id) ?? 0 };
  });
}

/** What the splits proposed, newest first. */
function proposalsOf(model: Model, brandId: string | null): ApiProposal[] {
  return model.session.proposals
    .filter((p) => !brandId || p.brandId === brandId || p.brandId === null)
    .map((p) => {
      const strategy = p.kind === "strategy" ? model.catalogue.strategy(p.createdId) : undefined;
      return {
        kind: p.kind,
        createdId: p.createdId,
        brandId: p.brandId,
        at: isoOfDay(p.day),
        where: p.point ? pointInfo(model.catalogue, p.point).title : strategy ? engineName(model.catalogue, strategy.outcome) : null,
        conditions: p.conditions.map((c) => describeCondition(c, model.catalogue)),
        text: p.text || null,
        splits: [...p.study.root]
          .sort((a, b) => a.likeForLike.pValue - b.likeForLike.pValue)
          .slice(0, 20)
          .map((x) => ({ inside: describeCondition(x.inside, model.catalogue), insideSuccesses: x.insideCounts.successes, insideTrials: x.insideCounts.trials, outsideSuccesses: x.outsideCounts.successes, outsideTrials: x.outsideCounts.trials, verdict: x.verdict })),
      };
    })
    .reverse();
}

function scriptsOf(model: Model, outcome: string | null): ApiScriptStats[] {
  const runs = new Map<string, { n: number; spent: number; today: number }>();
  for (const r of model.session.runs) {
    if (!r.scriptId) continue;
    const x = runs.get(r.scriptId) ?? { n: 0, spent: 0, today: 0 };
    x.n++;
    x.spent += r.spendCents;
    if (r.day === model.day - 1) x.today++;
    runs.set(r.scriptId, x);
  }
  const outputs = new Map<string, number>();
  for (const u of model.session.units) if (u.scriptId) outputs.set(u.scriptId, (outputs.get(u.scriptId) ?? 0) + 1);
  return model.catalogue.scripts
    .filter((s) => !outcome || s.outcome === outcome)
    .map((s: Script) => {
      const m = materialsOfScript(model, s);
      const r = runs.get(s.id);
      return {
        id: s.id,
        dynasty: s.dynasty,
        version: s.version,
        outcome: s.outcome,
        name: s.name,
        kind: s.kind,
        status: s.status === "active" ? "active" : "retired",
        provider: s.provider?.name ?? null,
        performedBy: String(s.tactics.performed_by ?? OURS),
        tactics: { ...s.tactics },
        code: s.code,
        source: SOURCES[s.code],
        materials: m.rows.map((x) => x.material),
        materialsLabel: m.label,
        capacity: { perDay: s.capacity?.perDay ?? null, daysPerUnit: s.capacity?.daysPerUnit ?? null },
        costCentsPrior: s.costCents,
        runs: r?.n ?? 0,
        runsToday: model.session.runsTodayOf(s.id),
        spentCents: r?.spent ?? 0,
        outputs: outputs.get(s.id) ?? 0,
        places: [],
      };
    });
}

function research(model: Model): ApiCandidates[] {
  const out: ApiCandidates[] = [];
  for (const c of model.campaigns) {
    for (const pt of scriptPlaces(model, c)) out.push({ ...candidatesOf(model, c, pt), id: `${c.id}|${pt}` });
  }
  return out;
}

function tasksOf(model: Model, brandId: string | null): ApiTask[] {
  return model.session.tasks(brandId ?? undefined).map((t) => {
    const s = model.catalogue.script(t.scriptId);
    return {
      id: t.id,
      campaignId: t.campaignId,
      brandId: t.brandId,
      scriptId: t.scriptId,
      scriptName: s?.name ?? t.scriptId,
      outcome: s?.outcome ?? "",
      leadId: t.subject,
      subjectName: t.subject ? personName(t.subject) : null,
      asked: s?.name ?? "",
      fields: (s?.form ?? []).map((f) => ({ key: f.key, label: f.label, type: f.type })),
      status: "open",
      createdAt: isoOfDay(t.dayOrdered),
      answeredAt: null,
      answer: null,
    };
  });
}

function accountsOf(model: Model, brandId: string): ApiConnectedAccount[] {
  return model.session.accountsOf(brandId).map((a) => ({ ...a, brandId }));
}

function ledgerOf(model: Model): ApiLedger {
  const report = model.session.ledger();
  const byDay = new Map<number, number>();
  const byEngine = new Map<string, { runs: number; spentCents: number; outputs: number }>();
  const byScript = new Map<string, { runs: number; spentCents: number }>();
  const byCampaign = new Map<string, number>();
  for (const r of model.session.runs) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.spendCents);
    if (r.engine) {
      const e = byEngine.get(r.engine) ?? { runs: 0, spentCents: 0, outputs: 0 };
      e.runs++;
      e.spentCents += r.spendCents;
      byEngine.set(r.engine, e);
    }
    if (r.scriptId) {
      const s = byScript.get(r.scriptId) ?? { runs: 0, spentCents: 0 };
      s.runs++;
      s.spentCents += r.spendCents;
      byScript.set(r.scriptId, s);
    }
    if (r.campaignId) byCampaign.set(r.campaignId, (byCampaign.get(r.campaignId) ?? 0) + r.spendCents);
  }
  return {
    totalCents: report.totalSpendCents,
    byDay: [...byDay].sort((a, b) => a[0] - b[0]).map(([d, cents]) => ({ day: isoOfDay(d).slice(0, 10), cents })),
    byEngine: [...byEngine].map(([engine, e]) => ({ engine, ...e })),
    byScript: [...byScript].map(([scriptId, s]) => ({ scriptId, name: headScript(model.catalogue, model.catalogue.script(scriptId)?.dynasty ?? scriptId)?.name ?? scriptId, ...s })),
    byVendor: [],
    byCampaign: [...byCampaign].map(([campaignId, spentCents]) => ({ campaignId, name: model.campaigns.find((c) => c.id === campaignId)?.name ?? campaignId, spentCents })),
    report,
    runs: runsOf(model, () => true, 50),
  };
}
