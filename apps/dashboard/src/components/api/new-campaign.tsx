"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ApiCampaign, ApiNewCampaign, ApiRankedFunnel, CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, SectionTitle, TopBar, SelectItem } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { outcomeName, legTitle } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, formatRoi, roiIsGood } from "@/lib/format";
import { Field, ShimmerRows } from "./common";

export function ApiNewCampaignPage() {
  const search = useSearchParams();
  const router = useRouter();
  const { data: overview } = useFactory();
  const brands = overview?.brands ?? [];
  const [brandId, setBrandId] = useState<string | null>(search.get("brand"));
  useEffect(() => {
    if (!brandId && brands.length > 0) setBrandId(brands[0]!.id);
  }, [brandId, brands]);
  const funnels = useApi<ApiRankedFunnel[]>(brandId ? `/brands/${encodeURIComponent(brandId)}/funnels` : null, 0);
  const [funnelId, setFunnelId] = useState<string | null>(null);
  useEffect(() => {
    if (funnels.data && funnels.data.length > 0 && !funnels.data.some((f) => f.id === funnelId)) setFunnelId(funnels.data[0]!.id);
  }, [funnels.data, funnelId]);
  const [budget, setBudget] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dollars = Number(budget);
  const valid = brandId && funnelId && Number.isFinite(dollars) && dollars > 0;

  const create = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const f = funnels.data?.find((x) => x.id === funnelId);
    if (!f) return;
    // A sales funnel is a view: the campaign takes its start and its Target; its tree is rebuilt at every tick.
    const body: ApiNewCampaign = { brandId: brandId!, start: f.line[0]!, target: f.line[f.line.length - 1]!, dailyBudgetCents: Math.round(dollars * 100) };
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
        <PageHeader title="Start a campaign" sub="Pick a brand and a Target among the sales funnels its tree can run today. The campaign starts paused: you launch it." />
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
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                    {b.test ? " (staff test)" : ""}
                  </SelectItem>
                ))}
              </select>
            </Field>

            <section>
              <SectionTitle count={funnels.data?.length}>Best sales funnels for this brand</SectionTitle>
              {!funnels.answered ? (
                <ShimmerRows rows={3} />
              ) : funnels.error ? (
                <p className="text-[13px] text-[var(--data-rose)]">{funnels.error}</p>
              ) : funnels.data && funnels.data.length === 0 ? (
                <div className="k-card">
                  <EmptyNote>The catalogue has no sales funnel for this brand yet.</EmptyNote>
                </div>
              ) : (
                <div className="space-y-2">
                  {funnels.data?.map((f, i) => (
                    <FunnelCard key={f.id} funnel={f} rank={i} catalogue={overview?.catalogue} on={f.id === funnelId} onPick={() => setFunnelId(f.id)} />
                  ))}
                </div>
              )}
            </section>

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

function FunnelCard({ funnel, rank, catalogue, on, onPick }: { funnel: ApiRankedFunnel; rank: number; catalogue: CatalogueData | undefined; on: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className={`k-card block w-full p-4 text-left ${on ? "k-card-on" : ""}`}>
      <div className="flex items-start gap-3">
        <Mark kind="funnel" id={funnel.id} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[14px] ${on ? "font-medium" : ""}`}>{funnel.name}</span>
            {rank === 0 && <span className="k-chip">Best value per dollar</span>}
            <span className="k-chip">{funnel.label === "measured" ? "Measured" : "Expected"}</span>
          </div>
          <p className="k-fg3 mt-0.5 text-[12px]">{funnel.pathName}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            {funnel.line.map((o, i) => (
              <span key={o} className="inline-flex items-center gap-1.5">
                {i > 0 && (
                  <span className="k-fg3">
                    {funnel.steps[i - 1]?.legs.length ? (
                      <>
                        → <span className="k-fg2">{funnel.steps[i - 1]!.legs.map((p) => legTitle(catalogue, p)).join(", ")}</span> →
                      </>
                    ) : (
                      "→"
                    )}
                  </span>
                )}
                <span className="k-chip">{outcomeName(catalogue, o)}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`block text-[18px] font-medium tabular-nums ${roiIsGood(funnel.valuePerDollar) ? "text-[var(--run)]" : ""}`}>{formatRoi(funnel.valuePerDollar)}</span>
          <span className="k-fg3 block text-[12px]">value per dollar</span>
          <span className="mt-1 block text-[13px] tabular-nums">{formatCents(funnel.costPerTargetCents)}</span>
          <span className="k-fg3 block text-[12px]">per {outcomeName(catalogue, funnel.line[funnel.line.length - 1] ?? "").toLowerCase()}</span>
        </div>
      </div>
      {on && (
        <div className="k-inset mt-3 grid gap-px overflow-hidden rounded-[8px] text-[12px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, funnel.steps.length)}, minmax(0,1fr))` }}>
          {funnel.steps.map((l) => (
            <div key={`${l.from}>${l.to}`} className="px-3 py-2">
              <span className="k-label block">
                {outcomeName(catalogue, l.from)} to {outcomeName(catalogue, l.to)}
              </span>
              <span className="mt-1 block tabular-nums">
                {formatRatePct(l.yieldRate)} yield · {formatCents(l.costPerAttemptCents)} per attempt
              </span>
              <span className="k-fg3 block tabular-nums">
                {formatCount(l.attemptsPerTarget)} attempts per {outcomeName(catalogue, funnel.line[funnel.line.length - 1] ?? "").toLowerCase()} · {l.label === "measured" ? "measured" : "expected"}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
