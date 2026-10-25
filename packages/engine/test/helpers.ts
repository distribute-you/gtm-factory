import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Catalogue, START, loadSeedCatalogue, type SeedFile, type Pipe, type PlayEstimator } from "../src";

export const SEED_PATH = fileURLToPath(new URL("../../../seed/distribute-catalogue.json", import.meta.url));

export function readSeed(): SeedFile {
  return JSON.parse(readFileSync(SEED_PATH, "utf8")) as SeedFile;
}

export function seedCatalogue(): Catalogue {
  return loadSeedCatalogue(readSeed()).catalogue;
}

const m = (delayMeanDays = 0, durationDays = 0) => ({ durationDays, outcomesRequired: 10, delayMeanDays });

/** A small hand-made catalogue: one lead track, a few pipes. */
export function smallCatalogue(): Catalogue {
  const pipes: Pipe[] = [
    { id: "email|start_to_interested", channel: "email", from: START, to: "interested", mode: "proactive", triggerId: null, maturity: m(3, 14) },
    { id: "ads|start_to_visited", channel: "ads", from: START, to: "visited", mode: "proactive", triggerId: null, maturity: m(1, 7) },
    { id: "booker|interested_to_booked", channel: "booker", from: "interested", to: "booked", mode: "reactive", triggerId: "on_interested", maturity: m() },
    { id: "site|visited_to_signup", channel: "site", from: "visited", to: "signup", mode: "reactive", triggerId: "on_visited", maturity: m() },
    { id: "team|signup_to_paid", channel: "team", from: "signup", to: "paid", mode: "reactive", triggerId: "on_signup", maturity: m() },
    { id: "team|booked_to_paid", channel: "team", from: "booked", to: "paid", mode: "reactive", triggerId: "on_booked", maturity: m() },
  ];
  return new Catalogue({
    leadTracks: [
      { id: "crm_lifecycle", name: "CRM lifecycle" },
      { id: "website_visits", name: "Website visits" },
    ],
    steps: [
      { key: "interested", label: "Lead interested", subjectKind: "lead", leadState: { state: "lead_interested", leadTrack: "crm_lifecycle", rank: 1 } },
      { key: "signup", label: "Signup", subjectKind: "lead", leadState: { state: "lead_interested", leadTrack: "crm_lifecycle", rank: 1 } },
      { key: "booked", label: "Meeting booked", subjectKind: "lead", leadState: { state: "meeting_booked", leadTrack: "crm_lifecycle", rank: 2 } },
      { key: "paid", label: "Paid client", subjectKind: "lead", leadState: { state: "paid_client", leadTrack: "crm_lifecycle", rank: 4 } },
      { key: "visited", label: "Lead visited", subjectKind: "lead", leadState: { state: "lead_visited", leadTrack: "website_visits", rank: 1 } },
    ],
    triggers: [
      { id: "on_interested", label: "Lead interested", kind: "outcome", outcomeStep: "interested", fromStep: null },
      { id: "on_visited", label: "Lead visited", kind: "outcome", outcomeStep: "visited", fromStep: null },
      { id: "on_signup", label: "Signed up", kind: "outcome", outcomeStep: "signup", fromStep: null },
      { id: "on_booked", label: "Meeting booked", kind: "outcome", outcomeStep: "booked", fromStep: null },
    ],
    channels: [
      { slug: "email", name: "Cold email", operatedBy: "platform", performedBy: "software" },
      { slug: "ads", name: "Ads", operatedBy: "platform", performedBy: "software" },
      { slug: "booker", name: "AI meeting booking", operatedBy: "platform", performedBy: "software" },
      { slug: "site", name: "Website", operatedBy: "customer", performedBy: "software" },
      { slug: "team", name: "Your team", operatedBy: "customer", performedBy: "person" },
    ],
    pipes,
  });
}

/** The worked example of docs/framework.md. */
export const WORKED: Record<string, { costPerTrial: number; yieldRate: number }> = {
  "email|start_to_interested": { costPerTrial: 1, yieldRate: 0.02 },
  "booker|interested_to_booked": { costPerTrial: 2, yieldRate: 0.4 },
  "team|booked_to_paid": { costPerTrial: 10, yieldRate: 0.2 },
  "ads|start_to_visited": { costPerTrial: 0.5, yieldRate: 0.05 },
  "site|visited_to_signup": { costPerTrial: 0, yieldRate: 0.1 },
  "team|signup_to_paid": { costPerTrial: 5, yieldRate: 0.3 },
};

export const workedEstimator: PlayEstimator = (_play, pipe) => {
  const e = WORKED[pipe.id];
  return e ? { ...e, label: "expected" } : null;
};


