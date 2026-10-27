"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { OURS, defaultStrategyId, describeCondition, describeTacticType, type OutcomeId } from "@gtm-factory/core";
import { ProviderLogo, ScriptCard, ScriptCode, ScriptMaterials, tacticValueText } from "@/components/catalogue-bits";
import { Mark } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Page, PageHeader, SectionTitle, Tabs, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { candidateLabel, engineLine, engineName, headScript, outcomeLabel, pluggedAt, scriptFigures, type Model } from "@/lib/model";
import { performerFigures } from "@/lib/engine-pages";
import { formatCents, formatCount, formatRatePct } from "@/lib/format";
import { pinHref, pinKey, togglePin, type Pin } from "@/lib/pins";
import { useSim } from "@/lib/sim";

const TABS = ["outcomes", "engines", "scripts", "tactics", "strategies", "performers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { outcomes: "Outcomes", engines: "Engines", scripts: "Scripts", tactics: "Tactics", strategies: "Strategies", performers: "Performed by" };

export function CataloguePage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Catalogue" }]} />
      <Page>{model ? <Catalogue model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Catalogue({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const asked = search.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "outcomes";
  const setTab = (t: Tab) => router.replace(`/catalogue/?tab=${t}`, { scroll: false });
  const c = model.catalogue;
  const performers = useMemo(() => performerFigures(model), [model]);
  const counts: Record<Tab, number> = {
    outcomes: c.outcomes.filter((x) => !x.retired).length,
    engines: c.engines().length,
    scripts: new Set(c.scripts.filter((s) => s.status === "active").map((s) => s.dynasty)).size,
    tactics: c.tactics.filter((t) => !t.retired).length,
    strategies: c.strategies.filter((s) => !s.retired).length,
    performers: performers.length,
  };
  return (
    <>
      <PageHeader
        title={
          <>
            {counts.engines} Engines, {counts.scripts} scripts competing
          </>
        }
        sub="Everything is data or code: outcomes, one Engine per outcome, scripts as files, described by tactics and strategies. Upgrade, fork or retire while it runs."
      />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], count: counts[t] }))} value={tab} onChange={setTab} />
      {tab === "outcomes" && <Outcomes model={model} />}
      {tab === "engines" && <Engines model={model} />}
      {tab === "scripts" && <Scripts model={model} />}
      {tab === "tactics" && <Tactics model={model} />}
      {tab === "strategies" && <Strategies model={model} />}
      {tab === "performers" && <Performers model={model} />}
    </>
  );
}

function PinButton({ pin }: { pin: Pin }) {
  const { pins, setPins } = useSim();
  const on = pins.some((p) => pinKey(p) === pinKey(pin));
  return (
    <button type="button" className="k-btn" onClick={() => setPins(togglePin(pins, pin))} title={on ? "Remove from the sidebar" : "Add a page for it in the sidebar"}>
      {on ? <PushPinSlashIcon size={13} /> : <PushPinIcon size={13} />}
      {on ? "Unpin" : "Pin"}
    </button>
  );
}

const SUBJECT: Record<string, string> = { lead: "A person", company: "A company", brand: "The brand", run: "The run that asked" };
const CONTENT: Record<string, string> = { text_with_variables: "Text with variables", text: "Plain text", audience: "A sentence about who", rating: "Beliefs per candidate", list: "A list", record: "A record", image: "An image" };

