/**
 * The API of a running GTM Factory: the contract between a backend that runs
 * scripts for real, on real brands, and the dashboard's "api" data source.
 * Types only: this repository ships no backend. A backend serves these reads
 * and writes as JSON under one base URL (the dashboard reads
 * NEXT_PUBLIC_FACTORY_API_URL, default "/api").
 *
 * Every figure is computed by the running GTM Factory: the dashboard divides nothing.
 * Money is integer cents. Times are ISO strings. Ids are opaque strings.
 *
 *   GET  /overview                      -> ApiOverview
 *   GET  /catalogue                     -> CatalogueData
 *   GET  /brands                        -> ApiBrand[]
 *   POST /brands          ApiNewBrand   -> ApiBrand
 *   GET  /brands/:id/plans              -> ApiPlanPreview[]
 *   GET  /campaigns                     -> ApiCampaign[]
 *   POST /campaigns       ApiNewCampaign-> ApiCampaign (always created paused)
 *   GET  /campaigns/:id                 -> ApiCampaignDetail
 *   POST /campaigns/:id/launch          -> ApiCampaign
 *   POST /campaigns/:id/pause           -> ApiCampaign
 *   PATCH /campaigns/:id  { dailyBudgetCents } -> ApiCampaign
 *   GET  /leads?campaignId=&brandId=&state= -> ApiLead[]
 *   GET  /leads/:id                     -> ApiLeadDetail
 *   POST /leads/:id/outcomes { outcome } -> ApiLeadDetail (an outcome reported by another party)
 *   GET  /objects?outcome=              -> ApiObjectDynasty[]
 *   POST /objects         ApiNewObjectVersion -> ApiObjectDynasty (upgrade, fork or new dynasty)
 *   GET  /scripts?outcome=              -> ApiScriptStats[]
 *   POST /scripts/:id/retire | /restore -> ApiScriptStats
 *   POST /scripts/:id/capacity ApiCapacity -> ApiScriptStats (a person types it for a Client's team script)
 *   GET  /research                      -> ApiCandidates[]
 *   GET  /picks?campaignId=&leadId=     -> ApiPick[]
 *   GET  /tasks?brandId=&status=        -> ApiTask[] (work the Plan ordered from the client's team)
 *   POST /tasks/:id/answer ApiTaskAnswer -> ApiTask (the answer becomes the Unit's content)
 *   GET  /ledger                        -> ApiLedger
 *
 * A write that fails answers 4xx/5xx with { error: string } in plain words.
 */

import type { CatalogueData, OutcomeId } from "./catalogue";
import type { LedgerReport } from "./ledger";
import type { Pin } from "./world";

/** An offer of a brand: what the brand sells, in the client's words. */
export interface ApiOffer {
  id: string;
  name: string;
}

export interface ApiBrand {
  id: string;
  name: string;
  /** The organization (the client account) the brand belongs to. */
  orgId: string;
  orgName: string;
  /** Its offers; a campaign sells one of them. */
  offers: ApiOffer[];
  website: string;
  /** The offer, in the client's words. */
  offer: string;
  /** Who the brand sells to, one plain sentence (the ICP). */
  icp: string;
  /** Lifetime revenue of one paid client, cents; null when the client gave none. */
  lifetimeValueCents: number | null;
  /** A staff test brand: every send goes to staff addresses only. */
  test: boolean;
  /** Leads the client provided (a list), when any. */
  providedLeads: number;
  createdAt: string;
  /**
   * Who performs this client's campaigns (the "Performed by" tactic). Absent: Ours. A client
   * another party runs is read here (its Units, runs and picks come in through a
   * connector) and gets no campaign from this dashboard.
   */
  performedBy?: string;
  /** Spent on this client, every campaign together, cents. */
  spentTotalCents?: number;
  /** Units reached by this client's leads, per outcome (every campaign together). */
  counts?: ApiOutcomeCounts;
}

export interface ApiNewBrand {
  name: string;
  website: string;
  offer: string;
  icp: string;
  lifetimeValueCents?: number | null;
  test?: boolean;
  /** Leads the client provides, consumed by a sourcing script reading lists. */
  leads?: { email?: string; firstName?: string; lastName?: string; company?: string; title?: string; domain?: string }[];
}

