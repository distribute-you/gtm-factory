"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Catalogue, START, describeCondition, type ApiCampaign, type ApiCampaignDetail, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { BarSpark, CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { outcomeName, legTitle } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, plural } from "@/lib/format";
import { BudgetButton, CampaignStatusButton, CapBar, ChoicesTable, CountsAlong, PointsList, Read, RunsTable, formatTime, timeAgo, useOtherFactory } from "./common";

export function ApiCampaignsPage() {
  const read = useApi<ApiCampaign[]>("/campaigns");
  const { data: o } = useFactory();
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
              <PageHeader title={plural(campaigns.length, "campaign", "campaigns")} sub={`${formatCount(live)} live. Each campaign orders a Target for one brand under a daily cap; its tree is rebuilt at every tick.`} />
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
  const other = useOtherFactory(c.factory);
  const target = outcomeName(catalogue, c.target);
  const proactive = c.start === START;
  const targetIcon = catalogue?.outcomes.find((o) => o.id === c.target)?.icon;
  // The lead states of the tree, start first, then every outcome counted off them.
  const line = d.steps.length > 0 ? d.steps.map((s) => s.to) : Object.keys(c.counts);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Mark kind="outcome" id={c.target} icon={targetIcon} size={40} />
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]" data-testid="campaign-goal">
              Goal: {target}
            </h1>
            <p className="k-fg2 mt-0.5 text-[13px]">
              {c.name} · {d.brand.name}
              {d.brand.test && <span className="k-chip ml-2">Staff test</span>}
            </p>
            <p className="k-fg3 mt-0.5 text-[12px]">
              {other
                ? `Run by ${other} since ${formatTime(c.launchedAt ?? c.createdAt)} · read ${timeAgo(c.lastTickAt)}`
                : `${c.launchedAt ? `Launched ${formatTime(c.launchedAt)}` : "Never launched"} · last tick ${timeAgo(c.lastTickAt)}`}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <CampaignStatusButton campaign={c} />
          <BudgetButton campaign={c} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="campaign-order">
        <StatTile label={proactive ? "Proactive" : "Reactive"} note={other ? `Run by ${other}` : proactive ? `Pulls on ${target.toLowerCase()} at each tick, down its tree` : "Pushes each Unit that lands up its tree"}>
          <Figure value={outcomeName(catalogue, c.start)} />
        </StatTile>
        <StatTile label="Strategy" note="The tree is rebuilt at every tick from performance">
          <span className="text-[14px] leading-5">{(c.conditions ?? []).length > 0 ? c.conditions.map((x) => describeCondition(x, catalogue ? new Catalogue(catalogue) : undefined)).join(", ") : "Every channel"}</span>
        </StatTile>
        <StatTile label="Daily budget" note={c.volume ? `At most ${formatCount(c.volume.units)} new subjects per ${plural(c.volume.periodDays, "day", "days")}` : "No volume limit"}>
          <Figure value={formatCents(c.dailyBudgetCents)} />
        </StatTile>
      </div>

      <div className="k-card mb-3 px-4 py-3" data-testid="campaign-views">
        <span className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="flex min-w-0 items-center gap-1.5">
            <Mark kind="funnel" id={c.salesFunnel?.id ?? c.id} size={16} />
            <span className="k-fg3 shrink-0">Sales funnel:</span>
            <span className="truncate font-medium">{c.salesFunnel?.name ?? "Not run yet"}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Mark kind="path" id={c.salesPath?.id ?? c.id} size={16} />
            <span className="k-fg3 shrink-0">Sales path:</span>
            <span className="truncate font-medium">{c.salesPath?.name ?? "Not run yet"}</span>
          </span>
        </span>
        {d.steps.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px]">
            <OutcomeTag catalogue={catalogue} id={c.start} />
            {d.steps.map((s) => (
              <span key={`${s.from}>${s.to}`} className="inline-flex flex-wrap items-center gap-1.5">
                {s.legs.map((legId) => (
                  <span key={legId} className="inline-flex items-center gap-1.5">
                    <span className="k-fg4">→</span>
                    <LegTag catalogue={catalogue} legId={legId} stepLegs={s.legs} />
                  </span>
                ))}
                <span className="k-fg4">→</span>
                <OutcomeTag catalogue={catalogue} id={s.to} />
              </span>
            ))}
          </div>
        )}
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
        <SectionTitle>Units reached</SectionTitle>
        <CountsAlong catalogue={catalogue} line={line} counts={c.counts} />
        <OtherCounts catalogue={catalogue} line={line} counts={c.counts} />
      </section>

      {d.steps.length > 0 && (
        <section className="mt-8">
          <SectionTitle count={d.steps.length}>Steps of the sales path</SectionTitle>
          <CardTable>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={TH}>Step</th>
                <th className={`${TH} text-right`}>Cost of this step per outcome</th>
                <th className={`${TH} text-right`}>Cost from Start</th>
                <th className={`${TH} text-right`}>% conversion</th>
                <th className={`${TH} text-right`}>Attempts per {target}</th>
              </tr>
            </thead>
            <tbody>
              {d.steps.map((s) => (
                <tr key={`${s.from}>${s.to}`} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>
                    <span className="inline-flex items-center gap-1.5 text-[12px]">
                      <OutcomeTag catalogue={catalogue} id={s.from} />
                      <span className="k-fg4">→</span>
                      <OutcomeTag catalogue={catalogue} id={s.to} />
                      {s.label === "expected" && <span className="k-chip ml-1">Learning</span>}
                    </span>
                  </td>
                  <td className={TDN}>{formatCents(s.costOfStepCents)}</td>
                  <td className={TDN}>
                    <span className="font-medium">{formatCents(s.costFromStartCents)}</span>
                  </td>
                  <td className={TDN}>{formatRatePct(s.yieldRate)}</td>
                  <td className={TDN}>{Number.isFinite(s.attemptsPerTarget) ? formatCount(s.attemptsPerTarget) : <span className="k-fg4">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
          <p className="k-fg3 mt-2 text-[12px]">Cost from Start adds every step before it: it is the one the return reads.</p>
        </section>
      )}

      <section className="mt-8">
        <SectionTitle count={d.tree.length} right={<span>Last 7 days, every Unit this campaign made</span>}>
          Production tree
        </SectionTitle>
        <div className="k-card divide-y divide-[var(--line-subtle)]" data-testid="production-tree">
          {d.tree.length === 0 && <EmptyNote>Nothing made yet.</EmptyNote>}
          {d.tree.map((t) => (
            <div key={t.outcome} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
              <span className="w-[200px] shrink-0">
                <OutcomeTag catalogue={catalogue} id={t.outcome} />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
                {t.branches.map((b) => (
                  <span key={b.legId} className="inline-flex items-center gap-1.5 tabular-nums">
                    <span className="font-medium">{formatRatePct(b.share)}</span>
                    <span className="k-fg3">via</span>
                    <Mark kind="leg" id={b.legId} icon={catalogue?.legs.find((l) => l.id === b.legId)?.icon} size={14} />
                    <span>{legTitle(catalogue, b.legId)}</span>
                    <span className="k-fg3">at {b.costPerUnitCents != null ? formatCents(b.costPerUnitCents) : "—"}</span>
                  </span>
                ))}
              </span>
              <span className="k-fg3 shrink-0 text-[12px] tabular-nums">{plural(t.units, "Unit", "Units")}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle count={d.points.length}>Choices</SectionTitle>
        <PointsList points={d.points} catalogue={catalogue} empty={other ? `No choice read from ${other} yet.` : "No choice made yet. Launch the campaign and the first tick makes them."} />
      </section>

      <section className="mt-8">
        <SectionTitle count={d.recentChoices.length}>Why each choice was made</SectionTitle>
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

function OutcomeTag({ catalogue, id }: { catalogue: CatalogueData | undefined; id: string }) {
  const o = catalogue?.outcomes.find((x) => x.id === id);
  return (
    <span className="inline-flex items-center gap-1">
      {id === START ? <Mark kind="start" id="start" size={14} quiet /> : <Mark kind="outcome" id={id} icon={o?.icon} size={14} />}
      <span className="k-fg2">{outcomeName(catalogue, id)}</span>
    </span>
  );
}

/** A leg of the line, with its "<n> materials" badge: the Bill of materials of its script, each Material with the leg that supplies it. */
function LegTag({ catalogue, legId, stepLegs }: { catalogue: CatalogueData | undefined; legId: string; stepLegs: string[] }) {
  const [open, setOpen] = useState(false);
  const leg = catalogue?.legs.find((l) => l.id === legId);
  const script = catalogue?.scripts.find((s) => s.legId === legId && s.status === "active");
  const materials = script?.materials ?? [];
  const supplier = (m: string) => stepLegs.map((id) => catalogue?.legs.find((l) => l.id === id)).find((l) => l?.output === m) ?? null;
  return (
    <span className="relative inline-flex items-center gap-1">
      <Mark kind="leg" id={legId} icon={leg?.icon} size={14} />
      <span>{leg?.name ?? legTitle(catalogue, legId)}</span>
      {materials.length > 0 && (
        <button type="button" className="k-chip ml-0.5 cursor-pointer text-[11px]" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {plural(materials.length, "material", "materials")}
        </button>
      )}
      {open && (
        <span className="k-popover absolute left-0 top-full z-20 mt-1 block w-[340px] p-3" role="dialog" aria-label="Bill of materials">
          <span className="k-label mb-1 block">Bill of materials</span>
          <span className="mb-2 flex items-center gap-1.5 text-[13px]">
            <Mark kind="script" id={script?.dynasty ?? legId} size={16} />
            <span className="truncate font-medium">{script?.name}</span>
          </span>
          {materials.map((m) => {
            const from = supplier(m.outcome);
            const o = catalogue?.outcomes.find((x) => x.id === m.outcome);
            return (
              <span key={m.outcome} className="flex items-center gap-2 py-1 text-[12px]">
                <Mark kind="material" id={m.outcome} icon={o?.icon} size={16} />
                <span className="min-w-0 flex-1 truncate">{outcomeName(catalogue, m.outcome)}</span>
                <span className="k-fg3 inline-flex shrink-0 items-center gap-1">
                  {from ? (
                    <>
                      from <Mark kind="leg" id={from.id} icon={from.icon} size={14} />
                      <span className="k-fg2">{from.name}</span>
                    </>
                  ) : o?.track ? (
                    "the step it starts from"
                  ) : (
                    "the stock"
                  )}
                </span>
              </span>
            );
          })}
        </span>
      )}
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