function Outcomes({ model }: { model: Model }) {
  const c = model.catalogue;
  const produced = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of model.session.units) m.set(o.outcome, (m.get(o.outcome) ?? 0) + 1);
    return m;
  }, [model]);
  return (
    <CardTable footer="An outcome is a part reference; each Unit is one physical piece of it, about one subject. Milestones sit on a Track; tracks are never added together.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Outcome</th>
          <th className={TH}>About</th>
          <th className={TH}>Track</th>
          <th className={TH}>Holds</th>
          <th className={TH}>Its Engine's scripts</th>
          <th className={`${TH} text-right`}>Units</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {c.outcomes
          .filter((o) => !o.retired)
          .map((o) => {
            const track = o.track ? c.tracks.find((t) => t.id === o.track!.track) : null;
            const scripts = c.scriptsOf(o.id);
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
                <td className={TD}>{track ? `${track.name} · rank ${o.track!.rank}` : <span className="k-fg4">—</span>}</td>
                <td className={TD}>{o.contentType ? CONTENT[o.contentType] : <span className="k-fg4">—</span>}</td>
                <td className={TD}>
                  <span className="k-fg2 block max-w-[280px] truncate text-[12px]">
                    {scripts.map((p) => p.name).join(", ") || "No script yet"}
                    {o.reference ? ` · reference: ${headScript(c, o.reference)?.name ?? o.reference}` : ""}
                  </span>
                </td>
                <td className={TDN}>{formatCount(produced.get(o.id) ?? 0)}</td>
                <td className={`${TD} text-right`}>
                  <PinButton pin={{ kind: "outcome", id: o.id, label: o.plural ?? o.label, ...(o.icon ? { icon: o.icon } : {}) }} />
                </td>
              </tr>
            );
          })}
      </tbody>
    </CardTable>
  );
}

/** Who performs an Engine's scripts, in one word or a list. */
function performersOf(model: Model, outcome: OutcomeId): string {
  return [...new Set(model.catalogue.scriptsOf(outcome).map((s) => String(s.tactics.performed_by ?? OURS)))].join(", ") || "—";
}

