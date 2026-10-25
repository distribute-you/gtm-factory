/**
 * A fictional world built from ANY catalogue: fictional clients, offers,
 * audiences and lead attributes, plus hidden truths drawn from a seed. Nothing
 * here knows a particular channel, pipe or step: every pipe of the catalogue
 * gets workflows, slot options and a hidden yield the same way.
 */

import type { Catalogue, Pipe, SlotOption, StepKey, Workflow } from "./catalogue";
import { START } from "./catalogue";
import type { AudienceProposal, SegmentRule } from "./client";
import { createRng, type Rng } from "./rng";
import type { PipeTruth, SimAttribute, SimClient, SimReporter, WorldSpec } from "./simulator";

export interface FictionalWorldOptions {
  seed?: number | string;
  clients?: number;
  /** Share of optional steps each fictional offer leaves out. */
  stepDropRate?: number;
}

const COMPANIES = ["Northwind Analytics", "Bluepeak Logistics", "Lumen Dental Labs", "Copperleaf Studio", "Harbor & Pine Legal", "Quillstone Payroll"];
const ICPS = [
  "Heads of operations at mid-sized logistics companies in Europe",
  "Founders of software startups who just raised a first round",
  "Dental clinic owners with two or more practices",
  "Marketing managers at consumer brands selling online",
  "Partners at small law firms handling business clients",
  "Finance leads at companies with 50 to 500 employees",
];

export const FICTIONAL_ATTRIBUTES: SimAttribute[] = [
  { name: "country", values: ["France", "Germany", "United Kingdom", "United States"], weights: [3, 2, 2, 3] },
  { name: "company_size", values: ["1-10", "11-50", "51-200", "201-1000"], weights: [3, 3, 2, 1] },
  { name: "seniority", values: ["founder", "head", "manager"], weights: [2, 2, 3] },
  { name: "source", values: ["cold filters", "buying signals", "engagement"], weights: [4, 2, 2] },
];

function between(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next();
}

function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** The step a paid client is: the highest rank of any lead track. */
export function topStep(catalogue: Catalogue): StepKey | null {
  let best: { key: StepKey; rank: number } | null = null;
  for (const s of catalogue.steps) {
    if (s.retired || !s.leadState) continue;
    const better = !best || s.leadState.rank > best.rank || (s.leadState.rank === best.rank && s.key === s.leadState.state);
    if (better) best = { key: s.key, rank: s.leadState.rank };
  }
  return best?.key ?? null;
}

