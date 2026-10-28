"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Flows, PlanTree, type FlowView, type TreeNode } from "@/components/plan-tree";
import { START, type ApiCampaign, type ApiCampaignDetail, type ApiPlanNode, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { BarSpark, CardTable, ChartNote, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { engineTitle, outcomeName, outcomePluralName, scriptTitle } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, plural } from "@/lib/format";
import { BudgetButton, CampaignStatusButton, CapBar, PicksTable, CountsAlong, PointsList, Read, RunsTable, formatTime, otherPerformer, timeAgo } from "./common";

export function ApiCampaignsPage() {
  const read = useApi<ApiCampaign[]>("/campaigns");
  const { data: o } = useOverview();
  const brandName = (id: string) => o?.brands.find((b) => b.id === id)?.name ?? "";
  const brand = useSearchParams().get("brand");
  return (
    <>
      <TopBar crumbs={brand ? [{ label: "Campaigns", href: "/campaigns/" }, { label: brandName(brand) || "Brand" }] : [{ label: "Campaigns" }]} actions={<Link href="/campaigns/new/" className="k-btn-strong">New campaign</Link>} />
      <Page>
        <Read read={read}>
          {(all) => {
            const campaigns = brand ? all.filter((c) => c.brandId === brand) : all;
            const live = campaigns.filter((c) => c.status === "live").length;
            return (
            <>
              <PageHeader title={plural(campaigns.length, "campaign", "campaigns")} sub={`${formatCount(live)} live. Each campaign orders a Target for one brand under a daily cap; its Plan is recomputed at every tick.`} />
              {campaigns.length === 0 ? (
                <div className="k-card">
                  <EmptyNote>
                    No campaign yet. <Link href="/campaigns/new/" className="k-accent">Start one</Link>.
                  </EmptyNote>
                </div>
              ) : (
                <CardTable note="Each campaign, its daily cap, and how much of today's cap it used.">
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
                        <td className={`${TD} max-w-0`}>
                          <Link href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`} className="flex min-w-0 items-center gap-2.5">
                            <Mark kind="outcome" id={c.target} size={28} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{c.name}</span>
                              <span className="k-fg3 block truncate text-[12px]">
                                {brandName(c.brandId)} · Goal: {outcomeName(o?.catalogue, c.target)}
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
            );
          }}
        </Read>
      </Page>
    </>
  );
}

export function ApiCampaignPage() {
  const id = useSearchParams().get("id");
  const read = useApi<ApiCampaignDetail>(id ? `/campaigns/${encodeURIComponent(id)}` : null);
  const { data: o } = useOverview();
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

/** The Plan tree a page draws, from the served one. */
function treeOf(catalogue: CatalogueData | undefined, n: ApiPlanNode): TreeNode {
  return {
    outcome: n.outcome,
    label: outcomeName(catalogue, n.outcome),
    icon: catalogue?.outcomes.find((o) => o.id === n.outcome)?.icon,
    candidates: n.candidates,
    branches: n.branches.map((b) => {
      const s = catalogue?.scripts.find((x) => x.id === b.scriptId);
      return {
        key: b.scriptId,
        name: s?.name ?? scriptTitle(catalogue, b.scriptId),
        kind: s?.kind ?? "rules",
        dynasty: s?.dynasty ?? b.scriptId,
        units: b.units,
        share: b.share,
        costPerUnit: b.costPerUnitCents != null ? b.costPerUnitCents / 100 : null,
        current: b.current,
        inputs: b.inputs.map((i) => ({ label: i.label, versions: i.versions.map((v) => ({ label: v.label, share: v.share })) })),
        sameBelow: b.sameBelow,
        children: b.children.map((c) => treeOf(catalogue, c)),
      };
    }),
  };
}

function Campaign({ d, catalogue }: { d: ApiCampaignDetail; catalogue: CatalogueData | undefined }) {
  const c = d.campaign;
  const other = otherPerformer(c.performedBy);
  const target = outcomeName(catalogue, c.target);
  const targetPlural = outcomePluralName(catalogue, c.target);
  const proactive = c.start === START;
  const targetIcon = catalogue?.outcomes.find((o) => o.id === c.target)?.icon;
  // The milestones its Plan passes through, then every outcome counted off them.
  const line = c.line.length > 0 ? c.line : d.milestones.length > 0 ? d.milestones.map((s) => s.to) : Object.keys(c.counts);
  const flows: FlowView[] = d.flows.map((f) => ({ from: f.from, fromLabel: outcomeName(catalogue, f.from), to: f.to, toLabel: outcomeName(catalogue, f.to), subjects: f.subjects, by: f.by.map((b) => ({ name: b.name, subjects: b.subjects, share: b.share })) }));
  const verdicts = Object.entries(c.verdicts ?? {});
  const caps = Object.entries(c.caps ?? {});
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Mark kind="outcome" id={c.target} icon={targetIcon} size={40} />
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]" data-testid="campaign-goal">
              Goal: {targetPlural} for {d.brand.name}
            </h1>
            <p className="k-fg2 mt-0.5 text-[13px]">
              {c.name}
              {d.brand.test && <span className="k-chip ml-2">Staff test</span>}
            </p>
            <p className="k-fg3 mt-0.5 text-[12px]">
              {other
                ? `Performed by ${other} since ${formatTime(c.launchedAt ?? c.createdAt)} · read ${timeAgo(c.lastTickAt)}`
                : `${c.launchedAt ? `Launched ${formatTime(c.launchedAt)}` : "Never launched"} · last tick ${timeAgo(c.lastTickAt)}${c.endsAt ? ` · ends ${formatTime(c.endsAt)}` : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <CampaignStatusButton campaign={c} />
          <BudgetButton campaign={c} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="campaign-order">
        <StatTile label={proactive ? "Proactive" : "Reactive"} note={other ? `Performed by ${other}` : proactive ? `Pulls on ${target} at each tick, down its Plan` : "Pushes each Unit that lands up its Plan"}>
          <Figure value={outcomeName(catalogue, c.start)} />
        </StatTile>
        <StatTile label="Daily budget" note={c.volume ? `At most ${formatCount(c.volume.units)} new subjects per ${plural(c.volume.periodDays, "day", "days")}` : "No volume limit"}>
          <Figure value={formatCents(c.dailyBudgetCents)} />
        </StatTile>
        <StatTile label="Today against the cap">
          <CapBar campaign={c} />
        </StatTile>
      </div>

      <div className="k-card mb-3 px-4 py-3" data-testid="campaign-brief">
        <p className="k-label mb-1">Strategy</p>
        <p className="text-[14px] leading-5">{c.brief ? c.brief : <span className="k-fg3">No brief: every script of every Engine may run.</span>}</p>
        {(verdicts.length > 0 || caps.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
            {verdicts.map(([engine, strategy]) => (
              <span key={engine} className="k-chip">
                {engineTitle(catalogue, engine)}: {strategy === "none" ? "not used" : strategyName(catalogue, strategy)}
              </span>
            ))}
            {caps.map(([engine, n]) => (
              <span key={`cap:${engine}`} className="k-chip tabular-nums">
                {engineTitle(catalogue, engine)}: at most {formatCount(n)} a day
              </span>
            ))}
          </div>
        )}
      </div>

      <section className="mb-6">
        <SectionTitle right={<span>Last 7 days, by the script that got them there</span>}>What its people went through</SectionTitle>
        <Flows flows={flows} unit="people" />
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StatTile label="Spent in total">
          <Figure value={formatCents(c.spentTotalCents)} />
        </StatTile>
        <StatTile label="Spend by day" note={d.spendByDay.length > 0 ? `${d.spendByDay.length} days` : undefined}>
          {d.spendByDay.length > 0 ? <BarSpark values={d.spendByDay.map((x) => x.cents)} className="h-10" /> : <span className="k-fg4">—</span>}
          <ChartNote>What this campaign spent each day.</ChartNote>
        </StatTile>
      </div>

      <section className="mt-8">
        <SectionTitle>Units reached</SectionTitle>
        <CountsAlong catalogue={catalogue} line={line} counts={c.counts} />
        <OtherCounts catalogue={catalogue} line={line} counts={c.counts} />
      </section>

      {d.milestones.length > 0 && (
        <section className="mt-8">
          <SectionTitle count={d.milestones.length}>Milestones</SectionTitle>
          <CardTable note="What one result costs at each milestone, and how many attempts it takes.">
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Milestone</th>
                <th className={`${TH} text-right`}>Cost of this outcome</th>
                <th className={`${TH} text-right`}>Cost from Start</th>
                <th className={`${TH} text-right`}>% conversion</th>
                <th className={`${TH} text-right`}>Attempts per {target}</th>
              </tr>
            </thead>
            <tbody>
              {d.milestones.map((s) => (
                <tr key={`${s.from}>${s.to}`} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1.5 text-[12px]">
                      <OutcomeTag catalogue={catalogue} id={s.from} />
                      <span className="k-fg4">→</span>
                      <OutcomeTag catalogue={catalogue} id={s.to} />
                      {s.label === "expected" && <span className="k-chip ml-1">Learning</span>}
                    </span>
                  </td>
                  <td className={TDN}>{formatCents(s.costOfOutcomeCents)}</td>
                  <td className={TDN}>
                    <span className="font-medium">{formatCents(s.costFromStartCents)}</span>
                  </td>
                  <td className={TDN}>{formatRatePct(s.yieldRate)}</td>
                  <td className={TDN}>{Number.isFinite(s.attemptsPerTarget) ? formatCount(s.attemptsPerTarget) : <span className="k-fg4">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
          <p className="k-fg3 mt-2 text-[12px]">Cost from Start adds every milestone before it: the return reads it.</p>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle right={<span>Recomputed at every tick; what ran over the last 7 days</span>}>Plan</SectionTitle>
        <PlanTree root={d.plan ? treeOf(catalogue, d.plan) : null} start={c.start} startLabel={outcomeName(catalogue, c.start)} target={c.target} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.candidates.length}>Scripts per Engine</SectionTitle>
        <PointsList points={d.candidates} catalogue={catalogue} empty={other ? `No pick read from ${other} yet.` : "No pick made yet. Launch the campaign and the first tick makes them."} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.recentPicks.length}>Why each one was picked</SectionTitle>
        <PicksTable picks={d.recentPicks} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.recentRuns.length}>Recent runs</SectionTitle>
        <RunsTable runs={d.recentRuns} catalogue={catalogue} />
      </section>

      <p className="mt-6 text-[13px]">
        <Link href={`/leads/?campaign=${encodeURIComponent(c.id)}`} className="k-accent">
          See the people this campaign reached
        </Link>
      </p>
    </>
  );
}

function strategyName(catalogue: CatalogueData | undefined, id: string): string {
  return catalogue?.strategies.find((s) => s.id === id)?.name ?? id;
}

function OutcomeTag({ catalogue, id }: { catalogue: CatalogueData | undefined; id: string }) {
  const o = catalogue?.outcomes.find((x) => x.id === id);
  return (
    <span className="inline-flex items-center gap-1">
      {id === START ? <Mark kind="start" id="start" size={14} quiet /> : <Mark kind="outcome" id={id} icon={o?.icon} size={14} />}
      <span className="k-fg2">{outcomeName(catalogue, id)}</span>
    </span>
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