function Engines({ model }: { model: Model }) {
  const c = model.catalogue;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <CardTable footer="One Engine per outcome. It makes a new piece when asked (pull) or from a Unit that just landed (push), with the best script of the ones that compete inside it. Its scripts share its storage: notes and references to Units, never copies.">
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Engine</th>
            <th className={TH}>Works on</th>
            <th className={TH}>Performed by</th>
            <th className={`${TH} text-right`}>Scripts</th>
            <th className={`${TH} text-right`}>Called by</th>
            <th className={`${TH} text-right`}>Storage rows</th>
          </tr>
        </thead>
        <tbody>
          {c.engines().map((o) => {
            const rows = model.session.storageReport(o).tables.reduce((s, t) => s + t.rows, 0);
            return (
              <tr key={o} className="k-row k-line-subtle cursor-pointer border-b last:border-0" onClick={() => setOpen(o)} data-engine={o}>
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Mark kind="engine" id={o} icon={c.outcome(o)?.icon} size={22} />
                    <span className="font-medium">{engineName(c, o)}</span>
                  </span>
                </td>
                <td className={TD}>
                  <span className="k-fg2 block max-w-[380px] truncate text-[12px]">{engineLine(c, o)}</span>
                </td>
                <td className={TD}>
                  <span className="k-fg2 block max-w-[220px] truncate text-[12px]">{performersOf(model, o)}</span>
                </td>
                <td className={TDN}>{c.scriptsOf(o).length}</td>
                <td className={TDN}>{pluggedAt(model, o).length || <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{rows ? formatCount(rows) : <span className="k-fg4">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </CardTable>
      {open && <EngineDrawer model={model} outcome={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function EngineDrawer({ model, outcome, onClose }: { model: Model; outcome: OutcomeId; onClose: () => void }) {
  const c = model.catalogue;
  const o = c.outcome(outcome);
  const plugged = pluggedAt(model, outcome);
  const storage = model.session.storageReport(outcome);
  return (
    <Drawer title="Engine" onClose={onClose} width={520}>
      <div className="flex items-start gap-3">
        <Mark kind="engine" id={outcome} icon={o?.icon} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-medium">{engineName(c, outcome)}</h2>
          <p className="k-fg2 text-[13px]">{engineLine(c, outcome)}</p>
          {o?.description && <p className="k-fg3 mt-1 text-[12px]">{o.description}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PinButton pin={{ kind: "outcome", id: outcome, label: o?.plural ?? o?.label ?? outcome, ...(o?.icon ? { icon: o.icon } : {}) }} />
      </div>
      <dl className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="k-label pt-0.5">Performed by</dt>
        <dd>{performersOf(model, outcome)}</dd>
      </dl>

      <p className="k-label mb-1.5 mt-5">Its scripts</p>
      <div className="space-y-1.5">
        {c.scriptsOf(outcome).map((s) => (
          <ScriptLine key={s.dynasty} model={model} dynasty={s.dynasty} />
        ))}
        {c.scriptsOf(outcome).length === 0 && <EmptyNote>No active script.</EmptyNote>}
      </div>

      <p className="k-label mb-1.5 mt-5">Who calls it</p>
      {plugged.length === 0 ? (
        <EmptyNote>No Engine chose among its scripts yet.</EmptyNote>
      ) : (
        <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]">
          {plugged.map((p) => (
            <Link key={p.point} href={`/research/?point=${encodeURIComponent(p.point)}`} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{p.info.sub}</span>
              <span className="k-fg3 text-[12px]">best</span>
              <span className="font-medium">{p.bestScript ? candidateLabel(model, p.point, p.bestScript) : "—"}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="k-label mb-1.5 mt-5">Storage</p>
      <p className="k-fg3 mb-2 text-[12px]">Private to this Engine's scripts. Other Engines get its data only through the Units it makes.</p>
      {storage.tables.length === 0 ? (
        <EmptyNote>Nothing stored yet.</EmptyNote>
      ) : (
        <div className="space-y-2">
          {storage.tables.map((t) => (
            <div key={t.name} className="k-inset rounded-[8px] px-3 py-2">
              <p className="flex justify-between text-[13px]">
                <span className="font-medium">{t.name}</span>
                <span className="k-fg3 tabular-nums">{formatCount(t.rows)} rows</span>
              </p>
              {t.sample.map((r) => (
                <p key={r.key} className="k-mono k-fg3 truncate text-[11px]">
                  {r.key}: {JSON.stringify(r.value)}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function ScriptLine({ model, dynasty }: { model: Model; dynasty: string }) {
  const script = headScript(model.catalogue, dynasty);
  if (!script) return null;
  const f = scriptFigures(model, dynasty);
  return (
    <div className="k-inset flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px]">
      <ProviderLogo script={script} size={22} />
      <span className="min-w-0 flex-1 truncate font-medium">{script.name}</span>
      <span className="k-fg3 text-[12px] tabular-nums">v{script.version}</span>
      <span className="k-fg2 w-14 text-right text-[12px] tabular-nums">{formatRatePct(f.yieldRate)}</span>
      <span className="k-fg2 w-16 text-right text-[12px] tabular-nums">{f.costPerRun != null ? formatCents(Math.round(f.costPerRun * 100)) : formatCents(script.costCents)}</span>
    </div>
  );
}

function Scripts({ model }: { model: Model }) {
  const c = model.catalogue;
  const [open, setOpen] = useState<string | null>(null);
  const groups = c
    .engines()
    .map((o) => ({ outcome: o, dynasties: [...new Set(c.scripts.filter((s) => s.outcome === o).map((s) => s.dynasty))] }))
    .filter((g) => g.dynasties.length > 0);
  return (
    <>
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.outcome}>
            <SectionTitle count={g.dynasties.length} right={<span>{engineLine(c, g.outcome)}</span>}>
              {engineName(c, g.outcome)}
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.dynasties.map((d) => (
                <ScriptCard key={d} model={model} dynasty={d} onClick={() => setOpen(d)} />
              ))}
            </div>
          </section>
        ))}
      </div>
      {open && <ScriptDrawer model={model} dynasty={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ScriptDrawer({ model, dynasty, onClose }: { model: Model; dynasty: string; onClose: () => void }) {
  const { dispatch } = useSim();
  const c = model.catalogue;
  const head = headScript(c, dynasty)!;
  const versions = c.versionsOf(dynasty);
  const [error, setError] = useState<string | null>(null);
  const next = (versions[versions.length - 1]?.version ?? 1) + 1;
  const upgrade = () => setError(dispatch({ type: "upgradeScript", dynasty, id: `${dynasty}-v${next}-d${model.day}`, name: `${head.name} v${next}` }));
  const fork = () => {
    const id = `${dynasty}-fork-d${model.day}`;
    setError(dispatch({ type: "forkScript", parentDynasty: dynasty, script: { id, dynasty: id, name: `${head.name}, fork`, kind: head.kind, tactics: { ...head.tactics }, costCents: head.costCents } }));
  };
  const cap = head.capacity;
  return (
    <Drawer title="Script" onClose={onClose} width={560}>
      <ScriptCard model={model} dynasty={dynasty} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="k-btn" onClick={upgrade} title="A new version of this dynasty: it runs from now on and keeps the dynasty's stats">
          Upgrade
        </button>
        <button type="button" className="k-btn" onClick={fork} title="A new dynasty that starts from this one's belief, its code copied">
          Fork
        </button>
        <button type="button" className="k-btn" onClick={() => setError(dispatch({ type: head.status === "active" ? "retire" : "restore", kind: "scripts", id: head.id }))}>
          {head.status === "active" ? "Retire" : "Restore"}
        </button>
        {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="k-label pt-0.5">Engine</dt>
        <dd>{engineName(c, head.outcome)}</dd>
        <dt className="k-label pt-0.5">Performed by</dt>
        <dd>{String(head.tactics.performed_by ?? OURS)}</dd>
        <dt className="k-label pt-0.5">Capacity</dt>
        <dd>{cap?.perDay !== undefined ? `${formatCount(cap.perDay)} a day${cap.daysPerUnit ? `, ${cap.daysPerUnit} days each` : ""}` : "No limit stated"}</dd>
      </dl>
      <p className="k-label mb-1.5 mt-5">What its code calls</p>
      <ScriptMaterials model={model} script={head} />
      <p className="k-label mb-1.5 mt-5">Its code</p>
      <ScriptCode script={head} />
      <p className="k-label mb-1.5 mt-5">Versions of the dynasty</p>
      <div className="space-y-1.5">
        {versions.map((v) => (
          <div key={v.id} className="k-inset flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px]">
            <span className="font-medium">v{v.version}</span>
            <span className="min-w-0 flex-1 truncate">{v.name}</span>
            <span className="k-fg3 text-[12px]">{v.status === "active" ? "Active" : "Retired"}</span>
          </div>
        ))}
      </div>
      <p className="k-fg3 mt-3 text-[12px]">Stats pool across the versions of a dynasty. A fork starts from its parent's belief.</p>
      <p className="k-label mb-1.5 mt-5">Who calls its Engine</p>
      <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]">
        {pluggedAt(model, head.outcome).map((p) => (
          <Link key={p.point} href={`/research/?point=${encodeURIComponent(p.point)}`} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{p.info.sub}</span>
            {p.bestScript === dynasty && <span className="k-chip text-[var(--run)]">Best here</span>}
          </Link>
        ))}
      </div>
    </Drawer>
  );
}

const DESCRIBES: Record<string, string> = { script: "Scripts", lead: "Leads", company: "Companies", brand: "Clients", unit: "Units" };

function Tactics({ model }: { model: Model }) {
  const c = model.catalogue;
  return (
    <CardTable footer="A tactic is a typed property: yes or no, a value from a list, or a number. The same tactics describe scripts and leads.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Tactic</th>
          <th className={TH}>Type and values</th>
          <th className={TH}>Describes</th>
          <th className={TH}>Read from</th>
          <th className={TH}>Scripts carrying it</th>
        </tr>
      </thead>
      <tbody>
        {c.tactics
          .filter((t) => !t.retired)
          .map((t) => {
            const carriers = c.scripts.filter((s) => s.tactics[t.id] !== undefined && s.status === "active");
            return (
              <tr key={t.id} className="k-row k-line-subtle border-b last:border-0">
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Mark kind="tactic" id={t.id} size={22} />
                    <span className="font-medium">{t.name}</span>
                  </span>
                </td>
                <td className={TD}>{describeTacticType(t)}</td>
                <td className={TD}>{t.describes.map((d) => DESCRIBES[d] ?? d).join(", ")}</td>
                <td className={TD}>{t.source === "judged" ? "Judged by an AI" : "Data"}</td>
                <td className={TD}>
                  <span className="flex flex-wrap gap-1">
                    {carriers.slice(0, 4).map((s) => (
                      <span key={s.id} className="k-chip">
                        {s.name}: {tacticValueText(c, t.id, s.tactics[t.id]).split(": ").slice(1).join(": ") || String(s.tactics[t.id])}
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

function Strategies({ model }: { model: Model }) {
  const c = model.catalogue;
  const users = (id: string) => model.campaigns.filter((x) => Object.values(x.verdicts ?? {}).includes(id));
  const byEngine = c
    .engines()
    .map((o) => ({ outcome: o, strategies: c.strategiesOf(o) }))
    .filter((g) => g.strategies.some((s) => s.id !== defaultStrategyId(g.outcome)));
  return (
    <div className="space-y-6">
      <p className="k-fg2 text-[13px]">A strategy is a set of conditions on tactics, for one Engine: on its scripts, and on who it serves. A judge reads each campaign&apos;s brief and keeps one per Engine, or none; an Engine left out keeps every script.</p>
      {byEngine.map(({ outcome, strategies }) => (
        <section key={outcome}>
          <SectionTitle count={strategies.length}>{engineName(c, outcome)}</SectionTitle>
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
                      {s.proposed && <span className="k-chip text-[var(--accent)]">Proposed day {s.proposed.day}</span>}
                    </p>
                    <div className="mt-1 space-y-1">
                      {s.conditions.length > 0 && (
                        <p className="flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="k-fg3">Its scripts:</span>
                          {s.conditions.map((cond, j) => (
                            <span key={j} className="k-chip">
                              {describeCondition(cond, c)}
                            </span>
                          ))}
                        </p>
                      )}
                      {(s.subject ?? []).length > 0 && (
                        <p className="flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="k-fg3">Serves:</span>
                          {s.subject!.map((cond, j) => (
                            <span key={j} className="k-chip">
                              {describeCondition(cond, c)}
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

function Performers({ model }: { model: Model }) {
  const rows = useMemo(() => performerFigures(model), [model]);
  return (
    <CardTable footer="Every script carries who performs it. Budget and return count only what we perform; another party's work comes at its access cost.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Performed by</th>
          <th className={TH}>Scripts</th>
          <th className={`${TH} text-right`}>Runs</th>
          <th className={`${TH} text-right`}>Units</th>
          <th className={`${TH} text-right`}>Spent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} className="k-row k-line-subtle border-b last:border-0">
            <td className={TD}>
              <span className="flex items-center gap-2">
                <Mark kind="performer" id={f.id} size={22} />
                <span className="font-medium">{f.id}</span>
              </span>
            </td>
            <td className={TD}>
              <span className="k-fg2 block max-w-[420px] truncate text-[12px]">{f.scripts.map((id) => model.catalogue.script(id)?.name ?? id).join(", ") || "—"}</span>
            </td>
            <td className={TDN}>{formatCount(f.runs)}</td>
            <td className={TDN}>{formatCount(f.units)}</td>
            <td className={TDN}>
              {formatCents(f.spendCents)}
              <span className="k-fg3 ml-1 text-[12px]">{f.ours ? "our spend" : "access cost"}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}
