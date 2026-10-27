"use client";

import { useState } from "react";
import type { ApiScriptStats, CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, TD, TDN, TH, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { engineTitle } from "@/lib/api/labels";
import { formatCents, formatCount, plural } from "@/lib/format";
import { Read } from "./common";

/** The "Performed by" value of the scripts the client's own people perform. */
const TEAM = "Client's team";

/**
 * Done by your team: every script the client's own people perform. A person types how many
 * Units the team makes a day and how many days one takes; out of capacity today, the Plan
 * routes around the script until tomorrow.
 */
export function ApiTeamPage() {
  const read = useApi<ApiScriptStats[]>("/scripts");
  const { data: o } = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Done by your team" }]} />
      <Page>
        <Read read={read}>
          {(all) => {
            const scripts = all.filter((s) => s.performedBy === TEAM && s.status === "active");
            return (
              <>
                <PageHeader title={plural(scripts.length, "script done by your team", "scripts done by your team")} sub="Say how much your team can do. The Plan sends it no more than that each day." />
                {scripts.length === 0 ? (
                  <div className="k-card">
                    <EmptyNote>Your team performs no script yet.</EmptyNote>
                  </div>
                ) : (
                  <CardTable>
                    <thead>
                      <tr className="k-line-subtle border-b">
                        <th className={`${TH} w-full`}>Script</th>
                        <th className={TH}>Makes</th>
                        <th className={`${TH} text-right`}>Today</th>
                        <th className={TH}>Most per day</th>
                        <th className={TH}>Days per Unit</th>
                        <th className={`${TH} text-right`}>Runs</th>
                        <th className={`${TH} text-right`}>Cost to us</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scripts.map((s) => (
                        <TeamRow key={s.id} s={s} catalogue={o?.catalogue} />
                      ))}
                    </tbody>
                  </CardTable>
                )}
              </>
            );
          }}
        </Read>
      </Page>
    </>
  );
}

function TeamRow({ s, catalogue }: { s: ApiScriptStats; catalogue: CatalogueData | undefined }) {
  const full = s.capacity.perDay != null && s.runsToday >= s.capacity.perDay;
  return (
    <tr className="k-row k-line-subtle border-b last:border-b-0" data-script={s.id}>
      <td className={TD}>
        <span className="inline-flex items-center gap-2">
          <Mark kind={`script:${s.kind}`} id={s.dynasty} size={20} />
          <span className="font-medium">{s.name}</span>
        </span>
      </td>
      <td className={`${TD} k-fg2 whitespace-nowrap`}>{engineTitle(catalogue, s.outcome)}</td>
      <td className={`${TDN} ${full ? "text-[var(--data-amber)]" : ""}`}>{formatCount(s.runsToday)}</td>
      <td className={TD}>
        <CapacityField script={s} field="perDay" />
      </td>
      <td className={TD}>
        <CapacityField script={s} field="daysPerUnit" />
      </td>
      <td className={TDN}>{formatCount(s.runs)}</td>
      <td className={TDN}>{formatCents(s.spentCents)}</td>
    </tr>
  );
}

/** One capacity figure, read as text; a click opens it in place, leaving it saves, Esc drops it. */
function CapacityField({ script, field }: { script: ApiScriptStats; field: "perDay" | "daysPerUnit" }) {
  const value = script.capacity[field];
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (text === null) return;
    const n = text.trim() === "" ? null : Number(text);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setError("A positive number, or empty for no limit.");
      return;
    }
    if (n === value) {
      setText(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/scripts/${encodeURIComponent(script.id)}/capacity`, { ...script.capacity, [field]: n });
      setText(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col">
      {text === null ? (
        <button type="button" className="k-btn-ghost tabular-nums" onClick={() => setText(value == null ? "" : String(value))} aria-label={field === "perDay" ? "Most per day" : "Days per Unit"}>
          {value == null ? <span className="k-fg4">No limit</span> : formatCount(value)}
        </button>
      ) : (
        <input
          autoFocus
          disabled={busy}
          aria-label={field === "perDay" ? "Most per day" : "Days per Unit"}
          className="k-input w-20 tabular-nums"
          style={{ font: "inherit" }}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setText(null);
          }}
        />
      )}
      {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
    </span>
  );
}
