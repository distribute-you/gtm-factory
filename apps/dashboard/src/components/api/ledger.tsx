"use client";

import type { ApiLedger, CatalogueData } from "@gtm-factory/core";
import { BarSpark, CardTable, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview, useScopeQuery } from "@/lib/api/overview";
import { engineTitle, outcomeName } from "@/lib/api/labels";
import { formatCents, formatCentsExact, formatCount, formatUsd } from "@/lib/format";
import { Read, RunsTable } from "./common";

export function ApiLedgerPage() {
  const scopeQuery = useScopeQuery();
  const read = useApi<ApiLedger>(scopeQuery ? `/ledger?${scopeQuery}` : null);
  const { data: o } = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Ledger" }]} />
      <Page>
        <Read read={read} rows={10}>
          {(l) => <Ledger l={l} catalogue={o?.catalogue} />}
        </Read>
      </Page>
    </>
  );
}

function Ledger({ l, catalogue }: { l: ApiLedger; catalogue: CatalogueData | undefined }) {
  const r = l.report;
  return (
    <>
      <PageHeader title={`${formatCentsExact(l.totalCents)} spent`} sub="Every run is a production order. Each vendor call is metered here, outside any other billing." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile label="Total spend">
          <Figure value={formatCentsExact(l.totalCents)} />
        </StatTile>
        <StatTile label="Spend by day" note={l.byDay.length > 0 ? `${l.byDay.length} days` : undefined}>
          {l.byDay.length > 0 ? <BarSpark values={l.byDay.map((d) => d.cents)} className="h-10" /> : <span className="k-fg4">—</span>}
        </StatTile>
        <StatTile label="Reconciled to the cent">
          {r.reconciles ? <ToneDot tone="run">Yes</ToneDot> : <ToneDot tone="rose">No</ToneDot>}
          <p className="k-fg3 mt-2 text-[12px] tabular-nums">
            {formatCentsExact(r.standardChargedCents)} charged, minus {formatCentsExact(r.reuseGainCents)} reuse gain, plus {formatCentsExact(r.runsProducingNone.totalCents)} of runs producing none, is {formatCentsExact(r.totalSpendCents)}.
          </p>
        </StatTile>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle count={l.byVendor.length}>By vendor</SectionTitle>
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Vendor</th>
                <th className={`${TH} w-full`}>Item</th>
                <th className={`${TH} text-right`}>Quantity</th>
                <th className={`${TH} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {l.byVendor.map((v) => (
                <tr key={`${v.vendor}|${v.item}`} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={`${TD} whitespace-nowrap`}>{v.vendor}</td>
                  <td className={`${TD} k-fg2`}>{v.item}</td>
                  <td className={TDN}>{formatCount(v.quantity)}</td>
                  <td className={TDN}>{formatCentsExact(v.cents)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </section>
        <section>
          <SectionTitle count={l.byCampaign.length}>By campaign</SectionTitle>
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`}>Campaign</th>
                <th className={`${TH} text-right`}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {l.byCampaign.map((c) => (
                <tr key={c.campaignId} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>{c.name}</td>
                  <td className={TDN}>{formatCentsExact(c.spentCents)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </section>
        <section>
          <SectionTitle count={l.byEngine.length}>By Engine</SectionTitle>
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`}>Engine</th>
                <th className={`${TH} text-right`}>Runs</th>
                <th className={`${TH} text-right`}>Outputs</th>
                <th className={`${TH} text-right`}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {l.byEngine.map((p) => (
                <tr key={p.engine} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>{engineTitle(catalogue, p.engine)}</td>
                  <td className={TDN}>{formatCount(p.runs)}</td>
                  <td className={TDN}>{formatCount(p.outputs)}</td>
                  <td className={TDN}>{formatCentsExact(p.spentCents)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </section>
        <section>
          <SectionTitle count={l.byScript.length}>By script</SectionTitle>
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`}>Script</th>
                <th className={`${TH} text-right`}>Runs</th>
                <th className={`${TH} text-right`}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {l.byScript.map((s) => (
                <tr key={s.scriptId} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>{s.name}</td>
                  <td className={TDN}>{formatCount(s.runs)}</td>
                  <td className={TDN}>{formatCentsExact(s.spentCents)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        </section>
      </div>

      <section className="mt-8">
        <SectionTitle count={r.report.length}>Unit cost of each outcome, every path</SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={`${TH} w-full`}>Outcome</th>
              <th className={`${TH} text-right`}>Produced</th>
              <th className={`${TH} text-right`}>Own production</th>
              <th className={`${TH} text-right`}>Unit cost</th>
            </tr>
          </thead>
          <tbody>
            {r.report.map((u) => (
              <tr key={u.outcome} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={TD}>{outcomeName(catalogue, u.outcome)}</td>
                <td className={TDN}>{formatCount(u.produced)}</td>
                <td className={TDN}>{formatCents(u.productionCents)}</td>
                <td className={TDN}>{formatUsd(u.unitCost)}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      </section>

      <section className="mt-8">
        <SectionTitle count={l.runs.length}>Runs</SectionTitle>
        <RunsTable runs={l.runs} catalogue={catalogue} />
      </section>
    </>
  );
}