/** One milestone of a Routing: from one milestone (or Start) to the next, every Engine it runs through. */
export interface ApiMilestone {
  from: OutcomeId;
  to: OutcomeId;
  /** Every Engine the subject goes through to get there, in the order they run. */
  engines: OutcomeId[];
  costPerAttemptCents: number;
  yieldRate: number;
  /** Attempts made here per Unit of the Target. */
  attemptsPerTarget: number;
  /** Cost of this outcome alone: its own cost per attempt over its yield. */
  costOfOutcomeCents: number;
  /** Cost from Start: what one Unit of this milestone costs, every milestone before it included (the one the return reads). */
  costFromStartCents: number;
  costPerTargetCents: number;
  label: "expected" | "measured";
}

/** A Routing (a view with a short name): the ordered milestones a Plan passes through. */
export interface ApiRouting {
  id: string;
  name: string;
  line: OutcomeId[];
}

/** What a new campaign toward a Target would run today (a view, ranked by value per dollar). */
export interface ApiPlanPreview {
  target: OutcomeId;
  routing: ApiRouting;
  milestones: ApiMilestone[];
  costPerTargetCents: number;
  valuePerDollar: number;
  label: "expected" | "measured";
}

/** A branch of an outcome of the Plan: the share of its Units one script made over the last 7 days, and its cost per Unit. */
export interface ApiPlanBranch {
  scriptId: string;
  units: number;
  share: number;
  costPerUnitCents: number | null;
}

/**
 * A node of a campaign's Plan: an outcome, the script its Engine runs now
 * (the Rating's best among the scripts the brief keeps), the Plan of each
 * outcome that script calls, and the branches actually used.
 */
export interface ApiPlanNode {
  outcome: OutcomeId;
  /** The script its Engine runs now; null at a leaf served by its Provider (the start, a brand Unit, the Rating). */
  scriptId: string | null;
  /** Scripts (or brand dynasties at a leaf) that compete there. */
  candidates: number;
  branches: ApiPlanBranch[];
  materials: ApiPlanNode[];
}

/**
 * A new Campaign orders production. It fixes only its Target, its start
 * (Start: proactive, it pulls; any other outcome: reactive, it pushes each
 * landed Unit up), its budget and its strategy, a brief in plain words. A
 * judge reads the brief once per Engine; the Plan is recomputed at every tick.
 */
export interface ApiNewCampaign {
  brandId: string;
  offerId: string;
  /** "start" (the market) or the outcome whose Units it pushes. */
  start: OutcomeId;
  /** The outcome it orders. */
  target: OutcomeId;
  /** At most this many new subjects per period. */
  volume?: { units: number; periodDays: number } | null;
  /** Hard daily cap: no run starts once today's spend would pass it. */
  dailyBudgetCents: number;
  /** Its strategy, in the client's words ("cold email and LinkedIn, at most 30 a day in email, a 30-day test"). */
  brief?: string;
}

export type ApiCampaignStatus = "paused" | "live";

/** Count of Units reached, per outcome. */
export type ApiOutcomeCounts = Record<OutcomeId, number>;

export interface ApiCampaign {
  id: string;
  brandId: string;
  /** The offer it sells. */
  offerId: string;
  name: string;
  /** The Routing its Plan runs (a view with a short name, never a control), null before its first tick. */
  routing: ApiRouting | null;
  /** START (the market: the campaign pulls), or the outcome whose Units it pushes. */
  start: OutcomeId;
  /** The outcome it orders. */
  target: OutcomeId;
  status: ApiCampaignStatus;
  dailyBudgetCents: number;
  volume: { units: number; periodDays: number } | null;
  spentTodayCents: number;
  spentTotalCents: number;
  /** Today's spend reached the cap: nothing more runs until tomorrow (UTC). */
  capReached: boolean;
  /** Its strategy, in the client's words. */
  brief: string;
  /** What the judge read in the brief, per Engine: the strategy kept, or "none" (the Plan routes around it). */
  verdicts: Record<OutcomeId, string>;
  /** Most Units per day the brief allows at an Engine. */
  caps: Record<OutcomeId, number>;
  /** The day a test of a stated length ends, when the brief gave one. */
  endsAt: string | null;
  counts: ApiOutcomeCounts;
  createdAt: string;
  launchedAt: string | null;
  /** Our last tick on it; for a campaign another party runs, the last read of it. */
  lastTickAt: string | null;
  /**
   * Who performs it (the "Performed by" tactic). Absent: Ours. A campaign another party
   * runs is shown here as that party reports it: it is never ticked, launched, paused or
   * capped from this dashboard.
   */
  performedBy?: string;
}

