/**
 * The "distribute.you catalogue" scenario: distribute.you's whole public GTM
 * catalogue (every channel, leg and step it serves) translated into
 * the framework's model, with scripts generated for the simulation, four
 * fictional clients on the fictional market, and a fictional hidden truth.
 * No figure here is a production rate, a cost or a statistic: every number is
 * drawn from a hash of the object's id, inside ranges written below.
 */

import { START, hashString, type Condition, type LegTruth, type Script, type ScriptTruth, type SeedUnit, type Tactic, type WorldClient, type WorldData } from "@gtm-factory/engine";
import type { PublicCatalogue } from "./public-catalogue";
import { CHANNEL_TACTIC, CLIENT_TEAM, ICP, ICP_CLIENT_LEG, ICP_FINDER_LEG, LLM_LEG, RATING_LEG, TEMPLATE, TEMPLATE_LEG, WAIT_TACTIC, translateCatalogue } from "./translate";

/** A number in [lo, hi] drawn from a hash of the parts: the same id gives the same number. */
function draw(lo: number, hi: number, ...parts: string[]): number {
  return lo + (hi - lo) * (hashString(parts.join("|")) / 4294967296);
}

function round(x: number, d = 3): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

const LEAD_TACTICS: Tactic[] = [
  { id: "country", name: "Country", type: { kind: "list", values: ["United States", "United Kingdom", "France", "Germany"] }, describes: ["lead"], source: "data" },
  { id: "seniority", name: "Seniority", type: { kind: "list", values: ["founder", "head", "manager"] }, describes: ["lead"], source: "data" },
  { id: "revenue", name: "Revenue", type: { kind: "number", unit: "$M" }, describes: ["company"], source: "data" },
  { id: "headcount", name: "Headcount", type: { kind: "number", unit: "people" }, describes: ["company"], source: "data" },
  { id: "hiring", name: "Hiring", type: { kind: "yesno" }, describes: ["company"], source: "judged" },
];
const SCRIPT_TACTICS: Tactic[] = [
  { id: "recontact_days", name: "Days before recontact", type: { kind: "number", unit: "days" }, describes: ["script"], source: "data" },
  { id: "tier", name: "Model tier", type: { kind: "list", values: ["fast", "pro"] }, describes: ["script"], source: "data" },
  { id: "personalized", name: "Personalized opening", type: { kind: "yesno" }, describes: ["script"], source: "judged" },
];
const BRAND_TACTICS: Tactic[] = [{ id: "sells_to", name: "Sells to", type: { kind: "list", values: ["SMB", "Mid-market"] }, describes: ["brand"], source: "data" }];

const LLMS = [
  { id: "llm_glm", name: "GLM", tier: "fast", provider: { name: "Zhipu", color: "#3b5bdb" }, cost: 1, end: 0.9 },
  { id: "llm_gemini_flash", name: "Gemini Flash", tier: "fast", provider: { name: "Google", color: "#1a73e8" }, cost: 2, end: 0.7 },
  { id: "llm_gemini_pro", name: "Gemini Pro", tier: "pro", provider: { name: "Google", color: "#1a73e8" }, cost: 5, end: 1.0 },
  { id: "llm_claude_sonnet", name: "Claude Sonnet", tier: "pro", provider: { name: "Anthropic", color: "#d97757" }, cost: 6, end: 1.1 },
];

/** Base yield of a leg by where it goes from and to (fictional ranges). */
function baseYield(from: string | undefined, to: string, id: string): number {
  const r = (lo: number, hi: number) => round(draw(lo, hi, "base", id));
  if (to === "lead_found") return 1;
  if (to === "lead_interested") return from === "lead_visited" ? r(0.05, 0.12) : from === "lead_found" ? r(0.01, 0.04) : r(0.005, 0.02);
  if (to === "lead_visited") return from === "lead_found" ? r(0.03, 0.08) : r(0.01, 0.04);
  if (to === "meeting_booked") return from === "lead_interested" ? r(0.3, 0.6) : r(0.2, 0.5);
  if (to === "meeting_attended") return r(0.6, 0.85);
  if (to === "paid_client") return from === "meeting_attended" ? r(0.15, 0.35) : r(0.05, 0.15);
  return r(0.2, 0.6);
}

