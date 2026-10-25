"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { resolveLifetimeRevenue, type Offer, type RankedFunnel, type SimClient } from "@gtm-factory/engine";
import { FunnelLine } from "@/components/funnel-line";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, RoiLabel, SectionTitle, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { campaignHref } from "./campaigns";
import { audiencesFromIcp } from "@/lib/expert";
import { funnelName, stepLabel, stepValues, type Model } from "@/lib/model";
import { formatCount, formatRatePct, formatRoi, formatUsd, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

type Step = "client" | "target" | "funnels";
const STEPS: { id: Step; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "target", label: "What you want" },
  { id: "funnels", label: "Best funnels" },
];

interface Draft {
  /** An existing brand's id, or null for a new client. */
  brandId: string | null;
  brandName: string;
  offerName: string;
  icp: string;
  steps: string[];
  ltr: string;
  budgetMode: "day" | "volume";
  perDay: string;
  volume: string;
  target: string;
}

export function NewCampaignPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: "New campaign" }]} />
      <Page narrow>{model ? <Flow model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function defaultDraft(model: Model): Draft {
  const steps = model.catalogue.steps.filter((s) => !s.retired).map((s) => s.key);
  const top = model.tracks[0]?.states[model.tracks[0].states.length - 1];
  const targetStep = model.catalogue.steps.find((s) => s.leadState?.state === top?.state && s.key === top?.state)?.key ?? steps[steps.length - 1] ?? "";
  return {
    brandId: null,
    brandName: "Brightloop Accounting",
    offerName: "Monthly bookkeeping",
    icp: "Founders of small software startups in Europe",
    steps,
    ltr: "",
    budgetMode: "day",
    perDay: "80",
    volume: "800",
    target: targetStep,
  };
}

function Flow({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const { dispatch, actions } = useSim();
  const asked = search.get("step");
  const [step, setStep] = useState<Step>(STEPS.some((s) => s.id === asked) ? (asked as Step) : "client");
  const [d, setD] = useState<Draft>(() => defaultDraft(model));
  const [enginePicks, setEnginePicks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const existing = d.brandId ? model.clients.find((c) => c.brand.id === d.brandId) : undefined;
  const launches = actions.filter((a) => a.action.type === "launch").length;
  const brandId = existing?.brand.id ?? `brand-x${launches + 1}`;

  const offer: Offer = useMemo(
    () =>
      existing
        ? existing.offer
        : {
            id: `offer-x${launches + 1}`,
            brandId,
            name: d.offerName || "Main offer",
            steps: d.steps,
            ...(Number(d.ltr) > 0 ? { lifetimeRevenue: Number(d.ltr) } : {}),
          },
    [existing, launches, brandId, d.offerName, d.steps, d.ltr],
  );
  const fleetOffers = model.clients.map((c) => c.offer);
  const ltr = resolveLifetimeRevenue(offer, fleetOffers);
  const fleetMedian = resolveLifetimeRevenue({ ...offer, lifetimeRevenue: undefined }, fleetOffers);

  // What each lead state of the offer is worth: the lifetime revenue at the top, value backward below it.
  const top = topOfOffer(model, offer);
  const stateValues = useMemo(() => {
    if (!top || !ltr) return new Map<string, number>();
    const pseudo: SimClient = {
      org: { id: "o", name: "o" },
      brand: { id: brandId, orgId: "o", name: d.brandName, icp: d.icp },
      offer: { ...offer, lifetimeRevenue: ltr.amount },
      campaign: { id: "draft", offerId: offer.id, target: top, dailyBudgetCents: 0, status: "paused" },
      expertAudiences: [],
    };
    return stepValues(model, pseudo);
  }, [model, offer, top, ltr, brandId, d.brandName, d.icp]);

  const targets = model.catalogue.steps.filter((s) => s.leadState && offer.steps.includes(s.key) && !s.retired);
  const targetKey = targets.some((t) => t.key === d.target) ? d.target : (top ?? targets[0]?.key ?? "");
  const targetValue = targetKey === top ? (ltr?.amount ?? null) : (stateValues.get(targetKey) ?? null);

  const proposal = useMemo(
    () => (targetKey ? model.session.proposeFunnels(offer, targetKey, { brandId, limit: 6, ...(targetValue != null ? { value: targetValue } : {}) }) : null),
    [model, offer, targetKey, brandId, targetValue],
  );

  const launch = (f: RankedFunnel | null) => {
    setError(null);
    const perDay = Math.round(Number(d.perDay) * 100);
    if (!(perDay > 0)) return setError("Set a daily amount above $0.");
    const n = launches + 1;
    const client: SimClient = {
      org: existing ? existing.org : { id: `org-x${n}`, name: d.brandName },
      brand: existing ? existing.brand : { id: brandId, orgId: `org-x${n}`, name: d.brandName || "New client", icp: d.icp },
      offer: targetKey !== top && targetValue != null ? { ...offer, outcomeValues: { ...(offer.outcomeValues ?? {}), [targetKey]: Math.round(targetValue) } } : offer,
      campaign: {
        id: `campaign-x${n}`,
        offerId: offer.id,
        target: targetKey,
        dailyBudgetCents: perDay,
        status: "running",
        ...(d.budgetMode === "volume" ? { maxVolume: Math.max(1, Math.round(Number(d.volume) || 0)) } : {}),
        ...(f && !enginePicks ? { salesFunnel: f.legs.map((l) => l.playId) } : {}),
      },
      expertAudiences: existing ? [] : audiencesFromIcp(d.icp),
    };
    const err = dispatch({ type: "launch", client });
    if (err) return setError(err);
    router.push(campaignHref(client.campaign.id));
  };

  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <>
      <PageHeader title="New campaign" sub="Tell us who you sell to and what you want. The engine lays out the best sales funnels for it." />
      <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-[13px]" aria-current={s.id === step ? "step" : undefined}>
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] tabular-nums ${
                i < idx ? "bg-[var(--accent)] text-white" : i === idx ? "bg-[var(--bg-strong)] text-white" : "k-inset k-fg3"
              }`}
            >
              {i < idx ? <CheckIcon size={12} weight="bold" /> : i + 1}
            </span>
            <span className={i === idx ? "font-medium" : "k-fg3"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-[var(--line)]" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {step === "client" && (
        <ClientStep model={model} d={d} set={set} ltrDefault={fleetMedian?.amount ?? null} />
      )}
      {step === "target" && (
        <section className="gs-in">
          <SectionTitle>What do you want?</SectionTitle>
          <p className="k-fg2 -mt-1 mb-3 text-[13px]">Pick the outcome this campaign is for. Its value decides how much is worth spending.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {targets.map((t) => {
              const v = t.key === top ? ltr?.amount : stateValues.get(t.key);
              const on = t.key === targetKey;
              return (
                <button key={t.key} type="button" onClick={() => set({ target: t.key })} className={`k-card flex items-center gap-3 px-3 py-3 text-left ${on ? "k-card-on" : ""}`} aria-pressed={on}>
                  <Mark kind="step" id={t.key} icon={t.icon} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className={`block ${on ? "font-medium" : ""}`}>{t.label}</span>
                    <span className="k-fg3 block text-[12px]">
                      {model.tracks.find((x) => x.id === t.leadState?.leadTrack)?.label} · worth {v != null ? formatUsd(v) : "—"}
                      {t.key === top ? (ltr?.label === "expected" ? " (fleet median)" : " (stated)") : " (expected)"}
                    </span>
                  </span>
                  {on && <CheckIcon size={16} className="k-accent" weight="bold" />}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {step === "funnels" && proposal && (
        <section className="gs-in">
          <SectionTitle right={<span>Ranked by value per dollar</span>}>
            Best sales funnels for {stepLabel(model.catalogue, targetKey)}
          </SectionTitle>
          <p className="k-fg2 -mt-1 mb-3 text-[13px]">
            One {stepLabel(model.catalogue, targetKey).toLowerCase()} is worth {proposal.value != null ? formatUsd(proposal.value) : "—"}. Each funnel below is a straight line: one channel between every two steps.
          </p>
          <label className="k-card mb-3 flex cursor-pointer items-center gap-3 px-3 py-2.5">
            <input type="checkbox" checked={enginePicks} onChange={(e) => setEnginePicks(e.target.checked)} />
            <span>
              <span className="block text-[13px]">Let the engine switch funnels every week</span>
              <span className="k-fg3 block text-[12px]">It keeps the one worth the most per dollar as it learns.</span>
            </span>
          </label>
          {proposal.funnels.length === 0 ? (
            <div className="k-card">
              <EmptyNote>No funnel reaches this outcome with the steps this offer has. Add steps or pick another outcome.</EmptyNote>
            </div>
          ) : (
            <div className="space-y-3">
              {proposal.funnels.map((f, i) => (
                <FunnelCard key={f.id} model={model} f={f} best={i === 0} onLaunch={() => launch(f)} />
              ))}
            </div>
          )}
          {error && <p className="mt-3 text-[12px] text-[var(--data-rose)]">{error}</p>}
        </section>
      )}

      <div className="mt-6 flex items-center justify-between">
        {idx > 0 ? (
          <button type="button" className="k-btn" onClick={() => setStep(STEPS[idx - 1]!.id)}>
            Back
          </button>
        ) : (
          <span />
        )}
        {idx < STEPS.length - 1 && (
          <button type="button" className="k-btn-accent" onClick={() => setStep(STEPS[idx + 1]!.id)} disabled={step === "client" && !d.brandId && (!d.brandName.trim() || !d.icp.trim())}>
            Continue
          </button>
        )}
      </div>
    </>
  );
}

function topOfOffer(model: Model, offer: Offer): string | null {
  let best: { key: string; rank: number } | null = null;
  for (const s of model.catalogue.steps) {
    if (!s.leadState || s.retired || !offer.steps.includes(s.key)) continue;
    if (s.leadState.leadTrack !== model.tracks[0]?.id) continue;
    if (!best || s.leadState.rank > best.rank || (s.leadState.rank === best.rank && s.key === s.leadState.state)) best = { key: s.key, rank: s.leadState.rank };
  }
  return best?.key ?? null;
}

function ClientStep({ model, d, set, ltrDefault }: { model: Model; d: Draft; set: (p: Partial<Draft>) => void; ltrDefault: number | null }) {
  const brands = [...new Map(model.clients.map((c) => [c.brand.id, c])).values()];
  const leadSteps = model.catalogue.steps.filter((s) => !s.retired && s.leadState);
  const otherSteps = model.catalogue.steps.filter((s) => !s.retired && !s.leadState);
  const toggle = (key: string) => set({ steps: d.steps.includes(key) ? d.steps.filter((k) => k !== key) : [...d.steps, key] });
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Who is it for?</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <button type="button" onClick={() => set({ brandId: null })} className={`k-card flex items-center gap-3 px-3 py-3 text-left ${d.brandId === null ? "k-card-on" : ""}`} aria-pressed={d.brandId === null}>
            <Mark kind="audience" id="new" size={32} quiet />
            <span>
              <span className="block font-medium">A new client</span>
              <span className="k-fg3 block text-[12px]">Describe the brand and its offer</span>
            </span>
          </button>
          {brands.map((c) => (
            <button key={c.brand.id} type="button" onClick={() => set({ brandId: c.brand.id })} className={`k-card flex items-center gap-3 px-3 py-3 text-left ${d.brandId === c.brand.id ? "k-card-on" : ""}`} aria-pressed={d.brandId === c.brand.id}>
              <Mark kind="audience" id={c.brand.id} size={32} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.brand.name}</span>
                <span className="k-fg3 block truncate text-[12px]">{c.brand.icp}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      {d.brandId === null && (
        <section className="k-card grid gap-4 p-4 md:grid-cols-2">
          <Field label="Brand">
            <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.brandName} onChange={(e) => set({ brandName: e.target.value })} />
          </Field>
          <Field label="Offer">
            <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.offerName} onChange={(e) => set({ offerName: e.target.value })} />
          </Field>
          <Field label="Who you sell to, in one sentence" wide>
            <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.icp} onChange={(e) => set({ icp: e.target.value })} />
            <span className="k-fg3 mt-1 block text-[12px]">An expert step turns it into audiences: {audiencesFromIcp(d.icp).map((a) => a.name).join(", ")}.</span>
          </Field>
          <Field label="What one client brings you (optional)">
            <span className="k-input flex items-center gap-1 px-2">
              <span className="k-fg3">$</span>
              <input
                className="w-full bg-transparent outline-none"
                style={{ font: "inherit" }}
                placeholder={ltrDefault != null ? `${Math.round(ltrDefault)} (fleet median)` : ""}
                value={d.ltr}
                onChange={(e) => set({ ltr: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </span>
            <span className="k-fg3 mt-1 block text-[12px]">{d.ltr ? "Stated by you." : `Empty: we use the fleet median, ${ltrDefault != null ? formatUsd(ltrDefault) : "—"}, labelled expected.`}</span>
          </Field>
          <Field label="Budget">
            <span className="flex gap-1.5">
              <button type="button" className={`k-card px-2.5 py-1 text-[12px] ${d.budgetMode === "day" ? "k-card-on" : ""}`} onClick={() => set({ budgetMode: "day" })}>
                Per day
              </button>
              <button type="button" className={`k-card px-2.5 py-1 text-[12px] ${d.budgetMode === "volume" ? "k-card-on" : ""}`} onClick={() => set({ budgetMode: "volume" })}>
                A volume of leads
              </button>
            </span>
            <span className="mt-1.5 flex gap-2">
              <span className="k-input flex flex-1 items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input className="w-full bg-transparent outline-none" style={{ font: "inherit" }} value={d.perDay} onChange={(e) => set({ perDay: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Up to, per day" />
                <span className="k-fg3 text-[12px]">/day</span>
              </span>
              {d.budgetMode === "volume" && (
                <span className="k-input flex flex-1 items-center gap-1 px-2">
                  <input className="w-full bg-transparent outline-none" style={{ font: "inherit" }} value={d.volume} onChange={(e) => set({ volume: e.target.value.replace(/[^0-9]/g, "") })} aria-label="New leads in total" />
                  <span className="k-fg3 text-[12px]">leads</span>
                </span>
              )}
            </span>
          </Field>
          <Field label={`Steps this business has (${d.steps.length})`} wide>
            <span className="flex flex-wrap gap-1.5">
              {[...leadSteps, ...otherSteps].map((s) => {
                const on = d.steps.includes(s.key);
                return (
                  <button key={s.key} type="button" onClick={() => toggle(s.key)} className={`k-chip ${on ? "k-fg" : "k-fg4"}`} aria-pressed={on} style={on ? {} : { opacity: 0.6 }}>
                    <Mark kind="step" id={s.key} icon={s.icon} size={14} />
                    {s.label}
                  </button>
                );
              })}
            </span>
            <span className="k-fg3 mt-1 block text-[12px]">A step the business does not have is never on a funnel. A firm with no signup never walks a signup.</span>
          </Field>
        </section>
      )}
      {d.brandId !== null && (
        <section className="k-card grid gap-4 p-4 md:grid-cols-2">
          <Field label="Budget for this campaign">
            <span className="k-input flex items-center gap-1 px-2">
              <span className="k-fg3">$</span>
              <input className="w-full bg-transparent outline-none" style={{ font: "inherit" }} value={d.perDay} onChange={(e) => set({ perDay: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Up to, per day" />
              <span className="k-fg3 text-[12px]">/day</span>
            </span>
          </Field>
          <Field label="Offer">
            <span className="k-fg2 text-[13px]">{model.clients.find((c) => c.brand.id === d.brandId)?.offer.name}</span>
          </Field>
        </section>
      )}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="k-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function FunnelCard({ model, f, best, onLaunch }: { model: Model; f: RankedFunnel; best: boolean; onLaunch: () => void }) {
  const plays = f.legs.map((l) => l.playId);
  return (
    <div className={`k-card p-4 ${best ? "k-card-accent" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Mark kind="funnel" id={f.id} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{funnelName(model.catalogue, plays)}</span>
            {best && <span className="k-chip">Best value per dollar</span>}
            <span className="k-chip">{f.label === "measured" ? "Measured" : "Expected"}</span>
          </div>
          <div className="mt-1">
            <FunnelLine catalogue={model.catalogue} plays={plays} />
          </div>
        </div>
        <div className="flex items-start gap-5 text-right">
          <span className="flex flex-col items-end">
            <span className="k-label">
              <RoiLabel />
            </span>
            <span className={`text-[18px] font-medium tabular-nums ${roiIsGood(f.valuePerDollar) ? "text-[var(--run)]" : ""}`}>{formatRoi(f.valuePerDollar)}</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="k-label">$ / outcome</span>
            <span className="text-[18px] font-medium tabular-nums">{formatUsd(f.costPerTarget)}</span>
          </span>
          <button type="button" onClick={onLaunch} className={best ? "k-btn-accent" : "k-btn"}>
            <RocketLaunchIcon size={13} />
            Launch
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${f.legs.length}, minmax(0, 1fr))` }}>
        {f.legs.map((l) => {
          const pipe = model.catalogue.pipe(l.pipeId);
          const ch = pipe ? model.catalogue.channel(pipe.channel) : undefined;
          return (
            <div key={l.playId} className="k-inset rounded-[8px] px-3 py-2">
              <span className="flex items-center gap-1.5 text-[12px]">
                <Mark kind="channel" id={pipe?.channel ?? ""} icon={ch?.icon} size={14} />
                <span className="truncate">{ch?.name}</span>
              </span>
              <span className="k-fg3 mt-1 block text-[12px] tabular-nums">
                Leads needed {formatCount(Math.ceil(l.leadsNeeded))} · {formatUsd(l.costPerTarget)}
              </span>
              <span className="k-fg3 block text-[12px] tabular-nums">
                {formatUsd(l.estimate.costPerTrial)} each · {formatRatePct(l.estimate.yieldRate)} go on
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

