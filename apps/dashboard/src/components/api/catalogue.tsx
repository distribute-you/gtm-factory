"use client";

import { useState } from "react";
import { describeCondition, describeTacticType, Catalogue, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, Page, PageHeader, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { engineLine, engineTitle, outcomeName, performerTitle } from "@/lib/api/labels";
import { formatCents } from "@/lib/format";
import { Read } from "./common";

type Tab = "outcomes" | "engines" | "scripts" | "tactics" | "strategies";

export function ApiCataloguePage() {
  const read = useApi<CatalogueData>("/catalogue", 60_000);
  return (
    <>
      <TopBar crumbs={[{ label: "Catalogue" }]} />
      <Page>
        <Read read={read} rows={10}>
          {(c) => <CatalogueView c={c} />}
        </Read>
      </Page>
    </>
  );
}

function CatalogueView({ c }: { c: CatalogueData }) {
  const [tab, setTab] = useState<Tab>("engines");
  const cat = new Catalogue(c);
  return (
    <>
      <PageHeader title="Catalogue" sub="Every object this GTM Factory runs, as data. Read only here." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "outcomes", label: "Outcomes", count: c.outcomes.length },
          { id: "engines", label: "Engines", count: cat.engines().length },
          { id: "scripts", label: "Scripts", count: c.scripts.length },
          { id: "tactics", label: "Tactics", count: c.tactics.length },
          { id: "strategies", label: "Strategies", count: c.strategies.length },
        ]}
      />
      {tab === "outcomes" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Outcome</th>
              <th className={TH}>About</th>
              <th className={TH}>Track</th>
              <th className={`${TH} w-full`}>Description</th>
            </tr>
          </thead>
          <tbody>
            {c.outcomes.map((o) => (
              <tr key={o.id} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mark kind="outcome" id={o.id} icon={o.icon} size={20} />
                    {o.label}
                    {o.retired && <ToneDot tone="muted">Retired</ToneDot>}
                  </span>
                </td>
                <td className={`${TD} k-fg2`}>{o.subject}</td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{o.track ? `${c.tracks.find((t) => t.id === o.track!.track)?.name ?? o.track.track}, milestone ${o.track.rank}` : <span className="k-fg4">—</span>}</td>
                <td className={`${TD} k-fg2`}>{o.description ?? <span className="k-fg4">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
      {tab === "engines" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Engine</th>
              <th className={`${TH} w-full`}>Where its work comes from</th>
              <th className={TH}>Performed by</th>
              <th className={TH}>Runs on</th>
              <th className={`${TH} text-right`}>Scripts</th>
            </tr>
          </thead>
          <tbody>
            {cat.engines().map((e) => {
              const o = cat.outcome(e);
              const scripts = cat.scriptsOf(e);
              const performers = [...new Set(scripts.map((s) => performerTitle(s.tactics.performed_by as string | undefined)))];
              const creates = scripts.some((s) => cat.createsSubjects(s));
              const webhook = scripts.length > 0 && scripts.every((s) => s.webhook);
              return (
                <tr key={e} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-2">
                      <Mark kind="engine" id={e} icon={o?.icon} size={20} />
                      {engineTitle(c, e)}
                    </span>
                  </td>
                  <td className={`${TD} k-fg2`}>{engineLine(c, e)}</td>
                  <td className={`${TD} k-fg2 whitespace-nowrap`}>{performers.join(", ") || <span className="k-fg4">—</span>}</td>
                  <td className={`${TD} k-fg2 whitespace-nowrap`}>{webhook ? "A webhook call" : creates ? "A pull from Start" : "A pull or a push"}</td>
                  <td className={TDN}>{scripts.length}</td>
                </tr>
              );
            })}
          </tbody>
        </CardTable>
      )}
      {tab === "scripts" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Script</th>
              <th className={TH}>Engine</th>
              <th className={TH}>Kind</th>
              <th className={TH}>Calls</th>
              <th className={`${TH} w-full`}>Tactics</th>
              <th className={`${TH} text-right`}>Expected per run</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {c.scripts.map((s) => (
              <tr key={s.id} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mark kind={`script:${s.kind}`} id={s.dynasty} size={20} />
                    {s.name}
                    <span className="k-chip">v{s.version}</span>
                  </span>
                </td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{engineTitle(c, s.outcome)}</td>
                <td className={`${TD} k-fg2`}>{s.kind === "ai" ? "AI" : s.kind === "human" ? "Person" : "Rules"}</td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{s.materials.length > 0 ? s.materials.map((m) => outcomeName(c, m)).join(", ") : <span className="k-fg4">—</span>}</td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(s.tactics).map(([k, v]) => (
                      <span key={k} className="k-chip">
                        {c.tactics.find((t) => t.id === k)?.name ?? k}: {String(v)}
                      </span>
                    ))}
                  </span>
                </td>
                <td className={TDN}>{formatCents(s.costCents)}</td>
                <td className={TD}>{s.status === "active" ? <ToneDot tone="run">Active</ToneDot> : <ToneDot tone="muted">Retired</ToneDot>}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
      {tab === "tactics" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Tactic</th>
              <th className={TH}>Type</th>
              <th className={TH}>Describes</th>
              <th className={`${TH} w-full`}>Description</th>
            </tr>
          </thead>
          <tbody>
            {c.tactics.map((t) => (
              <tr key={t.id} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mark kind="tactic" id={t.id} size={20} />
                    {t.name}
                  </span>
                </td>
                <td className={`${TD} k-fg2`}>{describeTacticType(t)}</td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{t.describes.join(", ")}</td>
                <td className={`${TD} k-fg2`}>{t.description ?? <span className="k-fg4">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
      {tab === "strategies" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Strategy</th>
              <th className={TH}>Engine</th>
              <th className={`${TH} w-full`}>Conditions</th>
            </tr>
          </thead>
          <tbody>
            {c.strategies.map((s) => (
              <tr key={s.id} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mark kind="strategy" id={s.id} size={20} />
                    {s.name}
                  </span>
                </td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{engineTitle(c, s.outcome)}</td>
                <td className={`${TD} k-fg2`}>
                  {[
                    ...s.conditions.map((cd) => describeCondition(cd, cat)),
                    ...(s.subject ?? []).map((cd) => `Serves: ${describeCondition(cd, cat)}`),
                  ].join(" · ") || "No condition"}
                </td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
    </>
  );
}
