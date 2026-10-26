"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { START, defaultStrategyId, describeCondition, type Campaign, type Pipe } from "@gtm-factory/engine";
import { FunnelLine, FunnelName, OutcomeChip } from "@/components/funnel-line";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, RoiLabel, SectionTitle, StateDot, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton, WhyFeed } from "./today";
import { campaignLegs, legEndOfPoints, playedPipes } from "@/lib/campaigns";
import { outcomeLabel, pipeLine, pointsOf, scopedCampaigns, targetOf, type Model, type PointRow } from "@/lib/model";
import { formatCents, formatCount, formatRatePct, formatRoi, formatUsd, plural, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

export const campaignHref = (id: string) => `/campaigns/view/?id=${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function CampaignsPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns" }]} />
      <Page>{model ? <CampaignList model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

function CampaignList({ model, scope }: { model: Model; scope: string | null }) {
  const campaigns = scopedCampaigns(model, scope);
  const running = campaigns.filter((c) => c.status === "running").length;
  const reactive = campaigns.filter((c) => c.start !== START).length;
  return (
    <>
      <PageHeader
        title={`${running} of ${plural(campaigns.length, "campaign", "campaigns")} running`}
        sub={`A campaign orders production: a target, a daily budget and a start outcome. Started from the market it pulls on its target each tick; ${plural(reactive, "campaign starts", "campaigns start")} from an outcome and pushes each of its Units.`}
        right={
          <Link href="/campaigns/new/" className="k-btn-strong">
            New campaign
          </Link>
        }
      />
      <CardTable footer={<>Expected return uses the same formula as the measured one, on today&apos;s estimates. Measured counts subjects old enough for their outcomes to land.</>}>
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Campaign</th>
            <th className={TH}>Start</th>
            <th className={TH}>Target</th>
            <th className={`${TH} text-right`}>
              <RoiLabel>Expected ROI</RoiLabel>
            </th>
            <th className={`${TH} text-right`}>
              <RoiLabel>Measured ROI</RoiLabel>
            </th>
            <th className={`${TH} text-right`}>$ Spent</th>
            <th className={`${TH} text-right`}>Value: our runs</th>
            <th className={`${TH} text-right`}>Other factories</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <CampaignRow key={c.id} model={model} campaign={c} />
          ))}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={9}>
                <EmptyNote>No campaign yet. Start one with New campaign.</EmptyNote>
              </td>
            </tr>
          )}
        </tbody>
      </CardTable>
    </>
  );
}

function CampaignRow({ model, campaign }: { model: Model; campaign: Campaign }) {
  const e = model.session.economics(campaign.id);
  const brand = model.clients.find((x) => x.brand.id === campaign.brandId)?.brand.name;
  return (
    <tr className="k-row k-line-subtle border-b last:border-b-0">
      <td className={`${TD} max-w-[460px]`}>
        <Link href={campaignHref(campaign.id)} className="flex min-w-0 items-start gap-2.5">
          <Mark kind="funnel" id={campaign.id} size={34} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{campaign.name}</span>
            <span className="k-fg3 block truncate text-[12px]">{brand}</span>
            <span className="mt-0.5 block">
              <FunnelLine model={model} campaign={campaign} />
            </span>
          </span>
        </Link>
      </td>
      <td className={TD}>
        <span className="k-fg2 whitespace-nowrap text-[12px]">{campaign.start === START ? "Start: pulls" : `${outcomeLabel(model.catalogue, campaign.start)}: pushes`}</span>
      </td>
      <td className={TD}>
        <span className="k-fg2 whitespace-nowrap text-[12px]">{outcomeLabel(model.catalogue, targetOf(campaign))}</span>
      </td>
      <td className={TDN}>
        <RoiWithRange value={e.expected.value} low={e.expected.low} high={e.expected.high} />
      </td>
      <td className={TDN}>
        {e.measured.value != null ? (
          <span className="whitespace-nowrap">
            <span className={roiIsGood(e.measured.value) ? "text-[var(--run)]" : ""}>{formatRoi(e.measured.value)}</span>
            <span className="k-fg3 ml-1 text-[11px]">{plural(e.measured.targets, "outcome", "outcomes")}</span>
          </span>
        ) : (
          <span className="k-fg3 text-[12px]">Not mature yet</span>
        )}
      </td>
      <td className={TDN}>{formatCents(e.spendCents)}</td>
      <td className={TDN}>{formatUsd(e.valueOurs)}</td>
      <td className={`${TDN} k-fg2`}>{e.valueOther > 0 ? formatUsd(e.valueOther) : <span className="k-fg4">—</span>}</td>
      <td className={TD}>
        <span className="flex flex-col gap-0.5">
          <StateDot running={campaign.status === "running"} />
          <span className="k-fg3 whitespace-nowrap text-[12px] tabular-nums">{formatCents(campaign.dailyBudgetCents)}/day</span>
        </span>
      </td>
    </tr>
  );
}

function RoiWithRange({ value, low, high }: { value: number | null; low: number | null; high: number | null }) {
  if (value == null) return <span className="k-fg4">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className={roiIsGood(value) ? "text-[var(--run)]" : ""}>{formatRoi(value)}</span>
      {low != null && high != null && (
        <span className="k-fg3 ml-1 text-[11px]">
          {formatRoi(low)} to {formatRoi(high)}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One campaign
// ---------------------------------------------------------------------------

export function CampaignPage() {
  const { model } = useSim();
  const id = useSearchParams().get("id") ?? "";
  const campaign = model?.campaigns.find((c) => c.id === id) ?? null;
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: campaign?.name ?? "Campaign" }]} />
      <Page>{model ? campaign ? <CampaignView model={model} campaign={campaign} /> : <EmptyNote>This campaign does not exist in this world. Pick one in the sidebar.</EmptyNote> : <PageSkeleton />}</Page>
    </>
  );
}

function CampaignView({ model, campaign }: { model: Model; campaign: Campaign }) {
  const e = model.session.economics(campaign.id);
  const legs = campaignLegs(model, campaign);
  const points = pointsOf(model, campaign);
  const brand = model.clients.find((x) => x.brand.id === campaign.brandId)?.brand.name;
  const target = targetOf(campaign);
  const proactive = campaign.start === START;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <Mark kind="funnel" id={campaign.id} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-medium leading-8 tracking-[-0.02em]">{campaign.name}</h1>
          <p className="k-fg2 text-[13px]">
            {brand} · {outcomeLabel(model.catalogue, target)} worth {formatUsd(e.targetValue)}
            {e.valueLabel === "expected" ? " (fleet median, the client stated none)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusControl model={model} campaign={campaign} />
          <BudgetControl campaign={campaign} />
        </div>
      </div>

      <div className="k-card mb-6 grid grid-cols-1 divide-y divide-[var(--line-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="campaign-order">
        <Kpi label="Start outcome">
          <span className="flex flex-col gap-1">
            <OutcomeChip model={model} outcome={campaign.start} size={16} />
            <span className="k-fg3 text-[12px] font-normal">{proactive ? "Proactive: pulls on its target at each tick" : "Reactive: pushes each Unit that lands into its first pipe"}</span>
          </span>
        </Kpi>
        <Kpi label="Target">
          <span className="flex flex-col gap-1">
            <OutcomeChip model={model} outcome={target} size={16} />
            <span className="k-fg3 text-[12px] font-normal">Worth {formatUsd(e.targetValue)} each</span>
          </span>
        </Kpi>
        <Kpi label="Daily budget">
          <span className="flex flex-col gap-1">
            <span>{formatCents(campaign.dailyBudgetCents)}</span>
            <span className="k-fg3 text-[12px] font-normal">{campaign.volume ? `At most ${formatCount(campaign.volume.units)} new subjects per ${plural(campaign.volume.periodDays, "day", "days")}` : "No volume limit"}</span>
          </span>
        </Kpi>
      </div>

      <div className="k-card mb-6 px-4 py-3">
        <p className="k-label mb-1.5">Sales funnel</p>
        <p className="mb-1.5">
          <FunnelName model={model} campaign={campaign} />
        </p>
        <FunnelLine model={model} campaign={campaign} size="md" />
      </div>

      <div className="k-card mb-6 grid grid-cols-2 divide-x divide-[var(--line-subtle)] md:grid-cols-4">
        <Kpi label={<RoiLabel>Expected ROI</RoiLabel>}>
          <RoiWithRange value={e.expected.value} low={e.expected.low} high={e.expected.high} />
        </Kpi>
        <Kpi label={<RoiLabel>Measured ROI</RoiLabel>}>
          {e.measured.value != null ? (
            <span>
              <RoiWithRange value={e.measured.value} low={e.measured.low} high={e.measured.high} />
            </span>
          ) : (
            <span className="k-fg3 text-[13px]">Not mature yet</span>
          )}
        </Kpi>
        <Kpi label="Spent by our runs">
          <span>{formatCents(e.spendCents)}</span>
        </Kpi>
        <Kpi label="Value won">
          <span>
            {formatUsd(e.valueOurs)}
            {e.valueOther > 0 && <span className="k-fg3 ml-1 text-[12px]">+{formatUsd(e.valueOther)} other factories</span>}
          </span>
        </Kpi>
      </div>
      <p className="k-fg3 -mt-4 mb-6 text-[12px]">
        Both returns use one formula: value of a {outcomeLabel(model.catalogue, target).toLowerCase()} over the cost per {outcomeLabel(model.catalogue, target).toLowerCase()}. Measured reads subjects that entered before day {Math.max(0, e.measured.cutoffDay)} ({plural(e.measured.targets, "outcome", "outcomes")}); expected reads every leg on today&apos;s estimates.
      </p>

      <section className="mb-8">
        <SectionTitle count={legs.length}>Legs</SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Leg</th>
              <th className={`${TH} text-right`}>$/outcome</th>
              <th className={`${TH} text-right`}>% conversion</th>
              <th className={`${TH} text-right`}># outcomes</th>
              <th className={`${TH} text-right`}>Attempts</th>
              <th className={`${TH} text-right`}>$ per attempt</th>
              <th className={`${TH} text-right`}>Leads needed</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l) => (
              <tr key={`${l.from}>${l.to}`} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={TD}>
                  <span className="inline-flex items-center gap-1.5 text-[12px]">
                    <OutcomeChip model={model} outcome={l.from} />
                    <span className="k-fg4">→</span>
                    <OutcomeChip model={model} outcome={l.to} />
                    {l.label === "expected" && <span className="k-chip ml-1">Learning</span>}
                  </span>
                </td>
                <td className={TDN}>{l.costPerAttempt != null && l.yieldRate ? formatUsd(l.costPerAttempt / l.yieldRate) : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{formatRatePct(l.yieldRate)}</td>
                <td className={TDN}>{formatCount(l.reached)}</td>
                <td className={TDN}>{formatCount(l.attempts)}</td>
                <td className={TDN}>{l.costPerAttempt != null ? formatUsd(l.costPerAttempt) : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{l.leadsNeeded != null && Number.isFinite(l.leadsNeeded) ? formatCount(l.leadsNeeded) : <span className="k-fg4">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
        <p className="k-fg3 mt-2 text-[12px]">Conversion is corrected for outcomes still on their way. Leads needed: attempts this leg makes per {outcomeLabel(model.catalogue, target).toLowerCase()}.</p>
      </section>

      <Plays model={model} campaign={campaign} />

      <section className="mb-8">
        <SectionTitle count={points.length} right={<span>In the order they are made for each subject</span>}>
          Choices at each Material
        </SectionTitle>
        {points.length === 0 ? (
          <div className="k-card">
            <EmptyNote>No choice yet. Press play.</EmptyNote>
          </div>
        ) : (
          <div className="space-y-3">
            {points.map((p) => (
              <PointCard key={p.info.key} model={model} campaign={campaign} point={p} />
            ))}
          </div>
        )}
      </section>

      {!proactive && <PushFeed model={model} campaign={campaign} />}

      <div className="mt-8">
        <WhyFeed model={model} campaignIds={new Set([campaign.id])} limit={10} />
      </div>
    </>
  );
}

function Kpi({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="k-label">{label}</p>
      <div className="mt-1 text-[22px] font-medium leading-7 tracking-[-0.02em] tabular-nums">{children}</div>
    </div>
  );
}

/** The changeable status: dot + word in a button, a menu with the other state. */
function StatusControl({ model, campaign }: { model: Model; campaign: Campaign }) {
  const { dispatch } = useSim();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const running = campaign.status === "running";
  void model;
  return (
    <>
      <button ref={btn} type="button" className="k-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <StateDot running={running} />
        <CaretDownIcon size={11} className="k-fg3" />
      </button>
      {open && (
        <FixedMenu anchor={btn.current} onClose={() => setOpen(false)}>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
            onClick={() => {
              dispatch({ type: "status", campaignId: campaign.id, status: running ? "paused" : "running" });
              setOpen(false);
            }}
          >
            <StateDot running={!running} />
          </button>
        </FixedMenu>
      )}
    </>
  );
}

/** The budget: "$30/day" in a button, a modal to change it. */
function BudgetControl({ campaign }: { campaign: Campaign }) {
  const { dispatch } = useSim();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(campaign.dailyBudgetCents / 100));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(String(campaign.dailyBudgetCents / 100)), [campaign.dailyBudgetCents]);
  return (
    <>
      <button type="button" className="k-btn tabular-nums" onClick={() => setOpen(true)}>

        {formatCents(campaign.dailyBudgetCents)}/day
        <CaretDownIcon size={11} className="k-fg3" />
      </button>
      {open && (
        <Modal title="Daily budget" onClose={() => setOpen(false)}>
          <p className="k-fg2 mb-3 text-[13px]">What this campaign may spend per day on our runs.</p>
          <label className="k-input flex items-center gap-1 px-2">
            <span className="k-fg3">$</span>
            <input aria-label="Dollars per day" value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))} className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} />
            <span className="k-fg3">/day</span>
          </label>
          {error && <p className="mt-2 text-[12px] text-[var(--data-rose)]">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="k-btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="k-btn-strong"
              onClick={() => {
                const err = dispatch({ type: "budget", campaignId: campaign.id, dailyBudgetCents: Math.round(Number(text || 0) * 100) });
                setError(err);
                if (!err) setOpen(false);
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function FixedMenu({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" onClick={onClose}>
      <div className="k-popover fixed w-[180px] p-1" style={{ top: r.bottom + 4, left: Math.max(8, r.right - 180) }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    host,
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host) return null;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#10101224" }} onClick={onClose}>
      <div className="k-popover w-[min(380px,calc(100vw-16px))] p-4" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="k-label mb-3">{title}</p>
        {children}
      </div>
    </div>,
    host,
  );
}

/** The pipes a campaign plays and the strategy it chose on each (its default otherwise). */
function Plays({ model, campaign }: { model: Model; campaign: Campaign }) {
  const pipes = playedPipes(model, campaign);
  return (
    <section className="mb-8">
      <SectionTitle count={pipes.length} right={<span>Every pipe of the funnel line, each with its strategy.</span>}>
        Plays
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {pipes.map((p) => (
          <PlayCard key={p.id} model={model} campaign={campaign} pipe={p} />
        ))}
      </div>
    </section>
  );
}

function PlayCard({ model, campaign, pipe }: { model: Model; campaign: Campaign; pipe: Pipe }) {
  const { dispatch } = useSim();
  const strategies = model.catalogue.strategiesOf(pipe.id);
  const chosen = model.session.strategyOf(campaign, pipe.id);
  const [error, setError] = useState<string | null>(null);
  const isDefault = !chosen || chosen.id === defaultStrategyId(pipe.id);
  return (
    <div className="k-card p-4">
      <div className="flex items-start gap-2.5">
        <Mark kind="pipe" id={pipe.id} icon={pipe.icon} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{pipe.name}</p>
          <p className="k-fg3 truncate text-[12px]">{pipeLine(model.catalogue, pipe)}</p>
        </div>
        {!isDefault && <span className="k-chip">Chosen</span>}
      </div>
      <label className="mt-3 flex items-center gap-2">
        <span className="k-label shrink-0">Strategy</span>
        <select
          className="k-input min-w-0 flex-1 px-1.5"
          style={{ font: "inherit" }}
          value={chosen?.id ?? defaultStrategyId(pipe.id)}
          onChange={(e) => setError(dispatch({ type: "strategy", campaignId: campaign.id, pipeId: pipe.id, strategyId: e.target.value }))}
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === defaultStrategyId(pipe.id) ? "Default: every script" : s.name}
              {s.proposed ? " (proposed by a split)" : ""}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="mt-1 text-[12px] text-[var(--data-rose)]">{error}</p>}
      <div className="mt-2 space-y-1">
        {chosen && (chosen.rules.length > 0 || (chosen.subject?.length ?? 0) > 0) ? (
          <>
            {chosen.rules.map((r, i) => (
              <p key={i} className="text-[12px]">
                <span className="k-fg3">{r.material ? `At ${outcomeLabel(model.catalogue, r.material).toLowerCase()}: ` : "Its own scripts: "}</span>
                {r.conditions.map((c) => describeCondition(c, model.catalogue)).join(", ")}
              </p>
            ))}
            {(chosen.subject ?? []).length > 0 && (
              <p className="text-[12px]">
                <span className="k-fg3">Serves: </span>
                {chosen.subject!.map((c) => describeCondition(c, model.catalogue)).join(", ")}
              </p>
            )}
            {chosen.proposed && <p className="k-fg3 text-[12px]">Proposed by a split on day {chosen.proposed.day}: {chosen.proposed.reason}.</p>}
          </>
        ) : (
          <p className="k-fg3 text-[12px]">No condition: every script competes at every Material.</p>
        )}
      </div>
    </div>
  );
}

/** One choice point: its options, their share of picks, the engine's belief, the hidden best. */
function PointCard({ model, campaign, point }: { model: Model; campaign: Campaign; point: PointRow }) {
  const legEnd = legEndOfPoints(model, campaign).get(point.info.key) ?? targetOf(campaign);
  const sorted = useMemo(() => [...point.options].sort((a, b) => b.share - a.share || b.valuePerDollar - a.valuePerDollar), [point.options]);
  return (
    <div className="k-card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <Mark kind="point" id={point.info.key} size={22} />
          <Link href={`/research/?point=${encodeURIComponent(point.info.key)}`} className="truncate text-[14px] font-medium hover:underline">
            {point.info.title}
          </Link>
          <span className="k-fg3 truncate text-[12px]">{point.info.sub}</span>
        </div>
        <span className="k-fg3 text-[12px]">
          {plural(point.picks, "pick", "picks")} · scored on {outcomeLabel(model.catalogue, legEnd).toLowerCase()}, through traceability
        </span>
      </div>
      <div className="k-scroll overflow-x-auto">
        <table className="mt-2 w-full border-collapse text-[13px]">
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Option</th>
              <th className={`${TH} text-right`}>Share, 7 days</th>
              <th className={`${TH} text-right`}>Value per $1</th>
              <th className={`${TH} text-right`}>$ from here</th>
              <th className={`${TH} text-right`}>% reach the end</th>
              <th className={TH}>Hidden truth</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.option} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{o.label}</span>
                    {o.isBelievedBest && <span className="k-chip">Best expected</span>}
                  </span>
                </td>
                <td className={TDN}>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--data-track)]">
                      <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(o.share * 100)}%` }} />
                    </span>
                    {formatRatePct(o.share)}
                  </span>
                </td>
                <td className={TDN}>{formatUsd(o.valuePerDollar)}</td>
                <td className={TDN}>{formatUsd(o.cost)}</td>
                <td className={TDN}>
                  {formatRatePct(o.rate)}
                  <span className="k-fg3 ml-1 text-[11px]">± {formatRatePct(o.rateSd)}</span>
                </td>
                <td className={TD}>
                  {o.isHiddenBest ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-[var(--run)]">
                      <CheckIcon size={12} weight="bold" />
                      Hidden best
                    </span>
                  ) : o.truth ? (
                    <span className="k-fg3 text-[12px] tabular-nums">{formatRatePct(o.truth.rate)} true rate</span>
                  ) : (
                    <span className="k-fg4">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The Units a reactive campaign pushed into its first pipe, newest first. */
function PushFeed({ model, campaign }: { model: Model; campaign: Campaign }) {
  const pushes = model.session.pushes.filter((p) => p.campaignId === campaign.id);
  const recent = pushes.slice(-8).reverse();
  const start = outcomeLabel(model.catalogue, campaign.start).toLowerCase();
  return (
    <section className="mb-8">
      <SectionTitle count={pushes.length}>Units pushed</SectionTitle>
      <div className="k-card p-4">
        <p className="k-fg2 mb-3 text-[13px]">
          Each {start} that lands for this brand goes into the campaign&apos;s first pipe, as far as the daily budget allows. The scripts decide when to run: a follow-up waits its days since the last message.
        </p>
        {recent.length === 0 ? (
          <p className="k-fg3 text-[13px]">Nothing pushed yet. Press play.</p>
        ) : (
          <div className="divide-y divide-[var(--line-subtle)]">
            {recent.map((p) => (
              <Link key={p.unitId} href={`/leads/view/?id=${encodeURIComponent(p.subject)}`} className="k-hover flex items-center gap-3 py-2">
                <Mark kind="outcome" id={campaign.start} icon={model.catalogue.outcome(campaign.start)?.icon} size={20} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.subject}</span>
                <span className="k-mono k-fg3 text-[12px]">Day {p.day}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

