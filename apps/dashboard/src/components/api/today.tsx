"use client";

import Link from "next/link";
import type { ApiOverview } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { useOverview } from "@/lib/api/overview";
import { outcomeName } from "@/lib/api/labels";
import { formatCents, formatCount, plural } from "@/lib/format";
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
  const live = o.campaigns.filter((c) => c.status === "live").length;
  const leadOutcomes = o.catalogue.outcomes.filter((x) => x.subject === "lead" && !x.retired && o.totals.counts[x.id] != null);
  const brandName = (id: string) => o.brands.find((b) => b.id === id)?.name ?? "";
  return (
    <>
      <PageHeader
        title={`${live} of ${plural(o.campaigns.length, "campaign", "campaigns")} live`}
        sub="Every script runs for real here. Each pick and each cent is below."
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
        </StatTile>
        {leadOutcomes.map((x) => (
          <StatTile key={x.id} label={x.plural ?? x.label}>
            <Figure value={formatCount(o.totals.counts[x.id] ?? 0)} />
          </StatTile>
        ))}
      </div>

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
                <th className={TH}>Budget</th>
                <th className={TH}>Spent</th>
                <th className={`${TH} text-right`}>Spent in total</th>
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
                        <span className="k-fg3 block truncate text-[12px]">{brandName(c.brandId)}</span>
                        {c.description && <span className="k-fg2 mt-0.5 block text-[12px] leading-5">{c.description}</span>}
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
        <SectionTitle count={o.recentPicks.length}>Why each pick was made</SectionTitle>
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
