"use client";

import { useMemo, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { DayChart, Legend } from "@/components/charts";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, StatTile, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { markKindOf } from "./campaigns";
import { flashMature, nodeLabel, optionLabel, optionOfRun, pickShares, pipeTitle, rate, runsOf, scopedClients, trueYield, type Model } from "@/lib/model";
import { formatCents, formatCount, formatRatePct, formatUsd } from "@/lib/format";
import { useSim } from "@/lib/sim";

const NODES = ["workflow", "slot:template", "slot:llm"];

export function ResearchPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>{model ? <Research model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

/** What an option costs per input, on the catalogue (a slot option adds to its pipe's average workflow). */
function costCents(model: Model, pipeId: string, node: string, id: string): number {
  if (node === "workflow") return model.catalogue.workflow(id)?.costPerTrialCents ?? 0;
  const wfs = model.catalogue.workflows.filter((w) => w.pipeId === pipeId && w.status === "active");
  const avg = wfs.reduce((s, w) => s + w.costPerTrialCents, 0) / Math.max(1, wfs.length);
  return avg + (model.catalogue.slotOption(id)?.costPerTrialCents ?? 0);
}

/** The option the hidden truth says is best: most true outcomes per dollar. */
function trueBest(model: Model, pipeId: string, node: string, ids: string[]): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const id of ids) {
    const y = trueYield(model, pipeId, node, id);
    const c = costCents(model, pipeId, node, id);
    if (y == null || c <= 0) continue;
    const s = y / c;
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return best;
}

function Research({ model, scope }: { model: Model; scope: string | null }) {
  const [view, setView] = useState<"flash" | "mature">("flash");
  const [shown, setShown] = useState(6);
  const campaignIds = useMemo(() => new Set(scopedClients(model, scope).map((c) => c.campaign.id)), [model, scope]);
  const runs = useMemo(() => runsOf(model, { campaignIds }), [model, campaignIds]);
  const pipes = useMemo(() => {
    const spend = new Map<string, number>();
    for (const r of runs) spend.set(r.pipeId!, (spend.get(r.pipeId!) ?? 0) + r.spendCents);
    return [...spend.entries()].sort((a, b) => b[1] - a[1]).map(([id, cents]) => ({ id, cents }));
  }, [runs]);

  // Convergence: share of each day's picks that went to the option the hidden truth says is best.
  const { series, nodes, converged } = useMemo(() => {
    const perDay = new Array<{ best: number; all: number }>(model.day).fill({ best: 0, all: 0 }).map(() => ({ best: 0, all: 0 }));
    const bestOf = new Map<string, string | null>();
    let nodes = 0;
    let converged = 0;
    for (const p of pipes) {
      for (const node of NODES) {
        const last = [...model.result.choices].reverse().find((c) => c.node === node && c.pipeId === p.id && campaignIds.has(c.campaignId));
        if (!last || last.options.length < 2) continue;
        const best = trueBest(model, p.id, node, last.options.map((o) => o.id));
        bestOf.set(`${p.id}|${node}`, best);
        nodes++;
        const shares = pickShares(model, node, p.id, campaignIds);
        const top = [...shares.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top && top === best) converged++;
      }
    }
    for (const c of model.result.choices) {
      if (!campaignIds.has(c.campaignId) || c.day >= model.day) continue;
      const best = bestOf.get(`${c.pipeId}|${c.node}`);
      if (!best) continue;
      for (const o of c.options) {
        perDay[c.day]!.all += o.picks;
        if (o.id === best) perDay[c.day]!.best += o.picks;
      }
    }
    return { series: perDay.map((d) => (d.all > 0 ? d.best / d.all : null)), nodes, converged };
  }, [model, pipes, campaignIds]);

  const lastWeek = series.slice(-7).filter((x): x is number => x != null);
  const firstWeek = series.slice(0, 7).filter((x): x is number => x != null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  return (
    <>
      <PageHeader
        title={`The engine backs the true best option at ${converged} of ${nodes} choices`}
        sub="Every choice node, its options, what was measured and what the engine believes. The hidden truth of the simulated world sits beside it, so you can watch the engine converge."
        right={
          <span className="flex items-center gap-1">
            {(["flash", "mature"] as const).map((x) => (
              <button key={x} type="button" className={`k-chip ${view === x ? "k-chip-on" : ""}`} onClick={() => setView(x)} aria-pressed={view === x}>
                {x === "flash" ? "Flash" : "Mature"}
              </button>
            ))}
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Picks on the true best" note="last 7 days">
          <Figure value={formatRatePct(avg(lastWeek))} sub={`from ${formatRatePct(avg(firstWeek))} in week one`} />
        </StatTile>
        <StatTile label="Choice nodes" note="with 2+ options">
          <Figure value={formatCount(nodes)} />
        </StatTile>
        <StatTile label="Pipes that ran">
          <Figure value={formatCount(pipes.length)} />
        </StatTile>
        <StatTile label="Choices logged">
          <Figure value={formatCount(model.result.choices.filter((c) => campaignIds.has(c.campaignId)).length)} />
        </StatTile>
      </div>
      <section className="mt-6">
        <SectionTitle right={<span>Each day&apos;s picks, every workflow, template and LLM node</span>}>Learning curve</SectionTitle>
        <div className="k-card px-4 pb-3 pt-3">
          <DayChart series={[{ key: "s", label: "Share of picks on the true best option", values: series, color: "var(--data-teal)" }]} format={(v) => formatRatePct(v)} />
          <Legend series={[{ label: "Share of picks on the true best option", color: "var(--data-teal)" }]} />
        </div>
      </section>
      {pipes.length === 0 && <EmptyNote>No pipe has run yet. Press play.</EmptyNote>}
      {pipes.slice(0, shown).map((p) => (
        <PipeResearch key={p.id} model={model} pipeId={p.id} cents={p.cents} runs={runs.filter((r) => r.pipeId === p.id)} campaignIds={campaignIds} view={view} />
      ))}
      {pipes.length > shown && (
        <div className="mt-6 flex justify-center">
          <button type="button" className="k-btn" onClick={() => setShown(pipes.length)}>
            Show the other {pipes.length - shown} pipes
          </button>
        </div>
      )}
    </>
  );
}

function PipeResearch({ model, pipeId, cents, runs, campaignIds, view }: { model: Model; pipeId: string; cents: number; runs: ReturnType<typeof runsOf>; campaignIds: Set<string>; view: "flash" | "mature" }) {
  const pipe = model.catalogue.pipe(pipeId);
  const ch = pipe ? model.catalogue.channel(pipe.channel) : undefined;
  const fm = flashMature(model, pipe, runs);
  const t = pipeTitle(model.catalogue, pipeId);
  const base = model.world.truth.pipes.find((x) => x.pipeId === pipeId)?.baseYield ?? null;
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Mark kind="channel" id={pipe?.channel ?? ""} icon={ch?.icon} size={32} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-medium">
            {ch?.name} <span className="k-fg3 font-normal">· {t.name}</span>
          </h2>
          <p className="k-fg3 text-[12px]">{t.line}</p>
        </div>
        <div className="k-fg2 flex flex-wrap gap-4 text-[12px] tabular-nums">
          <span>{formatCents(cents)} spent</span>
          <span>
            Flash {formatRatePct(rate(fm.flash))} · Mature {fm.mature.inputs > 0 ? formatRatePct(rate(fm.mature)) : "—"}
          </span>
          <span>{fm.isMature ? "Mature" : `Learning: needs ${fm.outcomesRequired} mature outcomes, ${fm.windowDays}-day window`}</span>
          <span className="k-fg3">Hidden base rate {formatRatePct(base)}</span>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {NODES.map((node) => {
          const last = [...model.result.choices].reverse().find((c) => c.node === node && c.pipeId === pipeId && campaignIds.has(c.campaignId));
          if (!last) return null;
          return <NodeTable key={node} model={model} node={node} pipeId={pipeId} runs={runs} campaignIds={campaignIds} view={view} />;
        })}
      </div>
    </section>
  );
}

function NodeTable({ model, node, pipeId, runs, campaignIds, view }: { model: Model; node: string; pipeId: string; runs: ReturnType<typeof runsOf>; campaignIds: Set<string>; view: "flash" | "mature" }) {
  const pipe = model.catalogue.pipe(pipeId);
  const last = [...model.result.choices].reverse().find((c) => c.node === node && c.pipeId === pipeId && campaignIds.has(c.campaignId))!;
  const shares = pickShares(model, node, pipeId, campaignIds);
  const ids = last.options.map((o) => o.id);
  const best = trueBest(model, pipeId, node, ids);
  const byOption = new Map<string, typeof runs>();
  for (const r of runs) {
    const o = optionOfRun(r, node);
    if (o) byOption.set(o, [...(byOption.get(o) ?? []), r]);
  }
  const options = [...last.options].sort((a, b) => (shares.get(b.id) ?? 0) - (shares.get(a.id) ?? 0));
  return (
    <CardTable footer={"Seen: measured conversion. Belief: expected $ back per $1. Truth: hidden conversion. ✓ best in truth."}>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={NTH}>{nodeLabel(node)}</th>
          <th className={`${NTH} text-right`}>Picks</th>
          <th className={`${NTH} text-right`}>Seen</th>
          <th className={`${NTH} text-right`}>Belief</th>
          <th className={`${NTH} text-right`}>Truth</th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => {
          const fm = flashMature(model, pipe, byOption.get(o.id) ?? []);
          const tally = fm[view];
          const truth = trueYield(model, pipeId, node, o.id);
          return (
            <tr key={o.id} className="k-row">
              <td className={NTD}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mark kind={markKindOf(model, node, o.id)} id={o.id} size={18} />
                  <span className="truncate text-[12px]">{optionLabel(model, node, o.id)}</span>
                  {o.id === best && <CheckIcon size={12} weight="bold" className="shrink-0 text-[var(--data-teal)]" aria-label="Best in the hidden truth" />}
                </span>
              </td>
              <td className={NTDN}>
                <span className="text-[12px]">{formatRatePct(shares.get(o.id) ?? 0)}</span>
              </td>
              <td className={NTDN}>
                <span className="text-[12px]" title={`${formatCount(tally.outputs)} of ${formatCount(tally.inputs)}`}>
                  {tally.inputs > 0 ? formatRatePct(rate(tally)) : "—"}
                </span>
              </td>
              <td className={NTDN}>
                <span className="text-[12px]" title="Expected dollars back per $1, on the engine's posterior">
                  {formatUsd(o.meanScore)}
                </span>
              </td>
              <td className={NTDN}>
                <span className="k-fg3 text-[12px]">{truth != null ? formatRatePct(truth) : "—"}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}


const NTH = "k-label px-2 py-2 text-left font-medium first:pl-3 last:pr-3 whitespace-nowrap";
const NTD = "px-2 py-1.5 first:pl-3 last:pr-3 align-middle max-w-[132px]";
const NTDN = "px-2 py-1.5 first:pl-3 last:pr-3 align-middle text-right tabular-nums whitespace-nowrap";
