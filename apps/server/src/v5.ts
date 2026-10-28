/**
 * The v5 catalogue shapes the public translation of distribute.you's catalogue
 * still speaks (legs, factories, Bills of materials). The connector converts
 * them to the v6 model (one Engine per outcome, "Performed by") before they
 * reach the stored catalogue; nothing else reads them.
 */

import type { Condition, OutcomeId, Outcome as V6Outcome, TacticValue, Tactic } from "@gtm-factory/core";

export type { OutcomeId };

export interface LeadTrack {
  id: string;
  name: string;
  description?: string;
  retired?: boolean;
}

export type Outcome = Omit<V6Outcome, "reference"> & { referenceLeg?: string };

export interface Factory {
  id: string;
  name: string;
  ours: boolean;
  description?: string;
}

export interface Leg {
  id: string;
  name: string;
  output: OutcomeId;
  factory: string;
  maturity: { durationDays: number; outcomesRequired: number; delayMeanDays: number; horizonDays: number };
  webhook?: boolean;
  description?: string;
  icon?: string;
  retired?: boolean;
}

export interface Material {
  outcome: OutcomeId;
  conditions?: Condition[];
}

export interface Script {
  id: string;
  legId: string;
  dynasty: string;
  version: number;
  name: string;
  parentDynasty?: string | null;
  kind: "rules" | "ai" | "human";
  materials: Material[];
  tactics: Record<string, TacticValue>;
  costCents: number;
  status: "active" | "retired";
  provider?: { name: string; color?: string; logoUrl?: string };
  description?: string;
}

export interface Strategy {
  id: string;
  name: string;
  legId: string;
  rules: { material?: OutcomeId; conditions: Condition[] }[];
  subject?: Condition[];
  proposed?: { day: number; reason: string };
  retired?: boolean;
}

export interface CatalogueData {
  leadTracks: LeadTrack[];
  outcomes: Outcome[];
  factories: Factory[];
  legs: Leg[];
  scripts: Script[];
  tactics: Tactic[];
  strategies: Strategy[];
  salesPaths?: { id: string; name: string; start: OutcomeId; line: OutcomeId[] }[];
  salesFunnels?: { id: string; name: string; pathId: string; plays: string[] }[];
}
