"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CaretDownIcon, CaretRightIcon, LightningIcon, CalendarCheckIcon } from "@phosphor-icons/react";
import type { SimClient } from "@gtm-factory/engine";
import { FunnelLine } from "@/components/funnel-line";
import { Mark } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Meter, Page, PageHeader, RoiLabel, RoiValue, SectionTitle, StateDot, TD, TDN, TH, Tabs, TopBar } from "@/components/ui";
import { CostPerOutcomeCard, PageSkeleton, ReturnCard, WhyFeed } from "./today";
import {
  costPerOutcome,
  explainChoice,
  expectedRoi,
  flashMature,
  funnelName,
  latestChoice,
  nodeLabel,
  optionLabel,
  optionOfRun,
  pickShares,
  playPipe,
  rate,
  runsOf,
  scopeFigures,
  scopedClients,
  stepLabel,
  stepValues,
  targetState,
  valueOf,
  type Model,
  type Tally,
} from "@/lib/model";
import { formatCents, formatCount, formatRatePct, formatRoi, formatUsd, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function campaignHref(id: string): string {
  return `/campaigns/view/?id=${encodeURIComponent(id)}`;
}

function plays(model: Model, c: SimClient): string[] {
  return model.session.funnelOfCampaign(c.campaign.id) ?? c.campaign.salesFunnel ?? [];
}

/** How a campaign's budget reads: the amount in the period it was stated in. */
export function budgetWords(c: SimClient): string {
  const day = `$${Math.round(c.campaign.dailyBudgetCents / 100).toLocaleString("en-US")}`;
  return c.campaign.maxVolume != null ? `${formatCount(c.campaign.maxVolume)} new leads, up to ${day}/day` : `${day}/day`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function CampaignsPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns" }]} actions={<Link href="/campaigns/new/" className="k-btn">New campaign</Link>} />
      <Page>{model ? <CampaignsOverview model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

function CampaignsOverview({ model, scope }: { model: Model; scope: string | null }) {
  const clients = scopedClients(model, scope);
  const running = clients.filter((c) => c.campaign.status === "running").length;
  const rows = clients.map((c) => {
    const f = scopeFigures(model, [c]);
    const target = targetState(model, c);
    const won = f.outcomes[target] ?? 0;
    return { c, f, won, target };
  });
  return (
    <>
      <PageHeader
        title={`${running} of ${clients.length} campaigns running`}
        sub="Each campaign is one sales funnel, run on a budget. The engine reviews the funnel every week."
        right={
          <span className="flex items-center gap-1.5">
            <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
            {running} running now
          </span>
        }
      />
      <CardTable footer={`${plural(clients.length, "campaign", "campaigns")} · Day ${model.day}`}>
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Campaign</th>
            <th className={TH}>Type</th>
            <th className={`${TH} text-right`}>
              <RoiLabel />
            </th>
            <th className={`${TH} text-right`}>$ / outcome</th>
            <th className={`${TH} text-right`}>% conversion</th>
            <th className={`${TH} text-right`}># outcomes</th>
            <th className={`${TH} text-right`}>$ spent</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, f, won, target }) => {
            const p = plays(model, c);
            const first = playPipe(model.catalogue, p[0] ?? "");
            const trigger = first?.mode === "reactive" && first.triggerId ? model.catalogue.trigger(first.triggerId) : null;
            const cpo = won > 0 ? f.spendCents / 100 / won : null;
            return (
              <tr key={c.campaign.id} className="k-row">
                <td className={`${TD} max-w-[460px]`}>
                  <Link href={campaignHref(c.campaign.id)} className="flex min-w-0 items-start gap-2.5">
                    <Mark kind="funnel" id={c.campaign.id} size={36} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{funnelName(model.catalogue, p)}</span>
                      <span className="k-fg3 truncate text-[12px]">{c.brand.name}</span>
                      <FunnelLine catalogue={model.catalogue} plays={p} />
                    </span>
                  </Link>
                </td>
                <td className={TD}>
                  <span className="k-fg2 inline-flex items-center gap-1 whitespace-nowrap text-[12px]">
                    {trigger ? <LightningIcon size={13} /> : <CalendarCheckIcon size={13} />}
                    {trigger ? trigger.label : "Daily"}
                  </span>
                </td>
                <td className={TDN}>
                  <RoiValue measured={f.roi} expected={f.expectedRoi} />
                </td>
                <td className={TDN}>{cpo != null ? formatUsd(cpo) : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{f.leads > 0 ? formatRatePct(won / f.leads) : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>
                  {formatCount(won)} <span className="k-fg3 text-[12px]">{model.stateDefs.get(target)?.label.toLowerCase()}</span>
                </td>
                <td className={TDN}>{formatCents(f.spendCents)}</td>
                <td className={TD}>
                  {c.campaign.status === "running" ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--run)]">
                      <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
                      {budgetWords(c)}
                    </span>
                  ) : (
                    <StateDot running={false} label="Off" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </CardTable>
      {clients.length === 0 && <EmptyNote>No campaign yet. Start one with New campaign.</EmptyNote>}
    </>
  );
}

// ---------------------------------------------------------------------------
// One campaign
// ---------------------------------------------------------------------------

export function CampaignPage() {
  const { model, dispatch } = useSim();
  const id = useSearchParams().get("id") ?? "";
  const client = model?.clients.find((c) => c.campaign.id === id);
  const name = model && client ? funnelName(model.catalogue, plays(model, client)) : "Campaign";
  return (
    <>
      <TopBar
        crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: name }]}
        actions={model && client ? <CampaignControls client={client} dispatch={dispatch} /> : null}
      />
      <Page>
        {!model ? (
          <PageSkeleton />
        ) : !client ? (
          <div className="k-card">
            <EmptyNote>
              This campaign does not exist in this world. <Link href="/campaigns/" className="k-accent">See every campaign</Link>.
            </EmptyNote>
          </div>
        ) : (
          <Campaign model={model} client={client} />
        )}
      </Page>
    </>
  );
}

/** Status as a dot + word in a button with a chevron, and the budget as the same button opening a modal. */
function CampaignControls({ client, dispatch }: { client: SimClient; dispatch: ReturnType<typeof useSim>["dispatch"] }) {
  const [menu, setMenu] = useState(false);
  const [budget, setBudget] = useState(false);
  const running = client.campaign.status === "running";
  return (
    <>
      <div className="relative">
        <button type="button" className="k-btn" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
          <StateDot running={running} label={running ? "Running" : "Paused"} />
          <CaretDownIcon size={12} className="k-fg3" />
        </button>
        {menu && (
          <div className="k-popover absolute right-0 top-9 z-30 w-36 p-1" onMouseLeave={() => setMenu(false)}>
            <button
              type="button"
              className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                dispatch({ type: "status", campaignId: client.campaign.id, status: running ? "paused" : "running" });
                setMenu(false);
              }}
            >
              <StateDot running={!running} label={running ? "Paused" : "Running"} />
            </button>
          </div>
        )}
      </div>
      <button type="button" className="k-btn tabular-nums" onClick={() => setBudget(true)}>
        {budgetWords(client)}
        <CaretDownIcon size={12} className="k-fg3" />
      </button>
      {budget && <BudgetModal client={client} onClose={() => setBudget(false)} dispatch={dispatch} />}
    </>
  );
}

