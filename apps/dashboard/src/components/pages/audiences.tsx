"use client";

import { useState } from "react";
import type { SegmentRule, SimClient } from "@gtm-factory/engine";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { addRun, emptyTally, pickShares, rate, scopedClients, segmentStudy, type Model } from "@/lib/model";
import { formatCount, formatRatePct, humanize, sentenceCase } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function AudiencesPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Audiences" }]} />
      <Page>{model ? <Audiences model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

function RuleChips({ rule }: { rule: SegmentRule }) {
  const entries = Object.entries(rule);
  if (entries.length === 0) return <span className="k-chip">Everyone</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <span key={k} className="k-chip">
          <span className="k-fg3">{humanize(k)}</span> {v.join(", ")}
        </span>
      ))}
    </span>
  );
}

function Audiences({ model, scope }: { model: Model; scope: string | null }) {
  const brands = [...new Map(scopedClients(model, scope).map((c) => [c.brand.id, c])).values()];
  // Open on the client whose data found the most, so the study has something to show.
  const richest = [...brands].sort((a, b) => model.result.audiences.filter((x) => x.brandId === b.brand.id).length - model.result.audiences.filter((x) => x.brandId === a.brand.id).length)[0];
  const [brandId, setBrandId] = useState<string>(richest?.brand.id ?? "");
  const client = brands.find((c) => c.brand.id === brandId) ?? brands[0];
  const all = model.result.audiences.filter((a) => brands.some((b) => b.brand.id === a.brandId));
  const found = all.filter((a) => a.source === "discovered").length;
  return (
    <>
      <PageHeader
        title={`${formatCount(all.length)} audiences, ${formatCount(found)} found by the data`}
        sub="An expert turns each client's ideal customer profile into audiences. Then the data splits them: a segment that wins becomes an audience, one that loses is left out."
      />
      {brands.length > 1 && <Tabs tabs={brands.map((b) => ({ id: b.brand.id, label: b.brand.name, count: model.result.audiences.filter((a) => a.brandId === b.brand.id).length }))} value={client?.brand.id ?? ""} onChange={setBrandId} />}
      {client ? <ClientAudiences model={model} client={client} /> : <EmptyNote>No client in this world yet.</EmptyNote>}
    </>
  );
}

