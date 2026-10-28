"use client";

import { OURS, type ApiObjectDynasty, type ApiProposal, type ApiSplit } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { formatCount, formatRatePct, plural } from "@/lib/format";
import { Read } from "./common";

/** The ICPs of each brand: every version competes at the places that consume it; the splits propose finer ones. */
export function ApiAudiencesPage() {
  const { data: o } = useOverview();
  const { scope } = useScope();
  const outcome = o?.catalogue.outcomes.find((x) => x.contentType === "audience" && !x.retired);
  const read = useApi<ApiObjectDynasty[]>(outcome ? `/objects?outcome=${encodeURIComponent(outcome.id)}` : null);
  const proposals = useApi<ApiProposal[]>(`/proposals${scope.brandId ? `?brandId=${encodeURIComponent(scope.brandId)}` : ""}`);
  const label = outcome?.label ?? "Audience";
  const many = outcome?.plural ?? `${label}s`;
  return (
    <>
      <TopBar crumbs={[{ label: many }]} />
      <Page>
        {o && !outcome ? (
          <EmptyNote>No outcome of this catalogue describes who to serve.</EmptyNote>
        ) : (
          <Read read={read}>
            {(all) => {
              const dyns = all.filter((d) => !d.retired && (!scope.brandId || d.brandId === scope.brandId));
              const brands = (o?.brands ?? []).filter((b) => dyns.some((d) => d.brandId === b.id));
              const forks = dyns.filter((d) => d.parentDynasty).length;
              return (
                <>
                  <PageHeader
                    title={<>{plural(dyns.length, label, many)} competing</>}
                    sub={`Each ${label} is one plain sentence that competes where it is consumed. ${forks > 0 ? `${plural(forks, "finer one was", "finer ones were")} proposed by the data and compete too.` : "The data proposes finer ones when a split proves it."}`}
                  />
                  {dyns.length === 0 && <EmptyNote>No {label} yet. A brand's first one is written from its offer.</EmptyNote>}
                  {brands.map((b) => {
                    const mine = dyns.filter((d) => d.brandId === b.id).sort((x, y) => (y.share ?? 0) - (x.share ?? 0) || (y.picks ?? 0) - (x.picks ?? 0));
                    return (
                      <section key={b.id} className="mb-8">
                        <SectionTitle count={mine.length}>{b.name}</SectionTitle>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {mine.map((d) => (
                            <AudienceCard key={d.dynasty} d={d} parent={mine.find((x) => x.dynasty === d.parentDynasty)} />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </>
              );
            }}
          </Read>
        )}
        <section className="mb-8">
          <Read read={proposals} rows={3}>
            {(ps) => (
              <>
                <SectionTitle count={ps.length} right={<span>Each side needs 10 outcomes. Corrected for the number of splits tried.</span>}>
                  What the splits proposed
                </SectionTitle>
                {ps.length === 0 ? (
                  <div className="k-card">
                    <EmptyNote>No split proved anything yet. A study runs every week.</EmptyNote>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ps.map((p) => (
                      <ProposalCard key={`${p.kind}:${p.createdId}`} p={p} brand={o?.brands.find((b) => b.id === p.brandId)?.name ?? null} label={label} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Read>
        </section>
      </Page>
    </>
  );
}

function AudienceCard({ d, parent }: { d: ApiObjectDynasty; parent: ApiObjectDynasty | undefined }) {
  const head = d.versions.find((v) => v.head) ?? d.versions[d.versions.length - 1]!;
  const ours = !d.producer || d.producer.performedBy === OURS;
  return (
    <div className="k-card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <Mark kind="audience" id={`${d.brandId}:${d.dynasty}`} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{head.name}</p>
          <p className="k-fg3 truncate text-[12px]">
            {d.producer ? `${d.producer.name}, ` : ""}v{head.version}
            {parent ? `, forked from ${parent.versions[parent.versions.length - 1]!.name}` : ""}
          </p>
        </div>
        <ToneDot tone={ours ? "run" : "amber"}>{ours ? "Our runs" : "Another party"}</ToneDot>
      </div>
      <p className="k-fg2 line-clamp-4 whitespace-pre-wrap text-[13px]">{head.content}</p>
      <div className="k-inset grid grid-cols-2 divide-x divide-[var(--line-subtle)] rounded-[8px]">
        <div className="px-3 py-2">
          <p className="k-label">Share of picks</p>
          <p className="text-[16px] font-medium tabular-nums">{formatRatePct(d.share ?? null)}</p>
          <p className="k-fg3 text-[11px]">last 7 days</p>
        </div>
        <div className="px-3 py-2">
          <p className="k-label">Picks</p>
          <p className="text-[16px] font-medium tabular-nums">{formatCount(d.picks ?? 0)}</p>
          <p className="k-fg3 text-[11px]">to date</p>
        </div>
      </div>
      {d.proposed && <p className="k-fg3 text-[12px]">Proposed on {new Date(d.proposed.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} from a split on {formatCount(d.proposed.subjects)} mature leads.</p>}
    </div>
  );
}

function ProposalCard({ p, brand, label }: { p: ApiProposal; brand: string | null; label: string }) {
  return (
    <div className="k-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mark kind={p.kind === "strategy" ? "strategy" : "audience"} id={p.createdId} size={24} />
        <span className="text-[13px] font-medium">{p.kind === "strategy" ? `Strategy${p.where ? ` on ${p.where}` : ""}` : `Finer ${label}`}</span>
        {brand && <span className="k-chip">{brand}</span>}
        <span className="k-fg3 k-mono ml-auto text-[12px]">{new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {p.conditions.map((c, i) => (
          <span key={i} className="k-chip">
            {c}
          </span>
        ))}
      </div>
      {p.text && <p className="k-fg2 mt-2 text-[13px]">{p.text}</p>}
      <details className="mt-3">
        <summary className="k-fg3 cursor-pointer text-[12px]">Every split looked at ({p.splits.length})</summary>
        <div className="mt-2">
          <SplitTable splits={p.splits} />
        </div>
      </details>
    </div>
  );
}

const VERDICT_TONE = { conclusion: "teal", signal: "amber", noise: "muted" } as const;
const VERDICT = { conclusion: "Conclusion", signal: "Signal", noise: "Noise" } as const;

function SplitTable({ splits }: { splits: ApiSplit[] }) {
  const rate = (s: number, t: number) => (t > 0 ? s / t : null);
  return (
    <CardTable note="Each way of cutting the leads in two, and whether one side did better.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Split</th>
          <th className={`${TH} text-right`}>Inside</th>
          <th className={`${TH} text-right`}>Rest</th>
          <th className={TH}>Verdict</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((s, i) => (
          <tr key={i} className="k-row k-line-subtle border-b">
            <td className={TD}>{s.inside}</td>
            <td className={TDN}>
              {formatRatePct(rate(s.insideSuccesses, s.insideTrials))} <span className="k-fg3">of {formatCount(s.insideTrials)}</span>
            </td>
            <td className={TDN}>
              {formatRatePct(rate(s.outsideSuccesses, s.outsideTrials))} <span className="k-fg3">of {formatCount(s.outsideTrials)}</span>
            </td>
            <td className={TD}>
              <ToneDot tone={VERDICT_TONE[s.verdict]}>{VERDICT[s.verdict]}</ToneDot>
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}
