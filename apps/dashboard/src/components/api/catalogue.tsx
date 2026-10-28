"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Catalogue, OURS, defaultStrategyId, describeCondition, describeTacticType, type ApiScriptStats, type CatalogueData, type OutcomeId } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { engineLine, engineTitle, performerTitle } from "@/lib/api/labels";
import { formatCents, formatCount } from "@/lib/format";
import { Read } from "./common";
import { EngineDrawer, PinButton, ScriptDrawer, ScriptTile, headsOf, outcomePin, tacticText } from "./catalogue-parts";

const TABS = ["outcomes", "engines", "scripts", "tactics", "strategies", "performers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { outcomes: "Outcomes", engines: "Engines", scripts: "Scripts", tactics: "Tactics", strategies: "Strategies", performers: "Performed by" };

export function ApiCataloguePage() {
  const read = useApi<CatalogueData>("/catalogue", 60_000);
  const scripts = useApi<ApiScriptStats[]>("/scripts", 30_000);
  return (
    <>
      <TopBar crumbs={[{ label: "Catalogue" }]} />
      <Page>
        <Read read={read} rows={10}>
          {(c) => <CatalogueView c={c} scripts={scripts.data ?? []} />}
        </Read>
      </Page>
    </>
  );
}

function CatalogueView({ c, scripts }: { c: CatalogueData; scripts: ApiScriptStats[] }) {
  const search = useSearchParams();
  const router = useRouter();
  const asked = search.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "outcomes";
  const setTab = (t: Tab) => router.replace(`/catalogue/?tab=${t}`, { scroll: false });
  const cat = new Catalogue(c);
  const [engine, setEngine] = useState<OutcomeId | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const performers = performersOf(scripts);
  const counts: Record<Tab, number> = {
    outcomes: c.outcomes.filter((x) => !x.retired).length,
    engines: cat.engines().length,
    scripts: new Set(c.scripts.filter((s) => s.status === "active").map((s) => s.dynasty)).size,
    tactics: c.tactics.filter((t) => !t.retired).length,
    strategies: c.strategies.filter((s) => !s.retired).length,
    performers: performers.length,
  };
  return (
    <>
      <PageHeader
        title={`${counts.engines} Engines, ${counts.scripts} scripts competing`}
        sub="Everything is data or code: outcomes, one Engine per outcome, scripts as code, described by tactics and strategies. Open an Engine or a script to upgrade, fork or retire it."
      />
      <Tabs<Tab> tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], count: counts[t] }))} value={tab} onChange={setTab} />
      {tab === "outcomes" && <Outcomes c={c} cat={cat} scripts={scripts} />}
      {tab === "engines" && <Engines c={c} cat={cat} scripts={scripts} onOpen={setEngine} />}
      {tab === "scripts" && <Scripts c={c} cat={cat} scripts={scripts} onOpen={setScript} />}
      {tab === "tactics" && <Tactics c={c} />}
      {tab === "strategies" && <Strategies c={c} cat={cat} />}
      {tab === "performers" && <Performers c={c} rows={performers} />}
      {engine && (
        <EngineDrawer
          outcome={engine}
          catalogue={c}
          onClose={() => setEngine(null)}
          onScript={(d) => {
            setEngine(null);
            setScript(d);
          }}
        />
      )}
      {script && <ScriptDrawer dynasty={script} catalogue={c} onClose={() => setScript(null)} />}
    </>
  );
}

const SUBJECT: Record<string, string> = { lead: "A person", company: "A company", brand: "The brand", run: "The run that asked" };
const CONTENT: Record<string, string> = { text_with_variables: "Text with variables", text: "Plain text", audience: "A sentence about who", rating: "Beliefs per candidate", list: "A list", record: "A record", image: "An image", account: "An account" };

