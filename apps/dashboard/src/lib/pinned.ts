/**
 * What a pinned page shows, for ANY outcome: pinning is configuration, the page is the same
 * code for every pin. An outcome shows its Engine (its scripts, the Engines that call it with
 * the best script at each, its storage) and, for a brand outcome, its Units by dynasty.
 */

import type { ContentType, StorageReport } from "@gtm-factory/core";
import { engineLine, objectDynasties, outcomeLabel, pluggedAt, type Model, type ObjectDynasty, type PluggedInput } from "./model";
import type { Pin } from "./pins";

export type PinnedPage =
  | {
      kind: "outcome";
      id: string;
      title: string;
      description: string | undefined;
      contentType: ContentType | undefined;
      line: string;
      /** The brand's Units by dynasty (a template, an ICP); empty for an outcome made per subject or per run. */
      dynasties: ObjectDynasty[];
      /** Every dynasty of its Engine's scripts: active ones first, then retired ones. */
      scripts: string[];
      plugged: PluggedInput[];
      storage: StorageReport;
    }
  | { kind: "missing"; id: string; title: string };

export function pinnedPage(model: Model, pin: Pin, scope: string | null): PinnedPage {
  const o = model.catalogue.outcome(pin.id);
  if (!o) return { kind: "missing", id: pin.id, title: pin.label };
  const active = model.catalogue.scriptsOf(o.id).map((s) => s.dynasty);
  const all = [...new Set(model.catalogue.scripts.filter((s) => s.outcome === o.id).map((s) => s.dynasty))];
  return {
    kind: "outcome",
    id: o.id,
    title: pin.label || o.plural || outcomeLabel(model.catalogue, o.id),
    description: o.description,
    contentType: o.contentType,
    line: engineLine(model.catalogue, o.id),
    dynasties: o.subject === "brand" ? objectDynasties(model, o.id, scope) : [],
    scripts: [...active, ...all.filter((d) => !active.includes(d))],
    plugged: pluggedAt(model, o.id),
    storage: model.session.storageReport(o.id),
  };
}
