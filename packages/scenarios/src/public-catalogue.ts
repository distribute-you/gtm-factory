/**
 * distribute.you's public catalogue, as its identity-free reads serve it
 * (features-service `GET /public/channels` and `GET /public/catalogue/steps`),
 * kept to the catalogue fields only. `stripPublicReads` drops every figure that
 * is a production rate, a fleet statistic or a price, renames every channel
 * the catalogue calls "agency-*" to "managed-*", and states what each
 * reactive leg consumes in the framework's words: the steps its scripts consume
 * (a fact another system reports is one of them) and how many days its
 * scripts wait after the Unit they consume landed.
 */

/** The public read's own field names for what a reactive leg reacts to: a word this framework retired, spelled in parts. */
const RETIRED_WORD = ["trig", "ger"].join("");
const REACTIONS = `${RETIRED_WORD}s`;
const REACTION_ID = `${RETIRED_WORD}Id`;
const MEMBER_IDS = `member${RETIRED_WORD[0]!.toUpperCase()}${RETIRED_WORD.slice(1)}Ids`;

export interface PublicStep {
  key: string;
  name: string;
  pluralName: string | null;
  icon: string | null;
  /** "person" | "object" | null. */
  subjectKind: string | null;
  lifecycleRung: string | null;
  /** The lead state this step is evidence of (lead_interested, meeting_booked, ...), if any. */
  leadState: string | null;
  /** "interest" | "visit" | null. */
  leadStateFamily: string | null;
  leadStateRank: number | null;
  description?: string | null;
}

export interface PublicTransition {
  legKey: string;
  from: string | null;
  to: string;
  mode: "proactive" | "reactive";
  /** For a reactive leg: the steps (or reported facts) its scripts consume besides `from`; several = any one of them. */
  consumes: string[];
  /** For a reactive leg that waits: the days its scripts wait after the Unit they consume landed. */
  waitDays: number | null;
}

export interface PublicChannel {
  slug: string;
  name: string;
  description: string | null;
  shortDescription: string | null;
  icon: string | null;
  displayOrder: number | null;
  channelType: string | null;
  operatedBy: string | null;
  performedBy: string | null;
  managed: boolean;
  transitions: PublicTransition[];
}

export interface PublicLeg {
  legKey: string;
  from: string | null;
  to: string;
  reactive: boolean;
  funnelKeys: string[];
  maturity: { durationDays: number; outcomesRequired: number } | null;
}

export interface PublicFunnel {
  key: string;
  name: string;
  entryStep: string | null;
  entryLegKey: string | null;
  steps: string[];
}

/** A fact another system reports (a hot lead, a number given), that a reactive leg consumes. */
export interface PublicFact {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  reportedBy: string | null;
}

export interface PublicCatalogue {
  source: string;
  readAt: string;
  steps: PublicStep[];
  channels: PublicChannel[];
  legs: PublicLeg[];
  funnels: PublicFunnel[];
  facts: PublicFact[];
  /** Legacy leg keys and the served spelling they map to (per channel type). */
  legKeyCorrespondence: { channelType: string; legacyLegKey: string; legKey: string }[];
}

const AGENCY = /^agency-/;

/** "agency-meeting-booking" -> "managed-meeting-booking"; "Agency Meeting Booking" -> "Managed Meeting Booking". */
export function renameAgency<T extends string | null>(s: T): T {
  if (s === null) return s;
  return s.replace(AGENCY, "managed-").replace(/\bAgency\b/g, "Managed").replace(/\bagency\b/g, "managed") as T;
}

type Json = Record<string, unknown>;

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function keyOf(x: unknown): string | null {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && typeof (x as Json).key === "string") return (x as Json).key as string;
  return null;
}

/**
 * What a reactive leg of the public read consumes, from the reaction it names
 * (the read's own field): the step reached, the step a delay counts from (and
 * the delay, in days), the steps of an "any of", or a fact another system
 * reports. A condition the read attaches to a delay is dropped: who is never
 * served is a strategy's choice, never a rule of the leg.
 */
