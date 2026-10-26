"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ApiCampaign, ApiCampaignDetail, CatalogueData } from "@gtm-factory/engine";
import { Mark } from "@/components/mark";
import { BarSpark, CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { outcomeName, pipeTitle } from "@/lib/api/labels";
import { formatCents, formatCount, plural } from "@/lib/format";
import { BudgetButton, CampaignStatusButton, CapBar, ChoicesTable, CountsAlong, PointsList, Read, RunsTable, formatTime, timeAgo } from "./common";

export function ApiCampaignsPage() {
  const read = useApi<ApiCampaign[]>("/campaigns");
  const { data: o } = useFactory();
  const brandName = (id: string) => o?.brands.find((b) => b.id === id)?.name ?? "";
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns" }]} actions={<Link href="/campaigns/new/" className="k-btn-strong">New campaign</Link>} />
      <Page>
        <Read read={read}>
          {(campaigns) => (
            <>
              <PageHeader title={plural(campaigns.length, "campaign", "campaigns")} sub="Each campaign runs one sales funnel for one brand, under a daily cap." />
              {campaigns.length === 0 ? (
                <div className="k-card">
                  <EmptyNote>
                    No campaign yet. <Link href="/campaigns/new/" className="k-accent">Start one</Link>.
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
                      <th className={`${TH} text-right`}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="k-row k-line-subtle border-b last:border-b-0">
                        <td className={TD}>
                          <Link href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`} className="flex min-w-0 items-center gap-2.5">
                            <Mark kind="funnel" id={c.funnelId} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{c.name}</span>
                              <span className="k-fg3 block truncate text-[12px]">
                                {brandName(c.brandId)} · {c.funnelName}
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
                        <td className={`${TD} k-mono k-fg2 whitespace-nowrap text-right text-[12px]`}>{formatTime(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </CardTable>
              )}
            </>
          )}
        </Read>
      </Page>
    </>
  );
}

export function ApiCampaignPage() {
  const id = useSearchParams().get("id");
  const read = useApi<ApiCampaignDetail>(id ? `/campaigns/${encodeURIComponent(id)}` : null);
  const { data: o } = useFactory();
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: read.data?.campaign.name ?? "Campaign" }]} />
      <Page>
        {!id ? (
          <EmptyNote>No campaign in the address.</EmptyNote>
        ) : (
          <Read read={read} rows={8}>
            {(d) => <Campaign d={d} catalogue={o?.catalogue} />}
          </Read>
        )}
      </Page>
    </>
  );
}

function Campaign({ d, catalogue }: { d: ApiCampaignDetail; catalogue: CatalogueData | undefined }) {
  const c = d.campaign;
  // Every outcome about a subject the funnel's pipes make, in the order they run (entry left out).
  // Object outcomes (a template, a brand context, an LLM completion) ride beside the pipe they feed.
  const line = d.funnel
    ? [...new Set(d.funnel.legs.flatMap((l) => l.pipes.map((p) => catalogue?.pipes.find((x) => x.id === p)?.output ?? p)))].filter(
        (o) => catalogue?.outcomes.find((x) => x.id === o)?.subject !== "object",
      )
    : Object.keys(c.counts);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Mark kind="funnel" id={c.funnelId} size={40} />
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]">{c.name}</h1>
            <p className="k-fg2 mt-0.5 text-[13px]">
              {d.brand.name} · {c.funnelName}
              {d.brand.test && <span className="k-chip ml-2">Staff test</span>}
            </p>
            <p className="k-fg3 mt-0.5 text-[12px]">
              {c.launchedAt ? `Launched ${formatTime(c.launchedAt)}` : "Never launched"} · last tick {timeAgo(c.lastTickAt)}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <CampaignStatusButton campaign={c} />
          <BudgetButton campaign={c} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile label="Today against the cap">
          <CapBar campaign={c} />
        </StatTile>
        <StatTile label="Spent in total">
          <Figure value={formatCents(c.spentTotalCents)} />
        </StatTile>
        <StatTile label="Spend by day" note={d.spendByDay.length > 0 ? `${d.spendByDay.length} days` : undefined}>
          {d.spendByDay.length > 0 ? <BarSpark values={d.spendByDay.map((x) => x.cents)} className="h-10" /> : <span className="k-fg4">—</span>}
        </StatTile>
      </div>

      <section className="mt-8">
        <SectionTitle>Along the sales funnel</SectionTitle>
        <CountsAlong catalogue={catalogue} line={line} counts={c.counts} />
        {d.funnel && (
          <p className="k-fg3 mt-2 text-[12px]">
            {d.funnel.legs.map((l) => `${outcomeName(catalogue, l.from)} to ${outcomeName(catalogue, l.to)}: ${l.pipes.map((p) => pipeTitle(catalogue, p)).join(", ")}`).join(" · ")}
          </p>
        )}
        <OtherCounts catalogue={catalogue} line={line} counts={c.counts} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.points.length}>Choice points</SectionTitle>
        <PointsList points={d.points} empty="No choice made yet. Launch the campaign and the first tick makes them." />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.recentChoices.length}>Why the engine chose</SectionTitle>
        <ChoicesTable choices={d.recentChoices} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.recentRuns.length}>Recent runs</SectionTitle>
        <RunsTable runs={d.recentRuns} catalogue={catalogue} />
      </section>

      <p className="mt-6 text-[13px]">
        <Link href={`/leads/?campaign=${encodeURIComponent(c.id)}`} className="k-accent">
          See this campaign&apos;s leads
        </Link>
      </p>
    </>
  );
}

/** Outcomes counted on the campaign that sit off its line (end states, side outcomes). */
function OtherCounts({ catalogue, line, counts }: { catalogue: CatalogueData | undefined; line: string[]; counts: Record<string, number> }) {
  const others = Object.entries(counts).filter(([k]) => !line.includes(k));
  if (others.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {others.map(([k, v]) => (
        <span key={k} className="k-chip tabular-nums">
          {outcomeName(catalogue, k)}: {formatCount(v)}
        </span>
      ))}
    </div>
  );
}