function ClientAudiences({ model, client }: { model: Model; client: SimClient }) {
  const audiences = model.result.audiences.filter((a) => a.brandId === client.brand.id);
  const campaignIds = new Set(model.clients.filter((c) => c.brand.id === client.brand.id).map((c) => c.campaign.id));
  const tallies = new Map(audiences.map((a) => [a.id, emptyTally()]));
  for (const r of model.result.runs) if (r.audienceId && tallies.has(r.audienceId)) addRun(tallies.get(r.audienceId)!, model, r);
  const entryPipe = [...model.result.choices].reverse().find((c) => c.node === "audience" && campaignIds.has(c.campaignId))?.pipeId ?? null;
  const shares = pickShares(model, "audience", entryPipe, campaignIds);
  const study = segmentStudy(model, client);
  const findings = model.result.findings.filter((f) => campaignIds.has(f.campaignId));
  const fate = (attribute: string, value: string) => {
    const f = findings.find((x) => x.finding.split.attribute === attribute && x.finding.split.value === value);
    return f ? (f.kind === "winner" ? "Became an audience" : "Left out") : null;
  };
  return (
    <div className="space-y-8">
      <div className="k-card flex items-start gap-3 px-4 py-3">
        <Mark kind="audience" id={client.brand.id} size={32} />
        <div>
          <span className="k-label">Ideal customer profile</span>
          <p className="text-[14px]">{client.brand.icp}</p>
        </div>
      </div>
      <section>
        <SectionTitle count={audiences.length} right={<span>The engine picks an audience for every lead it finds</span>}>
          Audiences
        </SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Audience</th>
              <th className={TH}>Who is in</th>
              <th className={TH}>Left out</th>
              <th className={`${TH} text-right`}>% conversion</th>
              <th className={`${TH} text-right`}># leads</th>
              <th className={`${TH} text-right`}>Picks, 7 days</th>
            </tr>
          </thead>
          <tbody>
            {audiences.map((a) => {
              const t = tallies.get(a.id)!;
              return (
                <tr key={a.id} className="k-row k-rise">
                  <td className={TD}>
                    <span className="flex items-center gap-2.5">
                      <Mark kind="audience" id={a.id} size={28} />
                      <span className="min-w-0">
                        <span className="block font-medium">{sentenceCase(a.name)}</span>
                        <span className="k-fg3 block text-[12px]">{a.source === "expert" ? "Written by the expert from the profile" : a.description}</span>
                      </span>
                    </span>
                  </td>
                  <td className={TD}>
                    <RuleChips rule={a.rule} />
                  </td>
                  <td className={TD}>{a.exclusions.length ? <span className="flex flex-col gap-1">{a.exclusions.map((x, i) => <RuleChips key={i} rule={x} />)}</span> : <span className="k-fg4">—</span>}</td>
                  <td className={TDN}>{formatRatePct(rate(t))}</td>
                  <td className={TDN}>{formatCount(t.inputs)}</td>
                  <td className={TDN}>{formatRatePct(shares.get(a.id) ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </CardTable>
      </section>
      <section>
        <SectionTitle count={study.splits.length} right={<span>On {formatCount(study.records)} leads old enough to judge</span>}>
          Segments the data looked at
        </SectionTitle>
        <p className="k-fg2 -mt-1 mb-3 text-[13px]">
          A split is tested once each side holds 10 outcomes. Conclusion: the exact test and the like-for-like test (same client, same month) both pass. Signal: only the first one. Noise: neither.
        </p>
        <CardTable footer="Thresholds are corrected for the number of splits tried.">
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Segment</th>
              <th className={TH}>Verdict</th>
              <th className={`${TH} text-right`}>Inside</th>
              <th className={`${TH} text-right`}>Rest</th>
              <th className={`${TH} text-right`}>Like for like</th>
              <th className={TH}>What happened</th>
            </tr>
          </thead>
          <tbody>
            {[...study.splits]
              .sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict) || a.crudePValue - b.crudePValue)
              .map((s) => (
                <tr key={`${s.attribute}=${s.value}`} className="k-row">
                  <td className={TD}>
                    <span className="k-fg3">{humanize(s.attribute)}</span> {s.value}
                  </td>
                  <td className={TD}>
                    <ToneDot tone={s.verdict === "conclusion" ? (s.direction === "better" ? "run" : "rose") : s.verdict === "signal" ? "amber" : "muted"}>
                      {humanize(s.verdict)}
                      {s.verdict !== "noise" ? `, ${s.direction}` : ""}
                    </ToneDot>
                  </td>
                  <td className={TDN}>
                    {formatRatePct(s.inside.successes / Math.max(1, s.inside.trials))} <span className="k-fg3 text-[12px]">of {formatCount(s.inside.trials)}</span>
                  </td>
                  <td className={TDN}>
                    {formatRatePct(s.outside.successes / Math.max(1, s.outside.trials))} <span className="k-fg3 text-[12px]">of {formatCount(s.outside.trials)}</span>
                  </td>
                  <td className={TDN}>{Number.isFinite(s.likeForLike.oddsRatio) ? `${s.likeForLike.oddsRatio.toFixed(2)}× odds` : "—"}</td>
                  <td className={`${TD} k-fg2 text-[12px]`}>{fate(s.attribute, s.value) ?? <span className="k-fg4">—</span>}</td>
                </tr>
              ))}
          </tbody>
        </CardTable>
        {study.splits.length === 0 && <EmptyNote>Not enough outcomes yet to test a split. Keep playing.</EmptyNote>}
      </section>
    </div>
  );
}

function verdictRank(v: string): number {
  return v === "conclusion" ? 0 : v === "signal" ? 1 : 2;
}