function BudgetModal({ client, onClose, dispatch }: { client: SimClient; onClose: () => void; dispatch: ReturnType<typeof useSim>["dispatch"] }) {
  const [perDay, setPerDay] = useState(String(Math.round(client.campaign.dailyBudgetCents / 100)));
  const [mode, setMode] = useState<"day" | "volume">(client.campaign.maxVolume != null ? "volume" : "day");
  const [volume, setVolume] = useState(String(client.campaign.maxVolume ?? 500));
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const cents = Math.round(Number(perDay) * 100);
    if (!(cents > 0)) return setError("Set a daily amount above $0.");
    const err = dispatch({ type: "budget", campaignId: client.campaign.id, dailyBudgetCents: cents, ...(mode === "volume" ? { maxVolume: Math.max(1, Math.round(Number(volume) || 0)) } : {}) });
    if (err) return setError(err);
    onClose();
  };
  return (
    <Drawer title="Budget" onClose={onClose} width={380}>
      <p className="k-fg2 text-[13px]">How much this campaign may spend. The engine spends it on the choices worth the most per dollar.</p>
      <div className="mt-4 flex gap-1.5">
        <button type="button" className={`k-card px-3 py-2 text-left text-[13px] ${mode === "day" ? "k-card-on" : ""}`} onClick={() => setMode("day")}>
          Per day
        </button>
        <button type="button" className={`k-card px-3 py-2 text-left text-[13px] ${mode === "volume" ? "k-card-on" : ""}`} onClick={() => setMode("volume")}>
          A volume of leads
        </button>
      </div>
      <label className="k-label mt-4 block" htmlFor="per-day">
        Up to, per day
      </label>
      <span className="k-input mt-1 flex items-center gap-1 px-2">
        <span className="k-fg3">$</span>
        <input id="per-day" value={perDay} onChange={(e) => setPerDay(e.target.value.replace(/[^0-9.]/g, ""))} className="w-full bg-transparent outline-none" style={{ font: "inherit" }} />
      </span>
      {mode === "volume" && (
        <>
          <label className="k-label mt-3 block" htmlFor="volume">
            New leads in total
          </label>
          <input id="volume" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^0-9]/g, ""))} className="k-input mt-1 w-full px-2" style={{ font: "inherit" }} />
        </>
      )}
      {error && <p className="mt-3 text-[12px] text-[var(--data-rose)]">{error}</p>}
      <button type="button" className="k-btn-strong mt-5" onClick={save}>
        Save
      </button>
    </Drawer>
  );
}

