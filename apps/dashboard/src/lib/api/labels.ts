/** Words for catalogue ids, read off the catalogue the factory serves. Nothing here knows an id by name. */

import { START, type CatalogueData, type OutcomeId } from "@gtm-factory/core";
import { humanize } from "@/lib/format";

export function outcomeName(c: CatalogueData | null | undefined, id: OutcomeId): string {
  if (id === START) return "Start";
  return c?.outcomes.find((o) => o.id === id)?.label ?? humanize(id);
}

export function outcomePluralName(c: CatalogueData | null | undefined, id: OutcomeId): string {
  const o = c?.outcomes.find((x) => x.id === id);
  return o?.plural ?? `${outcomeName(c, id)}s`;
}

export function legTitle(c: CatalogueData | null | undefined, id: string): string {
  return c?.legs.find((p) => p.id === id)?.name ?? humanize(id);
}

export function factoryTitle(c: CatalogueData | null | undefined, id: string): string {
  return c?.factories.find((f) => f.id === id)?.name ?? humanize(id);
}

export function scriptTitle(c: CatalogueData | null | undefined, id: string): string {
  return c?.scripts.find((s) => s.id === id)?.name ?? humanize(id);
}
