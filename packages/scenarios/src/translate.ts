/**
 * distribute.you's public catalogue translated into the framework's model:
 * steps become outcomes on lead tracks, channel x leg become pipes, triggers
 * become triggers with their event outcome. Scripts, clients and numbers are
 * not part of the translation (a scenario or a shadow snapshot adds them).
 *
 * Rules:
 *  - A step that IS a lead state (lead_interested, meeting_booked,
 *    meeting_attended, paid_client, lead_visited) is a lead outcome on its
 *    track. A step that is evidence of a state (a positive reply, a signup, a
 *    form) is that state: a lead reaches it once, whatever the evidence.
 *  - Evidence a pipe would turn into the same state it starts from (a booking
 *    call made after a reply, a purchase before the paid client) stays an
 *    outcome of its own, off the tracks, so the pipe keeps a meaning.
 *  - A channel's leg is a pipe "<channel>|<leg>". A reactive leg whose trigger
 *    is reaching the leg's own start is a plain pipe (the funnel walks it); a
 *    leg reacting to anything else waits on its trigger.
 *  - Sourcing pipes consume an ICP; pipes of the client's own team are another
 *    factory.
 */

import { ON_DEMAND, type CatalogueData, type LeadTrack, type Outcome, type OutcomeId, type Pipe, type Trigger } from "@gtm-factory/engine";
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

const TRACKS: Record<string, LeadTrack> = {
  interest: { id: "crm_lifecycle", name: "CRM lifecycle", description: "Lead interested, then meeting booked, then meeting attended, then paid client." },
  visit: { id: "website_visits", name: "Website visits", description: "Lead visited the brand's website." },
};

export interface TranslateOptions {
  /** Pipes that write a message from a template (they get a template input). */
  templatePipes?: (pipeId: string, channel: PublicCatalogue["channels"][number]) => boolean;
  /** Pipes that ask an LLM on demand (they get an LLM completion input). */
  llmPipes?: (pipeId: string, channel: PublicCatalogue["channels"][number]) => boolean;
}

export interface TranslatedCatalogue {
  catalogue: CatalogueData;
  /** The outcome a step is (its state, or its own outcome). */
  outcomeOfStep(step: string | null): OutcomeId | null;
  /** The pipe of a channel's leg (legacy leg keys accepted), or null when the catalogue has none. */
  pipeOf(channelSlug: string, legKey: string): string | null;
  /** The event outcome of a trigger. */
  eventOf(triggerId: string): OutcomeId | null;
  /** Served leg key of a legacy one, for a channel. */
  servedLegKey(channelSlug: string, legKey: string): string;
}

export function eventOutcomeId(triggerId: string): string {
  return `event:${triggerId}`;
}

