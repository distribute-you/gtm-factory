"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef } from "react";
import { EyeIcon, FolderOpenIcon, LightningIcon } from "@phosphor-icons/react";
import { START, type CampaignView, type PointView, type RankedFunnel } from "@gtm-factory/engine";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, Shimmer, StateDot, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { formatCents, formatCount, formatRatePct, formatRoi, formatUsd, plural, roiIsGood } from "@/lib/format";
import { useShadow, type ShadowState } from "@/lib/shadow";
import { ACTION_WORDS, clientRows, lineName, optionName, outcomeName, pipeName, pointOptions, pointTitle } from "@/lib/shadow-model";
import { useSim } from "@/lib/sim";

export const shadowClientHref = (id: string) => `/shadow/client/?id=${encodeURIComponent(id)}`;

/** Open a snapshot: a file picked on this computer, or a snapshot of the running simulation. */
export function OpenSnapshot({ compact = false }: { compact?: boolean }) {
  const { openFile, openSimulation } = useShadow();
  const { model } = useSim();
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="snapshot-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="k-btn shrink-0" onClick={() => input.current?.click()} title="A snapshot file on this computer: it stays in this tab, nothing is uploaded">
        <FolderOpenIcon size={13} />
        {compact ? "Snapshot" : "Open a snapshot"}
      </button>
      {!compact && (
        <button type="button" className="k-btn shrink-0" disabled={!model} onClick={() => model && openSimulation(model)}>
          <EyeIcon size={13} />
          Shadow of this simulation
        </button>
      )}
    </span>
  );
}

