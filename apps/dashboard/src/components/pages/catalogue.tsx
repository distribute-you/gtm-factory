"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { defaultStrategyId, describeCondition, describeTacticType, isOnDemand, type Pipe, type Script } from "@gtm-factory/engine";
import { ProviderLogo, ScriptCard, tacticValueText } from "@/components/catalogue-bits";
import { Mark } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Page, PageHeader, SectionTitle, Tabs, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { factoryName, headScript, optionLabel, outcomeLabel, pipeLine, pipeName, pluggedAt, scriptFigures, type Model } from "@/lib/model";
import { factoryFigures } from "@/lib/engine-pages";
import { formatCents, formatCount, formatRatePct } from "@/lib/format";
import { pinKey, togglePin, type Pin } from "@/lib/pins";
import { useSim } from "@/lib/sim";

const TABS = ["outcomes", "pipes", "scripts", "triggers", "tactics", "strategies", "factories"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { outcomes: "Outcomes", pipes: "Pipes", scripts: "Scripts", triggers: "Triggers", tactics: "Tactics", strategies: "Strategies", factories: "Factories" };

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
  const counts: Record<Tab, number> = {
    outcomes: c.outcomes.filter((x) => !x.retired).length,
    pipes: c.pipes.filter((p) => c.isPipeLive(p)).length,
    scripts: new Set(c.scripts.filter((s) => s.status === "active").map((s) => s.dynasty)).size,
    triggers: c.triggers.filter((t) => !t.retired).length,
    tactics: c.tactics.filter((t) => !t.retired).length,
    strategies: c.strategies.filter((s) => !s.retired).length,
    factories: c.factories.length,
  };
  return (
    <>
      <PageHeader
        title={
          <>
            {counts.pipes} pipes, {counts.scripts} scripts competing
          </>
        }
        sub="Everything is data: outcomes, pipes, triggers and scripts. Add, upgrade, fork or retire while the factory runs."
      />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], count: counts[t] }))} value={tab} onChange={setTab} />
      {tab === "outcomes" && <Outcomes model={model} />}
      {tab === "pipes" && <Pipes model={model} />}
      {tab === "scripts" && <Scripts model={model} />}
      {tab === "triggers" && <Triggers model={model} />}
      {tab === "tactics" && <Tactics model={model} />}
      {tab === "strategies" && <Strategies model={model} />}
      {tab === "factories" && <Factories model={model} />}
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

const SUBJECT: Record<string, string> = { lead: "A lead", company: "A company", object: "An object", event: "A trigger event" };
const CONTENT: Record<string, string> = { text_with_variables: "Text with variables", text: "Plain text", audience: "A sentence about who", list: "A list", record: "A record", image: "An image" };

function Outcomes({ model }: { model: Model }) {
  const c = model.catalogue;
  const produced = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of model.session.occurrences) m.set(o.outcome, (m.get(o.outcome) ?? 0) + 1);
    return m;
  }, [model]);
  return (
    <CardTable footer="An outcome is something reached for a subject. Lead states sit on a lead track; tracks are never added together.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Outcome</th>
          <th className={TH}>About</th>
          <th className={TH}>Lead track</th>
          <th className={TH}>Holds</th>
          <th className={TH}>Made by</th>
          <th className={`${TH} text-right`}>Occurrences</th>
          <th className={TH} />
        </tr>
      </thead>
      <tbody>
        {c.outcomes
          .filter((o) => !o.retired)
          .map((o) => {
            const track = o.track ? c.leadTracks.find((t) => t.id === o.track!.track) : null;
            const providers = c.providersOf(o.id);
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
                    {providers.map((p) => p.name).join(", ") || "A trigger"}
                    {o.referencePipe ? ` · reference: ${pipeName(c, o.referencePipe)}` : ""}
                  </span>
                </td>
                <td className={TDN}>{formatCount(produced.get(o.id) ?? 0)}</td>
                <td className={`${TD} text-right`}>{o.subject === "object" && <PinButton pin={{ kind: "outcome", id: o.id, label: o.plural ?? o.label, ...(o.icon ? { icon: o.icon } : {}) }} />}</td>
              </tr>
            );
          })}
      </tbody>
    </CardTable>
  );
}

