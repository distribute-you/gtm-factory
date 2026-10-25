"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarCheckIcon, LightningIcon, PlusIcon } from "@phosphor-icons/react";
import { START, type Pipe, type Trigger, type Workflow } from "@gtm-factory/engine";
import { FunnelLine, StepChip } from "@/components/funnel-line";
import { Mark, type MarkKind } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Page, PageHeader, RoiLabel, SectionTitle, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { channelName, funnelName, salesPaths, scopedClients, stepLabel, targetState, workflowLabel, type Model } from "@/lib/model";
import { formatCents, formatCount, formatRoi, formatUsd, humanize, roiIsGood } from "@/lib/format";
import { useSim } from "@/lib/sim";
import type { CatalogueKind, SimAction } from "@/lib/world";

type Tab = "steps" | "tracks" | "triggers" | "channels" | "pipes" | "paths" | "plays" | "tactics" | "strategies" | "workflows" | "templates" | "llms";

const TABS: { id: Tab; label: string }[] = [
  { id: "steps", label: "Steps" },
  { id: "tracks", label: "Lead tracks" },
  { id: "triggers", label: "Triggers" },
  { id: "channels", label: "Channels" },
  { id: "pipes", label: "Pipes" },
  { id: "paths", label: "Sales paths" },
  { id: "plays", label: "Plays" },
  { id: "tactics", label: "Tactics" },
  { id: "strategies", label: "Strategies" },
  { id: "workflows", label: "Workflows" },
  { id: "templates", label: "Templates" },
  { id: "llms", label: "LLMs" },
];

export function CataloguePage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Catalogue" }]} />
      <Page>{model ? <Catalogue model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

type Detail = { kind: CatalogueKind | "paths" | "tracks"; id: string } | { add: "pipe" | "workflow" | "trigger" | "play" };

function Catalogue({ model }: { model: Model }) {
  const search = useSearchParams();
  const router = useRouter();
  const asked = search.get("tab") as Tab | null;
  const tab: Tab = TABS.some((t) => t.id === asked) ? asked! : "pipes";
  const setTab = (t: Tab) => router.replace(`/catalogue/?tab=${t}`, { scroll: false });
  const [detail, setDetail] = useState<Detail | null>(null);
  const c = model.catalogue;
  const paths = useMemo(() => salesPaths(c), [c, model]);
  const counts: Record<Tab, number> = {
    steps: c.steps.filter((x) => !x.retired).length,
    tracks: c.leadTracks.filter((x) => !x.retired).length,
    triggers: c.triggers.filter((x) => !x.retired).length,
    channels: c.channels.filter((x) => !x.retired).length,
    pipes: c.pipes.filter((p) => c.isPipeLive(p)).length,
    paths: paths.length,
    plays: c.plays.filter((p) => !p.retired).length,
    tactics: c.tactics.filter((t) => !t.retired).length,
    strategies: c.strategies.filter((s) => !s.retired).length,
    workflows: c.workflows.filter((w) => w.status === "active").length,
    templates: c.slotOptions.filter((o) => o.slot === "template" && o.status === "active").length,
    llms: c.slotOptions.filter((o) => o.slot === "llm" && o.status === "active").length,
  };
  const addFor: Partial<Record<Tab, "pipe" | "workflow" | "trigger" | "play">> = { pipes: "pipe", workflows: "workflow", triggers: "trigger", plays: "play" };
  const add = addFor[tab];
  return (
    <>
      <PageHeader
        title={`${formatCount(counts.pipes)} pipes, ${formatCount(counts.workflows)} workflows, all as data`}
        sub="distribute.you's public catalogue. Add, retire or edit a pipe, a workflow or a trigger while the world runs: the funnels and the choices move on the next decision."
        right={
          add ? (
            <button type="button" className="k-btn-strong" onClick={() => setDetail({ add })}>
              <PlusIcon size={13} weight="bold" />
              Add {add}
            </button>
          ) : undefined
        }
      />
      <LiveFunnels model={model} />
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] }))} value={tab} onChange={setTab} />
      {tab === "steps" && <StepsTable model={model} />}
      {tab === "tracks" && <TracksTable model={model} />}
      {tab === "triggers" && <TriggersTable model={model} open={(id) => setDetail({ kind: "triggers", id })} />}
      {tab === "channels" && <ChannelsTable model={model} open={(id) => setDetail({ kind: "channels", id })} />}
      {tab === "pipes" && <PipesTable model={model} open={(id) => setDetail({ kind: "pipes", id })} />}
      {tab === "paths" && <PathsTable model={model} paths={paths} />}
      {tab === "plays" && <PlaysTable model={model} open={(id) => setDetail({ kind: "plays", id })} />}
      {tab === "tactics" && <TacticsTable model={model} />}
      {tab === "strategies" && <StrategiesTable model={model} open={(id) => setDetail({ kind: "strategies", id })} />}
      {tab === "workflows" && <WorkflowsTable model={model} open={(id) => setDetail({ kind: "workflows", id })} />}
      {tab === "templates" && <SlotTable model={model} slot="template" open={(id) => setDetail({ kind: "slotOptions", id })} />}
      {tab === "llms" && <SlotTable model={model} slot="llm" open={(id) => setDetail({ kind: "slotOptions", id })} />}
      {detail && <DetailDrawer model={model} detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** The best funnels of the first client, read live: edit the catalogue and watch them move. */
function LiveFunnels({ model }: { model: Model }) {
  const { scope } = useSim();
  const client = scopedClients(model, scope)[0];
  if (!client) return null;
  const proposal = model.session.proposeFunnels(client.offer, client.campaign.target, { brandId: client.brand.id, limit: 3 });
  return (
    <section className="mb-6">
      <SectionTitle right={<span>Updates the moment the catalogue changes</span>}>Best funnels for {client.brand.name} right now</SectionTitle>
      <div className="k-card divide-y divide-[var(--line-subtle)]">
        {proposal.funnels.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
            <Mark kind="funnel" id={f.id} size={24} />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{funnelName(model.catalogue, f.legs.map((l) => l.playId))}</span>
              <FunnelLine catalogue={model.catalogue} plays={f.legs.map((l) => l.playId)} />
            </div>
            <span className="text-right text-[12px] tabular-nums">
              <span className="k-label block">
                <RoiLabel />
              </span>
              <span className={roiIsGood(f.valuePerDollar) ? "text-[var(--run)]" : ""}>{formatRoi(f.valuePerDollar)}</span>
            </span>
            <span className="w-20 text-right text-[12px] tabular-nums">
              <span className="k-label block">$ / {model.stateDefs.get(targetState(model, client))?.label.toLowerCase()}</span>
              {formatUsd(f.costPerTarget)}
            </span>
          </div>
        ))}
        {proposal.funnels.length === 0 && <EmptyNote>No funnel reaches the target with this catalogue.</EmptyNote>}
      </div>
    </section>
  );
}