export interface DistributeWorldParams {
  seed?: number;
}

export function buildDistributeWorld(pub: PublicCatalogue, how: DistributeWorldParams = {}): WorldData {
  const isWriter = (c: PublicCatalogue["channels"][number]) => c.managed && c.channelType === "outbound";
  const asksLlm = (c: PublicCatalogue["channels"][number]) => c.managed && c.performedBy === "software" && (c.channelType === "outbound" || c.channelType === "conversion");
  const t = translateCatalogue(pub, { templateChannel: isWriter, llmChannel: asksLlm });
  const cat = t.catalogue;
  const scripts: Script[] = [];
  const truthScripts: Record<string, ScriptTruth> = {};
  const truthLegs: Record<string, LegTruth> = {};
  const fromOf = new Map<string, string | undefined>();
  for (const m of LLMS) {
    scripts.push({ id: m.id, legId: LLM_LEG, dynasty: m.id, version: 1, name: m.name, kind: "ai", materials: [], tactics: { tier: m.tier }, costCents: m.cost, status: "active", provider: m.provider });
    truthScripts[m.id] = { costCents: m.cost, end: m.end };
  }
  scripts.push({ id: "tpl_ai", legId: TEMPLATE_LEG, dynasty: "tpl_ai", version: 1, name: "AI template writer", kind: "ai", materials: [], tactics: {}, costCents: 50, status: "active" });
  scripts.push({ id: "tpl_copywriter", legId: TEMPLATE_LEG, dynasty: "tpl_copywriter", version: 1, name: "Copywriter", kind: "human", materials: [], tactics: {}, costCents: 3000, status: "active" });
  truthScripts.tpl_ai = { costCents: 50 };
  truthScripts.tpl_copywriter = { costCents: 3000 };
  scripts.push({ id: "icp_client_states", legId: ICP_CLIENT_LEG, dynasty: "icp_client_states", version: 1, name: "Client states it", kind: "human", materials: [], tactics: {}, costCents: 0, status: "active" });
  scripts.push({ id: "icp_ai", legId: ICP_FINDER_LEG, dynasty: "icp_ai", version: 1, name: "AI ICP finder", kind: "ai", materials: [], tactics: {}, costCents: 200, status: "active" });
  truthScripts.icp_client_states = { costCents: 0 };
  truthScripts.icp_ai = { costCents: 200 };
  scripts.push({ id: "rating_pooled", legId: RATING_LEG, dynasty: "rating_pooled", version: 1, name: "Pooled Thompson rating", kind: "rules", materials: [], tactics: { reads_evidence: true }, costCents: 1, status: "active" });
  truthScripts.rating_pooled = { costCents: 1 };

  // Scripts: each channel's own, on the leg it runs on, carrying the channel as a tactic and its own Bill of materials.
  for (const c of pub.channels) {
    for (const tr of c.transitions) {
      const ids = t.legsOf(c.slug, tr.legKey);
      const wait = t.waitOf(c.slug, tr.legKey);
      for (const legId of ids) {
        const leg = cat.legs.find((p) => p.id === legId);
        if (!leg) continue;
        const materials = t.billOf(c.slug, tr.legKey, legId);
        if (!fromOf.has(legId)) fromOf.set(legId, materials.map((m) => m.outcome).find((i) => cat.outcomes.find((o) => o.id === i)?.subject === "lead"));
        const channel = { [CHANNEL_TACTIC]: c.name, ...(wait ? { [WAIT_TACTIC]: wait } : {}) };
        const base = ids.length > 1 ? `${c.slug}|${tr.legKey}|${legId}` : `${c.slug}|${tr.legKey}`;
        if (leg.factory === CLIENT_TEAM) {
          scripts.push({ id: `${base}#team`, legId: leg.id, dynasty: `${base}#team`, version: 1, name: c.name, kind: "human", materials, tactics: channel, costCents: 0, status: "active" });
          truthScripts[`${base}#team`] = { costCents: 0, step: round(draw(0.7, 1.3, "step", base)) };
          continue;
        }
        const human = c.performedBy === "person";
        const sourcing = c.channelType === "sourcing";
        const variants = sourcing
          ? [
              { key: "fresh", name: "fresh data", tactics: { recontact_days: 30 } },
              { key: "standard", name: "standard", tactics: { recontact_days: 90 } },
            ]
          : human
            ? [{ key: "team", name: "our team", tactics: {} }]
            : [
                { key: "short", name: "short and direct", tactics: { personalized: false } },
                { key: "research", name: "researches first", tactics: { personalized: true } },
              ];
        for (const v of variants) {
          const id = `${base}#${v.key}`;
          const costCents = Math.round(draw(human ? 300 : sourcing ? 2 : 3, human ? 1500 : sourcing ? 12 : 40, "cost", id));
          scripts.push({ id, legId: leg.id, dynasty: id, version: 1, name: `${c.name}, ${v.name}`, kind: human ? "human" : sourcing ? "rules" : "ai", materials, tactics: { ...channel, ...v.tactics }, costCents, status: "active" });
          truthScripts[id] = { costCents, step: round(draw(0.6, 1.4, "step", id)), ...(sourcing ? { coverage: round(draw(0.3, 0.9, "coverage", id)) } : {}) };
        }
      }
    }
  }
  cat.scripts = scripts;
  for (const p of cat.legs) truthLegs[p.id] = { base: baseYield(fromOf.get(p.id), p.output, p.id), delayMeanDays: p.maturity.delayMeanDays, horizonDays: p.maturity.horizonDays };
  cat.tactics = [...cat.tactics, ...LEAD_TACTICS, ...SCRIPT_TACTICS, ...BRAND_TACTICS];
  // A strategy that keeps one channel: the client who wants cold email only says it in its campaign.
  const coldEmail: Condition[] = [{ op: "equals", tactic: CHANNEL_TACTIC, value: t.channelName("sales-cold-email-outreach")! }];

  const seeds = (brand: string, sellsTo: string): SeedUnit[] => [
    { outcome: ICP, scriptId: "icp_client_states", dynasty: "icp-client", version: 1, name: "The client's ICP", text: "Founders and heads of growing companies.", conditions: [{ op: "in", tactic: "seniority", values: ["founder", "head"] }] },
    { outcome: ICP, scriptId: "icp_ai", dynasty: "icp-revenue", version: 1, name: "Revenue of $5M or more", text: "Companies with a revenue of $5M or more.", conditions: [{ op: "range", tactic: "revenue", min: 5 }] },
    { outcome: TEMPLATE, scriptId: "tpl_ai", dynasty: "tpl-intro", version: 1, name: "Short intro", text: "Hi {{first_name}}, we help {{company}} {{benefit}}. Worth a quick call?", truthEnd: round(draw(0.4, 0.7, "tpl", brand, "intro")) },
    { outcome: TEMPLATE, scriptId: "tpl_copywriter", dynasty: "tpl-story", version: 1, name: "Client story", text: `Hi {{first_name}}, last month a ${sellsTo === "SMB" ? "small team" : "company"} like {{company}} {{client_story}}. Happy to show you how?`, truthEnd: 1 },
    { outcome: TEMPLATE, scriptId: "tpl_ai", dynasty: "tpl-question", version: 1, name: "Question first", text: "Hi {{first_name}}, how does {{company}} handle {{pain}} today?", truthEnd: round(draw(0.5, 0.9, "tpl", brand, "question")) },
  ];
  const client = (n: number, name: string, sellsTo: string, offer: Partial<WorldClient["offer"]>, campaigns: WorldClient["campaigns"]): WorldClient => ({
    org: { id: `org-${n}`, name },
    brand: { id: `brand-${n}`, orgId: `org-${n}`, name, tactics: { sells_to: sellsTo } },
    offer: { id: `offer-${n}`, brandId: `brand-${n}`, name: `${name} main offer`, outcomes: ["lead_interested", "meeting_booked", "meeting_attended", "paid_client", "lead_visited"], ...offer },
    campaigns,
    seeds: seeds(`brand-${n}`, sellsTo),
    connected: [],
    truthMultiplier: round(draw(0.85, 1.15, "client", String(n))),
    organicPerDay: 0,
  });
  const camp = (n: number, k: string, name: string, target: string, budget: number, extra: Partial<WorldClient["campaigns"][number]> = {}): WorldClient["campaigns"][number] => ({
    id: `campaign-${n}${k}`,
    brandId: `brand-${n}`,
    offerId: `offer-${n}`,
    name,
    start: START,
    target,
    dailyBudgetCents: budget,
    status: "running",
    strategies: {},
    ...extra,
  });
  const clients: WorldClient[] = [
    client(1, "Northwind Analytics", "Mid-market", { lifetimeRevenue: 900 }, [camp(1, "", "Paid clients from cold outreach", "paid_client", 3000)]),
    client(2, "Bluepeak Logistics", "Mid-market", { lifetimeRevenue: 400, outcomeValues: { lead_interested: 30 } }, [
      camp(2, "", "Paid clients from the website", "paid_client", 2500),
      camp(2, "f", "Follow-ups after each website visit", "lead_interested", 800, { start: t.outcomeOfStep("website_visit")! }),
    ]),
    client(3, "Lumen Dental Labs", "SMB", { lifetimeRevenue: 1500 }, [camp(3, "", "Replies closed by the team", "paid_client", 2000)]),
    client(4, "Copperleaf Studio", "SMB", { lifetimeRevenue: 1200, outcomeValues: { meeting_booked: 150 } }, [camp(4, "", "Meetings from cold email", "meeting_booked", 2000, { conditions: coldEmail })]),
  ];

  return {
    name: "distribute.you catalogue",
    description: "distribute.you's whole public catalogue (every channel, leg and step), four fictional clients, fictional numbers.",
    seed: how.seed ?? 7,
    catalogue: cat,
    clients,
    attributes: [
      { tactic: "country", level: "lead", values: ["United States", "United Kingdom", "France", "Germany"], weights: [3, 2, 3, 2] },
      { tactic: "seniority", level: "lead", values: ["founder", "head", "manager"], weights: [2, 3, 4] },
      { tactic: "revenue", level: "company", range: [0.5, 50] },
      { tactic: "headcount", level: "company", range: [5, 2000] },
      { tactic: "hiring", level: "company", values: [true, false], weights: [4, 6] },
    ],
    truth: {
      legs: truthLegs,
      scripts: truthScripts,
      at: {},
      segments: [
        { when: [{ op: "range", tactic: "revenue", min: 5 }], mult: 2.5 },
        { when: [{ op: "in", tactic: "country", values: ["United States", "United Kingdom"] }], mult: 2.5 },
        { when: [{ op: "in", tactic: "country", values: ["Germany"] }], mult: 0.4 },
      ],
      recontactMult: 0.4,
    },
    settings: {
      splitEveryDays: 7,
      splitMatureDays: 7,
      maxProposedIcps: 1,
      setupCentsPerBrand: 5000,
      minReliability: 0.8,
      marketSize: 80000,
      peoplePerCompany: 5,
      icpFinderScript: "icp_ai",
      clientGroupTactic: "sells_to",
      memoryHalfLifeDays: 14,
    },
    pins: [
      { kind: "outcome", id: TEMPLATE, label: "Templates", icon: "note-pencil" },
      { kind: "leg", id: LLM_LEG, label: "LLMs", icon: "sparkle" },
    ],
  };
}
