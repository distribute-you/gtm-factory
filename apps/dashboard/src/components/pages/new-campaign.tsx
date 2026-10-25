"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { START, defaultStrategyId, describeCondition, type Campaign, type RankedFunnel, type WorldClient } from "@gtm-factory/engine";
import { OutcomeChip } from "@/components/funnel-line";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, RoiLabel, SectionTitle, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { campaignHref } from "./campaigns";
import { freshCampaignId, newClient } from "@/lib/campaigns";
import { outcomeLabel, pipeName, proposeFunnels, type Model } from "@/lib/model";
import { formatCount, formatRatePct, formatRoi, formatUsd, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

type Step = "client" | "goal" | "funnels";
const STEPS: { id: Step; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "goal", label: "What you want" },
  { id: "funnels", label: "Best funnels" },
];

interface Draft {
  /** An existing brand, or null for a new client. */
  brandId: string | null;
  name: string;
  audienceText: string;
  target: string;
  /** Start, or a trigger id whose events open the funnel. */
  entry: string;
  value: string;
  perDay: string;
  campaignName: string;
  strategies: Record<string, string>;
  funnel: number;
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

/** Lead states with a track, the highest rank of its track first. */
function trackedOutcomes(model: Model): string[] {
  return model.tracks.flatMap((t) => [...t.states].reverse().map((s) => s.outcome));
}

/** The value of one target outcome a client stated, else the fleet median of stated ones. */
function statedValue(model: Model, brandId: string | null, target: string): number | null {
  const top = model.tracks.some((t) => t.states[t.states.length - 1]?.outcome === target);
  const of = (c: WorldClient) => c.offer.outcomeValues?.[target] ?? (top ? c.offer.lifetimeRevenue : undefined);
  const mine = brandId ? model.clients.find((c) => c.brand.id === brandId) : undefined;
  const own = mine ? of(mine) : undefined;
  if (own) return own;
  const all = model.clients.map(of).filter((x): x is number => !!x && x > 0).sort((a, b) => a - b);
  if (all.length === 0) return null;
  return all.length % 2 ? all[(all.length - 1) / 2]! : (all[all.length / 2 - 1]! + all[all.length / 2]!) / 2;
}

function defaultDraft(model: Model, existing: boolean): Draft {
  const first = model.clients[0];
  const target = trackedOutcomes(model)[0] ?? "";
  const value = statedValue(model, existing && first ? first.brand.id : null, target);
  return {
    brandId: existing && first ? first.brand.id : null,
    name: "Brightloop Accounting",
    audienceText: "Founders of growing software companies in Europe and the United States.",
    target,
    entry: START,
    value: value ? String(value) : "1000",
    perDay: "30",
    campaignName: "",
    strategies: {},
    funnel: 0,
  };
}

function Flow({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const { dispatch } = useSim();
  const opensOnFunnels = search.get("step") === "funnels";
  const [step, setStep] = useState<Step>(opensOnFunnels ? "funnels" : "client");
  const [d, setD] = useState<Draft>(() => defaultDraft(model, opensOnFunnels));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const client = d.brandId ? model.clients.find((c) => c.brand.id === d.brandId) ?? null : null;
  const offerOutcomes = client ? client.offer.outcomes : trackedOutcomes(model);
  const targets = trackedOutcomes(model).filter((o) => offerOutcomes.includes(o));
  const entries = [{ id: START, label: "The market (Start)", event: START }, ...model.catalogue.triggers.filter((t) => !t.retired && t.event).map((t) => ({ id: t.id, label: `${t.label} (a trigger)`, event: t.event! }))];
  const entry = entries.find((e) => e.id === d.entry) ?? entries[0]!;
  const value = Number(d.value) || 0;
  const funnels = useMemo(() => (step === "funnels" && d.target ? proposeFunnels(model, offerOutcomes, d.target, value, entry.event) : []), [model, step, offerOutcomes, d.target, value, entry.event]);
  const chosen: RankedFunnel | undefined = funnels[Math.min(d.funnel, funnels.length - 1)];
  // Pipes whose play the campaign may choose: each leg's pipe, and every pipe with a strategy beyond its default.
  const playable = useMemo(() => {
    const ids: string[] = [];
    for (const l of chosen?.legs ?? []) if (!ids.includes(l.pipeId)) ids.push(l.pipeId);
    for (const s of model.catalogue.strategies) if (!s.retired && s.id !== defaultStrategyId(s.pipeId) && !ids.includes(s.pipeId)) ids.push(s.pipeId);
    return ids.map((id) => model.catalogue.pipe(id)).filter((p): p is NonNullable<typeof p> => !!p && model.catalogue.strategiesOf(p.id).length > 1);
  }, [model, chosen]);

  const launch = () => {
    if (!chosen) return;
    const brandId = client?.brand.id ?? null;
    const base: WorldClient = client
      ? { ...client, campaigns: [], seeds: [] }
      : newClient(model, { name: d.name.trim() || "New client", audienceText: d.audienceText, offerOutcomes: trackedOutcomes(model), outcomeValues: { [d.target]: value } });
    const id = freshCampaignId(model, `campaign-${(brandId ?? base.brand.id).replace(/^brand-/, "")}`);
    const pinned: Record<number, string> = {};
    chosen.legs.forEach((l, k) => (pinned[k] = l.pipeId));
    const campaign: Campaign = {
      id,
      brandId: base.brand.id,
      offerId: base.offer.id,
      name: d.campaignName.trim() || `${outcomeLabel(model.catalogue, d.target)} from ${entry.id === START ? pipeName(model.catalogue, chosen.legs[0]!.pipeId).toLowerCase() : entry.label.replace(/ \(a trigger\)$/, "").toLowerCase()}`,
      entry: entry.id === START ? { kind: "start" } : { kind: "trigger", triggerId: entry.id },
      line: chosen.line.slice(1),
      dailyBudgetCents: Math.round((Number(d.perDay) || 0) * 100),
      status: "running",
      strategies: Object.fromEntries(Object.entries(d.strategies).filter(([pipe, s]) => s !== defaultStrategyId(pipe))),
      pinned,
    };
    const err = dispatch({ type: "launch", client: { ...base, campaigns: [campaign] } });
    setError(err);
    if (!err) router.push(campaignHref(id));
  };

  return (
    <>
      <PageHeader title="New campaign" sub="Say who it is for and what you want. The engine ranks the sales funnels by value per dollar." />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => {
          const at = STEPS.findIndex((x) => x.id === step);
          return (
            <li key={s.id} className={`flex items-center gap-2 text-[13px] ${i === at ? "" : "k-fg3"}`} aria-current={i === at ? "step" : undefined}>
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${i < at ? "bg-[var(--run)] text-white" : i === at ? "bg-[var(--fg-1)] text-[var(--bg-surface)]" : "shadow-[inset_0_0_0_1px_var(--line)]"}`}>
                {i < at ? <CheckIcon size={11} weight="bold" /> : i + 1}
              </span>
              {s.label}
              {i < STEPS.length - 1 && <span className="k-fg4">·</span>}
            </li>
          );
        })}
      </ol>

      {step === "client" && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {model.clients.map((c) => (
              <button key={c.brand.id} type="button" className={`k-card ${d.brandId === c.brand.id ? "k-card-on" : ""} flex items-center gap-3 p-3 text-left`} onClick={() => set({ brandId: c.brand.id })}>
                <Mark kind="audience" id={c.brand.id} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{c.brand.name}</span>
                  <span className="k-fg3 block truncate text-[12px]">{c.campaigns.length} campaigns running here</span>
                </span>
              </button>
            ))}
            <button type="button" className={`k-card ${d.brandId === null ? "k-card-on" : ""} flex items-center gap-3 p-3 text-left`} onClick={() => set({ brandId: null })}>
              <Mark kind="audience" id="new" size={28} quiet />
              <span className="text-[13px] font-medium">A new client</span>
            </button>
          </div>
          {d.brandId === null && (
            <div className="k-card space-y-3 p-4">
              <Field label="Client name">
                <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Who to reach, in one sentence">
                <textarea className="k-input w-full resize-y px-2 py-1.5 leading-6" style={{ font: "inherit", height: "auto" }} rows={2} value={d.audienceText} onChange={(e) => set({ audienceText: e.target.value })} />
              </Field>
              <p className="k-fg3 text-[12px]">This sentence becomes the first ICP: an occurrence other ICPs compete with. A finer one comes from the data later.</p>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="k-btn-strong" onClick={() => setStep("goal")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "goal" && (
        <div className="space-y-4">
          <div className="k-card space-y-4 p-4">
            <Field label="What you want">
              <div className="flex flex-wrap gap-1">
                {targets.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={`k-chip ${d.target === o ? "k-chip-on" : ""}`}
                    onClick={() => {
                      const v = statedValue(model, d.brandId, o);
                      set({ target: o, value: v ? String(v) : d.value, funnel: 0 });
                    }}
                  >
                    {outcomeLabel(model.catalogue, o)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Where the funnel starts">
              <div className="flex flex-wrap gap-1">
                {entries.map((e) => (
                  <button key={e.id} type="button" className={`k-chip ${d.entry === e.id ? "k-chip-on" : ""}`} onClick={() => set({ entry: e.id, funnel: 0 })}>
                    {e.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`Value of one ${outcomeLabel(model.catalogue, d.target).toLowerCase()}`}>
              <span className="k-input inline-flex w-[160px] items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input aria-label="Value" className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={d.value} onChange={(e) => set({ value: e.target.value.replace(/[^0-9.]/g, "") })} />
              </span>
            </Field>
          </div>
          <div className="flex justify-between">
            <button type="button" className="k-btn-ghost" onClick={() => setStep("client")}>
              Back
            </button>
            <button type="button" className="k-btn-strong" disabled={!d.target} onClick={() => setStep("funnels")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "funnels" && (
        <div className="space-y-6">
          <section>
            <SectionTitle count={funnels.length} right={<span>Priced on every client&apos;s measured legs</span>}>
              Best sales funnels to {outcomeLabel(model.catalogue, d.target).toLowerCase()}
            </SectionTitle>
            {funnels.length === 0 ? (
              <div className="k-card">
                <EmptyNote>No sales funnel reaches this outcome from this start. Pick another start or outcome.</EmptyNote>
              </div>
            ) : (
              <div className="space-y-2">
                {funnels.map((f, i) => (
                  <FunnelCard key={f.legs.map((l) => l.pipeId).join(">")} model={model} funnel={f} selected={i === Math.min(d.funnel, funnels.length - 1)} onSelect={() => set({ funnel: i })} />
                ))}
              </div>
            )}
          </section>

          {chosen && (
            <section>
              <SectionTitle count={playable.length} right={<span>A strategy states conditions per input. The default lets every script compete.</span>}>
                Plays
              </SectionTitle>
              <div className="k-card divide-y divide-[var(--line-subtle)]">
                {playable.map((p) => {
                  const options = model.catalogue.strategiesOf(p.id);
                  const value = d.strategies[p.id] ?? defaultStrategyId(p.id);
                  const s = model.catalogue.strategy(value);
                  return (
                    <div key={p.id} className="grid items-center gap-2 px-4 py-3 md:grid-cols-[220px_minmax(0,1fr)]">
                      <span className="flex min-w-0 items-center gap-2">
                        <Mark kind="pipe" id={p.id} icon={p.icon} size={22} />
                        <span className="truncate text-[13px] font-medium">{p.name}</span>
                      </span>
                      <span className="min-w-0">
                        <select className="k-input w-full px-1.5" style={{ font: "inherit" }} value={value} onChange={(e) => set({ strategies: { ...d.strategies, [p.id]: e.target.value } })}>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.id === defaultStrategyId(p.id) ? "Default: every script" : o.name}
                              {o.proposed ? " (proposed by a split)" : ""}
                            </option>
                          ))}
                        </select>
                        {s && s.rules.length + (s.subject?.length ?? 0) > 0 && (
                          <span className="k-fg3 mt-1 block text-[12px]">
                            {[
                              ...s.rules.map((r) => `${r.input ? `At ${outcomeLabel(model.catalogue, r.input).toLowerCase()}: ` : ""}${r.conditions.map((c) => describeCondition(c, model.catalogue)).join(", ")}`),
                              ...(s.subject ?? []).map((c) => describeCondition(c, model.catalogue)),
                            ].join(" · ")}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                {playable.length === 0 && <EmptyNote>Every pipe of this funnel plays its default.</EmptyNote>}
              </div>
            </section>
          )}

          {chosen && (
            <div className="k-card space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Campaign name">
                  <input className="k-input w-full px-2" style={{ font: "inherit" }} placeholder="Named after its funnel" value={d.campaignName} onChange={(e) => set({ campaignName: e.target.value })} />
                </Field>
                <Field label="Daily budget">
                  <span className="k-input inline-flex w-full items-center gap-1 px-2">
                    <span className="k-fg3">$</span>
                    <input aria-label="Dollars per day" className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={d.perDay} onChange={(e) => set({ perDay: e.target.value.replace(/[^0-9.]/g, "") })} />
                    <span className="k-fg3">/day</span>
                  </span>
                </Field>
              </div>
              <button type="button" className="k-cta w-full justify-center" onClick={launch}>
                <RocketLaunchIcon size={16} weight="fill" />
                Launch and earn {formatRoi(chosen.valuePerDollar)} per $1 expected
              </button>
              {error && <p className="text-[12px] text-[var(--data-rose)]">{error}</p>}
            </div>
          )}
          <button type="button" className="k-btn-ghost" onClick={() => setStep("goal")}>
            Back
          </button>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="k-label block">{label}</span>
      {children}
    </label>
  );
}

/** One proposed funnel: its line, value per dollar, cost per target, and each leg's leads needed. */
function FunnelCard({ model, funnel, selected, onSelect }: { model: Model; funnel: RankedFunnel; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={`k-card ${selected ? "k-card-on" : ""} block w-full p-4 text-left`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
          <OutcomeChip model={model} outcome={funnel.line[0]!} />
          {funnel.legs.map((l) => (
            <span key={`${l.from}>${l.to}:${l.pipeId}`} className="inline-flex items-center gap-1.5">
              <span className="k-fg4">→</span>
              <span className="inline-flex items-center gap-1">
                <Mark kind="pipe" id={l.pipeId} icon={model.catalogue.pipe(l.pipeId)?.icon} size={14} />
                <span>{pipeName(model.catalogue, l.pipeId)}</span>
              </span>
              <span className="k-fg4">→</span>
              <OutcomeChip model={model} outcome={l.to} />
            </span>
          ))}
        </span>
        <span className="text-right">
          <span className={`block text-[18px] font-medium tabular-nums ${roiIsGood(funnel.valuePerDollar) ? "text-[var(--run)]" : ""}`}>{formatRoi(funnel.valuePerDollar)}</span>
          <span className="k-fg3 block text-[11px]">
            <RoiLabel>per $1</RoiLabel> · {funnel.label === "measured" ? "measured" : "expected"}
          </span>
        </span>
      </div>
      <div className="k-inset mt-3 grid rounded-[8px] text-[12px]" style={{ gridTemplateColumns: `repeat(${funnel.legs.length + 1}, minmax(0, 1fr))` }}>
        <div className="px-3 py-2">
          <p className="k-label">$ per target</p>
          <p className="text-[14px] font-medium tabular-nums">{formatUsd(funnel.costPerTarget)}</p>
        </div>
        {funnel.legs.map((l) => (
          <div key={`${l.from}>${l.to}`} className="min-w-0 border-l border-[var(--line-subtle)] px-3 py-2">
            <p className="k-label truncate">{outcomeLabel(model.catalogue, l.to)}</p>
            <p className="tabular-nums">
              {formatRatePct(l.estimate.yieldRate)} · {formatUsd(l.estimate.costPerAttempt)} each
            </p>
            <p className="k-fg3 tabular-nums">{Number.isFinite(l.leadsNeeded) ? `${formatCount(l.leadsNeeded)} leads needed` : "—"}</p>
          </div>
        ))}
      </div>
    </button>
  );
}
