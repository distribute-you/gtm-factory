"use client";

/** Pieces every api page shares: read states, the campaign status and cap controls, choice, run and choice point tables. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDownIcon, XIcon } from "@phosphor-icons/react";
import type { ApiCampaign, ApiChoice, ApiChoicePoint, ApiRun, CatalogueData, OutcomeId } from "@gtm-factory/engine";
import { CardTable, EmptyNote, Meter, Shimmer, TD, TDN, TH, ToneDot } from "@/components/ui";
import { Mark } from "@/components/mark";
import { apiSend, type ApiRead } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { factoryTitle, outcomeName, legTitle } from "@/lib/api/labels";
import { formatCents, formatCount, formatRatePct, formatRoi } from "@/lib/format";

/** "3m ago", "2h ago", "4d ago". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** "Oct 26, 14:05" (local time). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ShimmerRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Shimmer key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="k-card px-4 py-3 text-[13px]">
      <ToneDot tone="rose">The factory did not answer</ToneDot>
      <p className="k-fg2 mt-1">{children}</p>
    </div>
  );
}

/** Shimmer until the read answered once; its error as one sentence; then the page. */
export function Read<T>({ read, rows = 5, children }: { read: ApiRead<T>; rows?: number; children: (data: T) => React.ReactNode }) {
  if (read.data != null) return <>{children(read.data)}</>;
  if (!read.answered) return <ShimmerRows rows={rows} />;
  return <ErrorNote>{read.error ?? "No data."}</ErrorNote>;
}

/** A popover menu portalled and placed against its button (a card's overflow never clips it). */
function Menu({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host) return null;
  const r = anchor.getBoundingClientRect();
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" style={{ background: "transparent" }} onClick={onClose}>
      <div className="k-popover fixed min-w-[180px] p-1" style={{ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 200) }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    host,
  );
}

/** The name of the factory that runs a campaign or a client, when it is not this one; null for this factory. */
export function useOtherFactory(factory: string | undefined): string | null {
  const { data } = useFactory();
  const f = factory ? data?.catalogue.factories.find((x) => x.id === factory) : undefined;
  if (!factory || f?.ours) return null;
  return factoryTitle(data?.catalogue, factory);
}

/** A campaign's status: the dot and its word in a button; the menu holds the other state. Another factory's campaign shows its status, read only. */
export function CampaignStatusButton({ campaign }: { campaign: ApiCampaign }) {
  const other = useOtherFactory(campaign.factory);
  if (other) {
    const live = campaign.status === "live";
    return (
      <span className="inline-flex flex-col items-start gap-0.5" title={`Run by ${other}: this factory reads it and never runs it.`}>
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          {live ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--run)]" /> : <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-2)]" />}
          {live ? "Live" : "Stopped"}
        </span>
        <span className="k-fg3 whitespace-nowrap text-[12px]">in {other}</span>
      </span>
    );
  }
  return <OwnStatusButton campaign={campaign} />;
}

function OwnStatusButton({ campaign }: { campaign: ApiCampaign }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = campaign.status === "live";
  const act = async () => {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/campaigns/${encodeURIComponent(campaign.id)}/${live ? "pause" : "launch"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button ref={ref} type="button" className="k-btn" onClick={() => setOpen((v) => !v)} disabled={busy} aria-haspopup="menu">
        {live ? <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" /> : <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-2)]" />}
        {busy ? (live ? "Pausing" : "Launching") : live ? "Live" : "Paused"}
        <CaretDownIcon size={11} className="k-fg3" />
      </button>
      {open && ref.current && (
        <Menu anchor={ref.current} onClose={() => setOpen(false)}>
          <button type="button" role="menuitem" onClick={act} className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] hover:bg-[var(--bg-hover)]">
            {live ? <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-2)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--run)]" />}
            {live ? "Pause" : "Launch"}
          </button>
        </Menu>
      )}
      {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
    </span>
  );
}

/** The daily cap as a button ("$10/day"); a modal edits it. Another factory's cap is shown as it reports it. */
export function BudgetButton({ campaign }: { campaign: ApiCampaign }) {
  const other = useOtherFactory(campaign.factory);
  if (other) return <span className="whitespace-nowrap text-[13px] tabular-nums">{campaign.dailyBudgetCents > 0 ? `${formatCents(campaign.dailyBudgetCents)}/day` : "No daily cap"}</span>;
  return <OwnBudgetButton campaign={campaign} />;
}