function Status({ active }: { active: boolean }) {
  return <ToneDot tone={active ? "run" : "muted"}>{active ? "Active" : "Retired"}</ToneDot>;
}

function NameCell({ kind, id, icon, name, line }: { kind: MarkKind; id: string; icon?: string | null; name: React.ReactNode; line?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Mark kind={kind} id={id} icon={icon} size={line ? 32 : 22} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name}</span>
        {line && <span className="k-fg3 block truncate text-[12px]">{line}</span>}
      </span>
    </span>
  );
}

function StepsTable({ model }: { model: Model }) {
  const c = model.catalogue;
  return (
    <CardTable>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Step</th>
          <th className={TH}>About</th>
          <th className={TH}>Lead state</th>
          <th className={TH}>Lead track</th>
          <th className={`${TH} text-right`}>Pipes in</th>
          <th className={`${TH} text-right`}>Pipes out</th>
        </tr>
      </thead>
      <tbody>
        {c.steps.map((s) => (
          <tr key={s.key} className="k-row">
            <td className={TD}>
              <NameCell kind="step" id={s.key} icon={s.icon} name={s.label} line={s.description} />
            </td>
            <td className={`${TD} k-fg2`}>{s.subjectKind === "lead" ? "A lead" : s.subjectKind === "object" ? "An object made" : "Nothing yet"}</td>
            <td className={TD}>{s.leadState ? humanize(s.leadState.state) : <span className="k-fg4">—</span>}</td>
            <td className={`${TD} k-fg2`}>{s.leadState ? `${c.leadTrack(s.leadState.leadTrack)?.name ?? s.leadState.leadTrack} track` : <span className="k-fg4">—</span>}</td>
            <td className={TDN}>{c.pipesInto(s.key).length}</td>
            <td className={TDN}>{c.pipesFrom(s.key).length}</td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

function TracksTable({ model }: { model: Model }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {model.tracks.map((t) => (
        <div key={t.id} className="k-card p-4">
          <NameCell kind="leadTrack" id={t.id} name={t.label} line={t.description} />
          <ol className="mt-3 space-y-1.5">
            {t.states.map((s) => (
              <li key={s.state} className="flex items-center gap-2 text-[13px]">
                <span className="k-kbd">{s.rank}</span>
                <Mark kind="step" id={s.state} size={16} />
                {s.label}
                <span className="k-fg3 text-[12px]">
                  {model.catalogue.steps
                    .filter((x) => x.leadState?.state === s.state)
                    .map((x) => x.label)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function TriggersTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  return (
    <CardTable>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Trigger</th>
          <th className={TH}>Kind</th>
          <th className={TH}>Fires on</th>
          <th className={`${TH} text-right`}>Pipes it wakes</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {c.triggers.map((t) => (
          <tr key={t.id} className="k-row cursor-pointer" onClick={() => open(t.id)}>
            <td className={TD}>
              <NameCell kind="trigger" id={t.id} name={t.label} line={t.description} />
            </td>
            <td className={`${TD} k-fg2`}>{t.kind === "outcome" ? "An outcome reached" : "A condition about a lead"}</td>
            <td className={TD}>{t.outcomeStep ? <StepChip catalogue={c} step={t.outcomeStep} /> : <span className="k-fg4">—</span>}</td>
            <td className={TDN}>{c.pipes.filter((p) => p.triggerId === t.id).length}</td>
            <td className={TD}>
              <Status active={!t.retired} />
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

function ChannelsTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  return (
    <CardTable>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Channel</th>
          <th className={TH}>Group</th>
          <th className={TH}>Run by</th>
          <th className={TH}>Done by</th>
          <th className={`${TH} text-right`}>Pipes</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {c.channels.map((ch) => (
          <tr key={ch.slug} className="k-row cursor-pointer" onClick={() => open(ch.slug)}>
            <td className={`${TD} max-w-[420px]`}>
              <NameCell kind="channel" id={ch.slug} icon={ch.icon} name={ch.name} line={ch.description} />
            </td>
            <td className={`${TD} k-fg2`}>{ch.group ? humanize(ch.group) : "—"}</td>
            <td className={`${TD} k-fg2`}>{ch.operatedBy === "customer" ? "Your team" : "The platform"}</td>
            <td className={`${TD} k-fg2`}>{ch.performedBy === "person" ? "A person" : "Software"}</td>
            <td className={TDN}>{c.pipes.filter((p) => p.channel === ch.slug).length}</td>
            <td className={TD}>
              <Status active={!ch.retired} />
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

function PipesTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  const [limit, setLimit] = useState(40);
  const spend = new Map<string, number>();
  for (const r of model.result.runs) if (r.pipeId) spend.set(r.pipeId, (spend.get(r.pipeId) ?? 0) + r.spendCents);
  return (
    <CardTable
      footer={
        <span className="flex items-center justify-between">
          <span>
            {formatCount(Math.min(limit, c.pipes.length))} of {formatCount(c.pipes.length)} · click a pipe to edit it or retire it
          </span>
          {c.pipes.length > limit && (
            <button type="button" className="k-btn-ghost" onClick={() => setLimit((n) => n + 40)}>
              Show 40 more
            </button>
          )}
        </span>
      }
    >
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Pipe</th>
          <th className={TH}>Leg</th>
          <th className={TH}>Type</th>
          <th className={`${TH} text-right`}>Workflows</th>
          <th className={`${TH} text-right`}>Mature after</th>
          <th className={`${TH} text-right`}>$ spent</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {[...c.pipes]
          .sort((a, b) => (spend.get(b.id) ?? 0) - (spend.get(a.id) ?? 0))
          .slice(0, limit)
          .map((p) => {
          const trigger = p.triggerId ? c.trigger(p.triggerId) : null;
          return (
            <tr key={p.id} className="k-row cursor-pointer" onClick={() => open(p.id)}>
              <td className={TD}>
                <NameCell kind="channel" id={p.channel} icon={c.channel(p.channel)?.icon} name={p.name ?? p.id} line={channelName(c, p)} />
              </td>
              <td className={TD}>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]">
                  <StepChip catalogue={c} step={p.from} />
                  <span className="k-fg4">→</span>
                  <StepChip catalogue={c} step={p.to} />
                </span>
              </td>
              <td className={TD}>
                <span className="k-fg2 inline-flex items-center gap-1 whitespace-nowrap text-[12px]">
                  {trigger ? <LightningIcon size={13} /> : <CalendarCheckIcon size={13} />}
                  {trigger ? trigger.label : "Daily"}
                </span>
              </td>
              <td className={TDN}>{c.workflows.filter((w) => w.pipeId === p.id && w.status === "active").length}</td>
              <td className={TDN}>{p.maturity.durationDays} days</td>
              <td className={TDN}>{spend.get(p.id) ? formatCents(spend.get(p.id)!) : <span className="k-fg4">—</span>}</td>
              <td className={TD}>
                <Status active={c.isPipeLive(p)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}

function PathsTable({ model, paths }: { model: Model; paths: string[][] }) {
  const c = model.catalogue;
  const count = (from: string, to: string) => c.pipes.filter((p) => c.isPipeLive(p) && p.from === from && p.to === to).length;
  return (
    <CardTable footer="A sales path is a chain of legs. A sales funnel is one channel picked on each leg.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Sales path</th>
          <th className={`${TH} text-right`}>Legs</th>
          <th className={`${TH} text-right`}>Funnels on it</th>
        </tr>
      </thead>
      <tbody>
        {paths.map((path) => {
          let funnels = 1;
          for (let i = 1; i < path.length; i++) funnels *= count(path[i - 1]!, path[i]!);
          return (
            <tr key={path.join(">")} className="k-row">
              <td className={TD}>
                <span className="flex items-center gap-2">
                  <Mark kind="salesPath" id={path.join(">")} size={22} />
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
                    {path.map((s, i) => (
                      <span key={s} className="inline-flex items-center gap-1.5">
                        {i > 0 && <span className="k-fg4">→</span>}
                        <StepChip catalogue={c} step={s} />
                      </span>
                    ))}
                  </span>
                </span>
              </td>
              <td className={TDN}>{path.length - 1}</td>
              <td className={TDN}>{formatCount(funnels)}</td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}

function PlaysTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  const [limit, setLimit] = useState(40);
  const plays = [...c.plays].sort((a, b) => Number(!!b.strategyId) - Number(!!a.strategyId));
  return (
    <CardTable
      footer={
        <span className="flex items-center justify-between">
          <span>A play is a pipe with a strategy. Every pipe has its default play.</span>
          {plays.length > limit && (
            <button type="button" className="k-btn-ghost" onClick={() => setLimit((n) => n + 40)}>
              Show 40 more
            </button>
          )}
        </span>
      }
    >
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Play</th>
          <th className={TH}>Strategy</th>
          <th className={`${TH} text-right`}>Workflows that fit</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {plays.slice(0, limit).map((pl) => {
          const pipe = c.pipe(pl.pipeId);
          return (
            <tr key={pl.id} className="k-row cursor-pointer" onClick={() => open(pl.id)}>
              <td className={TD}>
                <NameCell kind="play" id={pl.id} name={pipe?.name ?? pl.pipeId} line={pipe ? `${channelName(c, pipe)}: ${stepLabel(c, pipe.from)} → ${stepLabel(c, pipe.to)}` : undefined} />
              </td>
              <td className={TD}>{pl.strategyId ? c.strategy(pl.strategyId)?.name : <span className="k-fg2">Default play</span>}</td>
              <td className={TDN}>{c.workflowsFor(pl).length}</td>
              <td className={TD}>
                <Status active={!pl.retired} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}

function TacticsTable({ model }: { model: Model }) {
  const c = model.catalogue;
  return (
    <CardTable>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Tactic</th>
          <th className={TH}>Tags</th>
          <th className={`${TH} text-right`}>Tagged</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {c.tactics.map((t) => (
          <tr key={t.id} className="k-row">
            <td className={TD}>
              <NameCell kind="tactic" id={t.id} name={t.name} line={t.description} />
            </td>
            <td className={`${TD} k-fg2`}>{t.appliesTo === "workflow" ? "Workflows" : "Templates and LLMs"}</td>
            <td className={TDN}>{t.appliesTo === "workflow" ? c.workflows.filter((w) => w.tactics.includes(t.id)).length : c.slotOptions.filter((o) => o.tactics.includes(t.id)).length}</td>
            <td className={TD}>
              <Status active={!t.retired} />
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

function StrategiesTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  const name = (id: string) => c.tactics.find((t) => t.id === id)?.name ?? id;
  return (
    <CardTable footer="Add a play to put a strategy on a pipe.">
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Strategy</th>
          <th className={TH}>Requires</th>
          <th className={TH}>Leaves out</th>
          <th className={`${TH} text-right`}>Plays</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {c.strategies.map((s) => (
          <tr key={s.id} className="k-row cursor-pointer" onClick={() => open(s.id)}>
            <td className={TD}>
              <NameCell kind="strategy" id={s.id} name={s.name} />
            </td>
            <td className={TD}>{s.required.length ? s.required.map((t) => <span key={t} className="k-chip mr-1">{name(t)}</span>) : <span className="k-fg4">—</span>}</td>
            <td className={TD}>{s.excluded.length ? s.excluded.map((t) => <span key={t} className="k-chip mr-1">{name(t)}</span>) : <span className="k-fg4">—</span>}</td>
            <td className={TDN}>{c.plays.filter((p) => p.strategyId === s.id).length}</td>
            <td className={TD}>
              <Status active={!s.retired} />
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

function WorkflowsTable({ model, open }: { model: Model; open: (id: string) => void }) {
  const c = model.catalogue;
  const [limit, setLimit] = useState(40);
  const spend = new Map<string, number>();
  for (const r of model.result.runs) if (r.workflowId) spend.set(r.workflowId, (spend.get(r.workflowId) ?? 0) + r.spendCents);
  const list = [...c.workflows].sort((a, b) => (spend.get(b.id) ?? 0) - (spend.get(a.id) ?? 0));
  return (
    <CardTable
      footer={
        <span className="flex items-center justify-between">
          <span>
            {formatCount(Math.min(limit, list.length))} of {formatCount(list.length)} · most spent first
          </span>
          {list.length > limit && (
            <button type="button" className="k-btn-ghost" onClick={() => setLimit((n) => n + 40)}>
              Show 40 more
            </button>
          )}
        </span>
      }
    >
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>Workflow</th>
          <th className={TH}>Done by</th>
          <th className={TH}>Slots</th>
          <th className={TH}>Tactics</th>
          <th className={`${TH} text-right`}>$ per input</th>
          <th className={`${TH} text-right`}>$ spent</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {list.slice(0, limit).map((w) => {
          const pipe = c.pipe(w.pipeId);
          return (
            <tr key={w.id} className="k-row cursor-pointer" onClick={() => open(w.id)}>
              <td className={TD}>
                <NameCell kind={`workflow:${w.kind}` as MarkKind} id={w.id} name={workflowLabel(c, w.id)} line={pipe ? `${pipe.name} · ${channelName(c, pipe)}` : w.pipeId} />
              </td>
              <td className={`${TD} k-fg2`}>{w.kind === "rules" ? "Rules" : w.kind === "ai" ? "AI" : "A person"}</td>
              <td className={TD}>{w.slots.length ? w.slots.map((s) => <span key={s} className="k-chip mr-1">{s === "llm" ? "LLM" : humanize(s)}</span>) : <span className="k-fg4">—</span>}</td>
              <td className={TD}>{w.tactics.length ? w.tactics.map((t) => <span key={t} className="k-chip mr-1">{c.tactics.find((x) => x.id === t)?.name ?? t}</span>) : <span className="k-fg4">—</span>}</td>
              <td className={TDN}>{formatCents(w.costPerTrialCents)}</td>
              <td className={TDN}>{spend.get(w.id) ? formatCents(spend.get(w.id)!) : <span className="k-fg4">—</span>}</td>
              <td className={TD}>
                <Status active={w.status === "active"} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </CardTable>
  );
}

function SlotTable({ model, slot, open }: { model: Model; slot: string; open: (id: string) => void }) {
  const c = model.catalogue;
  const [limit, setLimit] = useState(40);
  const uses = new Map<string, number>();
  for (const r of model.result.runs) {
    const id = r.slotChoice?.[slot];
    if (id) uses.set(id, (uses.get(id) ?? 0) + (r.inputs ?? 0));
  }
  const list = c.slotOptions.filter((o) => o.slot === slot).sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0));
  return (
    <CardTable
      footer={
        <span className="flex items-center justify-between">
          <span>Each is a dynasty: improved over versions, chosen on its own effect.</span>
          {list.length > limit && (
            <button type="button" className="k-btn-ghost" onClick={() => setLimit((n) => n + 40)}>
              Show 40 more
            </button>
          )}
        </span>
      }
    >
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>{slot === "llm" ? "LLM" : "Template"}</th>
          <th className={TH}>Used on</th>
          <th className={TH}>Tactics</th>
          <th className={`${TH} text-right`}>Extra $ per input</th>
          <th className={`${TH} text-right`}>Inputs written</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {list.slice(0, limit).map((o) => (
          <tr key={o.id} className="k-row cursor-pointer" onClick={() => open(o.id)}>
            <td className={TD}>
              <NameCell kind={slot === "llm" ? "llm" : "template"} id={o.id} name={humanize(o.name)} />
            </td>
            <td className={`${TD} k-fg2`}>{o.pipeId ? (c.pipe(o.pipeId)?.name ?? o.pipeId) : "Every pipe"}</td>
            <td className={TD}>{o.tactics.length ? o.tactics.map((t) => <span key={t} className="k-chip mr-1">{c.tactics.find((x) => x.id === t)?.name ?? t}</span>) : <span className="k-fg4">—</span>}</td>
            <td className={TDN}>{formatCents(o.costPerTrialCents)}</td>
            <td className={TDN}>{formatCount(uses.get(o.id) ?? 0)}</td>
            <td className={TD}>
              <Status active={o.status === "active"} />
            </td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

// ---------------------------------------------------------------------------
// Detail, edit, add
// ---------------------------------------------------------------------------

function DetailDrawer({ model, detail, onClose }: { model: Model; detail: Detail; onClose: () => void }) {
  const { dispatch } = useSim();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = (action: SimAction, message: string) => {
    const err = dispatch(action);
    setError(err);
    setDone(err ? null : message);
  };
  if ("add" in detail) {
    return (
      <Drawer title={`Add a ${detail.add}`} onClose={onClose}>
        <AddForm model={model} what={detail.add} onDone={(a, m) => run(a, m)} />
        {error && <p className="mt-3 text-[12px] text-[var(--data-rose)]">{error}</p>}
        {done && <p className="mt-3 text-[12px] text-[var(--run)]">{done}</p>}
      </Drawer>
    );
  }
  const c = model.catalogue;
  const kind = detail.kind as CatalogueKind;
  const item = findItem(model, kind, detail.id);
  if (!item) return null;
  const active = isActive(model, kind, detail.id);
  const retirable: CatalogueKind[] = ["pipes", "workflows", "triggers", "channels", "slotOptions", "plays", "strategies"];
  return (
    <Drawer title={humanize(kind === "slotOptions" ? "option" : kind.replace(/s$/, ""))} onClose={onClose}>
      <h3 className="text-[16px] font-medium">{item.name}</h3>
      {item.line && <p className="k-fg3 text-[12px]">{item.line}</p>}
      <div className="mt-2">
        <Status active={active} />
      </div>
      {kind === "pipes" && <PipeEdit model={model} pipe={c.pipe(detail.id)!} run={run} />}
      {kind === "workflows" && <WorkflowEdit workflow={c.workflow(detail.id)!} run={run} />}
      {kind === "triggers" && <TriggerEdit trigger={c.trigger(detail.id)!} run={run} />}
      {retirable.includes(kind) && (
        <div className="k-line-subtle mt-5 border-t pt-4">
          <p className="k-fg2 mb-2 text-[13px]">
            {active ? "Retire it: it leaves every choice at once. Its history stays readable." : "Bring it back: it competes again from the next decision."}
          </p>
          <button type="button" className="k-btn" onClick={() => run({ type: active ? "retire" : "restore", kind, id: detail.id }, active ? "Retired. The next decision runs without it." : "Back in the catalogue.")}>
            {active ? "Retire" : "Restore"}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-[12px] text-[var(--data-rose)]">{error}</p>}
      {done && <p className="mt-3 text-[12px] text-[var(--run)]">{done}</p>}
    </Drawer>
  );
}

function findItem(model: Model, kind: CatalogueKind, id: string): { name: string; line?: string } | null {
  const c = model.catalogue;
  switch (kind) {
    case "pipes": {
      const p = c.pipe(id);
      return p ? { name: p.name ?? p.id, line: `${stepLabel(c, p.from)} → ${channelName(c, p)} → ${stepLabel(c, p.to)}` } : null;
    }
    case "workflows": {
      const w = c.workflow(id);
      return w ? { name: workflowLabel(c, id), line: c.pipe(w.pipeId)?.name } : null;
    }
    case "triggers": {
      const t = c.trigger(id);
      return t ? { name: t.label, ...(t.description ? { line: t.description } : {}) } : null;
    }
    case "channels": {
      const ch = c.channel(id);
      return ch ? { name: ch.name, ...(ch.description ? { line: ch.description } : {}) } : null;
    }
    case "slotOptions": {
      const o = c.slotOption(id);
      return o ? { name: humanize(o.name), line: o.pipeId ? c.pipe(o.pipeId)?.name : "Every pipe" } : null;
    }
    case "plays": {
      const p = c.play(id);
      return p ? { name: c.pipe(p.pipeId)?.name ?? p.pipeId, line: p.strategyId ? c.strategy(p.strategyId)?.name : "Default play" } : null;
    }
    case "strategies": {
      const s = c.strategy(id);
      return s ? { name: s.name } : null;
    }
    default:
      return null;
  }
}

function isActive(model: Model, kind: CatalogueKind, id: string): boolean {
  const c = model.catalogue;
  if (kind === "workflows") return c.workflow(id)?.status === "active";
  if (kind === "slotOptions") return c.slotOption(id)?.status === "active";
  if (kind === "pipes") return !c.pipe(id)?.retired;
  if (kind === "triggers") return !c.trigger(id)?.retired;
  if (kind === "channels") return !c.channel(id)?.retired;
  if (kind === "plays") return !c.play(id)?.retired;
  if (kind === "strategies") return !c.strategy(id)?.retired;
  return true;
}

type Run = (a: SimAction, message: string) => void;

function PipeEdit({ model, pipe, run }: { model: Model; pipe: Pipe; run: Run }) {
  const [name, setName] = useState(pipe.name ?? "");
  const [days, setDays] = useState(String(pipe.maturity.durationDays));
  const wfs = model.catalogue.workflows.filter((w) => w.pipeId === pipe.id);
  return (
    <div className="mt-4 space-y-3">
      <Field label="Name">
        <input className="k-input w-full px-2" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Days before a cohort is mature">
        <input className="k-input w-full px-2" style={{ font: "inherit" }} value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))} />
      </Field>
      <button type="button" className="k-btn-strong" onClick={() => run({ type: "editPipe", id: pipe.id, name, maturityDays: Number(days) || 0 }, "Saved. Choices read it from the next decision.")}>
        Save
      </button>
      <div>
        <span className="k-label">Workflows</span>
        <ul className="mt-1 space-y-1">
          {wfs.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-[13px]">
              <Mark kind={`workflow:${w.kind}` as MarkKind} id={w.id} size={16} />
              {workflowLabel(model.catalogue, w.id)}
              <span className="k-fg3 ml-auto text-[12px] tabular-nums">{formatCents(w.costPerTrialCents)} per input</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WorkflowEdit({ workflow, run }: { workflow: Workflow; run: Run }) {
  const [cost, setCost] = useState(String(workflow.costPerTrialCents / 100));
  return (
    <div className="mt-4 space-y-3">
      <Field label="Cost per input">
        <span className="k-input flex items-center gap-1 px-2">
          <span className="k-fg3">$</span>
          <input className="w-full bg-transparent outline-none" style={{ font: "inherit" }} value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} />
        </span>
      </Field>
      <button type="button" className="k-btn-strong" onClick={() => run({ type: "editWorkflow", id: workflow.id, costPerTrialCents: Math.round(Number(cost) * 100) }, "Saved. The prioritizer reads the new cost from the next pick.")}>
        Save
      </button>
    </div>
  );
}

function TriggerEdit({ trigger, run }: { trigger: Trigger; run: Run }) {
  const [label, setLabel] = useState(trigger.label);
  return (
    <div className="mt-4 space-y-3">
      <Field label="Label">
        <input className="k-input w-full px-2" style={{ font: "inherit" }} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <button type="button" className="k-btn-strong" onClick={() => run({ type: "editTrigger", id: trigger.id, label }, "Saved.")}>
        Save
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="k-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function AddForm({ model, what, onDone }: { model: Model; what: "pipe" | "workflow" | "trigger" | "play"; onDone: Run }) {
  const c = model.catalogue;
  const channels = c.channels.filter((x) => !x.retired);
  const steps = c.steps.filter((s) => !s.retired);
  const triggers = c.triggers.filter((t) => !t.retired);
  const livePipes = c.pipes.filter((p) => c.isPipeLive(p));
  const [channel, setChannel] = useState(channels[0]?.slug ?? "");
  const [from, setFrom] = useState<string>(START);
  const [to, setTo] = useState(steps.find((s) => s.leadState)?.key ?? "");
  const [mode, setMode] = useState<"proactive" | "reactive">("proactive");
  const [trigger, setTrigger] = useState(triggers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [pipeId, setPipeId] = useState(livePipes[0]?.id ?? "");
  const [kind, setKind] = useState<"rules" | "ai" | "human">("ai");
  const [cost, setCost] = useState("0.80");
  const [label, setLabel] = useState("");
  const [strategy, setStrategy] = useState(c.strategies[0]?.id ?? "");
  const select = "k-input w-full px-1.5";
  if (what === "pipe") {
    const id = `${channel}|${from}_to_${to}`;
    const exists = !!c.pipe(id);
    return (
      <div className="space-y-3">
        <p className="k-fg2 text-[13px]">A pipe is a channel on one leg. Once added, every funnel that can use it considers it, from its own prior.</p>
        <Field label="Channel">
          <select className={select} value={channel} onChange={(e) => setChannel(e.target.value)} style={{ font: "inherit" }}>
            {channels.map((ch) => (
              <option key={ch.slug} value={ch.slug}>
                {ch.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <select className={select} value={from} onChange={(e) => setFrom(e.target.value)} style={{ font: "inherit" }}>
              <option value={START}>Start</option>
              {steps.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To">
            <select className={select} value={to} onChange={(e) => setTo(e.target.value)} style={{ font: "inherit" }}>
              {steps.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Runs">
          <select className={select} value={mode} onChange={(e) => setMode(e.target.value as "proactive" | "reactive")} style={{ font: "inherit" }}>
            <option value="proactive">Every day, on its own budget</option>
            <option value="reactive">When a trigger fires</option>
          </select>
        </Field>
        {mode === "reactive" && (
          <Field label="Trigger">
            <select className={select} value={trigger} onChange={(e) => setTrigger(e.target.value)} style={{ font: "inherit" }}>
              {triggers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Name">
          <input className="k-input w-full px-2" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kestrel" />
        </Field>
        <button
          type="button"
          className="k-btn-strong"
          disabled={exists || from === to || !to}
          onClick={() =>
            onDone(
              {
                type: "addPipe",
                pipe: {
                  id,
                  channel,
                  from,
                  to,
                  mode,
                  triggerId: mode === "reactive" ? trigger : null,
                  name: name || "New pipe",
                  maturity: { durationDays: 7, outcomesRequired: 10, delayMeanDays: 2 },
                },
              },
              "Added with its workflows and templates. Funnels consider it from the next decision.",
            )
          }
        >
          Add pipe
        </button>
        {exists && <p className="k-fg3 text-[12px]">This pipe already exists.</p>}
      </div>
    );
  }
  if (what === "workflow") {
    const n = c.workflows.filter((w) => w.pipeId === pipeId && w.id.includes(":wf:custom")).length + 1;
    return (
      <div className="space-y-3">
        <p className="k-fg2 text-[13px]">A workflow is how a pipe is performed. A new one starts wide open: the prioritizer tries it, then keeps it only if it pays.</p>
        <Field label="Pipe">
          <select className={select} value={pipeId} onChange={(e) => setPipeId(e.target.value)} style={{ font: "inherit" }}>
            {livePipes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}: {channelName(c, p)}, {stepLabel(c, p.from)} to {stepLabel(c, p.to)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Done by">
          <select className={select} value={kind} onChange={(e) => setKind(e.target.value as "rules" | "ai" | "human")} style={{ font: "inherit" }}>
            <option value="rules">Rules</option>
            <option value="ai">AI</option>
            <option value="human">A person</option>
          </select>
        </Field>
        <Field label="Cost per input">
          <span className="k-input flex items-center gap-1 px-2">
            <span className="k-fg3">$</span>
            <input className="w-full bg-transparent outline-none" style={{ font: "inherit" }} value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} />
          </span>
        </Field>
        <button
          type="button"
          className="k-btn-strong"
          onClick={() =>
            onDone(
              {
                type: "addWorkflow",
                workflow: {
                  id: `${pipeId}:wf:custom-${n}`,
                  dynasty: `${pipeId}:custom-${n}`,
                  pipeId,
                  kind,
                  slots: kind === "ai" ? ["template", "llm"] : ["template"],
                  tactics: [],
                  costPerTrialCents: Math.max(1, Math.round(Number(cost) * 100)),
                  status: "active",
                },
              },
              "Added. It competes from the next pick.",
            )
          }
        >
          Add workflow
        </button>
      </div>
    );
  }
  if (what === "trigger") {
    return (
      <div className="space-y-3">
        <p className="k-fg2 text-[13px]">A trigger wakes a reactive pipe: a condition about a lead. Add it, then give a pipe this trigger.</p>
        <Field label="Label">
          <input className="k-input w-full px-2" style={{ font: "inherit" }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Opened the pricing page twice" />
        </Field>
        <button
          type="button"
          className="k-btn-strong"
          disabled={!label.trim() || !!c.trigger(slug(label))}
          onClick={() => onDone({ type: "addTrigger", trigger: { id: slug(label), label: label.trim(), kind: "condition", outcomeStep: null, fromStep: null } }, "Added. Pick it when you add a reactive pipe.")}
        >
          Add trigger
        </button>
      </div>
    );
  }
  const playId = `${pipeId}#${strategy}`;
  return (
    <div className="space-y-3">
      <p className="k-fg2 text-[13px]">A play puts a strategy on a pipe. Funnels can then pick the pipe with only the workflows the strategy allows.</p>
      <Field label="Pipe">
        <select className={select} value={pipeId} onChange={(e) => setPipeId(e.target.value)} style={{ font: "inherit" }}>
          {livePipes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: {channelName(c, p)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Strategy">
        <select className={select} value={strategy} onChange={(e) => setStrategy(e.target.value)} style={{ font: "inherit" }}>
          {c.strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <button type="button" className="k-btn-strong" disabled={!!c.play(playId)} onClick={() => onDone({ type: "addPlay", play: { id: playId, pipeId, strategyId: strategy } }, "Added. It competes in the funnels from the next decision.")}>
        Add play
      </button>
    </div>
  );
}
