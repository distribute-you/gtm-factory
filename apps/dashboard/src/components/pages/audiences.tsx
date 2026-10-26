"use client";

import { describeCondition, type Proposal, type Split } from "@gtm-factory/engine";
import { ContentView } from "@/components/catalogue-bits";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { headScript, objectDynasties, outcomeLabel, pointInfo, type Model } from "@/lib/model";
import { formatCount, formatRatePct, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

/** The object outcome describing who to serve (content type "audience"), found in the catalogue. */
function audienceOutcome(model: Model) {
  return model.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired);
}

export function AudiencesPage() {
  const { model, scope } = useSim();
  const o = model ? audienceOutcome(model) : undefined;
  return (
    <>
      <TopBar crumbs={[{ label: o?.plural ?? o?.label ?? "Audiences" }]} />
      <Page>{model ? o ? <Audiences model={model} scope={scope} outcome={o.id} /> : <EmptyNote>No outcome of this catalogue describes who to serve.</EmptyNote> : <PageSkeleton />}</Page>
    </>
  );
}

function Audiences({ model, scope, outcome }: { model: Model; scope: string | null; outcome: string }) {
  const o = model.catalogue.outcome(outcome)!;
  const dyns = objectDynasties(model, outcome, scope);
  const brands = model.clients.filter((c) => !scope || c.brand.id === scope);
  const proposals = model.session.proposals.filter((p) => !scope || p.brandId === scope || p.brandId === null);
  const forks = dyns.filter((d) => d.parentDynasty).length;
  return (
    <>
      <PageHeader
        title={<>{plural(dyns.length, o.label, o.plural ?? `${o.label}s`)} competing</>}
        sub={`Each ${o.label} is one plain sentence, a Unit that competes at the Material that consumes it. ${forks > 0 ? `${plural(forks, "finer one was", "finer ones were")} proposed by the data and compete too.` : "The data proposes finer ones when a split proves it."}`}
      />
      {brands.map((client) => {
        const mine = dyns.filter((d) => d.brandId === client.brand.id).sort((a, b) => b.share - a.share || b.picks - a.picks);
        if (mine.length === 0) return null;
        return (
          <section key={client.brand.id} className="mb-8">
            <SectionTitle count={mine.length}>{client.brand.name}</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {mine.map((d) => {
                const producer = d.head.scriptId ? model.catalogue.script(d.head.scriptId) : undefined;
                const ours = producer ? model.catalogue.isOurs(model.catalogue.pipe(producer.pipeId)!) : false;
                const proposal = proposals.find((p) => p.kind === "audience" && p.createdId === d.versions[0]!.id);
                return (
                  <div key={d.dynasty} className="k-card flex flex-col gap-3 p-4">
                    <div className="flex items-start gap-2.5">
                      <Mark kind="audience" id={`${client.brand.id}:${d.dynasty}`} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{d.name}</p>
                        <p className="k-fg3 truncate text-[12px]">
                          {producer ? headScript(model.catalogue, producer.dynasty)?.name : "Unknown"} · v{d.head.version}
                          {d.parentDynasty ? ` · forked from ${dyns.find((x) => x.brandId === d.brandId && x.dynasty === d.parentDynasty)?.name ?? d.parentDynasty}` : ""}
                        </p>
                      </div>
                      <ToneDot tone={ours ? "run" : "amber"}>{ours ? "Our runs" : "Other factory"}</ToneDot>
                    </div>
                    <ContentView model={model} unit={d.head} type={o.contentType} />
                    <div className="k-inset grid grid-cols-2 divide-x divide-[var(--line-subtle)] rounded-[8px]">
                      <div className="px-3 py-2">
                        <p className="k-label">Share of picks</p>
                        <p className="text-[16px] font-medium tabular-nums">{formatRatePct(d.share)}</p>
                        <p className="k-fg3 text-[11px]">last 7 days</p>
                      </div>
                      <div className="px-3 py-2">
                        <p className="k-label">Picks</p>
                        <p className="text-[16px] font-medium tabular-nums">{formatCount(d.picks)}</p>
                        <p className="k-fg3 text-[11px]">to date</p>
                      </div>
                    </div>
                    {proposal && <p className="k-fg3 text-[12px]">Proposed on day {proposal.day} from a split on {formatCount(proposal.study.proposal?.all.trials ?? 0)} mature leads.</p>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="mb-8">
        <SectionTitle count={proposals.length} right={<span>Each side needs 10 outcomes. Corrected for the number of splits tried.</span>}>
          What the splits proposed
        </SectionTitle>
        {proposals.length === 0 ? (
          <div className="k-card">
            <EmptyNote>No split proved anything yet. Press play: a study runs every week.</EmptyNote>
          </div>
        ) : (
          <div className="space-y-3">
            {[...proposals].reverse().map((p, i) => (
              <ProposalCard key={i} model={model} p={p} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ProposalCard({ model, p }: { model: Model; p: Proposal }) {
  const brand = model.clients.find((c) => c.brand.id === p.brandId)?.brand.name;
  const strategy = p.kind === "strategy" ? model.catalogue.strategy(p.createdId) : undefined;
  const where = p.point ? pointInfo(model.catalogue, p.point).title : strategy ? model.catalogue.pipe(strategy.pipeId)?.name : undefined;
  const audience = model.catalogue.outcomes.find((o) => o.contentType === "audience");
  return (
    <div className="k-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mark kind={p.kind === "strategy" ? "strategy" : "audience"} id={p.createdId} size={24} />
        <span className="text-[13px] font-medium">{p.kind === "strategy" ? `Strategy${where ? ` on ${where}` : ""}` : `Finer ${audience ? outcomeLabel(model.catalogue, audience.id) : "audience"}`}</span>
        {brand && <span className="k-chip">{brand}</span>}
        <span className="k-fg3 k-mono ml-auto text-[12px]">Day {p.day}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {p.conditions.map((c, i) => (
          <span key={i} className="k-chip">
            {describeCondition(c, model.catalogue)}
          </span>
        ))}
      </div>
      {p.text && <p className="k-fg2 mt-2 text-[13px]">{p.text}</p>}
      <details className="mt-3">
        <summary className="k-fg3 cursor-pointer text-[12px]">Every split looked at ({p.study.root.length})</summary>
        <div className="mt-2">
          <SplitTable model={model} splits={p.study.root} />
        </div>
      </details>
    </div>
  );
}

const VERDICT_TONE = { conclusion: "teal", signal: "amber", noise: "muted" } as const;

function SplitTable({ model, splits }: { model: Model; splits: Split[] }) {
  const rate = (c: { successes: number; trials: number }) => (c.trials > 0 ? c.successes / c.trials : null);
  return (
    <CardTable>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Split</th>
          <th className={`${TH} text-right`}>Inside</th>
          <th className={`${TH} text-right`}>Rest</th>
          <th className={TH}>Verdict</th>
        </tr>
      </thead>
      <tbody>
        {[...splits]
          .sort((a, b) => a.likeForLike.pValue - b.likeForLike.pValue)
          .slice(0, 20)
          .map((s, i) => (
            <tr key={i} className="k-row k-line-subtle border-b">
              <td className={TD}>{describeCondition(s.inside, model.catalogue)}</td>
              <td className={TDN}>
                {formatRatePct(rate(s.insideCounts))} <span className="k-fg3">of {formatCount(s.insideCounts.trials)}</span>
              </td>
              <td className={TDN}>
                {formatRatePct(rate(s.outsideCounts))} <span className="k-fg3">of {formatCount(s.outsideCounts.trials)}</span>
              </td>
              <td className={TD}>
                <ToneDot tone={VERDICT_TONE[s.verdict]}>{s.verdict === "conclusion" ? "Conclusion" : s.verdict === "signal" ? "Signal" : "Noise"}</ToneDot>
              </td>
            </tr>
          ))}
      </tbody>
    </CardTable>
  );
}
