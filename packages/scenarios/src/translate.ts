/**
 * distribute.you's public catalogue translated into the framework's model:
 * steps become outcomes on lead tracks, channel x leg become pipes, and a
 * reactive leg becomes a pipe consuming what it reacts to (a fact another
 * system reports is an outcome its webhook makes). Scripts, clients and
 * numbers are not part of the translation (a scenario adds them).
 *
 * Rules:
 *  - A step that IS a lead state (lead_interested, meeting_booked,
 *    meeting_attended, paid_client, lead_visited) is a lead outcome on its
 *    track. A step that is evidence of a state (a positive reply, a signup, a
 *    form) is that state: a lead reaches it once, whatever the evidence.
 *  - Evidence a pipe would turn into the same state it starts from (a booking
 *    call made after a reply, a purchase before the paid client) stays an
 *    outcome of its own, off the tracks, so the pipe keeps a meaning.
 *  - A pipe is a leg (per factory, and per outcome it consumes besides its
 *    start); a channel is the value of the "Channel" tactic its scripts carry,
 *    never an object. A reactive leg consuming its own start is a plain pipe
 *    (the funnel walks it); a leg consuming something else has it in its Bill
 *    of materials (one pipe per outcome when it reacts to any one of several).
 *  - A delay is the waiting of the leg's scripts ("Days since last message").
 *  - Sourcing pipes consume an ICP; pipes of the client's own team are another
 *    factory.
 */

import { type CatalogueData, type LeadTrack, type Outcome, type OutcomeId, type Pipe } from "@gtm-factory/engine";
import type { PublicCatalogue, PublicStep } from "./public-catalogue";

export const OUR_FACTORY = "ours";
export const CLIENT_TEAM = "client_team";
export const TEMPLATE = "template_written";
export const LLM = "llm_completion";
export const ICP = "audience_built";
export const LLM_PIPE = "llm";
export const TEMPLATE_PIPE = "template_writing";
export const ICP_CLIENT_PIPE = "icp_client";
export const ICP_FINDER_PIPE = "icp_finder";
export const RATING = "rating";
export const RATING_PIPE = "supplier_rating";
export const OTHER_SYSTEMS = "other_systems";
/** The tactic a waiting script carries: days since the Unit it consumes landed. */
export const WAIT_TACTIC = "wait_days";

const TRACKS: Record<string, LeadTrack> = {
  interest: { id: "crm_lifecycle", name: "CRM lifecycle", description: "Lead interested, then meeting booked, then meeting attended, then paid client." },
  visit: { id: "website_visits", name: "Website visits", description: "Lead visited the brand's website." },
};

export interface TranslateOptions {
  /** Channels that write a message from a template (their pipes get a template Material). */
  templateChannel?: (channel: PublicCatalogue["channels"][number]) => boolean;
  /** Channels whose scripts ask an LLM (their pipes get an LLM completion Material). */
  llmChannel?: (channel: PublicCatalogue["channels"][number]) => boolean;
}

/** The tactic every script carries: the channel it works on (a list of the catalogue's channel names). */
export const CHANNEL_TACTIC = "channel";

export interface TranslatedCatalogue {
  catalogue: CatalogueData;
  /** The outcome a step is (its state, or its own outcome). */
  outcomeOfStep(step: string | null): OutcomeId | null;
  /** The pipes a channel's leg runs on (one per outcome it may consume; legacy leg keys accepted), empty when the catalogue has none. */
  pipesOf(channelSlug: string, legKey: string): string[];
  /** The days a channel's leg waits (its scripts' "Days since last message"), null when it does not. */
  waitOf(channelSlug: string, legKey: string): number | null;
  /** A channel's name: the value of the channel tactic its scripts carry. */
  channelName(channelSlug: string): string | null;
  /** Served leg key of a legacy one, for a channel. */
  servedLegKey(channelSlug: string, legKey: string): string;
}

/** A pipe is a leg, per factory (ours, the client's team) and per outcome it consumes besides its start. */
export function legPipeId(from: OutcomeId | null, to: OutcomeId, factory: string, consumes: OutcomeId | null): string {
  return `${factory === CLIENT_TEAM ? "team:" : ""}${from ?? "start"}>${to}${consumes ? `@${consumes}` : ""}`;
}