export interface ApiCandidate {
  id: string;
  label: string;
  /** Mean of the belief about the share of decisions reaching the next milestone. */
  rateMean: number;
  /** Mean of the belief about the dollars from the decision to the next milestone, cents. */
  costMeanCents: number;
  /** Value per dollar at the means. */
  meanScore: number;
  /** Decisions made and reached so far. */
  picks: number;
  successes: number;
  spentCents: number;
}

/**
 * What competes where an Engine calls an outcome: the scripts of that outcome's Engine
 * ("Meeting booked · 3 scripts"), or the brand's Units of it ("Template · 3 Units").
 */
export interface ApiCandidates {
  /** `consumer|material`: the calling Engine (or "campaign" for the Target) and the outcome it calls. */
  id: string;
  /** The calling Engine's outcome, or "campaign". */
  consumer: string;
  material: OutcomeId;
  label: string;
  /** Scripts of the material's Engine, or the brand's Units (a template, an ICP). */
  kind: "script" | "unit";
  candidates: ApiCandidate[];
}

/** One pick: the candidate the Rating's draw took, for one subject, at one place. */
export interface ApiPick {
  id: string;
  at: string;
  campaignId: string;
  brandId: string;
  leadId: string | null;
  /** The ApiCandidates id it was made at, and its title. */
  place: string;
  placeLabel: string;
  picked: string;
  pickedLabel: string;
  /** Each candidate as scored at the moment of the pick (one Thompson draw). */
  candidates: { id: string; label: string; meanScore: number; sampledScore: number }[];
  /** Why, in plain words. */
  reason: string;
  /** Reached the next milestone (credited through traceability). */
  credited: boolean;
}

export interface ApiRun {
  id: string;
  at: string;
  campaignId: string | null;
  brandId: string | null;
  /** The Engine: the outcome the script makes. */
  engine: OutcomeId;
  scriptId: string;
  scriptName: string;
  /** Who performed it (the "Performed by" tactic). */
  performedBy: string;
  leadId: string | null;
  status: "ok" | "no_outcome" | "failed" | "refused";
  /** What happened, in plain words (the refusal or error included). */
  note: string;
  spendCents: number;
  produced: { id: string; outcome: OutcomeId }[];
  consumed: string[];
  /** Metered vendor lines of this run. */
  costs: { vendor: string; item: string; quantity: number; cents: number }[];
}

export interface ApiOverview {
  now: string;
  catalogue: CatalogueData;
  brands: ApiBrand[];
  campaigns: ApiCampaign[];
  totals: { spentTodayCents: number; spentTotalCents: number; counts: ApiOutcomeCounts };
  recentPicks: ApiPick[];
  recentRuns: ApiRun[];
  /** The scheduler: last tick and whether it is running. */
  scheduler: { lastTickAt: string | null; tickEverySeconds: number; running: boolean };
  /**
   * Sidebar pins, as data: an outcome pin lists its brand dynasties (GET /objects?outcome=)
   * or its Engine's scripts (GET /scripts?outcome=). The backend ships its own (Templates, LLMs).
   */
  pins?: Pin[];
}

export interface ApiCampaignDetail {
  campaign: ApiCampaign;
  brand: ApiBrand;
  /** The milestones of the Routing its Plan runs today. */
  milestones: ApiMilestone[];
  /** Its Plan this tick, with the branches actually used over the last 7 days. */
  plan: ApiPlanNode | null;
  /** Spend per UTC day, oldest first. */
  spendByDay: { day: string; cents: number }[];
  /** What competes at each Engine this campaign calls. */
  candidates: ApiCandidates[];
  recentPicks: ApiPick[];
  recentRuns: ApiRun[];
}

