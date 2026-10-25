"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DayChart, Legend } from "@/components/charts";
import { Mark } from "@/components/mark";
import { BarSpark, EmptyNote, Figure, Page, PageHeader, RoiLabel, SectionTitle, Shimmer, SparkLine, StatTile, TickGauge, TopBar } from "@/components/ui";
import { cumulative, costPerOutcomeSeries, explainChoice, funnelName, nodeLabel, optionLabel, pipeTitle, scopeFigures, scopedClients, targetState, valueOf, type Model } from "@/lib/model";
import { formatCents, formatCount, formatRoi, formatUsd, plural, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function TodayPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Today" }]} />
      <Page>{model ? <Today model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-3">
      <Shimmer className="h-9 w-80" />
      <Shimmer className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-3 pt-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <Shimmer key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function Today({ model, scope }: { model: Model; scope: string | null }) {
  const clients = scopedClients(model, scope);
  const f = useMemo(() => scopeFigures(model, clients), [model, clients]);
  const running = clients.filter((c) => c.campaign.status === "running").length;
  const target = clients[0] ? targetState(model, clients[0]) : "paid_client";
  const targetLabel = model.stateDefs.get(target)?.label ?? "Paid client";
  const won = f.outcomes[target] ?? 0;
  const roi = f.roi;
  const shown = roi && roi > 0 ? roi : f.expectedRoi;
  const gaugeMax = Math.max(3, Math.ceil((shown ?? 0) + 0.5));
  const brand = scope ? clients[0]?.brand.name : null;

  return (
    <>
      <PageHeader
        title={
          <>
            Day {model.day}: {plural(won, `${targetLabel.toLowerCase()} won`, `${targetLabel.toLowerCase()}s won`)}
          </>
        }
        sub={
          <>
            {brand ? `${brand} has` : "Your clients have"} {plural(running, "campaign", "campaigns")} running. They found {plural(f.leads, "lead", "leads")} for {formatCents(f.spendCents)}.
          </>
        }
        right={
          <span className="flex items-center gap-1.5">
            <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
            {running} running now
          </span>
        }
      />

      <div className="mb-3 flex items-center justify-between">
        <span className="k-label">Performance</span>
        <span className="k-fg3 text-[12px]">Since day 0</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={<RoiLabel />} note="Break-even 1×">
          <div className="flex flex-col items-center">
            <div className="relative w-full max-w-[124px]">
              <TickGauge value={shown} max={gaugeMax} marker={1} />
              <span className={`absolute inset-x-0 bottom-0 text-center text-[18px] font-medium tabular-nums ${roiIsGood(shown) && roi ? "text-[var(--run)]" : roi ? "" : "k-fg3"}`}>
                {formatRoi(shown)}
              </span>
            </div>
            <p className="k-fg3 mt-1 truncate text-[11px]">{roi ? `Measured · expected ${formatRoi(f.expectedRoi)}` : "Expected, nothing won yet"}</p>
          </div>
        </StatTile>
        <StatTile label="Value won" note={`${targetLabel}s × lifetime revenue`}>
          <Figure value={formatUsd(f.value)} />
          <SparkLine className="mt-auto h-8 pt-2" values={cumulative(f.dailyValue)} color="var(--run)" />
        </StatTile>
        <StatTile label="Spent" note="setup included">
          <Figure value={formatCents(f.spendCents)} />
          <BarSpark className="mt-auto pt-2" values={f.dailySpendCents} />
        </StatTile>
        <StatTile label="Leads found" note="new each day">
          <Figure value={formatCount(f.leads)} />
          <BarSpark className="mt-auto pt-2" values={f.dailyLeads} color="var(--data-teal)" />
        </StatTile>
      </div>

      <div className="mt-8">
        <SectionTitle right={<span>A lead moves on each track on its own. Tracks are never added together.</span>}>Outcomes by lead track</SectionTitle>
        <div
          className="grid gap-3 lg:[grid-template-columns:var(--cols)]"
          style={{ "--cols": model.tracks.map((t) => `minmax(0,${Math.max(1.5, t.states.length)}fr)`).join(" ") } as React.CSSProperties}
        >
          {model.tracks.map((t) => (
            <div key={t.id} className="k-card p-4">
              <div className="flex items-center gap-2">
                <Mark kind="leadTrack" id={t.id} size={22} />
                <span className="text-[14px] font-medium">{t.label}</span>
              </div>
              <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${t.states.length}, minmax(0, 1fr))` }}>
                {t.states.map((s) => {
                  const n = f.outcomes[s.state] ?? 0;
                  const cpo = n > 0 ? f.spendCents / 100 / n : null;
                  return (
                    <Link key={s.state} href={`/leads/?state=${s.state}`} className="k-inset k-hover block rounded-[8px] px-3 py-2.5">
                      <span className="k-label block truncate">{s.label}</span>
                      <span className="mt-1 block text-[20px] font-medium leading-6 tabular-nums">{formatCount(n)}</span>
                      <span className="k-fg3 block text-[12px] tabular-nums">{cpo != null ? `${formatUsd(cpo)} each` : "None yet"}</span>
                      <SparkLine className="mt-1 h-6" values={cumulative(f.dailyOutcomes[s.state] ?? [])} color="var(--data-teal)" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CostPerOutcomeCard model={model} f={f} target={target} />
        <ReturnCard f={f} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <WhyFeed model={model} campaignIds={new Set(clients.map((c) => c.campaign.id))} />
        <section>
          <SectionTitle count={clients.length}>Campaigns</SectionTitle>
          <div className="k-card divide-y divide-[var(--line-subtle)]">
            {clients.map((c) => {
              const plays = model.session.funnelOfCampaign(c.campaign.id) ?? c.campaign.salesFunnel ?? [];
              const v = valueOf(model, c);
              return (
                <Link key={c.campaign.id} href={`/campaigns/view/?id=${encodeURIComponent(c.campaign.id)}`} className="k-hover flex items-center gap-3 px-4 py-3 first:rounded-t-[12px] last:rounded-b-[12px]">
                  <Mark kind="funnel" id={c.campaign.id} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{funnelName(model.catalogue, plays)}</span>
                    <span className="k-fg3 block truncate text-[12px]">
                      {c.brand.name} · {v ? `${formatUsd(v.amount)} per ${targetLabel.toLowerCase()}${v.label === "expected" ? " (expected)" : ""}` : "—"}
                    </span>
                  </span>
                  <span className="k-fg2 text-[12px] tabular-nums">{formatCents(model.session.spentCents(c.campaign.id))}</span>
                </Link>
              );
            })}
            {clients.length === 0 && <EmptyNote>No campaign yet. Start one with New campaign.</EmptyNote>}
          </div>
        </section>
      </div>
    </>
  );
}

export function CostPerOutcomeCard({ model, f, target }: { model: Model; f: ReturnType<typeof scopeFigures>; target: string }) {
  const states = model.tracks.flatMap((t) => t.states).filter((s) => (f.outcomes[s.state] ?? 0) > 0);
  const [state, setState] = useState(target);
  const chosen = states.some((s) => s.state === state) ? state : (states[0]?.state ?? target);
  const label = model.stateDefs.get(chosen)?.label ?? chosen;
  const measured = costPerOutcomeSeries(f.dailySpendCents, f.dailyOutcomes[chosen] ?? []);
  const expectedValue = chosen === target ? f.expectedCostPerTarget : null;
  const last = [...measured].reverse().find((x) => x != null) ?? null;
  const series = [
    { key: "m", label: `Measured cost per ${label.toLowerCase()}`, values: measured, color: "var(--accent)" },
    ...(expectedValue ? [{ key: "e", label: "Expected on today's estimates", values: measured.map(() => expectedValue), color: "var(--fg-4)", dashed: true }] : []),
  ];
  return (
    <section>
      <SectionTitle right={<span>Spend to date ÷ outcomes to date</span>}>$ per outcome over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Figure value={last != null ? formatUsd(last) : "—"} sub={`per ${label.toLowerCase()}`} />
          <div className="flex flex-wrap gap-1">
            {states.map((s) => (
              <button key={s.state} type="button" onClick={() => setState(s.state)} className={`k-chip ${s.state === chosen ? "k-chip-on" : ""}`} aria-pressed={s.state === chosen}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          {measured.some((x) => x != null) ? <DayChart series={series} format={formatUsd} /> : <EmptyNote>No outcome yet. Press play.</EmptyNote>}
        </div>
        <Legend series={series} />
      </div>
    </section>
  );
}

export function ReturnCard({ f }: { f: ReturnType<typeof scopeFigures> }) {
  const spend = cumulative(f.dailySpendCents);
  const value = cumulative(f.dailyValue);
  const roi = spend.map((s, i) => (s > 0 ? value[i]! / (s / 100) : null));
  const series = [
    { key: "m", label: "Measured return", values: roi, color: "var(--run)" },
    ...(f.expectedRoi ? [{ key: "e", label: "Expected on today's estimates", values: roi.map(() => f.expectedRoi), color: "var(--fg-4)", dashed: true }] : []),
  ];
  return (
    <section>
      <SectionTitle right={<span>Value won ÷ spend, to date</span>}>Return over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <Figure value={<span className={roiIsGood(f.roi) ? "text-[var(--run)]" : ""}>{formatRoi(f.roi)}</span>} sub={`expected ${formatRoi(f.expectedRoi)}`} />
        <div className="mt-3">
          <DayChart series={series} format={(v) => formatRoi(v)} reference={{ y: 1, label: "Break-even" }} />
        </div>
        <Legend series={series} />
      </div>
    </section>
  );
}

/** The engine's last decisions and why: the choice log, newest first. */
export function WhyFeed({ model, campaignIds, limit = 8 }: { model: Model; campaignIds: Set<string>; limit?: number }) {
  const items = [];
  for (let i = model.result.choices.length - 1; i >= 0 && items.length < limit; i--) {
    const c = model.result.choices[i]!;
    if (!campaignIds.has(c.campaignId)) continue;
    items.push(c);
  }
  return (
    <section>
      <SectionTitle right={<span>Newest first</span>}>Why the engine chose</SectionTitle>
      <div className="k-card divide-y divide-[var(--line-subtle)]">
        {items.length === 0 && <EmptyNote>No choice yet. Press play.</EmptyNote>}
        {items.map((c, i) => {
          const client = model.clients.find((x) => x.campaign.id === c.campaignId);
          return (
            <div key={i} className="flex gap-3 px-4 py-3">
              <Mark kind={c.node === "funnel" ? "funnel" : c.node === "workflow" ? "workflow:ai" : c.node === "audience" ? "audience" : c.node === "slot:llm" ? "llm" : "template"} id={c.node} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="k-fg3">{nodeLabel(c.node)}:</span> <span className="font-medium">{optionLabel(model, c.node, c.chosenId)}</span>
                </p>
                <p className="k-fg3 truncate text-[12px]">
                  {client?.brand.name}
                  {c.pipeId ? ` · ${pipeTitle(model.catalogue, c.pipeId).name}` : ""} · {explainChoice(model, c)}
                </p>
              </div>
              <span className="k-mono k-fg3 shrink-0 text-[12px]">Day {c.day}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