/** Build a fictional world on a catalogue (the catalogue is cloned, then given workflows and slot options). */
export function fictionalWorld(source: Catalogue, options: FictionalWorldOptions = {}): WorldSpec {
  const seed = options.seed ?? 1;
  const rng = createRng(`world:${seed}`);
  const catalogue = source.clone();
  const target = topStep(catalogue);
  if (!target) throw new Error("the catalogue has no lead state to aim at");

  // Shared LLM-like slot options (usable on every pipe).
  const llms: SlotOption[] = [
    { id: "llm:swift", slot: "llm", name: "Swift model", pipeId: null, tactics: [], costPerTrialCents: 1, status: "active" },
    { id: "llm:balanced", slot: "llm", name: "Balanced model", pipeId: null, tactics: [], costPerTrialCents: 3, status: "active" },
    { id: "llm:deep", slot: "llm", name: "Deep model", pipeId: null, tactics: [], costPerTrialCents: 9, status: "active" },
  ];
  for (const o of llms) if (!catalogue.slotOption(o.id)) catalogue.add("slotOptions", o);

  const truthPipes: PipeTruth[] = [];
  const workflowTruth: Record<string, number> = {};
  const slotTruth: Record<string, number> = {};
  for (const o of llms) slotTruth[o.id] = round(between(rng, 0.8, 1.25));

  for (const pipe of catalogue.pipes) {
    if (!catalogue.isPipeLive(pipe)) continue;
    const channel = catalogue.channel(pipe.channel);
    const toState = catalogue.step(pipe.to)?.leadState ?? null;
    const fromState = pipe.from === START ? null : catalogue.step(pipe.from)?.leadState ?? null;
    const fromStart = pipe.from === START;
    // Generic truth: the further a pipe moves a lead up its lead track, the lower its yield.
    let baseYield: number;
    if (!toState) baseYield = between(rng, 0.5, 0.9);
    else if (fromState && fromState.leadTrack === toState.leadTrack) baseYield = between(rng, 0.2, 0.6) ** Math.max(1, toState.rank - fromState.rank);
    else if (fromState) baseYield = between(rng, 0.05, 0.3) * between(rng, 0.3, 0.6) ** (toState.rank - 1);
    else baseYield = between(rng, 0.02, 0.08) * between(rng, 0.3, 0.6) ** (toState.rank - 1);
    truthPipes.push({
      pipeId: pipe.id,
      baseYield: round(baseYield),
      delayMeanDays: pipe.maturity.delayMeanDays,
      maxDelayDays: Math.max(1, Math.ceil(pipe.maturity.durationDays || pipe.maturity.delayMeanDays * 4)),
    });
    const cheap = fromStart || pipe.mode === "proactive";
    const baseCost = cheap ? Math.round(between(rng, 30, 150)) : Math.round(between(rng, 100, 1500));
    const expectedYield = round(baseYield * between(rng, 0.6, 1.4));
    const person = channel?.performedBy === "person";
    const flows: Workflow[] = person
      ? [
          { id: `${pipe.id}:wf:human`, dynasty: `${pipe.id}:human`, pipeId: pipe.id, kind: "human", slots: [], tactics: [], costPerTrialCents: baseCost * 2, expectedYield, status: "active" },
          { id: `${pipe.id}:wf:scripted`, dynasty: `${pipe.id}:scripted`, pipeId: pipe.id, kind: "human", slots: ["template"], tactics: [], costPerTrialCents: baseCost * 2, expectedYield, status: "active" },
        ]
      : [
          { id: `${pipe.id}:wf:rules`, dynasty: `${pipe.id}:rules`, pipeId: pipe.id, kind: "rules", slots: ["template"], tactics: [], costPerTrialCents: baseCost, expectedYield, status: "active" },
          { id: `${pipe.id}:wf:ai`, dynasty: `${pipe.id}:ai`, pipeId: pipe.id, kind: "ai", slots: ["template", "llm"], tactics: [], costPerTrialCents: baseCost, expectedYield, status: "active" },
          { id: `${pipe.id}:wf:ai-research`, dynasty: `${pipe.id}:ai-research`, pipeId: pipe.id, kind: "ai", slots: ["template", "llm"], tactics: [], costPerTrialCents: Math.round(baseCost * 1.6), expectedYield, status: "active" },
        ];
    for (const w of flows) {
      if (catalogue.workflow(w.id)) continue;
      catalogue.add("workflows", w);
      workflowTruth[w.id] = round(between(rng, 0.6, 1.6));
    }
    for (const name of ["short", "story"]) {
      const o: SlotOption = { id: `${pipe.id}:template:${name}`, slot: "template", name: `${name} template`, pipeId: pipe.id, tactics: [], costPerTrialCents: 0, status: "active" };
      if (catalogue.slotOption(o.id)) continue;
      catalogue.add("slotOptions", o);
      slotTruth[o.id] = round(between(rng, 0.75, 1.3));
    }
  }

  const optional = catalogue.steps.filter((s) => !s.retired && s.key !== target).map((s) => s.key);
  const dropRate = options.stepDropRate ?? 0.25;
  const clients: SimClient[] = [];
  const clientTruth: Record<string, number> = {};
  const n = Math.min(options.clients ?? 3, COMPANIES.length);
  for (let i = 0; i < n; i++) {
    const name = COMPANIES[i]!;
    const brandId = `brand-${i + 1}`;
    const steps = [...optional.filter(() => rng.next() >= dropRate), target];
    clients.push({
      org: { id: `org-${i + 1}`, name },
      brand: { id: brandId, orgId: `org-${i + 1}`, name, icp: ICPS[i]! },
      offer: {
        id: `offer-${i + 1}`,
        brandId,
        name: `${name} main offer`,
        steps,
        ...(i === n - 1 && n > 1 ? {} : { lifetimeRevenue: Math.round(between(rng, 2000, 20000)) }),
      },
      campaign: {
        id: `campaign-${i + 1}`,
        offerId: `offer-${i + 1}`,
        target,
        dailyBudgetCents: Math.round(between(rng, 5000, 20000)),
        status: "running",
      },
      expertAudiences: expertAudiences(rng),
    });
    clientTruth[brandId] = round(between(rng, 0.7, 1.3));
  }

  const segments = FICTIONAL_ATTRIBUTES.flatMap((a) => a.values.map((value) => ({ attribute: a.name, value, multiplier: round(between(rng, 0.6, 1.6)) })));

  const states = [...new Set(catalogue.steps.flatMap((s) => (s.leadState ? [s.leadState.state] : [])))];
  const reporters: SimReporter[] = [
    { reporter: { id: "crm", name: "Client CRM" }, outcomes: states, recall: 0.98, spuriousRate: 0 },
    { reporter: { id: "tracker", name: "Website tracker" }, outcomes: states, recall: 0.6, spuriousRate: 0.004 },
    { reporter: { id: "reply_judge", name: "AI reply judge" }, outcomes: states.slice(0, 1), recall: 0.92, spuriousRate: 0.002 },
  ];

  return {
    seed,
    catalogue,
    clients,
    attributes: FICTIONAL_ATTRIBUTES,
    truth: { pipes: truthPipes, workflows: workflowTruth, slotOptions: slotTruth, segments, clients: clientTruth },
    reporters,
    evidencePolicy: { referenceReporter: Object.fromEntries(states.map((s) => [s, "crm"])), minReliability: 0.8 },
    settings: { funnelCandidates: 4, funnelEveryDays: 7, discoverEveryDays: 15, setupCentsPerClient: 5000 },
  };
}

function expertAudiences(rng: Rng): AudienceProposal[] {
  const out: AudienceProposal[] = [];
  const picks = [FICTIONAL_ATTRIBUTES[1]!, FICTIONAL_ATTRIBUTES[2]!];
  for (let i = 0; i < 2; i++) {
    const a = picks[i]!;
    const values = a.values.filter(() => rng.next() < 0.6);
    const chosen = values.length > 0 ? values : [a.values[0]!];
    const rule: SegmentRule = { [a.name]: chosen };
    out.push({ name: `${a.name.replace("_", " ")}: ${chosen.join(", ")}`, description: `Leads whose ${a.name.replace("_", " ")} is ${chosen.join(" or ")}.`, rule });
  }
  return out;
}
