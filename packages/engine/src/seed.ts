/**
 * Loader for a published catalogue file (the shape of seed/distribute-catalogue.json).
 * The engine never reads files: the caller parses the JSON and hands it here.
 */

import { Catalogue, START, type Channel, type LeadTrack, type Pipe, type Step, type Trigger, type CatalogueIssue } from "./catalogue";

interface SeedStepRef {
  key: string;
}

interface SeedStep {
  key: string;
  label: string;
  pluralLabel?: string;
  description?: string;
}

interface SeedTransition {
  legKey: string;
  from: SeedStepRef | null;
  to: SeedStepRef;
  pipe: { id: string; name?: string };
  reactive: boolean;
  triggerId: string | null;
}

interface SeedChannel {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  family?: string;
  operatedBy: string;
  performedBy: string;
  stepTransitions: SeedTransition[];
}

interface SeedLeg {
  legKey: string;
  maturity?: { durationDays?: number; outcomesRequired?: number } | null;
}

interface SeedTrigger {
  id: string;
  label: string;
  description?: string;
  type: string;
  fromStep: string | null;
  outcomeKey: string | null;
}

interface SeedIconRow {
  key: string;
  icon?: string;
  subjectKind: string | null;
  leadState: string | null;
  leadTrack: string | null;
  leadStateRank: number | null;
}

/** The published catalogue file shape. */
export interface SeedFile {
  catalogue: {
    channels: SeedChannel[];
    legs: SeedLeg[];
    steps: SeedStep[];
    leadTracks?: { id: string; name: string; description?: string }[];
    triggers: SeedTrigger[];
    triggerAliases?: { id: string; mergedInto: string }[];
  };
  stepIcons?: { rows: SeedIconRow[] };
}

export interface SeedLoadResult {
  catalogue: Catalogue;
  /** Validation issues of the loaded catalogue (empty when valid). */
  issues: CatalogueIssue[];
  /** What the loader had to complete, said out loud. */
  notes: string[];
}

/** Default maturity when the file states none. */
export const DEFAULT_MATURITY = { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0 };

/** Load a published catalogue file into a Catalogue. */
export function loadSeedCatalogue(file: SeedFile): SeedLoadResult {
  const notes: string[] = [];
  const iconRows = new Map((file.stepIcons?.rows ?? []).map((r) => [r.key, r]));

  const steps: Step[] = file.catalogue.steps.map((s) => {
    const row = iconRows.get(s.key);
    const subjectKind = row?.subjectKind === "person" ? "lead" : row?.subjectKind === "object" ? "object" : "none";
    return {
      key: s.key,
      label: s.label,
      ...(s.pluralLabel ? { pluralLabel: s.pluralLabel } : {}),
      ...(s.description ? { description: s.description } : {}),
      ...(row?.icon ? { icon: row.icon } : {}),
      subjectKind,
      leadState:
        row?.leadState && row.leadTrack && row.leadStateRank !== null
          ? { state: row.leadState, leadTrack: row.leadTrack, rank: row.leadStateRank }
          : null,
    };
  });
  const stepKeys = new Set(steps.map((s) => s.key));

  const aliases = new Map((file.catalogue.triggerAliases ?? []).map((a) => [a.id, a.mergedInto]));
  const triggers: Trigger[] = file.catalogue.triggers.map((t) => ({
    id: t.id,
    label: t.label,
    ...(t.description ? { description: t.description } : {}),
    kind: t.type === "outcome" ? "outcome" : "condition",
    outcomeStep: t.type === "outcome" ? t.outcomeKey : null,
    fromStep: t.fromStep && stepKeys.has(t.fromStep) ? t.fromStep : null,
  }));

  const legMaturity = new Map(file.catalogue.legs.map((l) => [l.legKey, l.maturity ?? null]));

  const channels: Channel[] = [];
  const pipes: Pipe[] = [];
  for (const c of file.catalogue.channels) {
    channels.push({
      slug: c.slug,
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.family ? { group: c.family } : {}),
      operatedBy: c.operatedBy === "customer" ? "customer" : "platform",
      performedBy: c.performedBy === "person" ? "person" : "software",
    });
    for (const t of c.stepTransitions) {
      let triggerId = t.reactive ? (t.triggerId ? aliases.get(t.triggerId) ?? t.triggerId : null) : null;
      if (triggerId && !triggers.some((x) => x.id === triggerId)) {
        triggers.push({ id: triggerId, label: humanise(triggerId), kind: "condition", outcomeStep: null, fromStep: null });
        notes.push(`trigger "${triggerId}" is used by ${t.pipe.id} but not listed: added as a condition trigger`);
      }
      if (t.reactive && !triggerId) {
        triggerId = null;
        notes.push(`reactive pipe ${t.pipe.id} names no trigger`);
      }
      const m = legMaturity.get(t.legKey);
      const durationDays = m?.durationDays ?? DEFAULT_MATURITY.durationDays;
      pipes.push({
        id: t.pipe.id,
        channel: c.slug,
        from: t.from?.key ?? START,
        to: t.to.key,
        mode: t.reactive ? "reactive" : "proactive",
        triggerId,
        ...(t.pipe.name ? { name: t.pipe.name } : {}),
        maturity: {
          durationDays,
          outcomesRequired: m?.outcomesRequired ?? DEFAULT_MATURITY.outcomesRequired,
          // Without a measured delay, assume a third of the maturity window on average.
          delayMeanDays: durationDays / 3,
        },
      });
    }
  }

  const leadTracks: LeadTrack[] = (file.catalogue.leadTracks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
  }));
  const catalogue = new Catalogue({ leadTracks, steps, triggers, channels, pipes });
  return { catalogue, issues: catalogue.validate(), notes };
}

function humanise(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
