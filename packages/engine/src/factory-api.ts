/**
 * The factory API: the contract between a RUNNING factory (a backend that runs
 * scripts for real, on real brands) and the dashboard's "api" data source.
 * Types only: this repository ships no backend. A factory serves these reads
 * and writes as JSON under one base URL (the dashboard reads
 * NEXT_PUBLIC_FACTORY_API_URL, default "/api").
 *
 * Every figure is computed by the factory: the dashboard divides nothing.
 * Money is integer cents. Times are ISO strings. Ids are opaque strings.
 *
 *   GET  /overview                      -> ApiOverview
 *   GET  /catalogue                     -> CatalogueData
 *   GET  /brands                        -> ApiBrand[]
 *   POST /brands          ApiNewBrand   -> ApiBrand
 *   GET  /brands/:id/funnels            -> ApiRankedFunnel[]
 *   GET  /campaigns                     -> ApiCampaign[]
 *   POST /campaigns       ApiNewCampaign-> ApiCampaign (always created paused)
 *   GET  /campaigns/:id                 -> ApiCampaignDetail
 *   POST /campaigns/:id/launch          -> ApiCampaign
 *   POST /campaigns/:id/pause           -> ApiCampaign
 *   PATCH /campaigns/:id  { dailyBudgetCents } -> ApiCampaign
 *   GET  /leads?campaignId=&brandId=&state= -> ApiLead[]
 *   GET  /leads/:id                     -> ApiLeadDetail
 *   POST /leads/:id/outcomes { outcome } -> ApiLeadDetail (an outcome reported by another factory)
 *   GET  /objects?outcome=              -> ApiObjectDynasty[]
 *   POST /objects         ApiNewObjectVersion -> ApiObjectDynasty (upgrade, fork or new dynasty)
 *   GET  /scripts?pipeId=               -> ApiScriptStats[]
 *   POST /scripts/:id/retire | /restore -> ApiScriptStats
 *   GET  /research                      -> ApiChoicePoint[]
 *   GET  /choices?campaignId=&leadId=   -> ApiChoice[]
 *   GET  /ledger                        -> ApiLedger
 *
 * A write that fails answers 4xx/5xx with { error: string } in plain words.
 */

import type { CatalogueData, OutcomeId } from "./catalogue";
import type { LedgerReport } from "./ledger";
import type { Pin } from "./world";

export interface ApiBrand {
  id: string;
  name: string;
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
   * The factory that runs this client's campaigns (a catalogue factory id). Absent: this
   * factory. Another factory's client is read here (its Units, runs and choices come in
   * through a connector) and gets no campaign from this dashboard.
   */
  factory?: string;
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

export interface ApiFunnelLeg {
  from: OutcomeId;
  to: OutcomeId;
  pipeId: string;
  /** Every pipe the leg runs through, in the order they run. */
  pipes: string[];
  costPerAttemptCents: number;
  yieldRate: number;
  leadsNeeded: number;
  costPerTargetCents: number;
  label: "expected" | "measured";
}

export interface ApiRankedFunnel {
  id: string;
  name: string;
  pathName: string;
  line: OutcomeId[];
  legs: ApiFunnelLeg[];
  costPerTargetCents: number;
  valuePerDollar: number;
  label: "expected" | "measured";
}

/**
 * A new Campaign orders production: its funnel names its start outcome (Start:
 * proactive, it pulls; any other outcome: reactive, it pushes each landed Unit)
 * and its target; it carries a daily budget and an optional volume per period.
 */
export interface ApiNewCampaign {
  brandId: string;
  funnelId: string;
  /** At most this many new subjects per period. */
  volume?: { units: number; periodDays: number } | null;
  /** Hard daily cap: no run starts once today's spend would pass it. */
  dailyBudgetCents: number;
  /** Strategy id per pipe; a pipe left out plays its default strategy. */
  strategies?: Record<string, string>;
}

export type ApiCampaignStatus = "paused" | "live";

/** Count of Units reached, per outcome. */
export type ApiOutcomeCounts = Record<OutcomeId, number>;

