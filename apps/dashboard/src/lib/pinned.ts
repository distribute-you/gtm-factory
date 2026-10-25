/**
 * What a pinned page shows, for ANY outcome or pipe: pinning is configuration, the page is
 * the same code for every pin. An outcome lists its dynasties (versions, picks); a pipe lists
 * its scripts, the inputs it is plugged at with the best script at each, and its pipe storage.
 */

import type { ContentType, StorageReport } from "@gtm-factory/engine";
import { objectDynasties, outcomeLabel, pipeLine, pluggedAt, type Model, type ObjectDynasty, type PluggedInput } from "./model";
import type { Pin } from "./pins";

export type PinnedPage =
  | {
      kind: "outcome";
      id: string;
      title: string;
      description: string | undefined;
      contentType: ContentType | undefined;
      dynasties: ObjectDynasty[];
    }
  | {
      kind: "pipe";
      id: string;
      title: string;
      description: string | undefined;
      line: string;
      /** Every dynasty of the pipe's scripts: active ones first, then retired ones. */
      dynasties: string[];
      plugged: PluggedInput[];
      storage: StorageReport;
    }
  | { kind: "missing"; id: string; title: string };

export function pinnedPage(model: Model, pin: Pin, scope: string | null): PinnedPage {
  if (pin.kind === "outcome") {
    const o = model.catalogue.outcome(pin.id);
    if (!o) return { kind: "missing", id: pin.id, title: pin.label };
    return {
      kind: "outcome",
      id: o.id,
      title: pin.label || o.plural || outcomeLabel(model.catalogue, o.id),
      description: o.description,
      contentType: o.contentType,
      dynasties: objectDynasties(model, o.id, scope),
    };
  }
  const p = model.catalogue.pipe(pin.id);
  if (!p) return { kind: "missing", id: pin.id, title: pin.label };
  const active = model.catalogue.dynastiesOf(p.id).map((s) => s.dynasty);
  const all = [...new Set(model.catalogue.scripts.filter((s) => s.pipeId === p.id).map((s) => s.dynasty))];
  return {
    kind: "pipe",
    id: p.id,
    title: pin.label || p.name,
    description: p.description,
    line: pipeLine(model.catalogue, p),
    dynasties: [...active, ...all.filter((d) => !active.includes(d))],
    plugged: pluggedAt(model, p.id),
    storage: model.session.storageReport(p.id),
  };
}
