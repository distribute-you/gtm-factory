/**
 * A simulated world: the clients, their market (fictional people and
 * companies), the catalogue they run on, and the HIDDEN truth the engine must
 * learn (yields, costs, delays, the effect of every script, Unit and lead
 * tactic). Every number of a scenario is data here, never in the engine or the
 * dashboard.
 */

import type { Catalogue, OutcomeId } from "./catalogue";
import type { ScriptLibrary } from "./script";
import { hashString } from "./rng";
import type { Condition, TacticValue } from "./tactics";
import { meetsAll } from "./tactics";

export interface Org {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  orgId: string;
  name: string;
  /** Brand tactic values: clients sharing them share a pooling level. */
  tactics: Record<string, TacticValue>;
}

export interface Offer {
  id: string;
  brandId: string;
  name: string;
  /** The outcomes this business has (a business with no website never walks a visit). */
  outcomes: OutcomeId[];
  /** Lifetime revenue of a paid client, dollars, when the client stated it. */
  lifetimeRevenue?: number;
  /** Value of other target outcomes, dollars, when stated. */
  outcomeValues?: Record<OutcomeId, number>;
}

/**
 * The Campaign orders production. It fixes only its Target, its start, its
 * budget (a daily budget and an optional volume per period) and its strategy,
 * a brief in plain words; its Plan is recomputed at every tick. Started from
 * Start (the market) it is proactive: at each tick it pulls on its Target.
 * Started from any other outcome it is reactive: each Unit of that outcome
 * landing for its brand is pushed up toward the Target.
 */
export interface Campaign {
  id: string;
  brandId: string;
  offerId: string;
  name: string;
  /** START (the market: proactive), or the outcome whose Units it pushes (reactive). */
  start: OutcomeId;
  /** The outcome it orders. */
  target: OutcomeId;
  dailyBudgetCents: number;
  /** At most this many new subjects per period. */
  volume?: { units: number; periodDays: number };
  status: "running" | "paused";
  /** Its strategy, in the client's words ("cold email and LinkedIn, at most 30 a day in email"). */
  brief: string;
  /**
   * What a judge read in the brief, per Engine: the strategy it keeps (a
   * strategy id), or "none" (the Plan routes around that Engine). Judged once,
   * stored; an Engine left out keeps every script.
   */
  verdicts?: Record<OutcomeId, string>;
  /** Most Units per day the brief allows at an Engine, for this campaign. */
  caps?: Record<OutcomeId, number>;
  /** The day it stops (a test of a stated length). */
  endDay?: number;
}

/** An account the brand connected (a mailbox, a WhatsApp number, a LinkedIn profile), with the role it gave it. */
export interface ConnectedAccount {
  id: string;
  channel: string;
  address: string;
  role: string;
  status: "connected" | "to_reconnect";
}

/** A Unit in the stock before the campaign runs: the client's ICP, a template. */
export interface SeedUnit {
  outcome: OutcomeId;
  /** The script producing it (its Engine follows). */
  scriptId: string;
  /** Brand Units have dynasties too: a template is a version of its template dynasty. */
  dynasty: string;
  version: number;
  /** A fork starts from its parent dynasty's posterior. */
  parentDynasty?: string;
  name: string;
  /** The text itself (an ICP sentence, a template's opening). */
  text: string;
  /** For an ICP: who it describes, as conditions on lead tactics (what a judge would read from the sentence). */
  conditions?: Condition[];
  /** Hidden: how much this Unit changes the next lead state its consumer leads to. */
  truthEnd?: number;
}

export interface WorldClient {
  org: Org;
  brand: Brand;
  offer: Offer;
  campaigns: Campaign[];
  seeds: SeedUnit[];
  /** Accounts the brand connected: each lands as a Unit of the account outcome. */
  accounts?: ConnectedAccount[];
  /** Scripts another party performs that this client connected (its CRM import, its mailbox reports). */
  connected: string[];
  /** Hidden: how much this client's market answers, all else equal. */
  truthMultiplier: number;
  /** Organic leads reaching the brand per day (another party). */
  organicPerDay: number;
}

/** A lead or company tactic of the market, and how values are drawn. */
export interface MarketAttribute {
  tactic: string;
  level: "lead" | "company";
  /** For a list or yes/no tactic. */
  values?: TacticValue[];
  weights?: number[];
  /** For a number tactic: log-uniform between these bounds, rounded to one decimal. */
  range?: [number, number];
}

/** Hidden effect of one script (or one script at one Material). */
export interface ScriptTruth {
  /** True cost of one run on one subject, cents (each run varies around it). */
  costCents: number;
  /** Its own yield (the fact rate before every multiplier), 1 when unset. */
  base?: number;
  /** Mean days a run takes to land, and the longest. */
  delayMeanDays?: number;
  horizonDays?: number;
  /** Multiplies its own yield. */
  ownYield?: number;
  /** Multiplies the fact at the next milestone its decision serves. */
  end?: number;
  /** For an attesting script: share of true facts it attests, and of non-facts it attests anyway. */
  recall?: number;
  falsePositive?: number;
  /** For a script creating subjects: the share of the market its source covers. */
  coverage?: number;
  /** For a script whose subject may come from a false attestation: its yield multiplier then. */
  onFalseInput?: number;
  /**
   * For a script another party performs on its own (a webhook): `creates`, it
   * brings new subjects (the organic market, at the client's organic rate);
   * `attests`, it reports the true facts of its outcome it sees (a CRM import,
   * at its recall); `on`, it reports on each Unit of that outcome landing (a
   * mailbox reporting a message sent), at its base rate and delay.
   */
  webhook?: { creates?: boolean; attests?: boolean; on?: OutcomeId; perDay?: number };
}

