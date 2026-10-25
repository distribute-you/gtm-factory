"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type { SimLead } from "@gtm-factory/engine";
import { FunnelLine } from "@/components/funnel-line";
import { Mark } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Initials, KeyHint, Page, PageHeader, SectionTitle, TD, TDN, TH, Tabs, ToneDot, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { campaignHref } from "./campaigns";
import { funnelName, leadStateOn, nodeLabel, outcomeLabel, pipeTitle, slotOptionLabel, workflowLabel, type Model, type TrackDef } from "@/lib/model";
import { companyKey, companyName, personName, personTitle } from "@/lib/people";
import { formatCentsExact, formatCount, formatRatePct, humanize, sentenceCase } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function leadHref(id: string): string {
  return `/leads/view/?id=${encodeURIComponent(id)}`;
}

const COLUMN_CAP = 20;

/** The day a lead reached its state on a track (its last outcome on that track). */
function reachedDay(model: Model, lead: SimLead, track: TrackDef): number {
  for (let i = lead.timeline.length - 1; i >= 0; i--) {
    const e = lead.timeline[i]!;
    if (e.kind === "outcome" && e.step && model.catalogue.step(e.step)?.leadState?.leadTrack === track.id) return e.day;
  }
  return lead.createdDay;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function LeadsPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Leads" }]} />
      <Page>{model ? <Board model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Board({ model, scope }: { model: Model; scope: string | null }) {
  const asked = useSearchParams().get("state");
  const initial = model.tracks.find((t) => t.states.some((s) => s.state === asked))?.id ?? model.tracks[0]?.id ?? "";
  const [trackId, setTrackId] = useState(initial);
  const track = model.tracks.find((t) => t.id === trackId) ?? model.tracks[0];
  const leads = useMemo(() => model.leads.filter((l) => !scope || l.brandId === scope), [model, scope]);
  if (!track) return <EmptyNote>The catalogue has no lead track.</EmptyNote>;
  const columns = [
    { key: "none", label: "Found, no state yet", leads: [] as SimLead[] },
    ...track.states.map((s) => ({ key: s.state, label: s.label, leads: [] as SimLead[] })),
  ];
  for (const l of leads) {
    const st = leadStateOn(model, l, track);
    columns.find((c) => c.key === (st?.state ?? "none"))!.leads.push(l);
  }
  for (const c of columns) c.leads.sort((a, b) => reachedDay(model, b, track) - reachedDay(model, a, track) || (a.id < b.id ? 1 : -1));
  const reached = leads.length - columns[0]!.leads.length;
  return (
    <>
      <PageHeader
        title={`${formatCount(reached)} of ${formatCount(leads.length)} leads moved on the ${track.label}`}
        sub="One column per lead state. A lead sits in the furthest state it reached on this track."
      />
      <Tabs tabs={model.tracks.map((t) => ({ id: t.id, label: t.label, count: leads.filter((l) => (l.states[t.id] ?? 0) > 0).length }))} value={track.id} onChange={setTrackId} />
      <div className="k-scroll flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.key} data-col={col.key} className={`flex min-w-[208px] flex-1 flex-col rounded-[12px] p-2 ${col.key === asked ? "k-selected" : "k-inset"}`}>
            <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
              <span className="flex items-center gap-1.5">
                {col.key !== "none" ? <Mark kind="step" id={col.key} size={16} /> : <Mark kind="start" id="none" size={16} quiet />}
                <span className="text-[13px] font-medium">{col.label}</span>
              </span>
              <span className="k-fg3 text-[12px] tabular-nums">{formatCount(col.leads.length)}</span>
            </div>
            <div className="space-y-1.5">
              {col.leads.slice(0, COLUMN_CAP).map((l) => (
                <Link key={l.id} href={leadHref(l.id)} className="k-card k-rise block px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Initials name={personName(l)} size={22} round />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{personName(l)}</span>
                      <span className="k-fg3 block truncate text-[12px]">{companyName(companyKey(l))}</span>
                    </span>
                    <span className="k-mono k-fg3 shrink-0 text-[11px]">Day {reachedDay(model, l, track)}</span>
                  </span>
                </Link>
              ))}
              {col.leads.length > COLUMN_CAP && <p className="k-fg3 px-1.5 py-1 text-[12px]">and {formatCount(col.leads.length - COLUMN_CAP)} more</p>}
              {col.leads.length === 0 && <p className="k-fg3 px-1.5 py-3 text-[12px]">Nobody here yet.</p>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------

export function LeadPage() {
  const { model } = useSim();
  const id = useSearchParams().get("id") ?? "";
  const lead = model?.leadById.get(id);
  return (
    <>
      <TopBar crumbs={[{ label: "Leads", href: "/leads/" }, { label: lead ? personName(lead) : "Lead" }]} />
      <Page>
        {!model ? (
          <PageSkeleton />
        ) : !lead ? (
          <div className="k-card">
            <EmptyNote>
              This lead does not exist in this world yet. <Link href="/leads/" className="k-accent">See every lead</Link>.
            </EmptyNote>
          </div>
        ) : (
          <Lead model={model} lead={lead} />
        )}
      </Page>
    </>
  );
}

type Entry = { day: number; order: number; node: React.ReactNode };

function Lead({ model, lead }: { model: Model; lead: SimLead }) {
  const client = model.clients.find((c) => c.campaign.id === lead.campaignId);
  const audience = model.result.audiences.find((a) => a.id === lead.audienceId);
  const evidence = model.result.evidence.filter((e) => e.subject === lead.id);
  const attested = model.result.attested.filter((a) => a.subject === lead.id);
  const reporters = new Map((model.world.reporters ?? []).map((r) => [r.reporter.id, r.reporter.name]));
  const entries: Entry[] = [];
  lead.timeline.forEach((e, i) => {
    const pipe = model.catalogue.pipe(e.pipeId);
    const ch = pipe ? model.catalogue.channel(pipe.channel) : undefined;
    if (e.kind === "trial") {
      const slots = Object.entries(e.slotChoice ?? {}).map(([slot, id]) => `${nodeLabel(`slot:${slot}`)}: ${slotOptionLabel(model.catalogue, id)}`);
      entries.push({
        day: e.day,
        order: i * 3,
        node: (
          <TimelineRow mark={<Mark kind="channel" id={pipe?.channel ?? ""} icon={ch?.icon} size={28} />} title={<>{ch?.name} worked on this lead</>}>
            {pipeTitle(model.catalogue, e.pipeId).name} · {e.workflowId ? workflowLabel(model.catalogue, e.workflowId) : "—"}
            {slots.length ? ` · ${slots.join(" · ")}` : ""} · run {e.runId.replace("run:", "#")}
          </TimelineRow>
        ),
      });
    } else {
      const state = model.catalogue.step(e.step ?? "")?.leadState?.state ?? e.step ?? "";
      const std = e.occurrenceId ? model.result.ledger.standardCents[e.occurrenceId] : undefined;
      entries.push({
        day: e.day,
        order: i * 3 + 1,
        node: (
          <TimelineRow mark={<Mark kind="step" id={e.step ?? ""} icon={model.catalogue.step(e.step ?? "")?.icon} size={28} />} title={<>Reached {outcomeLabel(model, state)}</>} tone="run">
            {e.occurrenceId
              ? `New occurrence, standard cost ${std != null ? formatCentsExact(std) : "—"} (its share of the run that made it)`
              : "Already there on its track: no new occurrence, no new cost"}
          </TimelineRow>
        ),
      });
    }
  });
  for (const ev of evidence) {
    const a = attested.find((x) => x.outcome === ev.outcome);
    entries.push({
      day: ev.day,
      order: 1e9,
      node: (
        <TimelineRow mark={<Mark kind="trigger" id={ev.reporterId} size={28} />} title={<>{reporters.get(ev.reporterId) ?? ev.reporterId} reported {outcomeLabel(model, ev.outcome)}</>}>
          Evidence. Confidence it happened: {a ? formatRatePct(a.confidence) : "—"} across {a?.reporters.length ?? 1} reporter{(a?.reporters.length ?? 1) === 1 ? "" : "s"}.
        </TimelineRow>
      ),
    });
  }
  entries.sort((a, b) => b.day - a.day || b.order - a.order);
  const name = personName(lead);
  return (
    <>
      <div className="mb-6 flex items-start gap-3">
        <Initials name={name} size={40} round />
        <div>
          <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]">{name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="k-chip">{personTitle(lead)}</span>
            <span className="k-chip">{companyName(companyKey(lead))}</span>
            {model.tracks.map((t) => {
              const st = leadStateOn(model, lead, t);
              return st ? (
                <ToneDot key={t.id} tone="run">
                  {st.label}
                </ToneDot>
              ) : null;
            })}
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <SectionTitle count={entries.length}>Timeline</SectionTitle>
          <div className="k-card divide-y divide-[var(--line-subtle)]">
            {entries.map((e, i) => (
              <div key={i} className="flex gap-3 px-4 py-3">
                <span className="k-mono k-fg3 w-14 shrink-0 pt-1 text-[12px]">Day {e.day}</span>
                <div className="min-w-0 flex-1">{e.node}</div>
              </div>
            ))}
          </div>
        </section>
        <aside className="k-card h-fit p-4">
          <dl className="space-y-3 text-[13px]">
            <div>
              <dt className="k-label">Client</dt>
              <dd>{client?.brand.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="k-label">Campaign</dt>
              <dd>
                {client ? (
                  <Link href={campaignHref(client.campaign.id)} className="k-accent">
                    {funnelName(model.catalogue, lead.funnel)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="k-label">Funnel it walks</dt>
              <dd className="mt-1">
                <FunnelLine catalogue={model.catalogue} plays={lead.funnel} />
              </dd>
            </div>
            <div>
              <dt className="k-label">Audience</dt>
              <dd>{audience ? sentenceCase(audience.name) : "—"}</dd>
            </div>
            {model.tracks.map((t) => (
              <div key={t.id}>
                <dt className="k-label">{t.label}</dt>
                <dd>{leadStateOn(model, lead, t)?.label ?? <span className="k-fg4">—</span>}</dd>
              </div>
            ))}
            {Object.entries(lead.attributes).map(([k, v]) => (
              <div key={k}>
                <dt className="k-label">{humanize(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt className="k-label">First found</dt>
              <dd className="k-mono k-fg2 text-[12px]">Day {lead.createdDay}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}

function TimelineRow({ mark, title, children, tone }: { mark: React.ReactNode; title: React.ReactNode; children: React.ReactNode; tone?: "run" }) {
  return (
    <div className="flex items-start gap-2.5">
      {mark}
      <div className="min-w-0">
        <p className={`text-[13px] font-medium ${tone === "run" ? "text-[var(--run)]" : ""}`}>{title}</p>
        <p className="k-fg3 text-[12px]">{children}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export function CompaniesPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Companies" }]} />
      <Page>{model ? <Companies model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

interface CompanyRow {
  key: string;
  name: string;
  brand: string;
  country: string;
  size: string;
  people: SimLead[];
  best: { label: string; rank: number } | null;
  last: number;
}

function Companies({ model, scope }: { model: Model; scope: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CompanyRow | null>(null);
  const [cursor, setCursor] = useState(0);
  const [limit, setLimit] = useState(50);
  const track = model.tracks[0];
  const rows = useMemo(() => {
    const map = new Map<string, CompanyRow>();
    for (const l of model.leads) {
      if (scope && l.brandId !== scope) continue;
      const key = companyKey(l);
      const row =
        map.get(key) ??
        ({ key, name: companyName(key), brand: model.clients.find((c) => c.brand.id === l.brandId)?.brand.name ?? "", country: l.attributes.country ?? "", size: l.attributes.company_size ?? "", people: [], best: null, last: 0 } as CompanyRow);
      row.people.push(l);
      row.last = Math.max(row.last, l.timeline[l.timeline.length - 1]?.day ?? l.createdDay);
      const st = track ? leadStateOn(model, l, track) : null;
      if (st && (!row.best || st.rank > row.best.rank)) row.best = { label: st.label, rank: st.rank };
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => (b.best?.rank ?? 0) - (a.best?.rank ?? 0) || b.people.length - a.people.length || b.last - a.last);
  }, [model, scope, track]);
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.brand.toLowerCase().includes(q.toLowerCase()));
  const visible = shown.slice(0, limit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("company-search")?.focus();
      } else if (e.key === "j") setCursor((c) => Math.min(visible.length - 1, c + 1));
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      else if (e.key === "Enter" && visible[cursor]) setOpen(visible[cursor]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor]);

  return (
    <>
      <PageHeader title={`${formatCount(rows.length)} companies`} sub={`Every company the campaigns reached. Ranked by the furthest state one of its people reached on the ${track?.label ?? "first track"}.`} />
      <div className="mb-3 flex items-center gap-2">
        <span className="k-input flex w-72 items-center gap-1.5 px-2">
          <MagnifyingGlassIcon size={13} className="k-fg3" />
          <input id="company-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="w-full bg-transparent outline-none" style={{ font: "inherit" }} />
          <span className="k-kbd">/</span>
        </span>
        <span className="ml-auto flex gap-3">
          <KeyHint keys={["J", "K"]} label="to move" />
          <KeyHint keys={["↵"]} label="to open" />
        </span>
      </div>
      <CardTable
        footer={
          <span className="flex items-center justify-between">
            <span>
              {formatCount(visible.length)} of {formatCount(shown.length)}
            </span>
            {shown.length > limit && (
              <button type="button" className="k-btn-ghost" onClick={() => setLimit((n) => n + 50)}>
                Show 50 more
              </button>
            )}
          </span>
        }
      >
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Company</th>
            <th className={TH}>Client</th>
            <th className={TH}>Country</th>
            <th className={TH}>Size</th>
            <th className={`${TH} text-right`}># people</th>
            <th className={TH}>Furthest state</th>
            <th className={`${TH} text-right`}>Last activity</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={r.key} className={`k-row h-10 cursor-pointer ${i === cursor ? "k-selected" : ""}`} onClick={() => setOpen(r)}>
              <td className={TD}>
                <span className="flex items-center gap-2">
                  <Initials name={r.name} size={20} />
                  <span className="font-medium">{r.name}</span>
                </span>
              </td>
              <td className={`${TD} k-fg2`}>{r.brand}</td>
              <td className={`${TD} k-fg2`}>{r.country}</td>
              <td className={`${TD} k-fg2 tabular-nums`}>{r.size}</td>
              <td className={TDN}>{r.people.length}</td>
              <td className={TD}>{r.best ? <ToneDot tone="run">{r.best.label}</ToneDot> : <span className="k-fg4">—</span>}</td>
              <td className={`${TDN} k-mono k-fg2 text-[12px]`}>Day {r.last}</td>
            </tr>
          ))}
        </tbody>
      </CardTable>
      {open && (
        <Drawer title={open.name} onClose={() => setOpen(null)}>
          <p className="k-fg2 text-[13px]">
            {open.brand} reached {open.people.length} {open.people.length === 1 ? "person" : "people"} here. {open.country}, {open.size} people.
          </p>
          <div className="k-card mt-3 divide-y divide-[var(--line-subtle)]">
            {open.people.map((l) => (
              <button key={l.id} type="button" onClick={() => router.push(leadHref(l.id))} className="k-hover flex w-full items-center gap-2 px-3 py-2 text-left">
                <Initials name={personName(l)} size={22} round />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{personName(l)}</span>
                  <span className="k-fg3 block truncate text-[12px]">{personTitle(l)}</span>
                </span>
                <span className="k-fg2 text-[12px]">{(track && leadStateOn(model, l, track)?.label) ?? "No state yet"}</span>
              </button>
            ))}
          </div>
        </Drawer>
      )}
    </>
  );
}