export function pipeIdOf(channelSlug: string, legKey: string): string {
  return `${channelSlug}|${legKey}`;
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
      // The step past the state keeps its own outcome: the end of the leg, unless the end is the state itself.
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
    const subject: Outcome["subject"] = s.subjectKind === "person" || s.lifecycleRung === "contacted" ? "lead" : "object";
    const ev = evidenceOf.get(id);
    outcomes.push({
      id,
      label: s.name,
      ...(s.pluralName ? { plural: s.pluralName } : {}),
      subject,
      ...(isState ? { track: { track: TRACKS[s.leadStateFamily!]!.id, rank: s.leadStateRank ?? 1 } } : {}),
      ...(s.key === ICP ? { contentType: "audience" as const } : subject === "object" ? { contentType: "text" as const } : {}),
      ...(s.icon ? { icon: s.icon } : {}),
      ...(s.description || ev ? { description: [s.description, ev ? `Reached by: ${ev.join(", ").toLowerCase()}.` : null].filter(Boolean).join(" ") } : {}),
    });
  }
  if (!used.has(ICP)) outcomes.push({ id: ICP, label: "ICP", plural: "ICPs", subject: "object", contentType: "audience", icon: "users-three", description: "Who to reach, as one plain sentence." });
  outcomes.push({ id: TEMPLATE, label: "Template", plural: "Templates", subject: "object", contentType: "text_with_variables", icon: "note-pencil", description: "A message model with variables a writer fills for each lead." });
  outcomes.push({ id: LLM, label: "LLM completion", plural: "LLM completions", subject: "object", contentType: "text", icon: "sparkle", description: "One answer of a language model, asked for by the script that needs it." });

  // ---- triggers ---------------------------------------------------------------
  const triggers: Trigger[] = [{ id: ON_DEMAND, label: "On demand", when: [], delayDays: 0, unless: [], reported: true, description: "A consuming script asks the engine for this input." }];
  const byId = new Map(pub.triggers.map((t) => [t.id, t]));
  const whenOf = (id: string, seen = new Set<string>()): OutcomeId[] => {
    const t = byId.get(id);
    if (!t || seen.has(id)) return [];
    seen.add(id);
    if (t.type === "outcome" && t.outcomeKey) return [outcomeOfStep(t.outcomeKey)!];
    if (t.kind === "delay" && typeof t.params?.afterStep === "string") return [outcomeOfStep(t.params.afterStep as string)!];
    if (t.kind === "any_of" && Array.isArray(t.params?.memberTriggerIds)) return [...new Set((t.params!.memberTriggerIds as string[]).flatMap((m) => whenOf(m, seen)))];
    return [];
  };
  for (const t of pub.triggers) {
    const ev = eventOutcomeId(t.id);
    outcomes.push({ id: ev, label: t.label, subject: "event", icon: t.icon ?? "lightning", ...(t.description ? { description: t.description } : {}) });
    const when = whenOf(t.id).filter((o) => outcomes.some((x) => x.id === o));
    const unless = t.kind === "delay" && typeof t.params?.unlessStep === "string" ? [outcomeOfStep(t.params.unlessStep as string)!] : [];
    const delayDays = t.kind === "delay" && typeof t.params?.minutes === "number" ? Math.round(((t.params.minutes as number) / 1440) * 1000) / 1000 : 0;
    triggers.push({
      id: t.id,
      label: t.label,
      when,
      delayDays,
      unless,
      ...(when.length === 0 ? { reported: true } : {}),
      event: ev,
      ...(t.description ? { description: t.description } : {}),
    });
  }
  const eventOf = (id: string) => (triggers.some((t) => t.id === id) ? eventOutcomeId(id) : null);

  // ---- factories and pipes ------------------------------------------------------
  const factories = [
    { id: OUR_FACTORY, name: "Our factory", ours: true, description: "Runs we start and pay for." },
    { id: CLIENT_TEAM, name: "Your team", ours: false, description: "The client's own people." },
  ];
  const pipes: Pipe[] = [];
  const legByKey = new Map(pub.legs.map((l) => [l.legKey, l]));
  const label = (o: OutcomeId) => outcomes.find((x) => x.id === o)?.label ?? o;
  for (const c of [...pub.channels].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || (a.slug < b.slug ? -1 : 1))) {
    for (const t of c.transitions) {
      const id = pipeIdOf(c.slug, t.legKey);
      const from = outcomeOfStep(t.from);
      const to = outcomeOfStep(t.to)!;
      if (from === to) continue;
      const trigger = t.triggerId ? byId.get(t.triggerId) : undefined;
      const onItsStart = trigger && trigger.type === "outcome" && trigger.outcomeKey && outcomeOfStep(trigger.outcomeKey) === from;
      const inputs: OutcomeId[] = [];
      let triggerId: string | null = null;
      if (t.mode === "reactive" && t.triggerId === ON_DEMAND) {
        triggerId = ON_DEMAND;
        if (from) inputs.push(from);
      } else if (t.mode === "reactive" && t.triggerId && !onItsStart && eventOf(t.triggerId)) {
        triggerId = t.triggerId;
        inputs.push(eventOf(t.triggerId)!);
        if (from) inputs.push(from);
      } else if (from) inputs.push(from);
      if (c.channelType === "sourcing") inputs.push(ICP);
      if (options.templatePipes?.(id, c)) inputs.push(TEMPLATE);
      if (options.llmPipes?.(id, c)) inputs.push(LLM);
      const leg = legByKey.get(t.legKey);
      const duration = leg?.maturity?.durationDays ?? 0;
      const several = c.transitions.length > 1;
      pipes.push({
        id,
        name: several ? `${c.name}: ${label(to)}` : c.name,
        inputs,
        output: to,
        factory: c.operatedBy === "customer" ? CLIENT_TEAM : OUR_FACTORY,
        ...(triggerId ? { triggerId } : {}),
        maturity: { durationDays: duration, outcomesRequired: leg?.maturity?.outcomesRequired ?? 10, delayMeanDays: Math.round((duration / 6) * 10) / 10, horizonDays: duration },
        ...(c.shortDescription || c.description ? { description: (c.shortDescription ?? c.description)! } : {}),
        ...(c.icon ? { icon: c.icon } : {}),
      });
    }
  }
  const zero = { durationDays: 0, outcomesRequired: 10, delayMeanDays: 0, horizonDays: 0 };
  pipes.push(
    { id: ICP_CLIENT_PIPE, name: "ICP from the client", inputs: [], output: ICP, factory: CLIENT_TEAM, maturity: zero, description: "The client says who to reach.", icon: "users-three" },
    { id: ICP_FINDER_PIPE, name: "ICP finder", inputs: [], output: ICP, factory: OUR_FACTORY, maturity: zero, description: "An AI proposes who to reach, and a finer ICP when the data shows one.", icon: "magic-wand" },
    { id: TEMPLATE_PIPE, name: "Template writing", inputs: [], output: TEMPLATE, factory: OUR_FACTORY, maturity: zero, description: "Writes the message models a writer fills for each lead.", icon: "note-pencil" },
    { id: LLM_PIPE, name: "LLM", inputs: [], output: LLM, factory: OUR_FACTORY, triggerId: ON_DEMAND, maturity: zero, description: "A language model, asked on demand by the script that needs it.", icon: "sparkle" },
  );

  const tracks = Object.values(TRACKS);
  const catalogue: CatalogueData = { leadTracks: tracks, outcomes, factories, pipes, scripts: [], triggers, tactics: [], strategies: [] };

  const served = new Map<string, string>();
  for (const c of pub.channels) {
    for (const x of pub.legKeyCorrespondence) if (x.channelType === c.channelType) served.set(`${c.slug}|${x.legacyLegKey}`, x.legKey);
  }
  const servedLegKey = (slug: string, legKey: string) => served.get(`${slug}|${legKey}`) ?? legKey;
  const pipeIds = new Set(pipes.map((p) => p.id));
  const pipeOf = (slug: string, legKey: string) => {
    const id = pipeIdOf(slug, servedLegKey(slug, legKey));
    return pipeIds.has(id) ? id : null;
  };
  return { catalogue, outcomeOfStep, pipeOf, eventOf, servedLegKey };
}