function Pipes({ model }: { model: Model }) {
  const c = model.catalogue;
  const [open, setOpen] = useState<string | null>(null);
  const pipe = open ? c.pipe(open) : undefined;
  return (
    <>
      <CardTable footer="A pipe turns its inputs into one outcome. Its scripts share its pipe storage; nobody else reads it.">
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Pipe</th>
            <th className={TH}>Inputs → output</th>
            <th className={TH}>Factory</th>
            <th className={TH}>Runs on</th>
            <th className={`${TH} text-right`}>Scripts</th>
            <th className={`${TH} text-right`}>Plugged at</th>
            <th className={`${TH} text-right`}>Storage rows</th>
          </tr>
        </thead>
        <tbody>
          {c.pipes.map((p) => {
            const rows = model.session.storageReport(p.id).tables.reduce((s, t) => s + t.rows, 0);
            const trigger = p.triggerId ? c.trigger(p.triggerId) : null;
            return (
              <tr key={p.id} className={`k-row k-line-subtle cursor-pointer border-b last:border-0 ${p.retired ? "k-fg3" : ""}`} onClick={() => setOpen(p.id)}>
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Mark kind="pipe" id={p.id} icon={p.icon} size={22} />
                    <span className="font-medium">{p.name}</span>
                    {p.retired && <span className="k-chip">Retired</span>}
                  </span>
                </td>
                <td className={TD}>
                  <span className="k-fg2 block max-w-[380px] truncate text-[12px]">{pipeLine(c, p)}</span>
                </td>
                <td className={TD}>{c.isOurs(p) ? "Ours" : factoryName(c, p.factory)}</td>
                <td className={TD}>{trigger ? (isOnDemand(p) ? "On demand" : trigger.label) : p.reports ? "Its own schedule" : c.createsSubjects(p) ? "The budget" : "Its inputs"}</td>
                <td className={TDN}>{c.dynastiesOf(p.id).length}</td>
                <td className={TDN}>{pluggedAt(model, p.id).length || <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{rows ? formatCount(rows) : <span className="k-fg4">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </CardTable>
      {pipe && <PipeDrawer model={model} pipe={pipe} onClose={() => setOpen(null)} />}
    </>
  );
}

function PipeDrawer({ model, pipe, onClose }: { model: Model; pipe: Pipe; onClose: () => void }) {
  const { dispatch } = useSim();
  const c = model.catalogue;
  const plugged = pluggedAt(model, pipe.id);
  const storage = model.session.storageReport(pipe.id);
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer title="Pipe" onClose={onClose} width={520}>
      <div className="flex items-start gap-3">
        <Mark kind="pipe" id={pipe.id} icon={pipe.icon} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-medium">{pipe.name}</h2>
          <p className="k-fg2 text-[13px]">{pipeLine(c, pipe)}</p>
          {pipe.description && <p className="k-fg3 mt-1 text-[12px]">{pipe.description}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PinButton pin={{ kind: "pipe", id: pipe.id, label: pipe.name, ...(pipe.icon ? { icon: pipe.icon } : {}) }} />
        <button
          type="button"
          className="k-btn"
          onClick={() => setError(dispatch({ type: pipe.retired ? "restore" : "retire", kind: "pipes", id: pipe.id }))}
        >
          {pipe.retired ? "Restore" : "Retire"}
        </button>
        {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="k-label pt-0.5">Factory</dt>
        <dd>{c.isOurs(pipe) ? "Ours" : `${factoryName(c, pipe.factory)} (another factory)`}</dd>
        <dt className="k-label pt-0.5">Inputs</dt>
        <dd>{pipe.inputs.length ? pipe.inputs.map((i) => outcomeLabel(c, i)).join(", ") : "The market"}</dd>
        <dt className="k-label pt-0.5">Output</dt>
        <dd>{outcomeLabel(c, pipe.output)}</dd>
        <dt className="k-label pt-0.5">Delay</dt>
        <dd>{pipe.maturity.delayMeanDays ? `${pipe.maturity.delayMeanDays} days on average, up to ${pipe.maturity.horizonDays}` : "Same day"}</dd>
      </dl>

      <p className="k-label mb-1.5 mt-5">Where it is plugged</p>
      {plugged.length === 0 ? (
        <EmptyNote>Not chosen at any input yet.</EmptyNote>
      ) : (
        <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]">
          {plugged.map((p) => (
            <Link key={p.point} href={`/research/?point=${encodeURIComponent(p.point)}`} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{p.info.title}</span>
              <span className="k-fg3 text-[12px]">best</span>
              <span className="font-medium">{p.bestScript ? optionLabel(model, p.point, p.bestScript) : "—"}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="k-label mb-1.5 mt-5">Scripts</p>
      <div className="space-y-1.5">
        {c.dynastiesOf(pipe.id).map((s) => (
          <ScriptLine key={s.dynasty} model={model} script={s} />
        ))}
      </div>

      <p className="k-label mb-1.5 mt-5">Pipe storage</p>
      <p className="k-fg3 mb-2 text-[12px]">Private to this pipe's scripts. Other pipes get its data only through the occurrences it produces.</p>
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

function ScriptLine({ model, script }: { model: Model; script: Script }) {
  const f = scriptFigures(model, script.dynasty);
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
  const groups = c.pipes
    .map((p) => ({ pipe: p, dynasties: [...new Set(c.scripts.filter((s) => s.pipeId === p.id).map((s) => s.dynasty))] }))
    .filter((g) => g.dynasties.length > 0);
  return (
    <>
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.pipe.id}>
            <SectionTitle count={g.dynasties.length} right={<span>{pipeLine(c, g.pipe)}</span>}>
              {g.pipe.name}
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
  return (
    <Drawer title="Script" onClose={onClose} width={480}>
      <ScriptCard model={model} dynasty={dynasty} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="k-btn" onClick={upgrade} title="A new version of this dynasty: it runs from now on and keeps the dynasty's stats">
          Upgrade
        </button>
        <button type="button" className="k-btn" onClick={fork} title="A new dynasty that starts from this one's belief">
          Fork
        </button>
        <button type="button" className="k-btn" onClick={() => setError(dispatch({ type: head.status === "active" ? "retire" : "restore", kind: "scripts", id: head.id }))}>
          {head.status === "active" ? "Retire" : "Restore"}
        </button>
        {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
      </div>
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
      <p className="k-label mb-1.5 mt-5">Where it is offered</p>
      <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]">
        {pluggedAt(model, head.pipeId).map((p) => (
          <Link key={p.point} href={`/research/?point=${encodeURIComponent(p.point)}`} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{p.info.title}</span>
            {p.bestScript === dynasty && <span className="k-chip text-[var(--run)]">Best here</span>}
          </Link>
        ))}
      </div>
    </Drawer>
  );
}

function Triggers({ model }: { model: Model }) {
  const c = model.catalogue;
  const fired = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of model.session.triggerEvents) m.set(e.triggerId, (m.get(e.triggerId) ?? 0) + 1);
    return m;
  }, [model]);
  return (
    <CardTable footer="One generic trigger: when an outcome is reached, after a delay, unless another is reached meanwhile. Each event is an occurrence.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Trigger</th>
          <th className={TH}>When</th>
          <th className={TH}>After</th>
          <th className={TH}>Unless</th>
          <th className={TH}>Event</th>
          <th className={`${TH} text-right`}>Fired</th>
        </tr>
      </thead>
      <tbody>
        {c.triggers.map((t) => (
          <tr key={t.id} className="k-row k-line-subtle border-b last:border-0">
            <td className={TD}>
              <span className="flex items-center gap-2">
                <Mark kind="trigger" id={t.id} size={22} />
                <span className="min-w-0">
                  <span className="block font-medium">{t.label}</span>
                  {t.description && <span className="k-fg3 block max-w-[320px] truncate text-[12px]">{t.description}</span>}
                </span>
              </span>
            </td>
            <td className={TD}>{t.when.length ? t.when.map((o) => outcomeLabel(c, o)).join(" or ") : t.reported ? "Reported" : "—"}</td>
            <td className={TD}>{t.delayDays ? `${t.delayDays} days` : "At once"}</td>
            <td className={TD}>{t.unless.length ? t.unless.map((o) => outcomeLabel(c, o)).join(" or ") : <span className="k-fg4">—</span>}</td>
            <td className={TD}>{t.event ? outcomeLabel(c, t.event) : <span className="k-fg3">A consuming script's call</span>}</td>
            <td className={TDN}>{t.event ? formatCount(fired.get(t.id) ?? 0) : <span className="k-fg4">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

const DESCRIBES: Record<string, string> = { script: "Scripts", lead: "Leads", company: "Companies", brand: "Clients" };

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
  const users = (id: string) => model.campaigns.filter((x) => Object.values(x.strategies).includes(id));
  const byPipe = c.pipes
    .map((p) => ({ pipe: p, strategies: c.strategiesOf(p.id) }))
    .filter((g) => g.strategies.some((s) => s.id !== defaultStrategyId(g.pipe.id)));
  return (
    <div className="space-y-6">
      <p className="k-fg2 text-[13px]">A strategy is a set of conditions on tactics, for one pipe. Its rules attach to the pipe's inputs. A campaign chooses one per pipe; a pipe it leaves out plays its default.</p>
      {byPipe.map(({ pipe, strategies }) => (
        <section key={pipe.id}>
          <SectionTitle count={strategies.length}>{pipe.name}</SectionTitle>
          <div className="k-card divide-y divide-[var(--line-subtle)]">
            {strategies.map((s) => {
              const isDefault = s.id === defaultStrategyId(pipe.id);
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
                      {s.rules.map((r, i) => (
                        <p key={i} className="flex flex-wrap items-center gap-1 text-[12px]">
                          <span className="k-fg3">{r.input ? `At its ${outcomeLabel(c, r.input).toLowerCase()} input:` : "Its own scripts:"}</span>
                          {r.conditions.map((cond, j) => (
                            <span key={j} className="k-chip">
                              {describeCondition(cond, c)}
                            </span>
                          ))}
                        </p>
                      ))}
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
                      {isDefault && <p className="k-fg3 text-[12px]">No condition: every script at every input.</p>}
                      {s.proposed && <p className="k-fg3 text-[12px]">{s.proposed.reason}</p>}
                    </div>
                  </div>
                  <span className="k-fg3 text-[12px]">{used.length ? `Chosen by ${used.map((x) => x.name).join(", ")}` : isDefault ? "Every other campaign" : "Not chosen yet"}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Factories({ model }: { model: Model }) {
  const rows = useMemo(() => factoryFigures(model), [model]);
  return (
    <CardTable footer="Every occurrence names its producer: one of our runs, or another factory at its access cost. Our return values only what our runs produced.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Factory</th>
          <th className={TH}>Pipes</th>
          <th className={`${TH} text-right`}>Runs</th>
          <th className={`${TH} text-right`}>Occurrences</th>
          <th className={`${TH} text-right`}>Spent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id} className="k-row k-line-subtle border-b last:border-0">
            <td className={TD}>
              <span className="flex items-center gap-2">
                <Mark kind="factory" id={f.id} size={22} />
                <span className="font-medium">{f.name}</span>
                <span className="k-chip">{f.ours ? "Ours" : "Other factory"}</span>
              </span>
            </td>
            <td className={TD}>
              <span className="k-fg2 block max-w-[420px] truncate text-[12px]">{f.pipes.map((p) => pipeName(model.catalogue, p)).join(", ") || "—"}</span>
            </td>
            <td className={TDN}>{formatCount(f.runs)}</td>
            <td className={TDN}>{formatCount(f.occurrences)}</td>
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
