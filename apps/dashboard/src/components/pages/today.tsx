"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DayChart, Legend } from "@/components/charts";
import { Mark } from "@/components/mark";
import { BarSpark, EmptyNote, Figure, Page, PageHeader, RoiLabel, SectionTitle, Shimmer, SparkLine, StatTile, TickGauge, TopBar } from "@/components/ui";
import { costPerOutcomeSeries, cumulative, engineName, explainPick, candidateLabel, outcomeLabel, pointInfo, recentPicks, scopeFigures, scopeReturn, scopedCampaigns, targetOf, type Model, type ScopeFigures } from "@/lib/model";
import { formatBudget, formatVolume, formatCents, formatCount, formatRoi, formatUsd, plural, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function TodayPage() {
  const { model, scope, offer } = useSim();
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
  const { offer } = useSim();
  const campaigns = scopedCampaigns(model, scope, offer);
  const f = useMemo(() => scopeFigures(model, campaigns), [model, campaigns]);
  const r = useMemo(() => scopeReturn(model, campaigns), [model, campaigns]);
  const running = campaigns.filter((c) => c.status === "running").length;
  const brand = scope ? model.clients.find((c) => c.brand.id === scope)?.brand.name : null;
  const paid = model.tracks.flatMap((t) => t.states).sort((a, b) => b.rank - a.rank)[0];
  const won = paid ? f.outcomes[paid.outcome] ?? 0 : 0;
  const shown = r.measured && r.measured > 0 ? r.measured : r.expected;
  const gaugeMax = Math.max(3, Math.ceil((shown ?? 0) + 0.5));

  return (
    <>
      <PageHeader
        title={
          <>
            Day {model.day}: {plural(won, `${(paid?.label ?? "client").toLowerCase()}`, `${(paid?.label ?? "client").toLowerCase()}s`)}
          </>
        }
        sub={
          <>
            {brand ? `${brand} runs` : "Your clients run"} {plural(campaigns.length, "campaign", "campaigns")}. They tried {plural(f.attempts, "lead", "leads")} for {formatCents(f.spendCents)}.
          </>
        }
        right={
          <span className="flex items-center gap-1.5">
            <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
            {running} running now
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={<RoiLabel />} note="Break-even 1×">
          <div className="flex flex-col items-center">
            <div className="relative w-full max-w-[124px]">
              <TickGauge value={shown} max={gaugeMax} marker={1} />
              <span className={`absolute inset-x-0 bottom-0 text-center text-[18px] font-medium tabular-nums ${roiIsGood(shown) ? "text-[var(--run)]" : ""}`}>{formatRoi(shown)}</span>
            </div>
            <p className="k-fg3 mt-1 truncate text-[11px]">
              Measured · expected {formatRoi(r.expected)}
            </p>
          </div>
        </StatTile>
        <StatTile label="Value won by our runs" note={`+${formatUsd(f.valueOther)} performed by others`}>
          <Figure value={formatUsd(f.valueOurs)} />
          <SparkLine className="mt-auto h-8 pt-2" values={cumulative(f.dailyValueOurs)} color="var(--run)" />
        </StatTile>
        <StatTile label="Spent by our runs" note="setup included">
          <Figure value={formatCents(f.spendCents)} />
          <BarSpark className="mt-auto pt-2" values={f.dailySpendCents} />
        </StatTile>
        <StatTile label="Units taken in" note={`${formatCount(f.pushes)} pushed by reactive campaigns`}>
          <Figure value={formatCount(f.attempts)} />
          <BarSpark className="mt-auto pt-2" values={f.dailyAttempts} color="var(--data-teal)" />
        </StatTile>
      </div>

      <div className="mt-8">
        <SectionTitle right={<span>A subject moves on each track on its own. Tracks are never added together.</span>}>Milestones by track</SectionTitle>
        <div className="grid gap-3 lg:[grid-template-columns:var(--cols)]" style={{ "--cols": model.tracks.map((t) => `minmax(0,${Math.max(1.5, t.states.length)}fr)`).join(" ") } as React.CSSProperties}>
          {model.tracks.map((t) => (
            <div key={t.id} className="k-card p-4">
              <div className="flex items-center gap-2">
                <Mark kind="track" id={t.id} size={22} />
                <span className="text-[14px] font-medium">{t.label}</span>
              </div>
              <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${t.states.length}, minmax(0, 1fr))` }}>
                {t.states.map((s) => {
                  const n = f.outcomes[s.outcome] ?? 0;
                  const cpo = n > 0 ? f.spendCents / 100 / n : null;
                  return (
                    <Link key={s.outcome} href={`/leads/?state=${s.outcome}`} className="k-inset k-hover block rounded-[8px] px-3 py-2.5">
                      <span className="k-label block truncate">{s.label}</span>
                      <span className="mt-1 block text-[20px] font-medium leading-6 tabular-nums">{formatCount(n)}</span>
                      <span className="k-fg3 block text-[12px] tabular-nums">{cpo != null ? `${formatUsd(cpo)} each` : "None yet"}</span>
                      <SparkLine className="mt-1 h-6" values={cumulative(f.dailyOutcomes[s.outcome] ?? [])} color="var(--data-teal)" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CostPerOutcomeCard model={model} f={f} />
        <ReturnCard f={f} expected={r.expected} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <WhyFeed model={model} campaignIds={new Set(campaigns.map((c) => c.id))} />
        <section>
          <SectionTitle count={campaigns.length}>Campaigns</SectionTitle>
          <div className="k-card divide-y divide-[var(--line-subtle)]">
            {campaigns.map((c) => {
              const e = model.session.economics(c.id);
              const brandName = model.clients.find((x) => x.brand.id === c.brandId)?.brand.name;
              return (
                <Link key={c.id} href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`} className="k-hover flex items-center gap-3 px-4 py-3 first:rounded-t-[12px] last:rounded-b-[12px]">
                  <Mark kind="campaign" id={c.id} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="k-fg3 block truncate text-[12px]">
                      {brandName} · {outcomeLabel(model.catalogue, targetOf(c))} at {formatUsd(e.targetValue)}
                      {e.valueLabel === "expected" ? " (expected)" : ""}
                    </span>
                  </span>
                  <span className={`text-[13px] tabular-nums ${roiIsGood(e.expected.value) ? "text-[var(--run)]" : "k-fg2"}`}>{formatRoi(e.expected.value)}</span>
                </Link>
              );
            })}
            {campaigns.length === 0 && <EmptyNote>No campaign yet. Start one with New campaign.</EmptyNote>}
          </div>
          {campaigns[0] && (
            <div className="k-card mt-3 p-4" data-testid="first-campaign">
              <p className="k-label mb-2">The first campaign</p>
              <p className="text-[14px] font-medium">{campaigns[0].name}</p>
              {campaigns[0].description && <p className="k-fg2 mt-0.5 text-[13px] leading-5">{campaigns[0].description}</p>}
              <p className="k-fg3 mt-1 text-[12px] tabular-nums">
                {formatBudget(campaigns[0].dailyBudgetCents, campaigns[0].budgetPeriodDays)}
                {campaigns[0].volume ? `, ${formatVolume(campaigns[0].volume)}` : ""}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function CostPerOutcomeCard({ model, f }: { model: Model; f: ScopeFigures }) {
  const states = model.tracks.flatMap((t) => t.states).filter((s) => (f.outcomes[s.outcome] ?? 0) > 0);
  const [state, setState] = useState<string | null>(null);
  const picked = state && states.some((s) => s.outcome === state) ? state : (states[0]?.outcome ?? null);
  const label = picked ? outcomeLabel(model.catalogue, picked) : "outcome";
  const measured = picked ? costPerOutcomeSeries(f.dailySpendCents, f.dailyOutcomes[picked] ?? []) : [];
  const last = [...measured].reverse().find((x) => x != null) ?? null;
  const series = [{ key: "m", label: `Cost per ${label.toLowerCase()}`, values: measured, color: "var(--accent)" }];
  return (
    <section>
      <SectionTitle right={<span>Spend to date ÷ outcomes to date</span>}>$ per outcome over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Figure value={last != null ? formatUsd(last) : "—"} sub={`per ${label.toLowerCase()}`} />
          <div className="flex flex-wrap gap-1">
            {states.map((s) => (
              <button key={s.outcome} type="button" onClick={() => setState(s.outcome)} className={`k-chip ${s.outcome === picked ? "k-chip-on" : ""}`} aria-pressed={s.outcome === picked}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">{measured.some((x) => x != null) ? <DayChart series={series} format={formatUsd} /> : <EmptyNote>No outcome yet. Press Run.</EmptyNote>}</div>
        <Legend series={series} />
      </div>
    </section>
  );
}

export function ReturnCard({ f, expected }: { f: ScopeFigures; expected: number | null }) {
  const spend = cumulative(f.dailySpendCents);
  const value = cumulative(f.dailyValueOurs);
  const roi = spend.map((s, i) => (s > 0 ? value[i]! / (s / 100) : null));
  const series = [
    { key: "m", label: "Measured return: our value ÷ our spend", values: roi, color: "var(--run)" },
    ...(expected ? [{ key: "e", label: "Expected: same formula on today's estimates", values: roi.map(() => expected), color: "var(--fg-4)", dashed: true }] : []),
  ];
  const last = [...roi].reverse().find((x) => x != null) ?? null;
  return (
    <section>
      <SectionTitle right={<span>Value won by our runs ÷ our spend</span>}>Return over time</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <Figure value={<span className={roiIsGood(last) ? "text-[var(--run)]" : ""}>{formatRoi(last)}</span>} sub={`expected ${formatRoi(expected)}`} />
        <div className="mt-3">
          <DayChart series={series} format={(v) => formatRoi(v)} reference={{ y: 1, label: "Break-even" }} />
        </div>
        <Legend series={series} />
      </div>
    </section>
  );
}

/** The engine's latest picks and why: newest first. */
export function WhyFeed({ model, campaignIds, limit = 8 }: { model: Model; campaignIds: Set<string>; limit?: number }) {
  const items = recentPicks(model, campaignIds, limit);
  return (
    <section>
      <SectionTitle right={<span>Newest first</span>}>Why each one was picked</SectionTitle>
      <div className="k-card divide-y divide-[var(--line-subtle)]">
        {items.length === 0 && <EmptyNote>No pick yet. Press Run.</EmptyNote>}
        {items.map((c, i) => {
          const info = pointInfo(model.catalogue, c.point);
          const campaign = model.campaigns.find((x) => x.id === c.campaignId);
          const picked = candidateLabel(model, c.point, c.pickedId, campaign?.brandId);
          const input = info.kind === "unit";
          return (
            <Link
              key={i}
              href={input ? `/pinned/?pin=${encodeURIComponent(`outcome:${info.material}`)}` : `/research/?point=${encodeURIComponent(c.point)}`}
              className="k-hover flex gap-3 px-4 py-3 first:rounded-t-[12px] last:rounded-b-[12px]"
            >
              <Mark kind={input ? "material" : "engine"} id={info.material} icon={model.catalogue.outcome(info.material)?.icon} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">
                  {input ? (
                    <>
                      <span className="k-fg3">{outcomeLabel(model.catalogue, info.material)} used:</span> <span className="font-medium">{picked}</span>
                    </>
                  ) : (
                    <>
                      <span className="k-fg3">{engineName(model.catalogue, info.material)} · script:</span> <span className="font-medium">{picked}</span>
                    </>
                  )}
                </p>
                <p className="k-fg3 truncate text-[12px]">
                  {campaign?.name}: {explainPick(model, c)}
                </p>
              </div>
              <span className="k-mono k-fg3 shrink-0 text-[12px]">Day {c.day}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