function Outcomes({ c, cat, scripts }: { c: CatalogueData; cat: Catalogue; scripts: ApiScriptStats[] }) {
  const made = new Map<string, number>();
  for (const s of scripts) made.set(s.outcome, (made.get(s.outcome) ?? 0) + s.outputs);
  return (
    <CardTable footer="An outcome is a part reference; each Unit is one piece of it, about one subject. Milestones sit on a Track; tracks are never added together.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Outcome</th>
          <th className={TH}>About</th>
          <th className={TH}>Track</th>
          <th className={TH}>Holds</th>
          <th className={TH}>Its Engine&apos;s scripts</th>
          <th className={`${TH} text-right`}>Units</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {c.outcomes
          .filter((o) => !o.retired)
          .map((o) => {
            const track = o.track ? c.tracks.find((t) => t.id === o.track!.track) : null;
            return (
              <tr key={o.id} className="k-row k-line-subtle border-b last:border-0">
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Mark kind="outcome" id={o.id} icon={o.icon} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{o.label}</span>
                      {o.description && <span className="k-fg3 block max-w-[360px] truncate text-[12px]">{o.description}</span>}
                    </span>
                  </span>
                </td>
                <td className={TD}>{SUBJECT[o.subject] ?? o.subject}</td>
                <td className={`${TD} whitespace-nowrap`}>{track ? `${track.name}, rank ${o.track!.rank}` : <span className="k-fg4">—</span>}</td>
                <td className={TD}>{o.contentType ? CONTENT[o.contentType] ?? o.contentType : <span className="k-fg4">—</span>}</td>
                <td className={TD}>
                  <span className="k-fg2 block max-w-[280px] truncate text-[12px]">{cat.scriptsOf(o.id).map((p) => p.name).join(", ") || "No script yet"}</span>
                </td>
                <td className={TDN}>{formatCount(made.get(o.id) ?? 0)}</td>
                <td className={`${TD} text-right`}>
                  <PinButton pin={outcomePin(c, o.id)} />
                </td>
              </tr>
            );
          })}
      </tbody>
    </CardTable>
  );
}

