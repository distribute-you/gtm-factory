"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { START, type Campaign, type WorldClient } from "@gtm-factory/core";
import { draftPlanLine } from "@/lib/plan";
import { Mark } from "@/components/mark";
import { EmptyNote, Page, PageHeader, RoiLabel, SectionTitle, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { campaignHref } from "./campaigns";
import { freshCampaignId, newClient } from "@/lib/campaigns";
import { outcomeLabel, type Model } from "@/lib/model";
import { formatRoi, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";

type Stage = "client" | "goal" | "plan";
const STAGES: { id: Stage; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "goal", label: "What you want" },
  { id: "plan", label: "Strategy and budget" },
];

interface Draft {
  /** An existing brand, or null for a new client. */
  brandId: string | null;
  name: string;
  audienceText: string;
  target: string;
  /** Start (the campaign pulls), or the outcome whose Units it pushes. */
  start: string;
  value: string;
  perDay: string;
  campaignName: string;
  description: string;
  /** Days of one budget period: 1 a day, 7 a week, 30 a month. */
  periodDays: number;
  /** Optional: at most this many new people per period; empty for none. */
  volume: string;
  /** Its strategy in plain words, long free text. */
  brief: string;
}

const PERIODS = [
  { days: 1, label: "day" },
  { days: 7, label: "week" },
  { days: 30, label: "month" },
];

export function NewCampaignPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Campaigns", href: "/campaigns/" }, { label: "New campaign" }]} />
      <Page narrow>{model ? <Flow model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

/** Milestones, the highest rank of each track first. */
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
    start: START,
    value: value ? String(value) : "1000",
    perDay: "30",
    campaignName: "",
    description: "",
    periodDays: 1,
    volume: "",
    brief: "Cold email and LinkedIn. Never write again to someone who asked to stop.",
  };
}