function Campaign({ model, client }: { model: Model; client: SimClient }) {
  const f = useMemo(() => scopeFigures(model, [client]), [model, client]);
  const p = plays(model, client);
  const target = targetState(model, client);
  const targetLabel = model.stateDefs.get(target)?.label ?? stepLabel(model.catalogue, client.campaign.target);
  const won = f.outcomes[target] ?? 0;
  const v = valueOf(model, client);
  const todaySpend = model.result.days[model.day - 1]?.spendCents[client.campaign.id] ?? 0;
  const running = client.campaign.status === "running";
  const [view, setView] = useState<"flash" | "mature">("flash");
  const values = useMemo(() => stepValues(model, client), [model, client]);
  const ids = new Set([client.campaign.id]);
  return (
    <>
      <div className="mb-6 flex items-start gap-3">
        <Mark kind="funnel" id={client.campaign.id} size={40} />
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]">{funnelName(model.catalogue, p)}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StateDot running={running} />
            <span className="k-chip">{client.brand.name}</span>
            <span className="k-chip">Aims at {targetLabel}</span>
            <span className="k-chip">{client.campaign.salesFunnel ? "Funnel picked by the client" : "Funnel picked by the engine"}</span>
            {v && (
              <span className="k-chip">
                {formatUsd(v.amount)} per {targetLabel.toLowerCase()} {v.label === "expected" ? "(fleet median, expected)" : "(stated)"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="k-card grid grid-cols-2 divide-[var(--line-subtle)] md:grid-cols-6 md:divide-x">
        <Kpi label={<RoiLabel />}>
          <RoiValue measured={f.roi} expected={expectedRoi(model, client)} />
        </Kpi>
        <Kpi label={`${targetLabel}s`}>{formatCount(won)}</Kpi>
        <Kpi label={`$ / ${targetLabel.toLowerCase()}`}>{won > 0 ? formatUsd(f.spendCents / 100 / won) : "—"}</Kpi>
        <Kpi label="Leads found">{formatCount(f.leads)}</Kpi>
        <Kpi label="Spent">{formatCents(f.spendCents)}</Kpi>
        <div className="px-4 py-3">
          <span className="k-label">Spent today</span>
          <div className="mt-1 text-[22px] font-medium leading-7 tabular-nums">{formatCents(todaySpend)}</div>
          <Meter className="mt-1.5" value={todaySpend} max={client.campaign.dailyBudgetCents} color={running ? "var(--run)" : "var(--fg-4)"} />
          <p className="k-fg3 mt-1 text-[12px]">of {formatCents(client.campaign.dailyBudgetCents)} a day</p>
        </div>
      </div>

      <div className="mt-8">
        <SectionTitle
          right={
            <span className="flex items-center gap-1">
              {(["flash", "mature"] as const).map((x) => (
                <button key={x} type="button" className={`k-chip ${view === x ? "k-chip-on" : ""}`} onClick={() => setView(x)} aria-pressed={view === x}>
                  {x === "flash" ? "Flash: everything to date" : "Mature: old enough to judge"}
                </button>
              ))}
            </span>
          }
        >
          The funnel, pipe by pipe
        </SectionTitle>
        <div className="k-card px-4 py-3">
          <FunnelLine catalogue={model.catalogue} plays={p} size="md" scroll={false} />
        </div>
        <div className="mt-3 space-y-3">
          {p.map((playId, i) => (
            <PipeBlock key={playId} model={model} client={client} playId={playId} index={i} view={view} stepValue={values.get(playPipe(model.catalogue, playId)?.to ?? "") ?? 0} />
          ))}
        </div>
      </div>

      {!client.campaign.salesFunnel && <FunnelChoice model={model} client={client} />}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CostPerOutcomeCard model={model} f={f} target={target} />
        <ReturnCard f={f} />
      </div>
      <div className="mt-8">
        <WhyFeed model={model} campaignIds={ids} limit={10} />
      </div>
    </>
  );
}

function Kpi({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <span className="k-label">{label}</span>
      <div className="mt-1 text-[22px] font-medium leading-7 tracking-[-0.02em] tabular-nums">{children}</div>
    </div>
  );
}

const NODES_ORDER = ["workflow", "slot:template", "slot:llm", "audience"];

function PipeBlock({ model, client, playId, index, view, stepValue }: { model: Model; client: SimClient; playId: string; index: number; view: "flash" | "mature"; stepValue: number }) {
  const pipe = playPipe(model.catalogue, playId);
  const [open, setOpen] = useState(index === 0);
  if (!pipe) return null;
  const ids = new Set([client.campaign.id]);
  const runs = runsOf(model, { campaignIds: ids, pipeId: pipe.id });
  const fm = flashMature(model, pipe, runs);
  const t: Tally = fm[view];
  const est = model.session.estimateLeg(playId, client.brand.id);
  const valuePerDollar = est && est.costPerTrial > 0 ? (est.yieldRate * stepValue) / est.costPerTrial : null;
  const ch = model.catalogue.channel(pipe.channel);
  const trigger = pipe.triggerId ? model.catalogue.trigger(pipe.triggerId) : null;
  const nodes = NODES_ORDER.filter((n) => latestChoice(model, n, pipe.id, client.campaign.id));
  return (
    <div className="k-card">
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Mark kind="channel" id={pipe.channel} icon={ch?.icon} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium">{ch?.name}</span>
            <span className="k-chip">
              <Mark kind="pipe" id={pipe.id} size={14} />
              {pipe.name}
            </span>
            <span className="k-chip">{trigger ? `Wakes on ${trigger.label}` : "Daily budget"}</span>
            {!fm.isMature && <span className="k-chip">Learning</span>}
          </span>
          <span className="k-fg3 block text-[12px]">
            {stepLabel(model.catalogue, pipe.from)} → {ch?.name} → {stepLabel(model.catalogue, pipe.to)}
          </span>
        </span>
        <span className="hidden gap-6 text-right md:flex">
          <Mini label="In" value={formatCount(t.inputs)} />
          <Mini label="Out" value={formatCount(t.outputs)} />
          <Mini label="% conversion" value={formatRatePct(rate(t))} />
          <Mini label="$ / outcome" value={formatUsd(costPerOutcome(t))} />
          <Mini label="Value per $1" value={valuePerDollar != null ? formatRoi(valuePerDollar) : "—"} good={valuePerDollar != null && valuePerDollar >= 1} />
        </span>
        <CaretRightIcon size={14} className={`k-fg3 mt-1 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="k-line-subtle border-t px-4 pb-4 pt-3">
          <p className="k-fg3 text-[12px]">
            {view === "mature"
              ? `Mature view: runs older than ${fm.windowDays} days only (${formatCount(fm.mature.inputs)} of ${formatCount(fm.flash.inputs)} inputs). ${fm.isMature ? "Enough outcomes to read on its own." : `Needs ${fm.outcomesRequired} outcomes to be read on its own.`}`
              : `Flash view: every run to date. One more ${stepLabel(model.catalogue, pipe.to).toLowerCase()} is worth ${formatUsd(stepValue)} to this campaign.`}
          </p>
          {nodes.length === 0 ? (
            <EmptyNote>This pipe has not run yet.</EmptyNote>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {nodes.map((node) => (
                <ChoiceCard key={node} model={model} node={node} pipeId={pipe.id} campaignId={client.campaign.id} runs={runs} view={view} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <span className="flex flex-col items-end">
      <span className="k-label">{label}</span>
      <span className={`text-[14px] font-medium tabular-nums ${good ? "text-[var(--run)]" : ""}`}>{value}</span>
    </span>
  );
}

/** One choice node inside a pipe: its options, the share of picks this week, what each is expected to return, why. */
export function ChoiceCard({ model, node, pipeId, campaignId, runs, view }: { model: Model; node: string; pipeId: string; campaignId: string; runs: ReturnType<typeof runsOf>; view: "flash" | "mature" }) {
  const last = latestChoice(model, node, pipeId, campaignId)!;
  const shares = pickShares(model, node, pipeId, new Set([campaignId]));
  const pipe = model.catalogue.pipe(pipeId);
  const byOption = new Map<string, typeof runs>();
  for (const r of runs) {
    const o = optionOfRun(r, node);
    if (!o) continue;
    byOption.set(o, [...(byOption.get(o) ?? []), r]);
  }
  const options = [...last.options].sort((a, b) => b.meanScore - a.meanScore);
  return (
    <div className="k-inset rounded-[10px] p-3">
      <div className="flex items-center justify-between">
        <span className="k-label">{nodeLabel(node)}</span>
        <span className="k-fg3 text-[12px]">Share of picks, last 7 days</span>
      </div>
      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr>
            <th className="k-label py-1 text-left font-medium">Option</th>
            <th className="k-label py-1 text-right font-medium">Picks</th>
            <th className="k-label py-1 text-right font-medium">$ per $1</th>
            <th className="k-label py-1 text-right font-medium">% conv.</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const share = shares.get(o.id) ?? 0;
            const t = flashMature(model, pipe, byOption.get(o.id) ?? [])[view];
            return (
              <tr key={o.id}>
                <td className="py-1 pr-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Mark kind={markKindOf(model, node, o.id)} id={o.id} size={16} />
                    <span className={`truncate ${o.id === last.chosenId ? "font-medium" : "k-fg2"}`}>{optionLabel(model, node, o.id)}</span>
                  </span>
                </td>
                <td className="w-[110px] py-1 pl-2">
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--data-track)]">
                      <span className="k-fill block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(share * 100)}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums">{formatRatePct(share)}</span>
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{formatUsd(o.meanScore)}</td>
                <td className="py-1 text-right tabular-nums">{formatRatePct(rate(t))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="k-fg3 mt-2 text-[12px]">{explainChoice(model, last)}</p>
    </div>
  );
}

export function markKindOf(model: Model, node: string, id: string): Parameters<typeof Mark>[0]["kind"] {
  if (node === "workflow") return `workflow:${model.catalogue.workflow(id)?.kind ?? "ai"}` as "workflow:ai";
  if (node === "slot:llm") return "llm";
  if (node.startsWith("slot:")) return "template";
  if (node === "audience") return "audience";
  return "funnel";
}

/** The weekly funnel choice of a campaign the engine runs: the candidates, what each is expected to return, the pick. */
function FunnelChoice({ model, client }: { model: Model; client: SimClient }) {
  const last = latestChoice(model, "funnel", null, client.campaign.id);
  const [tab, setTab] = useState<"now" | "history">("now");
  if (!last) return null;
  const history = model.result.choices.filter((c) => c.node === "funnel" && c.campaignId === client.campaign.id);
  return (
    <div className="mt-8">
      <SectionTitle right={<span>Reviewed every 7 days. Next on day {last.day + 7}.</span>}>Which funnel, and why</SectionTitle>
      <Tabs
        tabs={[
          { id: "now", label: "Last review" },
          { id: "history", label: "Every review", count: history.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "now" ? (
        <CardTable footer={explainChoice(model, last)}>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Sales funnel</th>
              <th className={`${TH} text-right`}>Expected $ per $1</th>
              <th className={TH}>Pick</th>
            </tr>
          </thead>
          <tbody>
            {[...last.options]
              .sort((a, b) => b.meanScore - a.meanScore)
              .map((o) => (
                <tr key={o.id} className="k-row">
                  <td className={`${TD} max-w-[640px]`}>
                    <span className="block font-medium">{funnelName(model.catalogue, o.id.split(" > "))}</span>
                    <FunnelLine catalogue={model.catalogue} plays={o.id.split(" > ")} />
                  </td>
                  <td className={TDN}>{formatUsd(o.meanScore)}</td>
                  <td className={TD}>{o.id === last.chosenId ? <StateDot running label="Running" /> : <span className="k-fg4">—</span>}</td>
                </tr>
              ))}
          </tbody>
        </CardTable>
      ) : (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Day</th>
              <th className={TH}>Funnel picked</th>
              <th className={TH}>Why</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((c, i) => (
              <tr key={i} className="k-row">
                <td className={`${TD} k-mono k-fg2 text-[12px]`}>Day {c.day}</td>
                <td className={TD}>{funnelName(model.catalogue, c.chosenId.split(" > "))}</td>
                <td className={`${TD} k-fg2 text-[12px]`}>{explainChoice(model, c)}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
    </div>
  );
}