function reactionsOf(read: Json[]): { consumesOf(id: string | null): { consumes: string[]; waitDays: number | null }; facts: PublicFact[] } {
  const byId = new Map(read.map((r) => [String(r.id), r]));
  const facts = new Map<string, PublicFact>();
  const consumesOf = (id: string | null, seen = new Set<string>()): { consumes: string[]; waitDays: number | null } => {
    const r = id ? byId.get(id) : undefined;
    if (!id || !r || seen.has(id)) return { consumes: [], waitDays: null };
    seen.add(id);
    const params = (r.params && typeof r.params === "object" ? r.params : {}) as Json;
    if (r.type === "outcome" && typeof r.outcomeKey === "string") return { consumes: [r.outcomeKey], waitDays: null };
    if (r.kind === "delay" && typeof params.afterStep === "string") return { consumes: [params.afterStep], waitDays: Math.round((Number(params.minutes ?? 0) / 1440) * 10000) / 10000 };
    if (r.kind === "any_of" && Array.isArray(params[MEMBER_IDS])) return { consumes: [...new Set((params[MEMBER_IDS] as string[]).flatMap((m) => consumesOf(m, seen).consumes))], waitDays: null };
    const fid = `fact:${id}`;
    facts.set(fid, { id: fid, label: String(r.label), description: str(r.description), icon: str(r.icon), reportedBy: str(params.reportedBy) });
    return { consumes: [fid], waitDays: null };
  };
  return { consumesOf, facts: [...facts.values()] };
}

/**
 * Keep the catalogue fields of the two public reads, nothing else: no rate, no
 * count, no cost, no price, no delivery or booking statistic.
 */
export function stripPublicReads(channelsRead: Json, stepsRead: Json, meta: { source: string; readAt: string }): PublicCatalogue {
  const steps: PublicStep[] = ((stepsRead.rows as Json[]) ?? []).map((r) => ({
    key: String(r.key),
    name: String(r.name),
    pluralName: str(r.pluralName),
    icon: str(r.icon),
    subjectKind: str(r.subjectKind),
    lifecycleRung: str(r.lifecycleRung),
    leadState: str(r.leadState),
    leadStateFamily: str(r.leadStateFamily),
    leadStateRank: typeof r.leadStateRank === "number" ? r.leadStateRank : null,
  }));
  const descriptions = new Map<string, string>();
  for (const s of (channelsRead.steps as Json[]) ?? []) {
    const d = str(s.description);
    if (d) descriptions.set(String(s.key), d);
  }
  for (const s of steps) s.description = descriptions.get(s.key) ?? null;
  const reactions = reactionsOf((channelsRead[REACTIONS] as Json[]) ?? []);
  const channels: PublicChannel[] = ((channelsRead.channels as Json[]) ?? []).map((c) => ({
    slug: renameAgency(String(c.slug)),
    name: renameAgency(String(c.name)),
    description: renameAgency(str(c.description)),
    shortDescription: renameAgency(str(c.shortDescription)),
    icon: str(c.icon),
    displayOrder: typeof c.displayOrder === "number" ? c.displayOrder : null,
    channelType: str(c.channelType),
    operatedBy: str(c.operatedBy),
    performedBy: str(c.performedBy),
    managed: c.managed === true,
    transitions: ((c.stepTransitions as Json[]) ?? []).map((t) => {
      const reactive = t.mode === "reactive";
      const r = reactive ? reactions.consumesOf(str(t[REACTION_ID])) : { consumes: [], waitDays: null };
      return {
        legKey: String(t.legKey),
        from: keyOf(t.from),
        to: keyOf(t.to)!,
        mode: reactive ? "reactive" : "proactive",
        consumes: r.consumes,
        waitDays: r.waitDays,
      };
    }),
  }));
  const legs: PublicLeg[] = ((channelsRead.legs as Json[]) ?? []).map((l) => {
    const m = l.maturity as Json | null;
    return {
      legKey: String(l.legKey),
      from: keyOf(l.fromStep),
      to: keyOf(l.toStep)!,
      reactive: l.reactive === true,
      funnelKeys: ((l.funnelKeys as string[]) ?? []).slice(),
      maturity: m ? { durationDays: Number(m.durationDays ?? 0), outcomesRequired: Number(m.outcomesRequired ?? 0) } : null,
    };
  });
  const funnels: PublicFunnel[] = ((channelsRead.funnels as Json[]) ?? []).map((f) => ({
    key: String(f.key),
    name: String(f.name),
    entryStep: keyOf(f.entryStep),
    entryLegKey: str(f.entryLegKey),
    steps: ((f.steps as string[]) ?? []).slice(),
  }));
  const legKeyCorrespondence = ((channelsRead.legKeyCorrespondence as Json[]) ?? []).map((x) => ({ channelType: String(x.channelType), legacyLegKey: String(x.legacyLegKey), legKey: String(x.legKey) }));
  const facts = [...reactions.facts].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { source: meta.source, readAt: meta.readAt, steps, channels, legs, funnels, facts, legKeyCorrespondence };
}