export function translateCatalogue(pub: PublicCatalogue, options: TranslateOptions = {}): TranslatedCatalogue {
  const stepByKey = new Map(pub.steps.map((s) => [s.key, s]));
  const stateOf = (s: PublicStep | undefined): string | null => (s?.leadState && s.leadStateFamily && TRACKS[s.leadStateFamily] ? s.leadState : null);

  // Which evidence steps stay apart: a leg from X to Y where both map to the same state.
  const apart = new Set<string>();
  for (const c of pub.channels) {
    for (const t of c.transitions) {
      if (!t.from) continue;
      const a = stateOf(stepByKey.get(t.from));
      const b = stateOf(stepByKey.get(t.to));
      // The step past the state keeps its own outcome: the end of the leg, except when the end is the state itself.
      if (a && a === b) apart.add(t.to !== b ? t.to : t.from);
    }
  }
  const outcomeOfStep = (step: string | null): OutcomeId | null => {
    if (!step) return null;
    const s = stepByKey.get(step);
    if (!s) return step;
    if (apart.has(step)) return step;
    return stateOf(s) ?? step;
  };

  // ---- outcomes -----------------------------------------------------------
  const outcomes: Outcome[] = [];
  const used = new Set<string>();
  const evidenceOf = new Map<string, string[]>();
  for (const s of pub.steps) {
    const o = outcomeOfStep(s.key)!;
    if (o !== s.key) evidenceOf.set(o, [...(evidenceOf.get(o) ?? []), s.name]);
  }
  for (const s of pub.steps) {
    const id = outcomeOfStep(s.key)!;
    if (id !== s.key || used.has(id)) continue;
    used.add(id);
    const state = stateOf(s);
    const isState = state === s.key;
    const subject: Outcome["subject"] = s.subjectKind === "person" || s.lifecycleRung === "contacted" ? "lead" : "brand";
    const ev = evidenceOf.get(id);
    outcomes.push({
      id,
      label: s.name,
      ...(s.pluralName ? { plural: s.pluralName } : {}),
      subject,
      ...(isState ? { track: { track: TRACKS[s.leadStateFamily!]!.id, rank: s.leadStateRank ?? 1 } } : {}),
      ...(s.key === ICP ? { contentType: "audience" as const } : subject === "brand" ? { contentType: "text" as const } : {}),
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.description || ev ? { description: [s.description, ev ? `Reached by: ${ev.join(", ").toLowerCase()}.` : null].filter(Boolean).join(" ") } : {}),
    });
  }
  if (!used.has(ICP)) outcomes.push({ id: ICP, label: "ICP", plural: "ICPs", subject: "brand", contentType: "audience", icon: "users-three", description: "Who to reach, as one plain sentence." });
  outcomes.push({ id: TEMPLATE, label: "Template", plural: "Templates", subject: "brand", contentType: "text_with_variables", icon: "note-pencil", description: "A message model with variables a writer fills for each lead." });
  outcomes.push({ id: LLM, label: "LLM completion", plural: "LLM completions", subject: "run", contentType: "text", icon: "sparkle", description: "One answer of a language model to the run that asked: no other run is ever served it." });

  outcomes.push({ id: RATING, label: "Rating", plural: "Ratings", subject: "brand", contentType: "rating", icon: "chart-bar", description: "Per option at each choice point, what the ledger says about value per dollar. Made each tick by the Supplier rating." });

  // ---- facts other systems report: outcomes their webhooks make ----------------------
  for (const f of pub.facts) outcomes.push({ id: f.id, label: f.label, subject: "lead", icon: f.icon ?? "lightning", ...(f.description ? { description: f.description } : {}) });

  // ---- factories and pipes ------------------------------------------------------
  const factories = [
    { id: OUR_FACTORY, name: "Our factory", ours: true, description: "Runs we start and pay for." },
    { id: CLIENT_TEAM, name: "Your team", ours: false, description: "The client's own people." },
    { id: OTHER_SYSTEMS, name: "Other systems", ours: false, description: "Systems that report a fact through a webhook." },
  ];
  const pipes: Pipe[] = [];
  const legByKey = new Map(pub.legs.map((l) => [l.legKey, l]));
  const label = (o: OutcomeId | null) => (o === null ? "Start" : outcomes.find((x) => x.id === o)?.label ?? o);
  /** channel|leg -> pipe id */
  const channelPipe = new Map<string, string[]>();
  const channelWait = new Map<string, number>();
  const channels = [...pub.channels].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || (a.slug < b.slug ? -1 : 1));
  const known = (o: OutcomeId) => outcomes.some((x) => x.id === o);
  for (const c of channels) {
    for (const t of c.transitions) {
      const from = outcomeOfStep(t.from);
      const to = outcomeOfStep(t.to)!;
      if (from === to) continue;
      // What the leg consumes besides its start: one pipe per outcome (any one of several).
      const extra = [...new Set(t.consumes.map((x) => (x.startsWith("fact:") ? x : outcomeOfStep(x)!)).filter((x) => x !== from && x !== to && known(x)))];
      const factory = c.operatedBy === "customer" ? CLIENT_TEAM : OUR_FACTORY;
      const ids: string[] = [];
      for (const consumed of extra.length > 0 ? extra : [null]) {
        // A pipe is a leg: what it consumes and what it makes. Channels are tactics of its scripts.
        const id = legPipeId(from, to, factory, consumed);
        ids.push(id);
        let pipe = pipes.find((p) => p.id === id);
        if (!pipe) {
          const materials: OutcomeId[] = [];
          if (consumed) materials.push(consumed);
          if (from) materials.push(from);
          const leg = legByKey.get(t.legKey);
          const duration = leg?.maturity?.durationDays ?? 0;
          const who = factory === CLIENT_TEAM ? "Your team: " : "";
          const after = consumed ? ` after ${label(consumed).toLowerCase()}` : "";
          pipe = {
            id,
            name: `${who}${label(from)} to ${label(to).toLowerCase()}${after}`,
            materials,
            output: to,
            factory,
            maturity: { durationDays: duration, outcomesRequired: leg?.maturity?.outcomesRequired ?? 10, delayMeanDays: Math.round((duration / 6) * 10) / 10, horizonDays: duration },
            ...(outcomes.find((o) => o.id === to)?.icon ? { icon: outcomes.find((o) => o.id === to)!.icon! } : {}),
          };
          pipes.push(pipe);
        }
        const more = [c.channelType === "sourcing" ? ICP : null, options.templateChannel?.(c) ? TEMPLATE : null, options.llmChannel?.(c) ? LLM : null, factory === OUR_FACTORY ? RATING : null];
        for (const x of more) if (x && !pipe.materials.includes(x)) pipe.materials.push(x);
      }
      channelPipe.set(`${c.slug}|${t.legKey}`, ids);
      if (t.waitDays) channelWait.set(`${c.slug}|${t.legKey}`, t.waitDays);
      for (const id of ids) pipes.find((p) => p.id === id)!.description = `Channels: ${channels.filter((ch) => [...channelPipe].some(([k, v]) => v.includes(id) && k.startsWith(`${ch.slug}|`))).map((ch) => ch.name).join(", ")}.`;
    }
  }
  const zero = { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 };
  pipes.push(
    { id: ICP_CLIENT_PIPE, name: "ICP from the client", materials: [], output: ICP, factory: CLIENT_TEAM, maturity: zero, description: "The client says who to reach.", icon: "users-three" },
    { id: ICP_FINDER_PIPE, name: "ICP finder", materials: [], output: ICP, factory: OUR_FACTORY, maturity: zero, description: "An AI proposes who to reach, and a finer ICP when the data shows one.", icon: "magic-wand" },
    { id: TEMPLATE_PIPE, name: "Template writing", materials: [], output: TEMPLATE, factory: OUR_FACTORY, maturity: zero, description: "Writes the message models a writer fills for each lead.", icon: "note-pencil" },
    { id: LLM_PIPE, name: "LLM", materials: [], output: LLM, factory: OUR_FACTORY, maturity: zero, description: "A language model: each run answers the run that ordered it.", icon: "sparkle" },
    { id: RATING_PIPE, name: "Supplier rating", materials: [], output: RATING, factory: OUR_FACTORY, maturity: zero, description: "An auxiliary cost center: reads the ledger and the traceability, and makes each tick the Rating every choosing pipe consumes.", icon: "chart-bar" },
    ...pub.facts.map((f) => ({ id: `webhook:${f.id.slice(5)}`, name: `${f.label} (webhook)`, materials: [], output: f.id, factory: OTHER_SYSTEMS, webhook: true, maturity: zero, description: `A webhook: ${f.reportedBy ? `${f.reportedBy} reports` : "another system reports"} it.`, icon: f.icon ?? "lightning" })),
  );

  const tracks = Object.values(TRACKS);
  const channelTactic = { id: CHANNEL_TACTIC, name: "Channel", type: { kind: "list" as const, values: channels.map((c) => c.name) }, describes: ["script" as const], source: "data" as const, description: "The channel a script works on: a pipe is a leg, and scripts of every channel compete on it." };
  const waitTactic = { id: WAIT_TACTIC, name: "Days since last message", type: { kind: "number" as const, unit: "days" }, describes: ["script" as const], source: "data" as const, description: "A script waits this many days after the Unit it consumes landed before it runs." };
  const ageTactic = { id: "age_days", name: "Age", type: { kind: "number" as const, unit: "days" }, describes: ["unit" as const], source: "data" as const, description: "Days since a Unit landed in the stock." };
  const evidenceTactic = { id: "reads_evidence", name: "Reads the ledger", type: { kind: "yesno" as const }, describes: ["script" as const], source: "data" as const, description: "A Supplier rating script that reads the ledger and the traceability, or one that gives every option its prior." };
  const catalogue: CatalogueData = { leadTracks: tracks, outcomes, factories, pipes, scripts: [], tactics: [channelTactic, waitTactic, ageTactic, evidenceTactic], strategies: [] };

  const served = new Map<string, string>();
  for (const c of pub.channels) {
    for (const x of pub.legKeyCorrespondence) if (x.channelType === c.channelType) served.set(`${c.slug}|${x.legacyLegKey}`, x.legKey);
  }
  const servedLegKey = (slug: string, legKey: string) => served.get(`${slug}|${legKey}`) ?? legKey;
  const pipesOf = (slug: string, legKey: string) => channelPipe.get(`${slug}|${legKey}`) ?? channelPipe.get(`${slug}|${servedLegKey(slug, legKey)}`) ?? [];
  const waitOf = (slug: string, legKey: string) => channelWait.get(`${slug}|${legKey}`) ?? channelWait.get(`${slug}|${servedLegKey(slug, legKey)}`) ?? null;
  const channelName = (slug: string) => pub.channels.find((c) => c.slug === slug)?.name ?? null;
  return { catalogue, outcomeOfStep, pipesOf, waitOf, channelName, servedLegKey };
}
