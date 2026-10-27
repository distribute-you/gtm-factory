"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { confidenceOf, type Unit, type TacticValue } from "@gtm-factory/engine";
import { ProviderLogo } from "@/components/catalogue-bits";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Initials, Page, PageHeader, SectionTitle, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { companyName, factoryName, leadRows, candidateLabel, outcomeLabel, personName, pipeName, pointInfo, timelineOf, type LeadRow, type Model } from "@/lib/model";
import { formatCount, formatRatePct, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

export function leadHref(id: string): string {
  return `/leads/view/?id=${encodeURIComponent(id)}`;
}

const PER_COLUMN = 12;

/** Who brought a lead in: our factory, or another one. */
function RootDot({ model, root }: { model: Model; root: string }) {
  const ours = model.catalogue.factory(root)?.ours ?? false;
  return <ToneDot tone={ours ? "run" : "amber"}>{ours ? "Our runs" : factoryName(model.catalogue, root)}</ToneDot>;
}

// ---------------------------------------------------------------------------
// Leads board
// ---------------------------------------------------------------------------

export function LeadsPage() {
  const { model, scope } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Leads" }]} />
      <Page>{model ? <Leads model={model} scope={scope} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Leads({ model, scope }: { model: Model; scope: string | null }) {
  const search = useSearchParams();
  const only = search.get("state");
  const rows = leadRows(model, scope);
  const columns = model.tracks.map((t) => ({
    track: t,
    cols: [
      { key: `${t.id}:none`, label: "No state yet", rows: rows.filter((r) => !r.states[t.id]) },
      ...t.states.map((s) => ({ key: s.outcome, label: s.label, rows: rows.filter((r) => r.states[t.id]?.outcome === s.outcome) })),
    ].filter((c) => !only || c.key === only),
  }));
  const ours = rows.filter((r) => model.catalogue.factory(r.root)?.ours).length;
  return (
    <>
      <PageHeader
        title={<>{plural(rows.length, "lead", "leads")}</>}
        sub={`${formatCount(ours)} brought by our runs, ${formatCount(rows.length - ours)} by another factory. A lead moves on each track on its own.`}
        right={only ? <Link href="/leads/" className="k-btn">Every state</Link> : undefined}
      />
      {columns.map(({ track, cols }) =>
        cols.length === 0 ? null : (
          <section key={track.id} className="mb-8">
            <SectionTitle right={<span>{track.description}</span>}>{track.label}</SectionTitle>
            <div className="k-scroll flex gap-3 overflow-x-auto pb-2">
              {cols.map((c) => (
                <div key={c.key} data-col={c.key} className="k-inset flex w-[260px] shrink-0 flex-col rounded-[12px] p-2">
                  <div className="flex items-baseline justify-between px-1.5 pb-2 pt-1">
                    <span className="k-label truncate">{c.label}</span>
                    <span className="k-fg3 text-[12px] tabular-nums">{formatCount(c.rows.length)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {[...c.rows]
                      .sort((a, b) => b.firstDay - a.firstDay || (a.person.id < b.person.id ? -1 : 1))
                      .slice(0, PER_COLUMN)
                      .map((r) => (
                        <LeadCard key={r.person.id} model={model} row={r} />
                      ))}
                    {c.rows.length === 0 && <p className="k-fg3 px-1.5 py-2 text-[12px]">Nobody here yet.</p>}
                    {c.rows.length > PER_COLUMN && <p className="k-fg3 px-1.5 py-1 text-[12px]">and {formatCount(c.rows.length - PER_COLUMN)} more</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}

function LeadCard({ model, row }: { model: Model; row: LeadRow }) {
  const name = personName(row.person.id);
  const campaigns = row.campaignIds.map((id) => model.campaigns.find((c) => c.id === id)?.name).filter(Boolean);
  return (
    <Link href={leadHref(row.person.id)} className="k-card k-hover block px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Initials name={name} size={22} round />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{name}</span>
          <span className="k-fg3 block truncate text-[12px]">{companyName(row.person.companyId)}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <RootDot model={model} root={row.root} />
        <span className="k-fg3 k-mono text-[11px]">Day {row.firstDay}</span>
      </div>
      {campaigns.length > 0 && <p className="k-fg3 mt-1 truncate text-[11px]">{campaigns.join(", ")}</p>}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------

export function LeadPage() {
  const { model } = useSim();
  const id = useSearchParams().get("id") ?? "";
  const person = model?.session.person(id);
  return (
    <>
      <TopBar crumbs={[{ label: "Leads", href: "/leads/" }, { label: person ? personName(person.id) : "Lead" }]} />
      <Page>{model ? person ? <Lead model={model} id={id} /> : <EmptyNote>This lead is not in the world on this day.</EmptyNote> : <PageSkeleton />}</Page>
    </>
  );
}

function TacticList({ model, values, level }: { model: Model; values: Record<string, TacticValue>; level: "lead" | "company" }) {
  const tactics = model.catalogue.tactics.filter((t) => t.describes.includes(level) && values[t.id] !== undefined);
  return (
    <dl className="space-y-2">
      {tactics.map((t) => (
        <div key={t.id} className="flex items-baseline justify-between gap-3">
          <dt className="k-label">{t.name}</dt>
          <dd className="text-right text-[13px] tabular-nums">{valueText(values[t.id]!, t.type.kind === "number" ? t.type.unit : undefined)}</dd>
        </div>
      ))}
    </dl>
  );
}

function valueText(v: TacticValue, unit?: string): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return `${v}${unit ? ` ${unit}` : ""}`;
  return v;
}

function Lead({ model, id }: { model: Model; id: string }) {
  const s = model.session;
  const person = s.person(id)!;
  const name = personName(id);
  const reached = s.reachedBy(id);
  const timeline = useMemo(() => timelineOf(model, id), [model, id]);
  const reliability = useMemo(() => s.reliability(), [s, model.day]);
  const pushes = s.pushes.filter((p) => p.subject === id);
  const root = s.rootOf(id) ?? "";
  const attempts = s.attemptsOf(id);
  return (
    <>
      <div className="mb-6 flex items-start gap-3">
        <Initials name={name} size={40} round />
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium leading-8 tracking-[-0.02em]">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <RootDot model={model} root={root} />
            <Link href={`/companies/?id=${encodeURIComponent(person.companyId)}`} className="k-chip">
              {companyName(person.companyId)}
            </Link>
            {s.campaignsOfSubject(id).map((c) => (
              <Link key={c} href={`/campaigns/view/?id=${encodeURIComponent(c)}`} className="k-chip">
                {model.campaigns.find((x) => x.id === c)?.name ?? c}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle>Lead states</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {model.tracks.map((t) => (
                <div key={t.id} className="k-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Mark kind="leadTrack" id={t.id} size={20} />
                    <span className="text-[13px] font-medium">{t.label}</span>
                  </div>
                  <ol className="space-y-1.5">
                    {t.states.map((st) => {
                      const day = reached.get(st.outcome);
                      const producers = [...new Set(timeline.filter((o) => o.outcome === st.outcome && o.pipeId).map((o) => o.pipeId!))];
                      const conf = day !== undefined && producers.length > 0 ? confidenceOf(producers, st.outcome, reliability) : null;
                      return (
                        <li key={st.outcome} className="flex items-center gap-2 text-[13px]">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${day !== undefined ? "bg-[var(--data-teal)]" : "border-[1.5px] border-[var(--fg-4)]"}`} />
                          <span className={day !== undefined ? "" : "k-fg3"}>{st.label}</span>
                          <span className="k-fg3 k-mono ml-auto text-[12px]">
                            {day !== undefined ? `Day ${day}` : "—"}
                            {conf !== null && ` · ${formatRatePct(conf)} sure`}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle count={timeline.length} right={<span>Oldest first. Each line names the script that made it and what led to it.</span>}>
              Timeline
            </SectionTitle>
            <div className="k-card divide-y divide-[var(--line-subtle)]">
              {timeline.map((o) => (
                <TimelineRow key={o.id} model={model} occ={o} />
              ))}
              {timeline.length === 0 && <EmptyNote>Nothing happened to this lead yet.</EmptyNote>}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="k-card h-fit p-4">
            <p className="k-label mb-3">Person</p>
            <TacticList model={model} values={person.values} level="lead" />
          </div>
          <div className="k-card h-fit p-4">
            <p className="k-label mb-3">Company</p>
            <TacticList model={model} values={person.values} level="company" />
          </div>
          <div className="k-card h-fit p-4">
            <p className="k-label mb-3">Pushed into campaigns</p>
            {pushes.length === 0 ? (
              <p className="k-fg3 text-[12px]">No reactive campaign took a Unit of this lead.</p>
            ) : (
              <ul className="space-y-1.5">
                {pushes.map((p) => (
                  <li key={`${p.campaignId}:${p.unitId}`} className="flex items-center gap-2 text-[13px]">
                    <Mark kind="funnel" id={p.campaignId} size={18} />
                    <span className="min-w-0 flex-1 truncate">{model.session.campaign(p.campaignId)?.name ?? p.campaignId}</span>
                    <span className="k-fg3 k-mono text-[12px]">Day {p.day}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="k-card h-fit p-4">
            <p className="k-label mb-3">Legs tried</p>
            <ul className="space-y-1.5">
              {attempts.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">
                    {outcomeLabel(model.catalogue, a.from)} → {outcomeLabel(model.catalogue, a.to)}
                  </span>
                  <ToneDot tone={a.status === "done" ? "teal" : a.status === "failed" ? "rose" : "accent"}>{a.status === "done" ? "Reached" : a.status === "failed" ? "Stopped" : "Open"}</ToneDot>
                </li>
              ))}
              {attempts.length === 0 && <li className="k-fg3 text-[12px]">No leg tried yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function TimelineRow({ model, occ }: { model: Model; occ: Unit }) {
  const [open, setOpen] = useState(false);
  const script = occ.scriptId ? model.catalogue.script(occ.scriptId) : undefined;
  const ours = model.catalogue.factory(occ.factory)?.ours ?? false;
  const campaign = occ.campaignId ? model.campaigns.find((c) => c.id === occ.campaignId) : undefined;
  const choices = occ.trace.map((d) => model.session.decisions[d]).filter((d): d is NonNullable<typeof d> => !!d);
  const inputs = Object.entries(occ.materials).filter(([, v]) => v);
  return (
    <div className="px-4 py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        {script ? <ProviderLogo script={script} size={28} /> : <Mark kind="outcome" id={occ.outcome} icon={model.catalogue.outcome(occ.outcome)?.icon} size={28} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{outcomeLabel(model.catalogue, occ.outcome)}</span>
          <span className="k-fg3 block truncate text-[12px]">
            {occ.pipeId ? pipeName(model.catalogue, occ.pipeId) : "Setup"}
            {script ? ` · ${script.name}` : ""}
            {campaign ? ` · ${campaign.name}` : ""}
          </span>
        </span>
        <ToneDot tone={ours ? "run" : "amber"}>{ours ? "Our run" : factoryName(model.catalogue, occ.factory)}</ToneDot>
        <span className="k-fg3 k-mono w-14 shrink-0 text-right text-[12px]">Day {occ.day}</span>
      </button>
      {open && (
        <div className="k-inset mt-2 space-y-2 rounded-[8px] p-3">
          <div>
            <p className="k-label mb-1">Materials consumed</p>
            {inputs.length === 0 ? (
              <p className="k-fg3 text-[12px]">None: it came from the market or from outside.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {inputs.map(([o, id]) => {
                  const src = model.session.unit(id);
                  return (
                    <span key={o} className="k-chip">
                      {outcomeLabel(model.catalogue, o)}
                      {src?.name ? `: ${src.name}${src.version ? ` v${src.version}` : ""}` : src ? ` (day ${src.day})` : ""}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="k-label mb-1">Traceability: the choices that led here</p>
            {choices.length === 0 ? (
              <p className="k-fg3 text-[12px]">No choice: a single candidate or another factory.</p>
            ) : (
              <ul className="space-y-1">
                {choices.map((d) => (
                  <li key={d.id} className="flex items-baseline gap-2 text-[12px]">
                    <span className="k-fg3 min-w-0 flex-1 truncate">{pointInfo(model.catalogue, d.point).title}</span>
                    <span className="truncate font-medium">{candidateLabel(model, d.point, d.candidate, d.brandId)}</span>
                    <span className="k-fg3 k-mono">Day {d.day}</span>
                    {d.credited && <span className="k-chip">Credited</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
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
  id: string;
  leads: LeadRow[];
  furthest: { label: string; rank: number; track: string } | null;
  researchedDay: number | null;
  researchUses: number;
}

function Companies({ model, scope }: { model: Model; scope: string | null }) {
  const focus = useSearchParams().get("id");
  const [shown, setShown] = useState(50);
  const rows = useMemo(() => {
    const leads = leadRows(model, scope);
    const by = new Map<string, LeadRow[]>();
    for (const l of leads) by.set(l.person.companyId, [...(by.get(l.person.companyId) ?? []), l]);
    // One research of a company serves every lead of it: count the leads whose message consumed it.
    const research = new Map<string, number>();
    const uses = new Map<string, number>();
    const occCompany = new Map<string, string>();
    for (const o of model.session.units) {
      if (!by.has(o.subject)) continue;
      occCompany.set(o.id, o.subject);
      if (model.catalogue.outcome(o.outcome)?.subject === "company") research.set(o.subject, Math.min(research.get(o.subject) ?? o.day, o.day));
    }
    for (const o of model.session.units) {
      for (const id of Object.values(o.materials)) {
        const cid = occCompany.get(id);
        if (cid) uses.set(cid, (uses.get(cid) ?? 0) + 1);
      }
    }
    const out: CompanyRow[] = [...by].map(([id, ls]) => {
      let furthest: CompanyRow["furthest"] = null;
      for (const l of ls)
        for (const t of model.tracks) {
          const st = l.states[t.id];
          if (st && (!furthest || st.rank > furthest.rank)) furthest = { label: st.label, rank: st.rank, track: t.label };
        }
      return { id, leads: ls, furthest, researchedDay: research.get(id) ?? null, researchUses: uses.get(id) ?? 0 };
    });
    return out.sort((a, b) => (b.furthest?.rank ?? 0) - (a.furthest?.rank ?? 0) || b.leads.length - a.leads.length || (a.id < b.id ? -1 : 1));
  }, [model, scope]);
  const focused = focus ? rows.find((r) => r.id === focus) : undefined;
  const companyTactics = model.catalogue.tactics.filter((t) => t.describes.includes("company"));
  const list = focused ? [focused, ...rows.filter((r) => r !== focused)] : rows;
  return (
    <>
      <PageHeader
        title={<>{plural(rows.length, "company", "companies")}</>}
        sub="Every lead resolves to one person in one company: identity is a pipe, and every pipe shares its ids. One company research serves every lead of that company."
      />
      <CardTable
        footer={
          <span className="flex items-center justify-between">
            <span>
              {formatCount(Math.min(shown, list.length))} of {formatCount(list.length)}
            </span>
            {shown < list.length && (
              <button type="button" className="k-btn-ghost" onClick={() => setShown((n) => n + 50)}>
                Show 50 more
              </button>
            )}
          </span>
        }
      >
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Company</th>
            {companyTactics.map((t) => (
              <th key={t.id} className={TH}>
                {t.name}
              </th>
            ))}
            <th className={TH}>Furthest state</th>
            <th className={TH}>Researched</th>
            <th className={`${TH} text-right`}>Leads</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, shown).map((r) => {
            const values = r.leads[0]!.person.values;
            return (
              <tr key={r.id} className={`k-row k-line-subtle border-b ${r === focused ? "k-selected" : ""}`}>
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Initials name={companyName(r.id)} size={22} />
                    <span className="truncate font-medium">{companyName(r.id)}</span>
                  </span>
                </td>
                {companyTactics.map((t) => (
                  <td key={t.id} className={`${TD} tabular-nums`}>
                    {values[t.id] !== undefined ? valueText(values[t.id]!, t.type.kind === "number" ? t.type.unit : undefined) : <span className="k-fg4">—</span>}
                  </td>
                ))}
                <td className={TD}>{r.furthest ? r.furthest.label : <span className="k-fg4">—</span>}</td>
                <td className={TD}>
                  {r.researchedDay !== null ? (
                    <span className="k-fg2 text-[12px]">
                      Day {r.researchedDay}
                      {r.researchUses > 0 ? `, used ${r.researchUses}×` : ""}
                    </span>
                  ) : (
                    <span className="k-fg4">—</span>
                  )}
                </td>
                <td className={TDN}>
                  <Link href={leadHref(r.leads[0]!.person.id)} className="hover:underline">
                    {formatCount(r.leads.length)}
                  </Link>
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td colSpan={5 + companyTactics.length}>
                <EmptyNote>No company yet. Press play.</EmptyNote>
              </td>
            </tr>
          )}
        </tbody>
      </CardTable>
    </>
  );
}