function Flow({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const { dispatch } = useSim();
  const opensOnPlan = search.get("stage") === "plan";
  const [stage, setStage] = useState<Stage>(opensOnPlan ? "plan" : "client");
  const [d, setD] = useState<Draft>(() => defaultDraft(model, opensOnPlan));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const client = d.brandId ? model.clients.find((c) => c.brand.id === d.brandId) ?? null : null;
  const offerOutcomes = client ? client.offer.outcomes : trackedOutcomes(model);
  const targets = trackedOutcomes(model).filter((o) => offerOutcomes.includes(o));
  // Start, or any outcome a script works on that is not a milestone: a reactive campaign pushes each one that lands.
  const events = model.catalogue.outcomes.filter((o) => o.subject === "lead" && !o.retired && !o.track && o.id !== d.target).map((o) => o.id);
  const starts = [{ id: START, label: "Proactive: looks for new people" }, ...events.map((o) => ({ id: o, label: `Reactive: on ${outcomeLabel(model.catalogue, o)}` }))];
  const start = starts.find((e) => e.id === d.start) ?? starts[0]!;
  // A reactive campaign needs an event some script makes or reads; else it is refused.
  const unmade = start.id !== START && !model.catalogue.canStartOn(start.id);
  const [newEvent, setNewEvent] = useState("");
  const createEvent = () => {
    const err = dispatch({ type: "outcome", label: newEvent.trim() });
    setError(err);
    if (!err) {
      set({ start: newEvent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") });
      setNewEvent("");
    }
  };
  const value = Number(d.value) || 0;
  const brandForPlan = client?.brand.id ?? model.clients[0]?.brand.id ?? "";
  const waits = start.id !== START && model.catalogue.outcome(start.id)?.event === true && !model.catalogue.isMade(start.id);
  const draft = useMemo(() => (stage === "plan" && d.target && brandForPlan ? draftPlanLine(model, brandForPlan, start.id, d.target) : null), [model, stage, d.target, brandForPlan, start.id]);
  // A campaign of the same brand already passing through the same milestones: its expected return, on the same formula.
  const sibling = draft ? model.campaigns.find((c) => c.brandId === brandForPlan && c.start === start.id && model.session.milestoneLine(c).join(">") === draft.line.join(">")) : undefined;
  const expected = sibling ? model.session.economics(sibling.id).expected.value : null;

  const launch = () => {
    if (!draft?.plan && !waits) return;
    const dollars = Number(d.perDay);
    if (!(dollars > 0)) return setError("A dollar budget is required.");
    if (!d.campaignName.trim() || !d.description.trim()) return setError("The demo cannot rewrite the name and description from your strategy. Type them here, or run your own host to have them written for you.");
    const volume = d.volume.trim() ? Math.round(Number(d.volume)) : 0;
    if (d.volume.trim() && !(volume >= 1)) return setError("A volume is at least 1 new person.");
    const brandId = client?.brand.id ?? null;
    const base: WorldClient = client
      ? { ...client, campaigns: [], seeds: [] }
      : newClient(model, { name: d.name.trim() || "New client", audienceText: d.audienceText, offerOutcomes: trackedOutcomes(model), outcomeValues: { [d.target]: value } });
    const id = freshCampaignId(model, `campaign-${(brandId ?? base.brand.id).replace(/^brand-/, "")}`);
    const campaign: Campaign = {
      id,
      brandId: base.brand.id,
      offerId: base.offer.id,
      name: d.campaignName.trim(),
      description: d.description.trim(),
      start: start.id,
      target: d.target,
      dailyBudgetCents: Math.round(dollars * 100),
      budgetPeriodDays: d.periodDays,
      ...(volume ? { volume: { units: volume, periodDays: d.periodDays } } : {}),
      status: "running",
      brief: d.brief.trim(),
    };
    const err = dispatch({ type: "launch", client: { ...base, campaigns: [campaign] } });
    setError(err);
    if (!err) router.push(campaignHref(id));
  };

  return (
    <>
      <PageHeader title="New campaign" sub="Say who it is for, the Target you want, your strategy and your budget. The Plan is recomputed at every tick." />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
        {STAGES.map((s, i) => {
          const at = STAGES.findIndex((x) => x.id === stage);
          return (
            <li key={s.id} className={`flex items-center gap-2 text-[13px] ${i === at ? "" : "k-fg3"}`} aria-current={i === at ? "true" : undefined}>
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${i < at ? "bg-[var(--run)] text-white" : i === at ? "bg-[var(--fg-1)] text-[var(--bg-surface)]" : "ring-1 ring-inset ring-[var(--line)]"}`}>
                {i < at ? <CheckIcon size={11} weight="bold" /> : i + 1}
              </span>
              {s.label}
              {i < STAGES.length - 1 && <span className="k-fg4">·</span>}
            </li>
          );
        })}
      </ol>

      {stage === "client" && (
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
              <p className="k-fg3 text-[12px]">This sentence becomes the first ICP: a Unit other ICPs compete with. A finer one comes from the data later.</p>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="k-btn-strong" onClick={() => setStage("goal")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {stage === "goal" && (
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
                      set({ target: o, value: v ? String(v) : d.value });
                    }}
                  >
                    {outcomeLabel(model.catalogue, o)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Proactive or reactive">
              <div className="flex flex-wrap gap-1">
                {starts.map((e) => (
                  <button key={e.id} type="button" className={`k-chip ${start.id === e.id ? "k-chip-on" : ""}`} onClick={() => set({ start: e.id })}>
                    {e.label}
                  </button>
                ))}
              </div>
            </Field>
            {unmade && (
              <div className="k-inset space-y-2 rounded-[8px] p-3 text-[13px]" data-testid="unmade-event">
                <p>No script makes or reads &ldquo;{start.label.replace("Reactive: on ", "")}&rdquo;, so this campaign would never start. Pick another event, or create the outcome.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="k-btn" onClick={() => set({ start: START })}>
                    Pick another event
                  </button>
                  <input aria-label="New outcome" className="k-input px-2" style={{ font: "inherit" }} placeholder="Name of the new outcome" value={newEvent} onChange={(e) => setNewEvent(e.target.value)} />
                  <button type="button" className="k-btn" disabled={!newEvent.trim()} onClick={createEvent}>
                    Create the outcome
                  </button>
                </div>
              </div>
            )}
            <Field label={`Value of one ${outcomeLabel(model.catalogue, d.target).toLowerCase()}`}>
              <span className="k-input inline-flex w-[160px] items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input aria-label="Value" className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={d.value} onChange={(e) => set({ value: e.target.value.replace(/[^0-9.]/g, "") })} />
              </span>
            </Field>
          </div>
          <div className="flex justify-between">
            <button type="button" className="k-btn-ghost" onClick={() => setStage("client")}>
              Back
            </button>
            <button type="button" className="k-btn-strong" disabled={!d.target || unmade} onClick={() => setStage("plan")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {stage === "plan" && (
        <div className="space-y-6">
          <section>
            <SectionTitle right={<span>Recomputed at every tick once it runs</span>}>The Plan it would run today</SectionTitle>
            {waits ? (
              <div className="k-card">
                <EmptyNote>No script makes this yet. The campaign waits for one.</EmptyNote>
              </div>
            ) : !draft?.plan || draft.parts.length === 0 ? (
              <div className="k-card">
                <EmptyNote>No Plan reaches this outcome from this start. Pick another start or outcome.</EmptyNote>
              </div>
            ) : (
              <div className="k-card space-y-2.5 p-4" data-testid="draft-plan">
                <p className="k-fg3 text-[12px]">
                  {expected != null ? (
                    <>
                      <RoiLabel>Expected</RoiLabel>: <span className={roiIsGood(expected) ? "text-[var(--run)]" : ""}>{formatRoi(expected)}</span> per $1, from {sibling!.name}.
                    </>
                  ) : (
                    "No campaign of this client runs it yet: the return is learned from its first days."
                  )}
                </p>
              </div>
            )}
          </section>

          {(waits || (draft?.plan && draft.parts.length > 0)) && (
            <div className="k-card space-y-3 p-4">
              <Field label="Strategy">
                <textarea className="k-input w-full resize-y px-2 py-1.5 leading-6" style={{ font: "inherit", height: "auto" }} rows={3} value={d.brief} onChange={(e) => set({ brief: e.target.value })} />
              </Field>
              <p className="k-fg3 text-[12px]">Write it as long as you like. The strategy is read once per Engine: the scripts it keeps, caps, a test length.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Campaign name">
                  <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.campaignName} onChange={(e) => set({ campaignName: e.target.value })} />
                </Field>
                <Field label="Description">
                  <input className="k-input w-full px-2" style={{ font: "inherit" }} value={d.description} onChange={(e) => set({ description: e.target.value })} />
                </Field>
                <Field label="Budget (required)">
                  <span className="k-input inline-flex w-full items-center gap-1 px-2">
                    <span className="k-fg3">$</span>
                    <input aria-label="Dollars per period" className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={d.perDay} onChange={(e) => set({ perDay: e.target.value.replace(/[^0-9.]/g, "") })} />
                    <span className="k-fg3">per</span>
                    <select aria-label="Budget period" className="bg-transparent outline-none" style={{ font: "inherit" }} value={d.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })}>
                      {PERIODS.map((p) => (
                        <option key={p.days} value={p.days}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </Field>
                <Field label="Volume limit (optional)">
                  <span className="k-input inline-flex w-full items-center gap-1 px-2">
                    <input aria-label="New people per period" className="w-full bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} placeholder="No limit" value={d.volume} onChange={(e) => set({ volume: e.target.value.replace(/[^0-9]/g, "") })} />
                    <span className="k-fg3 shrink-0">new people</span>
                  </span>
                </Field>
              </div>
              <p className="k-fg3 text-[12px]">Whichever limit is hit first stops the campaign for the period.</p>
              <button type="button" className="k-btn-accent k-cta w-full justify-center" onClick={launch}>
                <RocketLaunchIcon size={16} weight="fill" />
                {expected != null ? `Launch and earn up to ${formatRoi(expected)} per $1 expected` : "Launch and start learning"}
              </button>
              {error && <p className="text-[12px] text-[var(--data-rose)]">{error}</p>}
            </div>
          )}
          <button type="button" className="k-btn-ghost" onClick={() => setStage("goal")}>
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