function OwnBudgetButton({ campaign }: { campaign: ApiCampaign }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="k-btn tabular-nums" onClick={() => setOpen(true)}>
        {formatCents(campaign.dailyBudgetCents)}/day
        <CaretDownIcon size={11} className="k-fg3" />
      </button>
      {open && <BudgetModal campaign={campaign} onClose={() => setOpen(false)} />}
    </>
  );
}

function BudgetModal({ campaign, onClose }: { campaign: ApiCampaign; onClose: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [text, setText] = useState((campaign.dailyBudgetCents / 100).toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const dollars = Number(text);
  const valid = Number.isFinite(dollars) && dollars > 0;
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", `/campaigns/${encodeURIComponent(campaign.id)}`, { dailyBudgetCents: Math.round(dollars * 100) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  if (!host) return null;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#10101224" }} onClick={onClose}>
      <div className="k-popover w-[min(380px,calc(100vw-16px))]" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="k-line-subtle flex h-11 items-center justify-between border-b px-4">
          <span className="k-label">Daily cap</span>
          <button type="button" onClick={onClose} className="k-btn-ghost" aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="k-fg2 text-[13px]">No run starts once today&apos;s spend would pass this cap.</p>
          <label className="k-input flex items-center gap-1 px-2">
            <span className="k-fg3">$</span>
            <input autoFocus aria-label="Daily cap in dollars" className="w-full min-w-0 bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && save()} />
            <span className="k-fg3 shrink-0">per day</span>
          </label>
          {error && <p className="text-[12px] text-[var(--data-rose)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="k-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="k-btn-strong" disabled={!valid || busy} onClick={save}>
              {busy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}

/** Today's spend against the daily cap. */
export function CapBar({ campaign }: { campaign: ApiCampaign }) {
  return (
    <div className="min-w-[140px]">
      <div className="flex items-baseline justify-between gap-2 text-[12px] tabular-nums">
        <span>{formatCents(campaign.spentTodayCents)}</span>
        <span className="k-fg3">of {formatCents(campaign.dailyBudgetCents)}</span>
      </div>
      <Meter value={campaign.spentTodayCents} max={campaign.dailyBudgetCents} className="mt-1" color={campaign.capReached ? "var(--data-amber)" : "var(--accent)"} />
      {campaign.capReached && <span className="mt-1 block text-[12px] text-[var(--data-amber)]">Cap reached</span>}
    </div>
  );
}

/** Outcome counts along a line of outcomes: one cell per outcome, entry first. */
export function CountsAlong({ catalogue, line, counts }: { catalogue: CatalogueData | null | undefined; line: OutcomeId[]; counts: Record<string, number> }) {
  return (
    <div className="k-card grid divide-x divide-[var(--line-subtle)]" style={{ gridTemplateColumns: `repeat(${Math.max(1, line.length)}, minmax(0, 1fr))` }}>
      {line.map((o) => (
        <div key={o} className="min-w-0 px-4 py-3">
          <span className="k-label block truncate">{outcomeName(catalogue, o)}</span>
          <span className="mt-1 block text-[22px] font-medium leading-7 tabular-nums">{counts[o] != null ? formatCount(counts[o]!) : <span className="k-fg4">—</span>}</span>
        </div>
      ))}
    </div>
  );
}

const RUN_TONE = { ok: "run", no_outcome: "muted", failed: "rose", refused: "amber" } as const;
const RUN_WORD = { ok: "Produced", no_outcome: "No outcome", failed: "Failed", refused: "Refused" } as const;

export function RunStatus({ status }: { status: ApiRun["status"] }) {
  return <ToneDot tone={RUN_TONE[status]}>{RUN_WORD[status]}</ToneDot>;
}

export function RunsTable({ runs, catalogue, empty = "No run yet." }: { runs: ApiRun[]; catalogue: CatalogueData | null | undefined; empty?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (runs.length === 0) return <div className="k-card"><EmptyNote>{empty}</EmptyNote></div>;
  return (
    <CardTable footer={`${formatCount(runs.length)} runs`}>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>When</th>
          <th className={TH}>Script</th>
          <th className={TH}>Leg</th>
          <th className={TH}>Status</th>
          <th className={`${TH} w-full`}>What happened</th>
          <th className={`${TH} text-right`}>Cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <RunRow key={r.id} run={r} catalogue={catalogue} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
        ))}
      </tbody>
    </CardTable>
  );
}

