"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { describeCondition } from "@gtm-factory/core";
import { DayChart, Legend } from "@/components/charts";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Figure, Page, PageHeader, SectionTitle, SparkLine, StatTile, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { headScript, candidateLabel, engineName, placeChance, pointInfo, pointRow, shareSeries, type Model } from "@/lib/model";
import { InputsLine } from "@/components/plan-tree";
import { inputsView } from "@/lib/plan";
import { multiPlugged, pointGroups, recentShare } from "@/lib/engine-pages";
import { formatCents, formatCount, formatRatePct, formatUsd } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function ResearchPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>{model ? <Research model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Research({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const groups = useMemo(() => pointGroups(model), [model]);
  const all = groups.flatMap((g) => g.points);
  const asked = search.get("point");
  const selected = all.find((p) => p.conv.point === asked) ?? [...all].sort((a, b) => b.conv.picks - a.conv.picks)[0] ?? null;
  const select = (point: string) => router.replace(`/research/?point=${encodeURIComponent(point)}`, { scroll: false });
  const chances = useMemo(() => new Map(all.map((p) => [p.conv.point, placeChance(model, p.conv.point)])), [model, all]);
  const contested = all.filter((p) => p.conv.picks > 0);
  const clear = contested.filter((p) => (chances.get(p.conv.point) ?? 0) >= 0.9).length;

  return (
    <>
      <PageHeader
        title={
          <>
            {clear} of {contested.length} candidate places have a clear winner
          </>
        }
        sub="Every pick, made by one prioritizer. A clear winner is a candidate the Supplier rating believes is the best with a chance over 90%; here is how fast it gets there."
        right={<span>Day {model.day}</span>}
      />

      {all.length === 0 ? (
        <EmptyNote>No pick yet. Press Run.</EmptyNote>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section>
            <SectionTitle count={all.length}>Candidate places</SectionTitle>
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="k-label mb-1.5 px-1">{g.title}</p>
                  <div className="k-card divide-y divide-[var(--line-subtle)]">
                    {g.points.map(({ info, conv }) => {
                      const share = chances.get(conv.point) ?? null;
                      const on = selected?.conv.point === conv.point;
                      return (
                        <button
                          key={conv.point}
                          type="button"
                          onClick={() => select(conv.point)}
                          className={`k-hover flex w-full items-center gap-3 px-3 py-2.5 text-left first:rounded-t-[12px] last:rounded-b-[12px] ${on ? "k-selected" : ""}`}
                        >
                          <Mark kind="point" id={conv.point} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{info.title}</span>
                            <span className="k-fg3 block truncate text-[12px]">
                              {info.sub} · {formatCount(conv.picks)} picks
                            </span>
                          </span>
                          <span className="w-16 shrink-0">
                            <SparkLine className="h-6" values={shareSeries(conv).map((x) => x ?? 0)} color={share != null && share >= 0.9 ? "var(--run)" : "var(--accent)"} />
                          </span>
                          <span className={`w-10 shrink-0 text-right text-[13px] tabular-nums ${share != null && share >= 0.9 ? "text-[var(--run)]" : "k-fg2"}`} title="Chance the favourite is the best">{formatRatePct(share)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="min-w-0">{selected && <PointDetail model={model} point={selected.conv.point} />}</section>
        </div>
      )}

      <MultiPlugged model={model} />
      <ProposedStrategies model={model} />
    </>
  );
}

function PointDetail({ model, point }: { model: Model; point: string }) {
  const info = pointInfo(model.catalogue, point);
  const conv = useMemo(() => pointGroups(model).flatMap((g) => g.points).find((p) => p.conv.point === point)?.conv ?? null, [model, point]);
  const campaigns = model.campaigns.filter((c) => conv && conv.bestByCampaign[c.id] !== undefined);
  const series = conv ? [{ key: "s", label: "Value lost to weaker picks, per day", values: conv.daily.map((d) => (d.picks > 0 ? d.regretCents / 100 : null)), color: "var(--accent)" }] : [];
  const share = conv ? recentShare(conv) : null;
  const chance = placeChance(model, point);
  const first = conv ? conv.daily.slice(0, 10).reduce((a, d) => ({ p: a.p + d.picks, b: a.b + d.onBest }), { p: 0, b: 0 }) : null;
  return (
    <>
      <SectionTitle right={<span>{info.sub}</span>}>{info.title}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Chance the favourite is the best" note={`${formatRatePct(share)} of picks on it, last 7 days`}>
          <Figure value={formatRatePct(chance)} tone={chance != null && chance >= 0.9 ? "run" : undefined} />
        </StatTile>
        <StatTile label="First 10 days" note="picks on the favourite, nothing was known yet">
          <Figure value={formatRatePct(first && first.p > 0 ? first.b / first.p : null)} tone="muted" />
        </StatTile>
        <StatTile label="Picks" note={`${campaigns.length} campaigns`}>
          <Figure value={formatCount(conv?.picks ?? 0)} />
        </StatTile>
      </div>
      <div className="k-card mt-3 px-4 pb-3 pt-3">
        {series.length ? <DayChart series={series} format={formatUsd} /> : <EmptyNote>No pick yet.</EmptyNote>}
        <Legend series={series} />
        <p className="k-fg3 mt-1 text-[12px]">Dollars spent each day on candidates the Rating then believed weaker than its favourite. It falls as the Rating learns.</p>
      </div>

      {campaigns.map((c) => {
        const row = pointRow(model, c, point);
        const brand = model.clients.find((x) => x.brand.id === c.brandId)?.brand.name;
        return (
          <div key={c.id} className="mt-6">
            <SectionTitle count={row.candidates.length} right={<span>{brand}</span>}>
              {c.name}
            </SectionTitle>
            <CardTable footer="Belief = what the Rating reads today. The chance to be the best is read from those beliefs.">
              <thead>
                <tr className="k-line-subtle border-b">
                  <th className={TH}>Candidate</th>
                  <th className={`${TH} text-right`}>Picks, 7 days</th>
                  <th className={`${TH} text-right`}>Belief: reaches the next milestone</th>
                  <th className={`${TH} text-right`}>Belief: $ to the end</th>
                  <th className={`${TH} text-right`}>Belief: ends per $</th>
                  <th className={`${TH} text-right`}>Chance to be the best</th>
                </tr>
              </thead>
              <tbody>
                {row.candidates.map((o) => {
                  const script = headScript(model.catalogue, o.candidate);
                  return (
                    <tr key={o.candidate} className="k-row k-line-subtle border-b last:border-0">
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          {script ? <Mark kind={`script:${script.kind}`} id={script.dynasty} size={20} /> : <Mark kind="object" id={o.candidate} size={20} />}
                          <span className="truncate font-medium">{o.label}</span>

                        </span>
                        <InputsLine inputs={inputsView(model, model.session.inputsOf(o.candidate, c.id))} className="mt-0.5 pl-7" />
                      </td>
                      <td className={TDN}>{formatRatePct(o.share)}</td>
                      <td className={TDN}>
                        {formatRatePct(o.rate)} <span className="k-fg3">± {formatRatePct(o.rateSd)}</span>
                      </td>
                      <td className={TDN}>{formatUsd(o.cost)}</td>
                      <td className={TDN}>{o.cost < 0.005 ? <span className="k-fg3">Free</span> : (o.rate / o.cost).toFixed(3)}</td>
                      <td className={`${TDN} ${o.chanceBest >= 0.9 ? "text-[var(--run)]" : ""}`}>{formatRatePct(o.chanceBest)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </CardTable>
          </div>
        );
      })}
    </>
  );
}

/** One Engine called by two Engines: each caller has its own pick, so its own best script. */
function MultiPlugged({ model }: { model: Model }) {
  const rows = useMemo(() => multiPlugged(model), [model]);
  if (rows.length === 0) return null;
  return (
    <section className="mt-10">
      <SectionTitle right={<span>The pick lives on the Material, never on the Engine</span>}>One Engine, several callers</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.outcome} className="k-card p-4">
            <div className="flex items-center gap-2">
              <Mark kind="engine" id={r.outcome} icon={model.catalogue.outcome(r.outcome)?.icon} size={28} />
              <span className="text-[14px] font-medium">{engineName(model.catalogue, r.outcome)}</span>
              <span className="k-fg3 ml-auto text-[12px]">called by {r.inputs.length} Engines</span>
            </div>
            <div className="k-inset mt-3 divide-y divide-[var(--line-subtle)] rounded-[8px]">
              {r.inputs.map((i) => (
                <Link key={i.point} href={`/research/?point=${encodeURIComponent(i.point)}`} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{i.info.title}</span>
                  <span className="k-fg3 text-[12px]">best</span>
                  <span className="font-medium">{i.bestScript ? candidateLabel(model, i.point, i.bestScript) : "—"}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Strategies the split mechanism proposed from the tactics of the scripts picked at a Material. */
function ProposedStrategies({ model }: { model: Model }) {
  const proposals = model.session.proposals.filter((p) => p.kind === "strategy" && p.point);
  return (
    <section className="mt-10">
      <SectionTitle count={proposals.length} right={<span>A split on scripts' tactics, kept only when the verdict is a conclusion</span>}>
        Proposed strategies
      </SectionTitle>
      {proposals.length === 0 ? (
        <EmptyNote>No split has reached a conclusion yet. Splits are studied every few days on mature decisions.</EmptyNote>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
            const info = pointInfo(model.catalogue, p.point!);
            const strategy = model.catalogue.strategy(p.createdId);
            return (
              <div key={p.createdId} className="k-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Mark kind="strategy" id={p.createdId} size={28} />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{strategy?.name ?? p.createdId}</span>
                    <span className="k-fg3 block text-[12px]">
                      On {info.title} · proposed day {p.day}
                    </span>
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    {p.conditions.map((c, i) => (
                      <span key={i} className="k-chip">
                        {describeCondition(c, model.catalogue)}
                      </span>
                    ))}
                  </span>
                </div>
                <table className="mt-3 w-full text-[12px]">
                  <thead>
                    <tr className="k-line-subtle border-b">
                      <th className={TH}>Split looked at</th>
                      <th className={`${TH} text-right`}>Inside</th>
                      <th className={`${TH} text-right`}>Outside</th>
                      <th className={`${TH} text-right`}>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.study.root.slice(0, 6).map((s, i) => (
                      <tr key={i} className="k-line-subtle border-b last:border-0">
                        <td className={TD}>{describeCondition(s.inside, model.catalogue)}</td>
                        <td className={TDN}>
                          {formatRatePct(s.insideCounts.trials ? s.insideCounts.successes / s.insideCounts.trials : null)} <span className="k-fg3">of {formatCount(s.insideCounts.trials)}</span>
                        </td>
                        <td className={TDN}>
                          {formatRatePct(s.outsideCounts.trials ? s.outsideCounts.successes / s.outsideCounts.trials : null)} <span className="k-fg3">of {formatCount(s.outsideCounts.trials)}</span>
                        </td>
                        <td className={`${TDN} ${s.verdict === "conclusion" ? "text-[var(--run)]" : s.verdict === "signal" ? "text-[var(--data-amber)]" : "k-fg3"}`}>{s.verdict === "conclusion" ? "Conclusion" : s.verdict === "signal" ? "Signal" : "Noise"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
