"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApiOverview, ApiSeries } from "@gtm-factory/core";
import { DayChart, Legend } from "@/components/charts";
import { Mark } from "@/components/mark";
import { BarSpark, CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, SparkLine, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { outcomeName } from "@/lib/api/labels";
import { formatCents, formatCount, formatRoi, formatUsd, plural, roiIsGood } from "@/lib/format";
import { BudgetButton, CampaignStatusButton, CapBar, PicksTable, Read, RunsTable, timeAgo } from "./common";

export function ApiTodayPage() {
  const read = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Today" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(o) => <Today o={o} />}
        </Read>
      </Page>
    </>
  );
}

function Today({ o }: { o: ApiOverview }) {
  const { scope } = useScope();
  const series = useApi<ApiSeries>(`/series${scope.brandId ? `?brandId=${encodeURIComponent(scope.brandId)}` : ""}`).data ?? null;
  const live = o.campaigns.filter((c) => c.status === "live").length;
  const leadOutcomes = o.catalogue.outcomes.filter((x) => x.subject === "lead" && !x.retired && o.totals.counts[x.id] != null);
  const brandName = (id: string) => o.brands.find((b) => b.id === id)?.name ?? "";
  return (
    <>
      <PageHeader
        title={`${live} of ${plural(o.campaigns.length, "campaign", "campaigns")} live`}
        sub="Each pick and each cent is below."
        right={
          o.scheduler.running ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
              Last tick {timeAgo(o.scheduler.lastTickAt)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-3)]" />
              Scheduler stopped
            </span>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Spent today">
          <Figure value={formatCents(o.totals.spentTodayCents)} />
        </StatTile>
        <StatTile label="Spent in total">
          <Figure value={formatCents(o.totals.spentTotalCents)} />
          <BarSpark className="mt-auto pt-2" values={series?.spendCents ?? null} />
        </StatTile>
        {leadOutcomes.map((x) => (
          <StatTile key={x.id} label={x.plural ?? x.label}>
            <Figure value={formatCount(o.totals.counts[x.id] ?? 0)} />
            <SparkLine className="mt-auto h-8 pt-2" values={series?.outcomes[x.id] ? cumulative(series.outcomes[x.id]!) : null} color="var(--data-teal)" />
          </StatTile>
        ))}
      </div>

      {series && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <CostPerOutcomeCard o={o} series={series} />
          <ReturnCard series={series} />
        </div>
      )}

      <section className="mt-8">
        <SectionTitle count={o.campaigns.length} right={<Link href="/campaigns/new/" className="k-accent">New campaign</Link>}>
          Campaigns
        </SectionTitle>
        {o.campaigns.length === 0 ? (
          <div className="k-card">
            <EmptyNote>
              No campaign yet. <Link href="/brands/new/" className="k-accent">Add a brand</Link>, then start one.
            </EmptyNote>
          </div>
        ) : (
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`}>Campaign</th>
                <th className={TH}>Status</th>
                <th className={TH}>Daily cap</th>
                <th className={TH}>Today</th>
                <th className={`${TH} text-right`}>Spent</th>
                <th className={`${TH} text-right`}>Last tick</th>
              </tr>
            </thead>
            <tbody>
              {o.campaigns.map((c) => (
                <tr key={c.id} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>
                    <Link href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`} className="flex min-w-0 items-center gap-2.5">
                      <Mark kind="outcome" id={c.target} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="k-fg3 block truncate text-[12px]">
                          {brandName(c.brandId)}: {c.line.length > 0 ? c.line.map((x) => outcomeName(o.catalogue, x)).join(" → ") : "Not run yet"}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className={TD}>
                    <CampaignStatusButton campaign={c} />
                  </td>
                  <td className={TD}>
                    <BudgetButton campaign={c} />
                  </td>
                  <td className={TD}>
                    <CapBar campaign={c} />
                  </td>
                  <td className={TDN}>{formatCents(c.spentTotalCents)}</td>
                  <td className={`${TDN} k-fg2`}>{timeAgo(c.lastTickAt)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        )}
      </section>

      <section className="mt-8">
        <SectionTitle count={o.recentPicks.length}>Why each one was picked</SectionTitle>
        <PicksTable picks={o.recentPicks} empty="No pick yet. Launch a campaign and the first tick makes them." />
      </section>

      <section className="mt-8">
        <SectionTitle count={o.recentRuns.length} right={<Link href="/ledger/" className="k-accent">Ledger</Link>}>
          Recent runs
        </SectionTitle>
        <RunsTable runs={o.recentRuns} catalogue={o.catalogue} />
      </section>

      {o.totals.counts && leadOutcomes.length === 0 && Object.keys(o.totals.counts).length > 0 && (
        <p className="k-fg3 mt-4 text-[12px]">
          {Object.entries(o.totals.counts)
            .map(([k, v]) => `${outcomeName(o.catalogue, k)}: ${formatCount(v)}`)
            .join(" · ")}
        </p>
      )}
    </>
  );
}