/** One Unit of the ledger's stock: one piece of an outcome about one subject. */
export interface ApiUnit {
  id: string;
  outcome: OutcomeId;
  at: string;
  runId: string | null;
  /** Who performed the script that made it (the "Performed by" tactic). */
  performedBy: string;
  /** Picks on its traceability, its own included. */
  traceability: string[];
  /** What it holds (a written message, a reply, a verdict), shown as is. */
  content: Record<string, unknown> | null;
}

export interface ApiLead {
  id: string;
  brandId: string;
  campaignId: string | null;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  /** The furthest milestone reached. */
  state: OutcomeId;
  reached: OutcomeId[];
  updatedAt: string;
}

export interface ApiLeadDetail {
  lead: ApiLead;
  units: ApiUnit[];
  runs: ApiRun[];
  picks: ApiPick[];
}

export interface ApiObjectVersion {
  id: string;
  version: number;
  name: string;
  content: string;
  createdAt: string;
  /** Head of its dynasty: what a Material choosing this dynasty consumes now. */
  head: boolean;
}

export interface ApiObjectDynasty {
  dynasty: string;
  outcome: OutcomeId;
  parentDynasty: string | null;
  brandId: string | null;
  versions: ApiObjectVersion[];
  /** Per place it competes at. */
  stats: { place: string; placeLabel: string; picks: number; successes: number; rateMean: number }[];
  retired: boolean;
}

export interface ApiNewObjectVersion {
  outcome: OutcomeId;
  name: string;
  content: string;
  /** Upgrade: a new version of this dynasty. */
  dynasty?: string;
  /** Fork: a new dynasty starting from this one's belief. */
  parentDynasty?: string;
  brandId?: string | null;
}

/** Capacity of a script: Units per day at most, and days one Unit takes. */
export interface ApiCapacity {
  perDay: number | null;
  daysPerUnit: number | null;
}

export interface ApiScriptStats {
  id: string;
  dynasty: string;
  version: number;
  /** Its Engine: the outcome it makes. */
  outcome: OutcomeId;
  name: string;
  kind: "rules" | "ai" | "human";
  status: "active" | "retired";
  provider: string | null;
  /** Who performs it (the "Performed by" tactic). */
  performedBy: string;
  tactics: Record<string, string | number | boolean>;
  /** Its code: the file of scripts/ it runs. */
  code: string;
  /** The outcomes it calls: read from its code by a judge, then what the ledger measured each run consumed. */
  materials: OutcomeId[];
  materialsLabel: "judged" | "measured";
  /** Measured for code and AI scripts; typed by a person for a Client's team script. */
  capacity: ApiCapacity;
  costCentsPrior: number;
  runs: number;
  runsToday: number;
  spentCents: number;
  outputs: number;
  places: { place: string; placeLabel: string; picks: number; successes: number; rateMean: number; costMeanCents: number }[];
}

export interface ApiLedger {
  totalCents: number;
  byDay: { day: string; cents: number }[];
  byEngine: { engine: OutcomeId; runs: number; spentCents: number; outputs: number }[];
  byScript: { scriptId: string; name: string; runs: number; spentCents: number }[];
  byVendor: { vendor: string; item: string; quantity: number; cents: number }[];
  byCampaign: { campaignId: string; name: string; spentCents: number }[];
  /** The report of every run, reconciled to the cent. */
  report: LedgerReport;
  runs: ApiRun[];
}

/** One field of a task's answer form, declared by the script a person performs. */
export interface ApiTaskField {
  key: string;
  label: string;
  type: "yesno" | "number" | "money" | "text";
}

/**
 * Work the Plan ordered from the client's team: a run of a script a person performs
 * (a closing call with one person). The backend notifies the person by email; the
 * answer becomes the content of the Unit, which credits the picks that brought the subject.
 */
export interface ApiTask {
  id: string;
  campaignId: string;
  brandId: string;
  scriptId: string;
  scriptName: string;
  /** The outcome the script makes (its Engine). */
  outcome: OutcomeId;
  /** Who it is about. */
  leadId: string | null;
  subjectName: string | null;
  /** What is asked, one plain sentence ("Call Marie Dubois, Northwind, and say if she pays"). */
  asked: string;
  fields: ApiTaskField[];
  status: "open" | "answered";
  createdAt: string;
  answeredAt: string | null;
  answer: Record<string, string | number | boolean> | null;
}

export interface ApiTaskAnswer {
  values: Record<string, string | number | boolean>;
}