export interface WorldTruth {
  scripts: Record<string, ScriptTruth>;
  /** Per Material (point key "consumer|material"), the effects that differ there. */
  at: Record<string, Record<string, Partial<ScriptTruth>>>;
  /** Lead tactics that change the fact of the first milestone from Start. */
  segments: { when: Condition[]; mult: number }[];
  /** Fact multiplier for a person picked again after an earlier pick. */
  recontactMult: number;
  /** What a judge reads in each campaign's brief: per Engine, the strategy kept or "none", and daily caps. */
  briefs?: Record<string, { verdicts?: Record<OutcomeId, string>; caps?: Record<OutcomeId, number>; days?: number }>;
}

export interface WorldSettings {
  /** Days between two split studies. */
  splitEveryDays: number;
  /** Mature age (days) of a decision before a split study reads it. */
  splitMatureDays: number;
  /** Most finer ICPs the AI proposes per brand. */
  maxProposedIcps: number;
  /** One-off setup spend per brand (support), cents. */
  setupCentsPerBrand: number;
  /** Reliability a producer needs for its coverage to count a client in. */
  minReliability: number;
  /** People per brand market. */
  marketSize: number;
  /** People per company in the market. */
  peoplePerCompany: number;
  /** The script that writes finer ICPs from splits (an AI ICP finder). */
  icpFinderScript: string;
  /** Tactic that groups clients for pooling. */
  clientGroupTactic: string;
  /** Half-life of evidence, days: older decisions weigh less (0 = never fade). */
  memoryHalfLifeDays?: number;
  /** Ticks per day (default 1): at each tick every campaign recomputes its Plan, pulls or pushes, and a Unit advances one Engine. */
  ticksPerDay?: number;
}

export interface WorldSpec {
  seed: number | string;
  catalogue: Catalogue;
  /** The code of every script, by its `code` key. */
  library: ScriptLibrary;
  clients: WorldClient[];
  attributes: MarketAttribute[];
  truth: WorldTruth;
  settings: WorldSettings;
}

// ---------------------------------------------------------------------------
// The market: fictional people and companies, drawn from the seed
// ---------------------------------------------------------------------------

function unit(...parts: (string | number)[]): number {
  return hashString(parts.join("\u0000")) / 4294967296;
}

function drawValue(a: MarketAttribute, u: number): TacticValue {
  if (a.range) {
    const [lo, hi] = a.range;
    return Math.round(Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * u) * 10) / 10;
  }
  const values = a.values ?? [];
  const weights = a.weights ?? values.map(() => 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = u * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i] ?? 1;
    if (r < 0) return values[i]!;
  }
  return values[values.length - 1]!;
}

export interface Person {
  id: string;
  index: number;
  brandId: string;
  companyId: string;
  /** Lead and company tactic values (read from data). */
  values: Record<string, TacticValue>;
}

/** Person `index` of a brand's market, the same on every call. */
export function personOf(world: WorldSpec, brandId: string, index: number): Person {
  const c = Math.floor(index / world.settings.peoplePerCompany);
  const values: Record<string, TacticValue> = {};
  for (const a of world.attributes) {
    values[a.tactic] = a.level === "company" ? drawValue(a, unit(world.seed, brandId, "c", c, a.tactic)) : drawValue(a, unit(world.seed, brandId, "p", index, a.tactic));
  }
  return { id: `${brandId}:p${index}`, index, brandId, companyId: `${brandId}:c${c}`, values };
}

/** Does a source (a script creating subjects) cover person `index`? */
export function covers(world: WorldSpec, dynasty: string, brandId: string, index: number, coverage: number): boolean {
  return unit(world.seed, "cover", dynasty, brandId, index) < coverage;
}

/** The hidden multiplier of a person on the fact of the first milestone from Start. */
export function segmentMultiplier(world: WorldSpec, values: Readonly<Record<string, TacticValue>>): number {
  let m = 1;
  for (const s of world.truth.segments) if (meetsAll(values, s.when)) m *= s.mult;
  return m;
}

/** A fixed sample of a brand's market, for hidden-truth figures. */
export function marketSample(world: WorldSpec, brandId: string, n = 3000): Person[] {
  const out: Person[] = [];
  const stride = Math.max(1, Math.floor(world.settings.marketSize / n));
  for (let i = 0; i < world.settings.marketSize && out.length < n; i += stride) out.push(personOf(world, brandId, i));
  return out;
}

// ---------------------------------------------------------------------------
// Loading a world from data
// ---------------------------------------------------------------------------

/** A pinned menu entry: an outcome (its Units and its Engine's scripts) given its own page (configuration, no code). */
export interface Pin {
  kind: "outcome";
  id: string;
  label: string;
  icon?: string;
}

/** A world as published data (the shape of seed/fictional-world.json). */
export interface WorldData {
  name: string;
  description?: string;
  seed: number;
  catalogue: import("./catalogue").CatalogueData;
  clients: WorldClient[];
  attributes: MarketAttribute[];
  truth: WorldTruth;
  settings: WorldSettings;
  /** Menu entries the dashboard shows by default. */
  pins?: Pin[];
}

/** Build a world from its data and the code of its scripts. The data is cloned: a world never edits its source. */
export function loadWorld(data: WorldData, how: { seed?: number | string; Catalogue: typeof import("./catalogue").Catalogue; library: ScriptLibrary }): WorldSpec {
  const copy = JSON.parse(JSON.stringify(data)) as WorldData;
  return {
    seed: how.seed ?? copy.seed,
    catalogue: new how.Catalogue(copy.catalogue),
    library: how.library,
    clients: copy.clients,
    attributes: copy.attributes,
    truth: copy.truth,
    settings: copy.settings,
  };
}