function cumulative(values: readonly number[]): number[] {
  let s = 0;
  return values.map((v) => (s += v));
}

/** Spend to date over outcomes to date, day by day, for the milestone picked. */
function CostPerOutcomeCard({ o, series }: { o: ApiOverview; series: ApiSeries }) {
  const states = o.catalogue.outcomes.filter((x) => x.subject === "lead" && !x.retired && (series.outcomes[x.id] ?? []).some((v) => v > 0));
  const [state, setState] = useState<string | null>(null);
  const picked = state && states.some((x) => x.id === state) ? state : (states[0]?.id ?? null);
  const label = picked ? outcomeName(o.catalogue, picked).toLowerCase() : "outcome";
  const spend = cumulative(series.spendCents);
  const outs = cumulative(picked ? (series.outcomes[picked] ?? []) : []);
  const measured = spend.map((s, i) => ((outs[i] ?? 0) > 0 ? s / 100 / outs[i]! : null));
  const last = [...measured].reverse().find((x) => x != null) ?? null;
  const lines = [{ key: "m", label: `Cost per ${label}`, values: measured, color: "var(--accent)" }];
  return (
    <section>
      <SectionTitle right={<span>Spend to date over outcomes to date</span>}>$ per outcome over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Figure value={last != null ? formatUsd(last) : "None yet"} sub={`per ${label}`} />
          <div className="flex flex-wrap gap-1">
            {states.map((x) => (
              <button key={x.id} type="button" onClick={() => setState(x.id)} className={`k-chip ${x.id === picked ? "k-chip-on" : ""}`} aria-pressed={x.id === picked}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">{measured.some((x) => x != null) ? <DayChart series={lines} days={series.days} format={formatUsd} /> : <EmptyNote>No outcome yet.</EmptyNote>}</div>
        <Legend series={lines} />
      </div>
    </section>
  );
}

/** Value won by our runs over our spend, to date, day by day; the expected return beside it. */
function ReturnCard({ series }: { series: ApiSeries }) {
  const spend = cumulative(series.spendCents);
  const value = series.valueCents ? cumulative(series.valueCents) : null;
  const roi = value ? spend.map((s, i) => (s > 0 ? value[i]! / s : null)) : [];
  const expected = series.expectedReturn ?? null;
  const lines = [
    { key: "m", label: "Measured return: our value over our spend", values: roi, color: "var(--run)" },
    ...(expected ? [{ key: "e", label: "Expected: the same formula on today's estimates", values: series.days.map(() => expected), color: "var(--fg-4)", dashed: true }] : []),
  ];
  const last = [...roi].reverse().find((x) => x != null) ?? null;
  return (
    <section>
      <SectionTitle right={<span>Value won by our runs over our spend</span>}>Return over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <Figure value={<span className={roiIsGood(last) ? "text-[var(--run)]" : ""}>{formatRoi(last)}</span>} sub={`expected ${formatRoi(expected)}`} />
        <div className="mt-3">
          {value ? <DayChart series={lines} days={series.days} format={(v) => formatRoi(v)} reference={{ y: 1, label: "Break-even" }} /> : <EmptyNote>No value measured yet. A paid client's value comes in once its lifetime value is known.</EmptyNote>}
        </div>
        <Legend series={lines} />
      </div>
    </section>
  );
}
