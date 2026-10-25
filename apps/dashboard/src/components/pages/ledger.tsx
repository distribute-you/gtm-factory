"use client";

import { useMemo } from "react";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { buildLedger, type LedgerReport } from "@gtm-factory/engine";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { channelName, outcomeLabel, scopedClients, type Model } from "@/lib/model";
import { formatCents, formatCentsExact, formatCount, formatRatePct, formatUsd } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function LedgerPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Ledger" }]} />
      <Page>{model ? <Ledger model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

/** The ledger of the campaigns in scope: their runs and the occurrences those runs made. */
function scopedLedger(model: Model, scope: string | null): LedgerReport {
  if (!scope) return model.result.ledger;
  const clients = scopedClients(model, scope);
  const ids = new Set(clients.map((c) => c.campaign.id));
  const brands = new Set(clients.map((c) => c.brand.id));
  const runs = model.result.runs.filter((r) => (r.campaignId ? ids.has(r.campaignId) : brands.has(r.id.replace("run:setup:", ""))));
  const runIds = new Set(runs.map((r) => r.id));
  return buildLedger(runs, model.result.occurrences.filter((o) => runIds.has(o.runId)));
}

function Ledger({ model, scope }: { model: Model; scope: string | null }) {
  const l = useMemo(() => scopedLedger(model, scope), [model, scope]);
  const none = l.runsProducingNone;
  const pipeOfOutcome = new Map<string, { spend: number; outputs: number }>();
  for (const d of l.decide) {
    const pipe = model.catalogue.pipe(d.pipeId);
    const out = model.catalogue.step(pipe?.to ?? "")?.leadState?.state ?? pipe?.to ?? "";
    const agg = pipeOfOutcome.get(out) ?? { spend: 0, outputs: 0 };
    agg.spend += d.spendCents;
    agg.outputs += d.outputs;
    pipeOfOutcome.set(out, agg);
  }
  const report = [...l.report].filter((r) => r.produced > 0).sort((a, b) => (a.unitCost ?? 0) - (b.unitCost ?? 0));
  return (
    <>
      <PageHeader
        title={`${formatCentsExact(l.totalSpendCents)} spent, every cent accounted for`}
        sub="Every run is a production order: it consumes outcomes, makes outcomes and costs money. Decisions read each pipe's own cost. Reports read the full cost of each outcome, every path."
        right={
          l.reconciles ? (
            <span className="flex items-center gap-1.5 text-[var(--run)]">
              <CheckCircleIcon size={16} weight="fill" />
              Reconciles to the cent
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[var(--data-rose)]">
              <WarningCircleIcon size={16} weight="fill" />
              Does not reconcile
            </span>
          )
        }
      />
      <section>
        <SectionTitle>The check</SectionTitle>
        <div className="k-card divide-y divide-[var(--line-subtle)] text-[13px]">
          <Line label="Standard cost on occurrences, once per use" value={l.standardChargedCents} />
          <Line label="Minus the reuse gain (an occurrence used again is not paid again)" value={-l.reuseGainCents} />
          <Line label="Plus runs that made nothing: normal loss" value={none.normalLossCents} sub />
          <Line label="Plus abnormal loss (work on a lead already past its target)" value={none.abnormalLossCents} sub />
          <Line label="Plus support (setup, experiments), in no unit cost" value={none.supportCents} sub />
          <div className="flex items-center justify-between px-4 py-3 font-medium">
            <span>Total run spend</span>
            <span className="tabular-nums">{formatCentsExact(l.standardChargedCents - l.reuseGainCents + none.totalCents)}</span>
          </div>
        </div>
      </section>

      <div className="mt-8 space-y-8">
        <section>
          <SectionTitle count={report.length} right={<span>To report</span>}>
            Cost of each outcome, every path
          </SectionTitle>
          <CardTable footer="Inputs from other outcomes are counted at their own unit cost. Normal loss is absorbed by the good units.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Outcome</th>
                <th className={`${TH} text-right`}>Made</th>
                <th className={`${TH} text-right`}>Own production</th>
                <th className={`${TH} text-right`}>Inputs</th>
                <th className={`${TH} text-right`}>Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.outcome} className="k-row">
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <Mark kind="step" id={r.outcome} size={20} />
                      {outcomeLabel(model, r.outcome)}
                    </span>
                  </td>
                  <td className={TDN}>{formatCount(r.produced)}</td>
                  <td className={TDN}>{formatCents(r.productionCents)}</td>
                  <td className={TDN}>{formatUsd(r.inputsValue)}</td>
                  <td className={`${TDN} font-medium`}>{formatUsd(r.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
          {report.length === 0 && <EmptyNote>No outcome yet. Press play.</EmptyNote>}
        </section>
        <section>
          <SectionTitle count={l.decide.length} right={<span>To decide</span>}>
            Each pipe&apos;s own cost
          </SectionTitle>
          <CardTable footer="What a choice reads: inputs bought from other pipes are not in it. The funnel adds them.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Pipe</th>
                <th className={`${TH} text-right`}>$ per input</th>
                <th className={`${TH} text-right`}>% conversion</th>
                <th className={`${TH} text-right`}># outcomes</th>
                <th className={`${TH} text-right`}>$ / outcome</th>
              </tr>
            </thead>
            <tbody>
              {[...l.decide]
                .sort((a, b) => b.spendCents - a.spendCents)
                .map((d) => {
                  const pipe = model.catalogue.pipe(d.pipeId);
                  return (
                    <tr key={d.pipeId} className="k-row">
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          <Mark kind="channel" id={pipe?.channel ?? ""} icon={pipe ? model.catalogue.channel(pipe.channel)?.icon : null} size={20} />
                          <span className="min-w-0">
                            <span className="block truncate">{channelName(model.catalogue, pipe)}</span>
                            <span className="k-fg3 block truncate text-[12px]">{pipe?.name}</span>
                          </span>
                        </span>
                      </td>
                      <td className={TDN}>{formatUsd(d.costPerInput)}</td>
                      <td className={TDN}>{formatRatePct(d.yieldRate)}</td>
                      <td className={TDN}>{formatCount(d.outputs)}</td>
                      <td className={TDN}>{formatUsd(d.costPerOutcome)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </CardTable>
        </section>
      </div>

      <section className="mt-8">
        <SectionTitle right={<span>Same outcome, two questions</span>}>Decide versus report</SectionTitle>
        <CardTable footer="The gap is what the inputs cost: leads found, replies, meetings bought upstream. Counting it twice would bias every choice.">
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Outcome</th>
              <th className={`${TH} text-right`}>Own cost of the last pipe</th>
              <th className={`${TH} text-right`}>Full cost, every path</th>
              <th className={`${TH} text-right`}>Bought upstream</th>
            </tr>
          </thead>
          <tbody>
            {report.map((r) => {
              const own = pipeOfOutcome.get(r.outcome);
              const ownCost = own && own.outputs > 0 ? own.spend / 100 / own.outputs : null;
              return (
                <tr key={r.outcome} className="k-row">
                  <td className={TD}>{outcomeLabel(model, r.outcome)}</td>
                  <td className={TDN}>{formatUsd(ownCost)}</td>
                  <td className={TDN}>{formatUsd(r.unitCost)}</td>
                  <td className={TDN}>{ownCost != null && r.unitCost != null ? formatUsd(r.unitCost - ownCost) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </CardTable>
      </section>
    </>
  );
}

function Line({ label, value, sub }: { label: string; value: number; sub?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className={sub ? "k-fg2 pl-3" : ""}>{label}</span>
      <span className="tabular-nums">{formatCentsExact(value)}</span>
    </div>
  );
}