function Frame({ crumbs, children }: { crumbs: { label: string; href?: string }[]; children: (s: ShadowState) => React.ReactNode }) {
  const { shadow, busy, error } = useShadow();
  return (
    <>
      <TopBar crumbs={[{ label: "Shadow", href: "/shadow/" }, ...crumbs]} />
      <Page>
        {busy ? (
          <div className="space-y-2">
            <p className="k-fg2 mb-4 text-[14px]">{busy}</p>
            {Array.from({ length: 6 }, (_, i) => (
              <Shimmer key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : shadow ? (
          children(shadow)
        ) : (
          <NoSnapshot error={error} />
        )}
      </Page>
    </>
  );
}

function NoSnapshot({ error }: { error: string | null }) {
  return (
    <>
      <PageHeader title="Shadow mode" sub="Load what a real factory did and see what the engine would do, beside what runs today. Nothing executes, nothing is sent anywhere: the snapshot stays in this tab." />
      <div className="k-card space-y-3 p-4">
        <p className="text-[13px]">A snapshot is one JSON file an exporter writes from a factory&apos;s own data. Open one, or take a snapshot of the simulation to see the same pages on fictional data.</p>
        <OpenSnapshot />
        {error && <p className="text-[12px] text-[var(--data-rose)]">{error}</p>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Every client: reconciliation first, then today against the engine
// ---------------------------------------------------------------------------

export function ShadowHomePage() {
  return <Frame crumbs={[{ label: "Clients" }]}>{(s) => <ShadowHome s={s} />}</Frame>;
}

function ShadowHome({ s }: { s: ShadowState }) {
  const rows = clientRows(s);
  const ok = rows.filter((r) => r.view.reconciliation.reconciles).length;
  const running = rows.reduce((n, r) => n + r.running, 0);
  return (
    <>
      <PageHeader
        title={
          <>
            {ok} of {plural(rows.length, "client", "clients")} reconcile
          </>
        }
        sub={`${s.snapshot.name}, read ${s.snapshot.takenAt.slice(0, 16).replace("T", " ")} UTC. ${plural(running, "campaign runs", "campaigns run")} today; the engine would launch ${plural(s.report.actions.length, "action", "actions")}. A client whose figures do not match production is greyed, with its gap, never with recommendations.`}
        right={
          <Link href="/shadow/actions/" className="k-btn">
            <LightningIcon size={13} />
            Actions
          </Link>
        }
      />
      <CardTable footer={`${rows.length} clients · source: ${s.origin}`}>
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Client</th>
            <th className={`${TH} text-right`}>Campaigns</th>
            <th className={`${TH} text-right`}>$ spent</th>
            <th className={`${TH} text-right`}>Leads interested</th>
            <th className={`${TH} text-right`}>Meetings booked</th>
            <th className={TH}>Reconciliation</th>
            <th className={`${TH} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rec = r.view.reconciliation;
            const gaps = rec.lines.filter((l) => !l.matches);
            return (
              <tr key={r.client.brand.id} className={`k-row k-line-subtle border-b last:border-b-0 ${rec.reconciles ? "" : "opacity-55"}`} data-reconciles={rec.reconciles ? "yes" : "no"}>
                <td className={TD}>
                  <Link href={shadowClientHref(r.client.brand.id)} className="flex min-w-0 items-center gap-2.5">
                    <Mark kind="audience" id={r.client.brand.id} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.client.brand.name}</span>
                      <span className="k-fg3 block truncate text-[12px]">{r.client.org.name}</span>
                    </span>
                  </Link>
                </td>
                <td className={TDN}>{r.campaigns > 0 ? `${r.running} running · ${r.campaigns}` : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{formatCents(r.spendCents)}</td>
                <td className={TDN}>{formatCount(r.states.lead_interested ?? 0)}</td>
                <td className={TDN}>{formatCount(r.states.meeting_booked ?? 0)}</td>
                <td className={TD}>
                  {rec.reconciles ? (
                    <ToneDot tone="run">Matches production</ToneDot>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      <ToneDot tone="rose">Gap</ToneDot>
                      <span className="k-fg3 text-[12px]">
                        {gaps.map((l) => `${lineName(s, l.key)}: ${fmtValue(l.key, l.snapshot)} here, ${fmtValue(l.key, l.production)} in production`).join(" · ") || `No production figure for ${rec.missing.map((k) => lineName(s, k).toLowerCase()).join(", ")}`}
                      </span>
                    </span>
                  )}
                </td>
                <td className={TDN}>{rec.reconciles ? formatCount(r.actions) : <span className="k-fg4">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </CardTable>
    </>
  );
}

function fmtValue(key: string, v: number): string {
  return key === "spend" ? formatCents(v) : formatCount(v);
}

// ---------------------------------------------------------------------------
// One client: its reconciliation, then each campaign, today beside the engine
// ---------------------------------------------------------------------------

export function ShadowClientPage() {
  const id = useSearchParams().get("id") ?? "";
  const { shadow } = useShadow();
  const name = shadow?.snapshot.clients.find((c) => c.brand.id === id)?.brand.name ?? "Client";
  return <Frame crumbs={[{ label: "Clients", href: "/shadow/" }, { label: name }]}>{(s) => <ShadowClient s={s} id={id} />}</Frame>;
}

function ShadowClient({ s, id }: { s: ShadowState; id: string }) {
  const client = s.snapshot.clients.find((c) => c.brand.id === id);
  const view = s.report.clients.find((c) => c.brandId === id);
  if (!client || !view) return <EmptyNote>This client is not in the snapshot.</EmptyNote>;
  const rec = view.reconciliation;
  const proposals = s.report.proposals.filter((p) => p.brandId === id);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <Mark kind="audience" id={id} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-medium leading-8 tracking-[-0.02em]">{client.brand.name}</h1>
          <p className="k-fg2 text-[13px]">
            {client.org.name} · {plural(client.campaigns.length, "campaign", "campaigns")} · {client.offers.map((o) => (o.lifetimeRevenue ? `${o.name}, a paid client worth ${formatUsd(o.lifetimeRevenue)}` : o.name)).join(" · ")}
          </p>
        </div>
        {rec.reconciles ? <ToneDot tone="run">Matches production</ToneDot> : <ToneDot tone="rose">Does not match production</ToneDot>}
      </div>

      <section className="mb-8">
        <SectionTitle count={rec.lines.length} right={<span>Within 1% matches. A gap shows here, never a recommendation.</span>}>
          Reconciliation
        </SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Figure</th>
              <th className={`${TH} text-right`}>In the snapshot</th>
              <th className={`${TH} text-right`}>In production</th>
              <th className={`${TH} text-right`}>Gap</th>
              <th className={TH}>Read from</th>
            </tr>
          </thead>
          <tbody>
            {rec.lines.map((l) => (
              <tr key={l.key} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={TD}>{lineName(s, l.key)}</td>
                <td className={TDN}>{fmtValue(l.key, l.snapshot)}</td>
                <td className={TDN}>{fmtValue(l.key, l.production)}</td>
                <td className={TDN}>{l.matches ? <ToneDot tone="run">{l.relativeGap ? formatRatePct(Math.abs(l.relativeGap)) : "None"}</ToneDot> : <ToneDot tone="rose">{fmtValue(l.key, l.gap)}</ToneDot>}</td>
                <td className={`${TD} k-fg3 text-[12px]`}>{l.source}</td>
              </tr>
            ))}
          </tbody>
        </CardTable>
        {rec.notes.map((n) => (
          <p key={n} className="k-fg3 mt-2 text-[12px]">
            {n}
          </p>
        ))}
      </section>

      {!rec.reconciles ? (
        <div className="k-card opacity-60">
          <EmptyNote>This client&apos;s figures do not match production, so the engine shows no recommendation for it.</EmptyNote>
        </div>
      ) : view.campaigns.length === 0 ? (
        <div className="k-card">
          <EmptyNote>No campaign: nothing runs today, so there is nothing to compare.</EmptyNote>
        </div>
      ) : (
        <>
          {proposals.length > 0 && (
            <section className="mb-8">
              <SectionTitle count={proposals.length}>Finer ICPs the engine would write</SectionTitle>
              <div className="k-card divide-y divide-[var(--line-subtle)]">
                {proposals.map((p, i) => (
                  <div key={i} className="px-4 py-3">
                    <p className="text-[13px]">{p.text}</p>
                    <p className="k-fg3 mt-0.5 text-[12px]">
                      {p.study.proposal ? `${formatRatePct(p.study.proposal.branch.trials ? p.study.proposal.branch.successes / p.study.proposal.branch.trials : null)} reach the leg's end inside, ${formatRatePct(p.study.proposal.all.trials ? p.study.proposal.all.successes / p.study.proposal.all.trials : null)} overall` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
          {view.campaigns.map((v) => (
            <CampaignShadow key={v.campaignId} s={s} v={v} brandId={id} />
          ))}
        </>
      )}
    </>
  );
}

/**
 * A sales funnel's line: its entry, then every pipe each leg runs through and what each makes. A
 * pipe making an object for another (an LLM completion, a template) rides as a small mark beside
 * the pipe it feeds.
 */
function Line({ s, entry, legs }: { s: ShadowState; entry: string; legs: { to: string; pipes: string[] }[] }) {
  const c = s.session.catalogue;
  const feeds = (p: string) => c.outcome(c.pipe(p)?.output ?? "")?.subject === "object";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="k-fg2">{outcomeName(s, entry)}</span>
      {legs.map((l, k) => {
        const main = l.pipes.filter((p, i) => i === l.pipes.length - 1 || !feeds(p));
        const side = l.pipes.filter((p, i) => i !== l.pipes.length - 1 && feeds(p));
        if (main.length === 0)
          return (
            <span key={`${k}:${l.to}`} className="inline-flex items-center gap-1.5">
              <span className="k-fg4">→</span>
              <span className="k-fg2">{outcomeName(s, l.to)}</span>
            </span>
          );
        return main.map((p, i) => (
          <span key={`${k}:${p}`} className="inline-flex items-center gap-1.5" data-pipe={p}>
            <span className="k-fg4">→</span>
            <span className="inline-flex items-center gap-1">
              {i === main.length - 1 &&
                side.map((x) => (
                  <span key={x} title={`${pipeName(s, x)} feeds it`} data-pipe={x} className="inline-flex">
                    <Mark kind="pipe" id={x} icon={c.pipe(x)?.icon} size={12} />
                  </span>
                ))}
              <Mark kind="pipe" id={p} icon={c.pipe(p)?.icon} size={14} />
              <span>{pipeName(s, p)}</span>
            </span>
            <span className="k-fg4">→</span>
            <span className="k-fg2">{outcomeName(s, i === main.length - 1 ? l.to : c.pipe(p)?.output ?? l.to)}</span>
          </span>
        ));
      })}
    </span>
  );
}

const BASIS_WORDS: Record<"client" | "group" | "fleet" | "default", string> = {
  client: "its own attempts and the levels above",
  group: "clients sharing its tactics, then the fleet and the leg's default",
  fleet: "every client running this pipe, then the leg's default",
  default: "the leg's default (a stated benchmark)",
};

function funnelFigures(f: RankedFunnel | null): string {
  if (!f) return "Not measured on every leg yet";
  if (!(f.costPerTarget > 0)) return `No spend of ours on its legs: every leg is another factory's (the client's team) · ${f.label}`;
  return `${formatUsd(f.costPerTarget)} per target · ${formatRoi(f.valuePerDollar)} per $1 · ${f.label}`;
}

function CampaignShadow({ s, v, brandId }: { s: ShadowState; v: CampaignView; brandId: string }) {
  const best = v.funnels.engine[0] ?? null;
  return (
    <section className="mb-10" data-campaign={v.campaignId}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Mark kind="funnel" id={v.campaignId} size={28} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-medium">{v.name}</h2>
          <p className="k-fg3 text-[12px]">
            {outcomeName(s, v.line[v.line.length - 1]!)} worth {formatUsd(v.targetValue.amount)}
            {v.targetValue.label === "expected" ? " (expected: the client stated none)" : ""} · {formatCents(v.spendCents)} spent
          </p>
        </div>
        <StateDot running={v.status === "running"} />
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="k-card p-4">
          <p className="k-label mb-1.5">Running today</p>
          <p className="mb-1 text-[13px] font-medium">{v.salesFunnel?.name ?? "No pipe on a leg yet"}</p>
          <Line s={s} entry={v.entry} legs={v.legs.map((l) => ({ to: l.to, pipes: l.pipes }))} />
          <p className="k-fg3 mt-2 text-[12px]">{funnelFigures(v.funnels.today)}</p>
          <p className="mt-2 text-[12px] tabular-nums">Daily budget {formatCents(v.budget.todayCents)}</p>
        </div>
        <div className="k-card p-4">
          <p className="k-label mb-1.5">The engine would do</p>
          {best ? (
            <>
              <p className="mb-1 text-[13px] font-medium">{best.name}</p>
              <Line s={s} entry={best.line[0] ?? START} legs={best.legs.map((l) => ({ to: l.to, pipes: [l.pipeId] }))} />
              <p className="k-fg3 mt-2 text-[12px]">{funnelFigures(best)}</p>
            </>
          ) : (
            <p className="k-fg3 text-[12px]">{v.funnels.unmeasuredLegs > 0 ? "No sales funnel is measured on every leg yet: the engine keeps today's and learns." : "No other sales funnel reaches this target."}</p>
          )}
          <p className="mt-2 text-[12px] tabular-nums">
            Daily budget {formatCents(v.budget.engineCents)}
            {v.budget.valuePerDollar !== null ? (
              <span className={`ml-1 ${roiIsGood(v.budget.valuePerDollar) ? "text-[var(--run)]" : "k-fg3"}`}>
                · {Number.isFinite(v.budget.valuePerDollar) ? `${formatRoi(v.budget.valuePerDollar)} per $1` : "no spend of ours"}, {v.budget.label}
              </span>
            ) : (
              <span className="k-fg3 ml-1">· the campaign has no value to aim at</span>
            )}
          </p>
        </div>
      </div>

      <CardTable>
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Leg</th>
            <th className={TH}>Pipe today</th>
            <th className={TH}>The engine&apos;s pipe</th>
            <th className={`${TH} text-right`}>% conversion</th>
            <th className={`${TH} text-right`}>Reached</th>
            <th className={`${TH} text-right`}>Attempts</th>
            <th className={`${TH} text-right`}>$ per attempt</th>
          </tr>
        </thead>
        <tbody>
          {v.legs.map((l, k) => (
            <tr key={k} className="k-row k-line-subtle border-b last:border-b-0">
              <td className={TD}>
                {outcomeName(s, l.from)} → {outcomeName(s, l.to)}
              </td>
              <td className={TD}>{pipeName(s, l.todayPipe)}</td>
              <td className={TD}>{l.enginePipe === l.todayPipe ? <span className="k-fg3">Same</span> : pipeName(s, l.enginePipe)}</td>
              <td className={TDN}>
                {formatRatePct(l.priced.yieldRate)}
                {l.priced.label === "expected" && <span className="k-chip ml-1.5" title={`Not completed by this client yet: pooled from ${BASIS_WORDS[l.priced.basis]}`}>Expected</span>}
              </td>
              <td className={TDN}>{formatCount(l.estimate.reached)}</td>
              <td className={TDN}>{formatCount(l.estimate.attempts)}</td>
              <td className={TDN}>{formatUsd(l.priced.costPerAttempt)}</td>
            </tr>
          ))}
        </tbody>
      </CardTable>

      <div className="mt-4 space-y-3">
        {v.points
          .filter((p) => p.options.length > 1 || p.today !== p.engine)
          .map((p) => (
            <PointShadow key={p.point} s={s} p={p} brandId={brandId} />
          ))}
      </div>
    </section>
  );
}

function PointShadow({ s, p, brandId }: { s: ShadowState; p: PointView; brandId: string }) {
  const { shown, hidden } = pointOptions(p);
  return (
    <CardTable footer={hidden > 0 ? `${hidden} more ${hidden > 1 ? "options" : "option"} with fewer picks` : undefined}>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH} colSpan={2}>
            <span className="normal-case tracking-normal">{pointTitle(s, p)}</span>
          </th>
          <th className={`${TH} text-right`}>Share the engine gives</th>
          <th className={`${TH} text-right`}>Value per $1</th>
          <th className={`${TH} text-right`}>% reach the end</th>
          <th className={`${TH} text-right`}>$ from here</th>
          <th className={`${TH} text-right`}>Decisions</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((o) => (
          <tr key={o.option} className="k-row k-line-subtle border-b last:border-b-0">
            <td className={`${TD} max-w-[340px]`}>
              <span className="block truncate">{optionName(s, p, o.option, brandId)}</span>
            </td>
            <td className={TD}>
              <span className="flex gap-1">
                {o.option === p.today && <span className="k-chip">Today</span>}
                {o.option === p.engine && <span className="k-chip text-[var(--accent)]">Engine</span>}
              </span>
            </td>
            <td className={TDN}>{formatRatePct(o.pickShare)}</td>
            <td className={TDN}>
              <span className={roiIsGood(o.valuePerDollar) ? "text-[var(--run)]" : ""}>{formatRoi(o.valuePerDollar)}</span>
            </td>
            <td className={TDN}>{formatRatePct(o.rate)}</td>
            <td className={TDN}>{formatUsd(o.cost)}</td>
            <td className={TDN}>{formatCount(Math.round(o.decisions))}</td>
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

// ---------------------------------------------------------------------------
// The actions the engine would launch: read only, nothing executes them
// ---------------------------------------------------------------------------

export function ShadowActionsPage() {
  return <Frame crumbs={[{ label: "Actions" }]}>{(s) => <ShadowActions s={s} />}</Frame>;
}

function ShadowActions({ s }: { s: ShadowState }) {
  const name = (b: string | null) => (b ? s.snapshot.clients.find((c) => c.brand.id === b)?.brand.name ?? b : "Every client");
  const campaign = (id: string | null) => (id ? s.session.campaign(id)?.name ?? id : "—");
  const kinds = [...new Set(s.report.actions.map((a) => a.kind))];
  return (
    <>
      <PageHeader title={<>{plural(s.report.actions.length, "action", "actions")} the engine would launch</>} sub="Read only: nothing here runs, writes or sends. Each line is a decision the engine would take on this snapshot, with its reason." />
      {kinds.map((k) => {
        const list = s.report.actions.filter((a) => a.kind === k);
        return (
          <section key={k} className="mb-8">
            <SectionTitle count={list.length}>{ACTION_WORDS[k]}</SectionTitle>
            <CardTable>
              <thead>
                <tr className="k-line-subtle border-b">
                  <th className={TH}>Client</th>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>Action</th>
                  <th className={TH}>Why</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className="k-row k-line-subtle border-b last:border-b-0">
                    <td className={`${TD} whitespace-nowrap`}>{a.brandId ? <Link href={shadowClientHref(a.brandId)} className="hover:underline">{name(a.brandId)}</Link> : name(null)}</td>
                    <td className={`${TD} max-w-[220px]`}>
                      <span className="block truncate">{campaign(a.campaignId)}</span>
                    </td>
                    <td className={`${TD} max-w-[420px]`}>{a.label}</td>
                    <td className={`${TD} k-fg2 max-w-[420px] text-[12px]`}>{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </CardTable>
          </section>
        );
      })}
      {kinds.length === 0 && (
        <div className="k-card">
          <EmptyNote>The engine would change nothing on this snapshot.</EmptyNote>
        </div>
      )}
    </>
  );
}