function Engines({ c, cat, scripts, onOpen }: { c: CatalogueData; cat: Catalogue; scripts: ApiScriptStats[]; onOpen: (o: OutcomeId) => void }) {
  return (
    <CardTable footer="One Engine per outcome. It makes a new piece when asked (pull) or from a Unit that just landed (push), with the best of the scripts that compete inside it.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Engine</th>
          <th className={`${TH} w-full`}>Works on</th>
          <th className={TH}>Performed by</th>
          <th className={`${TH} text-right`}>Scripts</th>
          <th className={`${TH} text-right`}>Called by</th>
          <th className={`${TH} text-right`}>Runs</th>
        </tr>
      </thead>
      <tbody>
        {cat.engines().map((e) => {
          const o = cat.outcome(e);
          const mine = cat.scriptsOf(e);
          const performers = [...new Set(mine.map((s) => performerTitle(s.tactics.performed_by as string | undefined)))];
          const runs = scripts.filter((s) => s.outcome === e).reduce((x, s) => x + s.runs, 0);
          return (
            <tr key={e} className="k-row k-line-subtle cursor-pointer border-b last:border-b-0" onClick={() => onOpen(e)} data-engine={e}>
              <td className={`${TD} whitespace-nowrap`}>
                <span className="inline-flex items-center gap-2">
                  <Mark kind="engine" id={e} icon={o?.icon} size={22} />
                  <span className="font-medium">{engineTitle(c, e)}</span>
                </span>
              </td>
              <td className={`${TD} k-fg2`}>{engineLine(c, e)}</td>
              <td className={`${TD} k-fg2 whitespace-nowrap`}>{performers.join(", ") || <span className="k-fg4">—</span>}</td>
              <td className={TDN}>{mine.length}</td>
              <td className={TDN}>{cat.scripts.filter((s) => s.status === "active" && s.materials.includes(e)).map((s) => s.outcome).filter((x, i, a) => a.indexOf(x) === i).length || <span className="k-fg4">—</span>}</td>
              <td className={TDN}>{runs ? formatCount(runs) : <span className="k-fg4">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}

function Scripts({ c, cat, scripts, onOpen }: { c: CatalogueData; cat: Catalogue; scripts: ApiScriptStats[]; onOpen: (dynasty: string) => void }) {
  const groups = cat
    .engines()
    .map((o) => ({ outcome: o, heads: headsOf(scripts.filter((s) => s.outcome === o)) }))
    .filter((g) => g.heads.length > 0);
  if (groups.length === 0) return <EmptyNote>No script served yet.</EmptyNote>;
  return (
    <div className="space-y-8">
      <p className="k-fg3 text-[12px]">Every script, grouped by the Engine it competes in. Open one to read its code and make a new version.</p>
      {groups.map((g) => (
        <section key={g.outcome}>
          <SectionTitle count={g.heads.length} right={<span>{engineLine(c, g.outcome)}</span>}>
            {engineTitle(c, g.outcome)}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.heads.map((s) => (
              <ScriptTile key={s.dynasty} s={s} versions={scripts.filter((x) => x.dynasty === s.dynasty)} catalogue={c} onClick={() => onOpen(s.dynasty)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const DESCRIBES: Record<string, string> = { script: "Scripts", lead: "Leads", company: "Companies", brand: "Clients", unit: "Units" };

function Tactics({ c }: { c: CatalogueData }) {
  return (
    <CardTable footer="A tactic is a typed property: yes or no, a value from a list, or a number. The same tactics describe scripts and leads.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Tactic</th>
          <th className={TH}>Type and values</th>
          <th className={TH}>Describes</th>
          <th className={TH}>Read from</th>
          <th className={`${TH} w-full`}>Scripts carrying it</th>
        </tr>
      </thead>
      <tbody>
        {c.tactics
          .filter((t) => !t.retired)
          .map((t) => {
            const carriers = c.scripts.filter((s) => s.tactics[t.id] !== undefined && s.status === "active");
            return (
              <tr key={t.id} className="k-row k-line-subtle border-b last:border-0">
                <td className={`${TD} whitespace-nowrap`}>
                  <span className="flex items-center gap-2">
                    <Mark kind="tactic" id={t.id} size={22} />
                    <span className="font-medium">{t.name}</span>
                  </span>
                </td>
                <td className={TD}>{describeTacticType(t)}</td>
                <td className={TD}>{t.describes.map((d) => DESCRIBES[d] ?? d).join(", ")}</td>
                <td className={`${TD} whitespace-nowrap`}>{t.source === "judged" ? "Judged by an AI" : "Data"}</td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {carriers.slice(0, 4).map((s) => (
                      <span key={s.id} className="k-chip">
                        {s.name}: {tacticText(c, t.id, s.tactics[t.id]).split(": ").slice(1).join(": ") || String(s.tactics[t.id])}
                      </span>
                    ))}
                    {carriers.length > 4 && <span className="k-fg3 text-[12px]">+{carriers.length - 4} more</span>}
                    {carriers.length === 0 && <span className="k-fg4">—</span>}
                  </span>
                </td>
              </tr>
            );
          })}
      </tbody>
    </CardTable>
  );
}

function Strategies({ c, cat }: { c: CatalogueData; cat: Catalogue }) {
  const { data: o } = useOverview();
  const users = (id: string) => (o?.campaigns ?? []).filter((x) => Object.values(x.verdicts ?? {}).includes(id));
  const byEngine = cat
    .engines()
    .map((e) => ({ outcome: e, strategies: cat.strategiesOf(e) }))
    .filter((g) => g.strategies.some((s) => s.id !== defaultStrategyId(g.outcome)));
  return (
    <div className="space-y-6">
      <p className="k-fg2 text-[13px]">A strategy is a set of conditions on tactics, for one Engine: on its scripts, and on who it serves. A judge reads each campaign&apos;s brief and keeps one per Engine, or none; an Engine left out keeps every script.</p>
      {byEngine.map(({ outcome, strategies }) => (
        <section key={outcome}>
          <SectionTitle count={strategies.length}>{engineTitle(c, outcome)}</SectionTitle>
          <div className="k-card divide-y divide-[var(--line-subtle)]">
            {strategies.map((s) => {
              const isDefault = s.id === defaultStrategyId(outcome);
              const used = users(s.id);
              return (
                <div key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <Mark kind="strategy" id={s.id} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      {s.name}
                      {isDefault && <span className="k-chip">Default</span>}
                      {s.proposed && <span className="k-chip text-[var(--accent)]">Proposed by a split</span>}
                    </p>
                    <div className="mt-1 space-y-1">
                      {s.conditions.length > 0 && (
                        <p className="flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="k-fg3">Its scripts:</span>
                          {s.conditions.map((cond, j) => (
                            <span key={j} className="k-chip">
                              {describeCondition(cond, cat)}
                            </span>
                          ))}
                        </p>
                      )}
                      {(s.subject ?? []).length > 0 && (
                        <p className="flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="k-fg3">Serves:</span>
                          {s.subject!.map((cond, j) => (
                            <span key={j} className="k-chip">
                              {describeCondition(cond, cat)}
                            </span>
                          ))}
                        </p>
                      )}
                      {isDefault && <p className="k-fg3 text-[12px]">No condition: every script competes.</p>}
                      {s.proposed && <p className="k-fg3 text-[12px]">{s.proposed.reason}</p>}
                    </div>
                  </div>
                  <span className="k-fg3 text-[12px]">{used.length ? `Kept for ${used.map((x) => x.name).join(", ")}` : isDefault ? "Every other campaign" : "Not kept yet"}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

interface PerformerRow {
  id: string;
  ours: boolean;
  scripts: string[];
  runs: number;
  units: number;
  spentCents: number;
}

/** What each performer ran (the "Performed by" tactic): its scripts, runs, Units and spend. */
function performersOf(scripts: readonly ApiScriptStats[]): PerformerRow[] {
  const by = new Map<string, PerformerRow>();
  for (const s of scripts) {
    const id = s.performedBy || OURS;
    let r = by.get(id);
    if (!r) by.set(id, (r = { id, ours: id === OURS, scripts: [], runs: 0, units: 0, spentCents: 0 }));
    if (s.status === "active") r.scripts.push(s.name);
    r.runs += s.runs;
    r.units += s.outputs;
    r.spentCents += s.spentCents;
  }
  return [...by.values()].sort((a, b) => Number(b.ours) - Number(a.ours) || a.id.localeCompare(b.id));
}

function Performers({ c, rows }: { c: CatalogueData; rows: PerformerRow[] }) {
  void c;
  return (
    <CardTable footer="Every script carries who performs it. Budget and return count only what we perform; another party's work comes at its access cost.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Performed by</th>
          <th className={`${TH} w-full`}>Scripts</th>
          <th className={`${TH} text-right`}>Runs</th>
          <th className={`${TH} text-right`}>Units</th>
          <th className={`${TH} text-right`}>Spent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} className="k-row k-line-subtle border-b last:border-0">
            <td className={`${TD} whitespace-nowrap`}>
              <span className="flex items-center gap-2">
                <Mark kind="performer" id={f.id} size={22} />
                <span className="font-medium">{performerTitle(f.id)}</span>
              </span>
            </td>
            <td className={TD}>
              <span className="k-fg2 block max-w-[520px] truncate text-[12px]">{f.scripts.join(", ") || "—"}</span>
            </td>
            <td className={TDN}>{formatCount(f.runs)}</td>
            <td className={TDN}>{formatCount(f.units)}</td>
            <td className={TDN}>
              {formatCents(f.spentCents)}
              <span className="k-fg3 ml-1 text-[12px]">{f.ours ? "our spend" : "access cost"}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

export { ToneDot };
