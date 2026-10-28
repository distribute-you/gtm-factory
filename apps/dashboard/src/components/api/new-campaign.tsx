"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { START, type ApiCampaign, type ApiNewCampaign, type ApiNewOutcome, type ApiPlanPreview, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, SectionTitle, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { engineTitle, outcomeName, outcomePluralName } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, formatRoi, roiIsGood } from "@/lib/format";
import { Field, ShimmerRows } from "./common";

export function ApiNewCampaignPage() {
  const search = useSearchParams();
  const router = useRouter();
  const { data: overview } = useOverview();
  const catalogue = overview?.catalogue;
  const brands = overview?.brands ?? [];
  const { scope } = useScope();
  const brandId = scope.brandId;
  const offerId = scope.offerId;
  const plans = useApi<ApiPlanPreview[]>(brandId ? `/brands/${encodeURIComponent(brandId)}/plans` : null, 0);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (plans.data && plans.data.length > 0 && !plans.data.some((f) => f.target === target)) setTarget(plans.data[0]!.target);
  }, [plans.data, target]);
  const [start, setStart] = useState<string>(START);
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("10");
  const [periodDays, setPeriodDays] = useState(1);
  const [volume, setVolume] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [newEvent, setNewEvent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dollars = Number(budget);
  // A reactive campaign starts from an outcome about a person: each Unit of it that lands is pushed up.
  const starts = [START, ...(catalogue?.outcomes.filter((o) => (o.subject === "lead" || o.subject === "company") && !o.retired && o.id !== target).map((o) => o.id) ?? [])];
  // A reactive campaign needs an event some script makes or reads: else it is refused.
  const startOutcome = catalogue?.outcomes.find((o) => o.id === start);
  const unmade =
    start !== START && !!catalogue && !startOutcome?.event && !catalogue.scripts.some((s) => s.status === "active" && (s.outcome === start || s.materials.includes(start)));
  const createEvent = async () => {
    setError(null);
    try {
      const c = await apiSend<CatalogueData>("POST", "/outcomes", { label: newEvent.trim() } satisfies ApiNewOutcome);
      const made = c.outcomes.find((o) => o.label === newEvent.trim());
      if (made) setStart(made.id);
      setNewEvent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const valid = brandId && offerId && target && start !== target && !unmade && Number.isFinite(dollars) && dollars > 0 && (!volume || Number(volume) >= 1);

  const create = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const body: ApiNewCampaign = { brandId: brandId!, offerId: offerId!, start, target: target!, dailyBudgetCents: Math.round(dollars * 100), budgetPeriodDays: periodDays, ...(volume ? { volume: { units: Math.round(Number(volume)), periodDays } } : {}), ...(name.trim() ? { name: name.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(brief.trim() ? { brief: brief.trim() } : {}) };
    try {
      const c = await apiSend<ApiCampaign>("POST", "/campaigns", body);
      router.push(`/campaigns/view/?id=${encodeURIComponent(c.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: "New campaign" }]} />
      <Page narrow>
        <PageHeader title="Start a campaign" sub="Pick a Target and a budget, then write your strategy in your own words. The campaign starts paused: you launch it." />
        {overview && brands.length === 0 ? (
          <div className="k-card">
            <EmptyNote>
              No brand yet. <Link href="/brands/new/" className="k-accent">Add a brand</Link> first.
            </EmptyNote>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="k-fg2 text-[13px]">
              For <span className="font-medium">{brands.find((b) => b.id === brandId)?.name ?? "the brand picked above"}</span>
              {brands.find((b) => b.id === brandId)?.offers.find((x) => x.id === offerId) ? `, offer ${brands.find((b) => b.id === brandId)!.offers.find((x) => x.id === offerId)!.name}` : ""}. Change it in the selector at the top left.
            </p>

            <section>
              <SectionTitle count={plans.data?.length}>Targets this brand can order today</SectionTitle>
              {!plans.answered ? (
                <ShimmerRows rows={3} />
              ) : plans.error ? (
                <p className="text-[13px] text-[var(--data-rose)]">{plans.error}</p>
              ) : plans.data && plans.data.length === 0 ? (
                <div className="k-card">
                  <EmptyNote>The catalogue has no Plan to a Target for this brand yet.</EmptyNote>
                </div>
              ) : (
                <div className="space-y-2">
                  {plans.data?.map((f, i) => (
                    <PlanCard key={f.target} plan={f} rank={i} catalogue={catalogue} on={f.target === target} onPick={() => setTarget(f.target)} />
                  ))}
                </div>
              )}
            </section>

            <Field label="Proactive or reactive" hint="Proactive looks for new people in the market. Reactive starts each time the event below happens.">
              <select className="k-input w-full max-w-[360px] px-1.5" style={{ font: "inherit" }} value={start} onChange={(e) => setStart(e.target.value)}>
                {starts.map((o) => (
                  <option key={o} value={o}>
                    {o === START ? "Proactive" : `Reactive: on ${outcomeName(catalogue, o)}`}
                  </option>
                ))}
              </select>
            </Field>
            {unmade && (
              <div className="k-inset space-y-2 rounded-[8px] p-3 text-[13px]" data-testid="unmade-event">
                <p>No script makes or reads &ldquo;{outcomeName(catalogue, start)}&rdquo;, so this campaign would never start. Pick another event, or create the outcome.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="k-btn" onClick={() => setStart(START)}>
                    Pick another event
                  </button>
                  <input aria-label="New outcome" className="k-input px-2" style={{ font: "inherit" }} placeholder="Name of the new outcome" value={newEvent} onChange={(e) => setNewEvent(e.target.value)} />
                  <button type="button" className="k-btn" disabled={!newEvent.trim()} onClick={createEvent}>
                    Create the outcome
                  </button>
                </div>
              </div>
            )}

            <Field label="Strategy" hint="Write it as long as you like. A judge reads it once for each Engine. The name and description are written from it, and you can edit them after.">
              <textarea
                aria-label="Strategy"
                className="k-input min-h-[88px] w-full px-2 py-1.5"
                style={{ font: "inherit", height: "auto" }}
                placeholder="Cold email and LinkedIn. At most 30 emails a day. A 30-day test."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="Optional. Left empty, it is written from the strategy.">
                <input aria-label="Name" className="k-input w-full px-2" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description" hint="Optional. Left empty, it is written from the strategy.">
                <input aria-label="Description" className="k-input w-full px-2" style={{ font: "inherit" }} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>

            <Field label="Budget (required)" hint="The most it spends per period. Whichever limit is hit first stops the campaign for the period.">
              <label className="k-input flex w-64 items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input aria-label="Budget in dollars" className="w-full min-w-0 bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} />
                <span className="k-fg3 shrink-0">per</span>
                <select aria-label="Budget period" className="bg-transparent outline-none" style={{ font: "inherit" }} value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
                  <option value={1}>day</option>
                  <option value={7}>week</option>
                  <option value={30}>month</option>
                </select>
              </label>
            </Field>

            <Field label="Volume limit (optional)" hint="At most this many new people in the same period.">
              <label className="k-input flex w-64 items-center gap-1 px-2">
                <input aria-label="New people per period" className="w-full min-w-0 bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} placeholder="No limit" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^0-9]/g, ""))} />
                <span className="k-fg3 shrink-0">new people</span>
              </label>
            </Field>

            {error && <p className="text-[13px] text-[var(--data-rose)]">{error}</p>}
            <div className="flex items-center justify-end gap-3">
              <span className="k-fg3 text-[12px]">It starts paused. Nothing runs until you launch it.</span>
              <button type="button" className="k-btn-strong" disabled={!valid || busy} onClick={create}>
                {busy ? "Creating" : "Create the campaign"}
              </button>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}

function PlanCard({ plan, rank, catalogue, on, onPick }: { plan: ApiPlanPreview; rank: number; catalogue: CatalogueData | undefined; on: boolean; onPick: () => void }) {
  const target = outcomeName(catalogue, plan.target);
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className={`k-card block w-full p-4 text-left ${on ? "k-card-on" : ""}`}>
      <div className="flex items-start gap-3">
        <Mark kind="outcome" id={plan.target} icon={catalogue?.outcomes.find((o) => o.id === plan.target)?.icon} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[14px] ${on ? "font-medium" : ""}`}>{outcomePluralName(catalogue, plan.target)}</span>
            {rank === 0 && <span className="k-chip">Best value per dollar</span>}
            <span className="k-chip">{plan.label === "measured" ? "Measured" : "Expected"}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="k-chip">{outcomeName(catalogue, START)}</span>
            {plan.milestones.map((m) => (
              <span key={`${m.from}>${m.to}`} className="inline-flex items-center gap-1.5">
                <span className="k-fg3">
                  → <span className="k-fg2">{m.engines.map((e) => engineTitle(catalogue, e)).join(", ")}</span> →
                </span>
                <span className="k-chip">{outcomeName(catalogue, m.to)}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`block text-[18px] font-medium tabular-nums ${roiIsGood(plan.valuePerDollar) ? "text-[var(--run)]" : ""}`}>{formatRoi(plan.valuePerDollar)}</span>
          <span className="k-fg3 block text-[12px]">value per dollar</span>
          <span className="mt-1 block text-[13px] tabular-nums">{formatCents(plan.costPerTargetCents)}</span>
          <span className="k-fg3 block text-[12px]">per {target}</span>
        </div>
      </div>
      {on && plan.milestones.length > 0 && (
        <div className="k-inset mt-3 grid gap-px overflow-hidden rounded-[8px] text-[12px]" style={{ gridTemplateColumns: `repeat(${plan.milestones.length}, minmax(0,1fr))` }}>
          {plan.milestones.map((l) => (
            <div key={`${l.from}>${l.to}`} className="px-3 py-2">
              <span className="k-label block">
                {outcomeName(catalogue, l.from)} to {outcomeName(catalogue, l.to)}
              </span>
              <span className="mt-1 block tabular-nums">
                {formatRatePct(l.yieldRate)} conversion · {formatCents(l.costFromStartCents)} from Start
              </span>
              <span className="k-fg3 block tabular-nums">
                {formatCount(l.attemptsPerTarget)} attempts per {target} · {l.label === "measured" ? "measured" : "expected"}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