/** A small fictional world on the small catalogue, with planted truths. */
export function smallWorld(seed: number | string = 1): import("../src").WorldSpec {
  const c = smallCatalogue();
  const wf = (id: string, pipeId: string, cost: number, expectedYield: number, slots: string[] = []) =>
    c.add("workflows", { id, dynasty: id, pipeId, kind: slots.includes("llm") ? "ai" : "rules", slots, tactics: [], costPerTrialCents: cost, expectedYield, status: "active" });
  wf("email-plain", "email|start_to_interested", 50, 0.04, ["template", "llm"]);
  wf("email-personal", "email|start_to_interested", 50, 0.04, ["template", "llm"]);
  wf("email-researched", "email|start_to_interested", 60, 0.04, ["template", "llm"]);
  wf("booker-ai", "booker|interested_to_booked", 200, 0.4);
  wf("team-close", "team|booked_to_paid", 500, 0.25);
  wf("ads-search", "ads|start_to_visited", 40, 0.03);
  wf("site-default", "site|visited_to_signup", 10, 0.05);
  wf("team-onboard", "team|signup_to_paid", 300, 0.1);
  c.add("slotOptions", { id: "tpl-short", slot: "template", name: "Short", pipeId: "email|start_to_interested", tactics: [], costPerTrialCents: 0, status: "active" });
  c.add("slotOptions", { id: "tpl-story", slot: "template", name: "Story", pipeId: "email|start_to_interested", tactics: [], costPerTrialCents: 0, status: "active" });
  c.add("slotOptions", { id: "llm-fast", slot: "llm", name: "Fast model", pipeId: null, tactics: [], costPerTrialCents: 1, status: "active" });
  c.add("slotOptions", { id: "llm-deep", slot: "llm", name: "Deep model", pipeId: null, tactics: [], costPerTrialCents: 5, status: "active" });
  const client = (i: number, ltr: number): import("../src").SimClient => ({
    org: { id: `org-${i}`, name: `Fictional Co ${i}` },
    brand: { id: `brand-${i}`, orgId: `org-${i}`, name: `Fictional Co ${i}`, icp: "Operations leads at European companies" },
    offer: { id: `offer-${i}`, brandId: `brand-${i}`, name: "Main offer", steps: ["interested", "booked", "paid", "visited", "signup"], lifetimeRevenue: ltr },
    campaign: { id: `campaign-${i}`, offerId: `offer-${i}`, target: "paid", dailyBudgetCents: 10000, status: "running" as const },
    expertAudiences: [
      { name: "European companies", description: "Any company in France, Germany or Spain.", rule: { country: ["France", "Germany", "Spain"] } },
      { name: "Large companies", description: "Companies with over 200 people.", rule: { size: ["large"] } },
    ],
  });
  return {
    seed,
    catalogue: c,
    clients: [client(1, 3000), client(2, 5000)],
    attributes: [
      { name: "country", values: ["France", "Germany", "Spain"] },
      { name: "size", values: ["small", "large"] },
    ],
    truth: {
      pipes: [
        { pipeId: "email|start_to_interested", baseYield: 0.04, delayMeanDays: 3, maxDelayDays: 14 },
        { pipeId: "booker|interested_to_booked", baseYield: 0.4, delayMeanDays: 0, maxDelayDays: 0 },
        { pipeId: "team|booked_to_paid", baseYield: 0.25, delayMeanDays: 0, maxDelayDays: 0 },
        { pipeId: "ads|start_to_visited", baseYield: 0.02, delayMeanDays: 1, maxDelayDays: 7 },
        { pipeId: "site|visited_to_signup", baseYield: 0.05, delayMeanDays: 0, maxDelayDays: 0 },
        { pipeId: "team|signup_to_paid", baseYield: 0.1, delayMeanDays: 0, maxDelayDays: 0 },
      ],
      workflows: { "email-plain": 0.6, "email-personal": 1.0, "email-researched": 1.8 },
      slotOptions: { "tpl-short": 1.0, "tpl-story": 1.15, "llm-fast": 0.9, "llm-deep": 1.2 },
      segments: [
        { attribute: "country", value: "France", multiplier: 1.5 },
        { attribute: "country", value: "Germany", multiplier: 0.5 },
        { attribute: "size", value: "large", multiplier: 1.4 },
        { attribute: "size", value: "small", multiplier: 0.8 },
      ],
      clients: { "brand-1": 1.0, "brand-2": 1.1 },
    },
    reporters: [
      { reporter: { id: "crm", name: "Client CRM" }, outcomes: ["lead_interested", "meeting_booked", "paid_client"], recall: 1, spuriousRate: 0 },
      { reporter: { id: "tracker", name: "Website tracker" }, outcomes: ["meeting_booked"], recall: 0.5, spuriousRate: 0.01 },
    ],
    evidencePolicy: { referenceReporter: { lead_interested: "crm", meeting_booked: "crm", paid_client: "crm" }, minReliability: 0.8 },
    settings: { funnelCandidates: 2, funnelEveryDays: 7, discoverEveryDays: 15, setupCentsPerClient: 5000 },
  };
}
