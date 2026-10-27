/**
 * What a pinned page shows, for ANY outcome or leg: pinning is configuration, the page is
 * the same code for every pin. An outcome lists its dynasties (versions, picks); a leg lists
 * its scripts, the Materials it is plugged at with the best script at each, and its leg storage.
 */

import type { Campaign, ContentType, SalesFunnel, SalesPath, StorageReport } from "@gtm-factory/engine";
import { campaignsRunning } from "./funnels";
import { objectDynasties, outcomeLabel, legLine, pluggedAt, type Model, type ObjectDynasty, type PluggedInput } from "./model";
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
      kind: "leg";
      id: string;
      title: string;
      description: string | undefined;
      line: string;
      /** Every dynasty of the leg's scripts: active ones first, then retired ones. */
      dynasties: string[];
      plugged: PluggedInput[];
      storage: StorageReport;
    }
  | {
      kind: "path";
      id: string;
      title: string;
      path: SalesPath;
      /** Its named funnels, each with the campaigns running it today. */
      funnels: { funnel: SalesFunnel; campaigns: Campaign[] }[];
    }
  | {
      kind: "funnel";
      id: string;
      title: string;
      funnel: SalesFunnel;
      path: SalesPath | undefined;
      campaigns: Campaign[];
    }
  | { kind: "missing"; id: string; title: string };

export function pinnedPage(model: Model, pin: Pin, scope: string | null): PinnedPage {
  if (pin.kind === "path") {
    const path = model.catalogue.salesPath(pin.id);
    if (!path) return { kind: "missing", id: pin.id, title: pin.label };
    return { kind: "path", id: path.id, title: path.name, path, funnels: model.catalogue.funnelsOf(path.id).map((funnel) => ({ funnel, campaigns: campaignsRunning(model, funnel.id) })) };
  }
  if (pin.kind === "funnel") {
    const funnel = model.catalogue.salesFunnel(pin.id);
    if (!funnel) return { kind: "missing", id: pin.id, title: pin.label };
    return { kind: "funnel", id: funnel.id, title: funnel.name, funnel, path: model.catalogue.salesPath(funnel.pathId), campaigns: campaignsRunning(model, funnel.id) };
  }
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
  const p = model.catalogue.leg(pin.id);
  if (!p) return { kind: "missing", id: pin.id, title: pin.label };
  const active = model.catalogue.dynastiesOf(p.id).map((s) => s.dynasty);
  const all = [...new Set(model.catalogue.scripts.filter((s) => s.legId === p.id).map((s) => s.dynasty))];
  return {
    kind: "leg",
    id: p.id,
    title: pin.label || p.name,
    description: p.description,
    line: legLine(model.catalogue, p),
    dynasties: [...active, ...all.filter((d) => !active.includes(d))],
    plugged: pluggedAt(model, p.id),
    storage: model.session.storageReport(p.id),
  };
}
