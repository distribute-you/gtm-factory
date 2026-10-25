/**
 * distribute.you's public catalogue, as its identity-free reads serve it
 * (features-service `GET /public/channels` and `GET /public/catalogue/steps`),
 * kept to the catalogue fields only. `stripPublicReads` drops every figure that
 * is a production rate, a fleet statistic or a price, and renames every
 * channel the catalogue calls "agency-*" to "managed-*".
 */

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
  triggerId: string | null;
  pipe: { id: string; name: string; icon: string | null; color: string | null } | null;
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

export interface PublicTrigger {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  fromStep: string | null;
  firedBy: string | null;
  kind: string | null;
  type: string | null;
  outcomeKey: string | null;
  params: Record<string, unknown> | null;
}

export interface PublicCatalogue {
  source: string;
  readAt: string;
  steps: PublicStep[];
  channels: PublicChannel[];
  legs: PublicLeg[];
  funnels: PublicFunnel[];
  triggers: PublicTrigger[];
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
      const pipe = t.pipe as Json | null;
      return {
        legKey: String(t.legKey),
        from: keyOf(t.from),
        to: keyOf(t.to)!,
        mode: t.mode === "reactive" ? "reactive" : "proactive",
        triggerId: str(t.triggerId),
        pipe: pipe ? { id: renameAgency(String(pipe.id)), name: String(pipe.name), icon: str(pipe.icon), color: str(pipe.color) } : null,
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
  const triggers: PublicTrigger[] = ((channelsRead.triggers as Json[]) ?? []).map((t) => ({
    id: String(t.id),
    label: String(t.label),
    description: str(t.description),
    icon: str(t.icon),
    fromStep: str(t.fromStep),
    firedBy: str(t.firedBy),
    kind: str(t.kind),
    type: str(t.type),
    outcomeKey: str(t.outcomeKey),
    params: t.params && typeof t.params === "object" ? (t.params as Record<string, unknown>) : null,
  }));
  const legKeyCorrespondence = ((channelsRead.legKeyCorrespondence as Json[]) ?? []).map((x) => ({ channelType: String(x.channelType), legacyLegKey: String(x.legacyLegKey), legKey: String(x.legKey) }));
  return { source: meta.source, readAt: meta.readAt, steps, channels, legs, funnels, triggers, legKeyCorrespondence };
}
