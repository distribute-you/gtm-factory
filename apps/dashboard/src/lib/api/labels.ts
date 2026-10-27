/** Words for catalogue ids, read off the catalogue a running GTM Factory serves. Nothing here knows an id by name. */

import { OURS, START, type CatalogueData, type OutcomeId } from "@gtm-factory/core";
import { humanize } from "@/lib/format";

export function outcomeName(c: CatalogueData | null | undefined, id: OutcomeId): string {
  if (id === START) return "Start";
  return c?.outcomes.find((o) => o.id === id)?.label ?? humanize(id);
}

export function outcomePluralName(c: CatalogueData | null | undefined, id: OutcomeId): string {
  const o = c?.outcomes.find((x) => x.id === id);
  return o?.plural ?? `${outcomeName(c, id)}s`;
}

/** An Engine is named by the outcome it makes. */
export function engineTitle(c: CatalogueData | null | undefined, outcome: OutcomeId | null | undefined): string {
  if (!outcome || outcome === "campaign") return "Campaign";
  return outcomeName(c, outcome);
}

/** Who performs it, in words ("Ours" stays as is). */
export function performerTitle(performedBy: string | null | undefined): string {
  return performedBy ?? OURS;
}

export function scriptTitle(c: CatalogueData | null | undefined, id: string): string {
  return c?.scripts.find((s) => s.id === id)?.name ?? humanize(id);
}

/** The Engines whose active scripts call an outcome. */
export function callersOf(c: CatalogueData | null | undefined, outcome: OutcomeId): OutcomeId[] {
  return [...new Set((c?.scripts ?? []).filter((s) => s.status === "active" && s.materials.includes(outcome)).map((s) => s.outcome))];
}

/**
 * An Engine in one line: where its subject comes from, then what it makes. An Engine that
 * makes no person or company of its own (a completion, a template) says which Engines call it.
 */
export function engineLine(c: CatalogueData | null | undefined, outcome: OutcomeId): string {
  const o = c?.outcomes.find((x) => x.id === outcome);
  const scripts = (c?.scripts ?? []).filter((s) => s.outcome === outcome && s.status === "active");
  if (o?.subject === "lead" || o?.subject === "company") {
    const subjects = new Set((c?.outcomes ?? []).filter((x) => x.subject === "lead" || x.subject === "company").map((x) => x.id));
    const froms = [
      ...new Set(
        scripts.map((s) => {
          const m = s.materials.find((x) => subjects.has(x));
          return m ? outcomeName(c, m) : s.webhook ? "A webhook call" : "The market";
        }),
      ),
    ];
    return `${froms.join(" or ") || "The market"} → ${outcomeName(c, outcome)}`;
  }
  const callers = callersOf(c, outcome);
  return callers.length > 0 ? `Called by ${callers.map((x) => outcomeName(c, x)).join(", ")}` : "Made for the brand";
}
