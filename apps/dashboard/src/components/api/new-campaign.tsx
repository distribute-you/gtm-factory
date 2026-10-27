"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { START, type ApiCampaign, type ApiNewCampaign, type ApiPlanPreview, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, SectionTitle, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { engineTitle, outcomeName, outcomePluralName } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, formatRoi, roiIsGood } from "@/lib/format";
import { Field, ShimmerRows } from "./common";

export function ApiNewCampaignPage() {
  const search = useSearchParams();
  const router = useRouter();
  const { data: overview } = useOverview();
  const catalogue = overview?.catalogue;
  const brands = overview?.brands ?? [];
  const [brandId, setBrandId] = useState<string | null>(search.get("brand"));
  useEffect(() => {
    if (!brandId && brands.length > 0) setBrandId(brands[0]!.id);
  }, [brandId, brands]);
  const plans = useApi<ApiPlanPreview[]>(brandId ? `/brands/${encodeURIComponent(brandId)}/plans` : null, 0);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (plans.data && plans.data.length > 0 && !plans.data.some((f) => f.target === target)) setTarget(plans.data[0]!.target);
  }, [plans.data, target]);
  const [start, setStart] = useState<string>(START);
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dollars = Number(budget);
  const valid = brandId && target && start !== target && Number.isFinite(dollars) && dollars > 0;
  // A reactive campaign starts from an outcome about a person: each Unit of it that lands is pushed up.
  const starts = [START, ...(catalogue?.outcomes.filter((o) => (o.subject === "lead" || o.subject === "company") && !o.retired && o.id !== target).map((o) => o.id) ?? [])];

  const create = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const body: ApiNewCampaign = { brandId: brandId!, start, target: target!, dailyBudgetCents: Math.round(dollars * 100), ...(brief.trim() ? { brief: brief.trim() } : {}) };
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
        <PageHeader title="Start a campaign" sub="Pick a brand, a Target and a budget, then say your strategy in your own words. The campaign starts paused: you launch it." />
        {overview && brands.length === 0 ? (
          <div className="k-card">
            <EmptyNote>
              No brand yet. <Link href="/brands/new/" className="k-accent">Add a brand</Link> first.
            </EmptyNote>
          </div>
        ) : (
          <div className="space-y-6">
            <Field label="Brand">
              <select className="k-input w-full max-w-[360px] px-1.5" style={{ font: "inherit" }} value={brandId ?? ""} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.test ? " (staff test)" : ""}
                  </option>
                ))}
              </select>
            </Field>

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

            <Field label="Start" hint="Start pulls new people from the market at each tick. Any other outcome pushes each Unit of it that lands up to the Target.">
              <select className="k-input w-full max-w-[360px] px-1.5" style={{ font: "inherit" }} value={start} onChange={(e) => setStart(e.target.value)}>
                {starts.map((o) => (
                  <option key={o} value={o}>
                    {outcomeName(catalogue, o)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Strategy" hint="A judge reads it once for each Engine and keeps the scripts that fit, daily caps and a test length.">
              <textarea
                aria-label="Strategy"
                className="k-input min-h-[88px] w-full px-2 py-1.5"
                style={{ font: "inherit", height: "auto" }}
                placeholder="Cold email and LinkedIn. At most 30 emails a day. A 30-day test."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </Field>

            <Field label="Daily cap" hint="A hard cap. No run starts once today's spend would pass it.">
              <label className="k-input flex w-48 items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input aria-label="Daily cap in dollars" className="w-full min-w-0 bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} />
                <span className="k-fg3 shrink-0">per day</span>
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
          <p className="k-fg3 mt-0.5 inline-flex items-center gap-1.5 text-[12px]">
            <Mark kind="routing" id={plan.routing.id} size={14} />
            Routing: {plan.routing.name}
          </p>
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