function RunRow({ run, catalogue, open, onToggle }: { run: ApiRun; catalogue: CatalogueData | null | undefined; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="k-row k-line-subtle cursor-pointer border-b last:border-b-0" onClick={onToggle}>
        <td className={`${TD} k-mono k-fg2 whitespace-nowrap text-[12px]`}>{formatTime(run.at)}</td>
        <td className={`${TD} whitespace-nowrap`}>{run.scriptName}</td>
        <td className={`${TD} k-fg2 whitespace-nowrap`}>{legTitle(catalogue, run.legId)}</td>
        <td className={TD}>
          <RunStatus status={run.status} />
        </td>
        <td className={`${TD} k-fg2 min-w-[240px]`}>
          {run.note || <span className="k-fg4">—</span>}
          {run.leadId && (
            <Link href={`/leads/view/?id=${encodeURIComponent(run.leadId)}`} className="k-accent ml-2 text-[12px]" onClick={(e) => e.stopPropagation()}>
              Lead
            </Link>
          )}
        </td>
        <td className={TDN}>{formatCents(run.spendCents)}</td>
      </tr>
      {open && (
        <tr className="k-line-subtle border-b">
          <td colSpan={6} className="bg-[var(--bg-inset)] px-4 py-3">
            {run.costs.length === 0 ? (
              <p className="k-fg3 text-[12px]">No metered vendor line on this run.</p>
            ) : (
              <table className="text-[12px]">
                <tbody>
                  {run.costs.map((c, i) => (
                    <tr key={i}>
                      <td className="k-fg2 py-0.5 pr-4">{c.vendor}</td>
                      <td className="py-0.5 pr-4">{c.item}</td>
                      <td className="py-0.5 pr-4 text-right tabular-nums">{formatCount(c.quantity)}</td>
                      <td className="py-0.5 text-right tabular-nums">{formatCents(c.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {run.produced.length > 0 && (
              <p className="k-fg3 mt-2 text-[12px]">Produced: {run.produced.map((p) => outcomeName(catalogue, p.outcome)).join(", ")}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function ChoicesTable({ choices, empty = "No choice made yet." }: { choices: ApiChoice[]; empty?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (choices.length === 0) return <div className="k-card"><EmptyNote>{empty}</EmptyNote></div>;
  return (
    <CardTable footer={`${formatCount(choices.length)} choices`}>
      <thead>
        <tr className="k-line-subtle border-b">
          <th className={TH}>When</th>
          <th className={TH}>Material</th>
          <th className={TH}>Chosen</th>
          <th className={`${TH} w-full`}>Why</th>
          <th className={TH}>Credited</th>
        </tr>
      </thead>
      <tbody>
        {choices.map((c) => (
          <ChoiceRow key={c.id} choice={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
        ))}
      </tbody>
    </CardTable>
  );
}

function ChoiceRow({ choice, open, onToggle }: { choice: ApiChoice; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="k-row k-line-subtle cursor-pointer border-b last:border-b-0" onClick={onToggle}>
        <td className={`${TD} k-mono k-fg2 whitespace-nowrap text-[12px]`}>{formatTime(choice.at)}</td>
        <td className={`${TD} whitespace-nowrap`}>
          <span className="inline-flex items-center gap-2">
            <Mark kind="point" id={choice.point} size={16} />
            {choice.pointLabel}
          </span>
        </td>
        <td className={`${TD} whitespace-nowrap font-medium`}>{choice.chosenLabel}</td>
        <td className={`${TD} k-fg2 min-w-[260px]`}>{choice.reason}</td>
        <td className={TD}>{choice.credited ? <ToneDot tone="teal">Yes</ToneDot> : <span className="k-fg4">—</span>}</td>
      </tr>
      {open && (
        <tr className="k-line-subtle border-b">
          <td colSpan={5} className="bg-[var(--bg-inset)] px-4 py-3">
            <p className="k-label mb-1.5">Scored at this draw</p>
            <table className="text-[12px]">
              <thead>
                <tr className="k-fg3">
                  <td className="pb-1 pr-6">Picked among</td>
                  <td className="pb-1 pr-6 text-right">Value per $ (mean)</td>
                  <td className="pb-1 text-right">Value per $ (this draw)</td>
                </tr>
              </thead>
              <tbody>
                {choice.candidates.map((o) => (
                  <tr key={o.id} className={o.id === choice.chosen ? "font-medium" : "k-fg2"}>
                    <td className="py-0.5 pr-6">{o.label}</td>
                    <td className="py-0.5 pr-6 text-right tabular-nums">{formatRoi(o.meanScore)}</td>
                    <td className="py-0.5 text-right tabular-nums">{formatRoi(o.sampledScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

/** Each choice point and its candidates' beliefs, under a uniform title. Rows keep the served order. */
export function PointsList({ points, catalogue, empty = "No choice point yet." }: { points: ApiChoicePoint[]; catalogue?: CatalogueData | null; empty?: string }) {
  if (points.length === 0) return <div className="k-card"><EmptyNote>{empty}</EmptyNote></div>;
  return (
    <div className="space-y-3">
      {points.map((p) => {
        const word = p.chooses === "unit" ? "Unit" : p.chooses === "leg" ? "Leg" : "Script";
        return (
          <CardTable key={p.id} footer={`${formatCount(p.candidates.length)} ${p.chooses === "unit" ? "Units" : p.chooses === "leg" ? "legs" : "scripts"} compete here`}>
            <thead>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`} colSpan={7}>
                  <ApiPointTitle point={p} catalogue={catalogue} />
                </th>
              </tr>
              <tr className="k-line-subtle border-b">
                <th className={`${TH} w-full`}>{word}</th>
                <th className={`${TH} text-right`}>Value per $</th>
                <th className={`${TH} text-right`}>Rate</th>
                <th className={`${TH} text-right`}>Cost to step end</th>
                <th className={`${TH} text-right`}>Picks</th>
                <th className={`${TH} text-right`}>Reached</th>
                <th className={`${TH} text-right`}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {p.candidates.map((o) => (
                <tr key={o.id} className="k-row k-line-subtle border-b last:border-b-0">
                  <td className={TD}>{o.label}</td>
                  <td className={TDN}>{formatRoi(o.meanScore)}</td>
                  <td className={TDN}>{formatRatePct(o.rateMean)}</td>
                  <td className={TDN}>{formatCents(o.costMeanCents)}</td>
                  <td className={TDN}>{formatCount(o.picks)}</td>
                  <td className={TDN}>{formatCount(o.successes)}</td>
                  <td className={TDN}>{formatCents(o.spentCents)}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        );
      })}
    </div>
  );
}

/** A choice card's uniform title: "<Leg> · its script" or "<Leg> · Material <outcome>", one mark per object type. */
export function ApiPointTitle({ point, catalogue }: { point: ApiChoicePoint; catalogue?: CatalogueData | null }) {
  const leg = catalogue?.legs.find((l) => l.id === point.legId);
  const outcome = point.material ? catalogue?.outcomes.find((o) => o.id === point.material) : undefined;
  return (
    <span className="inline-flex items-center gap-1.5 normal-case">
      <Mark kind="leg" id={point.legId} icon={leg?.icon} size={18} />
      <span className="k-fg text-[13px] font-medium tracking-normal" style={{ fontFamily: "var(--font-geist-sans)" }}>
        {leg?.name ?? legTitle(catalogue, point.legId)}
      </span>
      <span className="k-fg4">·</span>
      {point.chooses === "leg" ? (
        <>
          <Mark kind="leg" id={`legs:${point.id}`} size={14} />
          <span className="k-fg2 text-[13px] tracking-normal" style={{ fontFamily: "var(--font-geist-sans)" }}>its leg</span>
        </>
      ) : point.material ? (
        <>
          <Mark kind="material" id={point.material} icon={outcome?.icon} size={14} />
          <span className="k-fg2 text-[13px] tracking-normal" style={{ fontFamily: "var(--font-geist-sans)" }}>
            Material {outcomeName(catalogue, point.material)}
          </span>
        </>
      ) : (
        <>
          <Mark kind="script" id={`scripts:${point.id}`} size={14} />
          <span className="k-fg2 text-[13px] tracking-normal" style={{ fontFamily: "var(--font-geist-sans)" }}>its script</span>
        </>
      )}
    </span>
  );
}

/** A small labelled field for forms. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="k-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="k-fg3 mt-1 block text-[12px]">{hint}</span>}
    </label>
  );
}
