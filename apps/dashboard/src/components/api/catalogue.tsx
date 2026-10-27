"use client";

import { useState } from "react";
import { describeCondition, describeTacticType, Catalogue, type CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, Page, PageHeader, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { factoryTitle, outcomeName, legTitle } from "@/lib/api/labels";
import { formatCents } from "@/lib/format";
import { Read } from "./common";

type Tab = "outcomes" | "legs" | "scripts" | "tactics" | "strategies";

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
  const [tab, setTab] = useState<Tab>("legs");
  const cat = new Catalogue(c);
  return (
    <>
      <PageHeader title="Catalogue" sub="Every object this factory runs, as data. Read only here." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "outcomes", label: "Outcomes", count: c.outcomes.length },
          { id: "legs", label: "Legs", count: c.legs.length },
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
              <th className={TH}>Lead track</th>
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
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{o.track ? `${c.leadTracks.find((t) => t.id === o.track!.track)?.name ?? o.track.track}, step ${o.track.rank}` : <span className="k-fg4">—</span>}</td>
                <td className={`${TD} k-fg2`}>{o.description ?? <span className="k-fg4">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
      {tab === "legs" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Leg</th>
              <th className={`${TH} w-full`}>Bill of materials to output</th>
              <th className={TH}>Factory</th>
              <th className={TH}>Runs on</th>
              <th className={`${TH} text-right`}>Scripts</th>
            </tr>
          </thead>
          <tbody>
            {c.legs.map((p) => (
              <tr key={p.id} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="inline-flex items-center gap-2">
                    <Mark kind="leg" id={p.id} icon={p.icon} size={20} />
                    {p.name}
                    {p.retired && <ToneDot tone="muted">Retired</ToneDot>}
                  </span>
                </td>
                <td className={`${TD} k-fg2`}>
                  {cat.subjectMaterial(p) ? outcomeName(c, cat.subjectMaterial(p)!) : p.webhook ? "A webhook call" : "The market"} → <span className="k-fg">{outcomeName(c, p.output)}</span>
                </td>
                <td className={`${TD} whitespace-nowrap`}>{factoryTitle(c, p.factory)}</td>
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{p.webhook ? "A webhook call" : cat.createsSubjects(p) ? "A pull from Start" : "A pull or a push"}</td>
                <td className={TDN}>{cat.dynastiesOf(p.id).length}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
      )}
      {tab === "scripts" && (
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Script</th>
              <th className={TH}>Leg</th>
              <th className={TH}>Kind</th>
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
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{legTitle(c, s.legId)}</td>
                <td className={`${TD} k-fg2`}>{s.kind === "ai" ? "AI" : s.kind === "human" ? "Person" : "Rules"}</td>
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
              <th className={TH}>Leg</th>
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
                <td className={`${TD} k-fg2 whitespace-nowrap`}>{legTitle(c, s.legId)}</td>
                <td className={`${TD} k-fg2`}>
                  {[
                    ...s.rules.flatMap((r) => r.conditions.map((cd) => `${r.material ? `At ${outcomeName(c, r.material).toLowerCase()}: ` : ""}${describeCondition(cd, cat)}`)),
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