export interface ApiCampaign {
  id: string;
  brandId: string;
  name: string;
  funnelId: string;
  funnelName: string;
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
  strategies: Record<string, string>;
  counts: ApiOutcomeCounts;
  createdAt: string;
  launchedAt: string | null;
  /** This factory's last tick on it; for another factory's campaign, the last read of it. */
  lastTickAt: string | null;
  /**
   * The factory that runs it (a catalogue factory id). Absent: this factory. A campaign
   * another factory runs is shown here as that factory reports it: this factory never
   * ticks it, and it is never launched, paused or capped from this dashboard.
   */
  factory?: string;
}

export interface ApiOption {
  id: string;
  label: string;
  /** Mean of the belief about the share of decisions reaching the leg's end. */
  rateMean: number;
  /** Mean of the belief about the dollars from the decision to the leg's end, cents. */
  costMeanCents: number;
  /** Value per dollar at the means. */
  meanScore: number;
  /** Decisions made and reached so far. */
  picks: number;
  successes: number;
  spentCents: number;
}

export interface ApiChoicePoint {
  /** `pipeId|material` (the consuming pipe and the Material), or `pipeId` for the pipe's own script. */
  id: string;
  pipeId: string;
  material: OutcomeId | null;
  label: string;
  options: ApiOption[];
}

export interface ApiChoice {
  id: string;
  at: string;
  campaignId: string;
  brandId: string;
  leadId: string | null;
  point: string;
  pointLabel: string;
  chosen: string;
  chosenLabel: string;
  /** Each option as scored at the moment of the choice (one Thompson draw). */
  options: { id: string; label: string; meanScore: number; sampledScore: number }[];
  /** Why, in plain words. */
  reason: string;
  /** Reached the end of its leg (credited through traceability). */
  credited: boolean;
}

export interface ApiRun {
  id: string;
  at: string;
  campaignId: string | null;
  brandId: string | null;
  pipeId: string;
  scriptId: string;
  scriptName: string;
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
  recentChoices: ApiChoice[];
  recentRuns: ApiRun[];
  /** The scheduler: last tick and whether it is running. */
  scheduler: { lastTickAt: string | null; tickEverySeconds: number; running: boolean };
  /**
   * Sidebar pins, as data: an outcome pin lists its brand dynasties (GET /objects?outcome=),
   * a pipe pin its scripts (GET /scripts?pipeId=). The factory ships its own (Templates, LLMs).
   */
  pins?: Pin[];
}

export interface ApiCampaignDetail {
  campaign: ApiCampaign;
  brand: ApiBrand;
  funnel: ApiRankedFunnel | null;
  /** Spend per UTC day, oldest first. */
  spendByDay: { day: string; cents: number }[];
  points: ApiChoicePoint[];
  recentChoices: ApiChoice[];
  recentRuns: ApiRun[];
}

/** One Unit of the ledger's stock: one piece of an outcome about one subject. */
export interface ApiUnit {
  id: string;
  outcome: OutcomeId;
  at: string;
  runId: string | null;
  /** Who produced it: a factory id (ours, or another factory such as the client's team). */
  factory: string;
  /** Choices on its traceability, its own included. */
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
  /** The furthest outcome reached, by the order of the campaign's line. */
  state: OutcomeId;
  reached: OutcomeId[];
  updatedAt: string;
}

export interface ApiLeadDetail {
  lead: ApiLead;
  units: ApiUnit[];
  runs: ApiRun[];
  choices: ApiChoice[];
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
  /** Per choice point it is offered at. */
  stats: { point: string; pointLabel: string; picks: number; successes: number; rateMean: number }[];
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

export interface ApiScriptStats {
  id: string;
  dynasty: string;
  version: number;
  pipeId: string;
  name: string;
  kind: "rules" | "ai" | "human";
  status: "active" | "retired";
  provider: string | null;
  tactics: Record<string, string | number | boolean>;
  costCentsPrior: number;
  runs: number;
  spentCents: number;
  outputs: number;
  points: { point: string; pointLabel: string; picks: number; successes: number; rateMean: number; costMeanCents: number }[];
}

export interface ApiLedger {
  totalCents: number;
  byDay: { day: string; cents: number }[];
  byPipe: { pipeId: string; runs: number; spentCents: number; outputs: number }[];
  byScript: { scriptId: string; name: string; runs: number; spentCents: number }[];
  byVendor: { vendor: string; item: string; quantity: number; cents: number }[];
  byCampaign: { campaignId: string; name: string; spentCents: number }[];
  /** The every-path report, reconciled to the cent. */
  report: LedgerReport;
  runs: ApiRun[];
}
