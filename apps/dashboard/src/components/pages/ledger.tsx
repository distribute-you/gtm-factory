"use client";

import { useMemo } from "react";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { outcomeLabel, pipeName, type Model } from "@/lib/model";
import { factoryFigures, mostReused } from "@/lib/engine-pages";
import { formatCents, formatCentsExact, formatCount, formatRatePct, formatUsd } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function LedgerPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Ledger" }]} />
      <Page>{model ? <Ledger model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Ledger({ model }: { model: Model }) {
  const l = model.session.ledger();
  const factories = useMemo(() => factoryFigures(model), [model]);
  const reused = useMemo(() => mostReused(model), [model]);
  const ours = factories.filter((f) => f.ours).reduce((s, f) => s + f.spendCents, 0);
  const other = factories.filter((f) => !f.ours).reduce((s, f) => s + f.spendCents, 0);
  const c = model.catalogue;
  return (
    <>
      <PageHeader
        title={<>{l.reconciles ? "The books reconcile to the cent" : "The books do not reconcile"}</>}
        sub="Every run is a production order: it consumes Units, produces Units, and costs money. The ledger is the common conveyor belt every run writes to."
        right={<span>{formatCount(model.session.runs.length)} runs</span>}
      />

      <div className="k-card px-4 py-4">
        <p className="k-label mb-2">Reconciliation</p>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px] tabular-nums">
          <span title="Each unit's standard cost, charged once per consumption">{formatCentsExact(l.standardChargedCents)}</span>
          <span className="k-fg3">standard cost charged</span>
          <span className="k-fg2">−</span>
          <span>{formatCentsExact(l.reuseGainCents)}</span>
          <span className="k-fg3">reuse gain</span>
          <span className="k-fg2">+</span>
          <span>{formatCentsExact(l.runsProducingNone.totalCents)}</span>
          <span className="k-fg3">runs producing none</span>
          <span className="k-fg2">=</span>
          <span className={`font-medium ${l.reconciles ? "text-[var(--run)]" : "text-[var(--data-rose)]"}`}>{formatCentsExact(l.totalSpendCents)}</span>
          <span className="k-fg3">total spend</span>
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Our runs" note="our spend">
          <Figure value={formatCents(ours)} />
        </StatTile>
        <StatTile label="Other factories" note="access cost">
          <Figure value={formatCents(other)} />
        </StatTile>
        <StatTile label="Normal loss" note="runs with no outcome">
          <Figure value={formatCents(l.runsProducingNone.normalLossCents)} />
        </StatTile>
        <StatTile label="Support" note="setup, stated apart">
          <Figure value={formatCents(l.runsProducingNone.supportCents)} />
        </StatTile>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle right={<span>What choices read</span>}>Decide: each pipe's own cost</SectionTitle>
          <CardTable footer="Materials bought from other pipes are not in a pipe's price: the funnel adds them, never twice.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Pipe</th>
                <th className={`${TH} text-right`}>Units consumed</th>
                <th className={`${TH} text-right`}>$ per Unit consumed</th>
                <th className={`${TH} text-right`}>Yield</th>
                <th className={`${TH} text-right`}>$ per outcome</th>
              </tr>
            </thead>
            <tbody>
              {[...l.decide]
                .sort((a, b) => b.spendCents - a.spendCents)
                .map((d) => (
                  <tr key={d.pipeId} className="k-row k-line-subtle border-b last:border-0">
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <Mark kind="pipe" id={d.pipeId} icon={c.pipe(d.pipeId)?.icon} size={20} />
                        <span className="truncate">{pipeName(c, d.pipeId)}</span>
                      </span>
                    </td>
                    <td className={TDN}>{formatCount(d.inputs)}</td>
                    <td className={TDN}>{formatUsd(d.costPerInput)}</td>
                    <td className={TDN}>{formatRatePct(d.yieldRate)}</td>
                    <td className={TDN}>{formatUsd(d.costPerOutcome)}</td>
                  </tr>
                ))}
            </tbody>
          </CardTable>
        </section>
        <section>
          <SectionTitle right={<span>What reports and prices read</span>}>Report: every-path unit cost</SectionTitle>
          <CardTable footer="Own production plus Materials at their own unit cost, normal loss absorbed, cycles solved.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Outcome</th>
                <th className={`${TH} text-right`}>Produced</th>
                <th className={`${TH} text-right`}>Own production</th>
                <th className={`${TH} text-right`}>Units consumed</th>
                <th className={`${TH} text-right`}>Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {l.report
                .filter((r) => r.produced > 0)
                .map((r) => (
                  <tr key={r.outcome} className="k-row k-line-subtle border-b last:border-0">
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <Mark kind="outcome" id={r.outcome} icon={c.outcome(r.outcome)?.icon} size={20} />
                        <span className="truncate">{outcomeLabel(c, r.outcome)}</span>
                      </span>
                    </td>
                    <td className={TDN}>{formatCount(r.produced)}</td>
                    <td className={TDN}>{formatCents(r.productionCents)}</td>
                    <td className={TDN}>{formatUsd(r.inputsValue)}</td>
                    <td className={TDN}>{formatUsd(r.unitCost)}</td>
                  </tr>
                ))}
            </tbody>
          </CardTable>
          {l.divergent.length > 0 && <p className="k-fg3 mt-2 text-[12px]">No unit cost for {l.divergent.map((o) => outcomeLabel(c, o)).join(", ")}: their cycle buys more than it makes.</p>}
        </section>
      </div>

      <section className="mt-8">
        <SectionTitle right={<span>Paid once, consumed many times</span>}>Where the reuse gain comes from</SectionTitle>
        {reused.length === 0 ? (
          <EmptyNote>No Unit consumed twice yet.</EmptyNote>
        ) : (
          <CardTable footer="A Unit keeps the price paid to make it; each consumption charges that price. A second consumption is a gain on the books.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Unit</th>
                <th className={TH}>Made by</th>
                <th className={`${TH} text-right`}>Consumed</th>
                <th className={`${TH} text-right`}>Standard cost</th>
                <th className={`${TH} text-right`}>Reuse gain</th>
              </tr>
            </thead>
            <tbody>
              {reused.map((r) => {
                const occ = model.session.unit(r.id);
                return (
                  <tr key={r.id} className="k-row k-line-subtle border-b last:border-0">
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <Mark kind={occ?.dynasty ? "object" : "outcome"} id={occ?.outcome ?? r.id} icon={occ ? c.outcome(occ.outcome)?.icon : undefined} size={20} />
                        <span className="truncate">
                          {occ ? outcomeLabel(c, occ.outcome) : r.id}
                          {occ?.name ? `: ${occ.name}` : ""}
                        </span>
                      </span>
                    </td>
                    <td className={TD}>{occ?.pipeId ? pipeName(c, occ.pipeId) : "—"}</td>
                    <td className={TDN}>{formatCount(r.consumptions)}</td>
                    <td className={TDN}>{formatCentsExact(r.standardCents)}</td>
                    <td className={TDN}>{formatCentsExact(r.standardCents * (r.consumptions - 1))}</td>
                  </tr>
                );
              })}
            </tbody>
          </CardTable>
        )}
      </section>
    </>
  );
}
