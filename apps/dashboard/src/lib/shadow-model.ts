/**
 * Read models of the shadow pages: every figure they show, computed from the shadow session and
 * its report. Pages divide nothing. Nothing here knows a client, a pipe or a script by name.
 */

import { START, type CampaignView, type ClientView, type OutcomeId, type PointView, type ShadowAction, type ShadowClient } from "@gtm-factory/engine";
import type { ShadowState } from "./shadow";

export interface ClientRow {
  client: ShadowClient;
  view: ClientView;
  campaigns: number;
  running: number;
  spendCents: number;
  /** Lead states reached, per outcome, from the snapshot's observations. */
  states: Record<OutcomeId, number>;
  actions: number;
}

export function outcomeName(s: ShadowState, id: OutcomeId): string {
  if (id === START) return "Start";
  return s.session.catalogue.outcome(id)?.label ?? s.session.catalogue.triggers.find((t) => t.event === id)?.label ?? id;
}

export function pipeName(s: ShadowState, id: string | null): string {
  if (!id) return "No pipe";
  return s.session.catalogue.pipe(id)?.name ?? id;
}

/** Every client, the ones running campaigns first, then by spend. */
export function clientRows(s: ShadowState): ClientRow[] {
  const obs = s.snapshot.observations;
  return s.snapshot.clients
    .map((client) => {
      const b = client.brand.id;
      const view = s.report.clients.find((c) => c.brandId === b)!;
      const states: Record<OutcomeId, number> = {};
      for (const st of obs.states) if (st.brandId === b) states[st.outcome] = (states[st.outcome] ?? 0) + st.leads;
      return {
        client,
        view,
        campaigns: client.campaigns.length,
        running: client.campaigns.filter((c) => c.status === "running").length,
        spendCents: obs.runs.filter((r) => r.brandId === b).reduce((x, r) => x + r.spendCents, 0),
        states,
        actions: s.report.actions.filter((a) => a.brandId === b).length,
      };
    })
    .sort((a, b) => b.running - a.running || b.campaigns - a.campaigns || b.spendCents - a.spendCents || (a.client.brand.name < b.client.brand.name ? -1 : 1));
}

/** The key of a reconciliation line in words. */
export function lineName(s: ShadowState, key: string): string {
  return key === "spend" ? "Spend" : outcomeName(s, key);
}

/** A point's options as a page shows them: today's and the engine's first, then by share of picks. */
export function pointOptions(p: PointView, limit = 8) {
  const rest = [...p.options].sort((a, b) => b.pickShare - a.pickShare || b.valuePerDollar - a.valuePerDollar || (a.option < b.option ? -1 : 1));
  const keep = rest.filter((o) => o.option === p.today || o.option === p.engine);
  for (const o of rest) {
    if (keep.length >= limit) break;
    if (!keep.includes(o)) keep.push(o);
  }
  return { shown: keep.sort((a, b) => b.pickShare - a.pickShare || b.valuePerDollar - a.valuePerDollar), hidden: p.options.length - keep.length };
}

/** A point in words, and an option in words (a script, a pipe, or a client's object). */
export function pointTitle(s: ShadowState, p: PointView): string {
  return s.session.pointTitle(p);
}

export function optionName(s: ShadowState, p: PointView, option: string, brandId: string): string {
  return s.session.optionName(p, option, brandId);
}

/** The actions of the engine, grouped by kind in a stable order. */
export const ACTION_WORDS: Record<ShadowAction["kind"], string> = {
  switch_pipe: "Change the pipe of a leg",
  switch_script: "Change the script at an input",
  switch_occurrence: "Change the ICP or template used",
  set_budget: "Change a daily budget",
  pause_campaign: "Fund a campaign with nothing",
  switch_funnel: "Run another sales funnel",
  propose_icp: "Write a finer ICP",
  propose_strategy: "Offer a strategy",
};

/** A campaign's line in words: entry, then each leg's pipe and the state it reaches. */
export function lineParts(s: ShadowState, v: CampaignView, pipes: (string | null)[]): { pipe: string | null; to: OutcomeId }[] {
  return v.line.map((to, k) => ({ pipe: pipes[k] ?? null, to }));
}
