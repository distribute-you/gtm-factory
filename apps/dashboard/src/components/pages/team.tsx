"use client";

import { useEffect, useState } from "react";
import { OURS, type Script } from "@gtm-factory/core";
import { ProviderLogo } from "@/components/catalogue-bits";
import { CardTable, EmptyNote, Page, PageHeader, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { engineName, scriptFigures, type Model } from "@/lib/model";
import { formatCount, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

/** Who performs the scripts a person types the capacity of. */
const TEAM = "Client's team";

/**
 * Done by your team: the scripts a person of the client's team performs (a closing call,
 * a copywriter's template). They cost us nothing; their limit is their capacity, typed
 * here. A script full for today leaves today's picks; the Plan routes around it until
 * tomorrow.
 */
export function TeamPage() {
  const { model } = useSim();
  return (
    <>
      <TopBar crumbs={[{ label: "Done by your team" }]} />
      <Page>{model ? <Team model={model} /> : <PageSkeleton />}</Page>
    </>
  );
}

function Team({ model }: { model: Model }) {
  const scripts = model.catalogue.scripts.filter((s) => s.status === "active" && String(s.tactics.performed_by ?? OURS) === TEAM);
  const full = scripts.filter((s) => s.capacity?.perDay !== undefined && model.session.runsTodayOf(s.id) >= s.capacity.perDay).length;
  return (
    <>
      <PageHeader
        title={<>{plural(scripts.length, "script", "scripts")} done by your team</>}
        sub="Tell us how much your team can take each day. We plan around it: a full day sends the work elsewhere until tomorrow."
        right={full > 0 ? <span className="text-[var(--data-amber)]">{plural(full, "script is", "scripts are")} full today</span> : undefined}
      />
      <CardTable footer="A click on a figure edits it; leaving the field saves it.">
        <thead>
          <tr className="k-line-subtle border-b">
            <th className={TH}>Script</th>
            <th className={TH}>Engine</th>
            <th className={`${TH} text-right`}>Today</th>
            <th className={`${TH} text-right`}>Most per day</th>
            <th className={`${TH} text-right`}>Days per Unit</th>
            <th className={`${TH} text-right`}>Units to date</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map((s) => (
            <TeamRow key={s.id} model={model} script={s} />
          ))}
          {scripts.length === 0 && (
            <tr>
              <td colSpan={6}>
                <EmptyNote>No script is done by your team.</EmptyNote>
              </td>
            </tr>
          )}
        </tbody>
      </CardTable>
    </>
  );
}

function TeamRow({ model, script }: { model: Model; script: Script }) {
  const { dispatch } = useSim();
  const today = model.session.runsTodayOf(script.id);
  const cap = script.capacity ?? {};
  const isFull = cap.perDay !== undefined && today >= cap.perDay;
  const save = (patch: { perDay?: number; daysPerUnit?: number }) => dispatch({ type: "capacity", scriptId: script.id, capacity: { ...cap, ...patch } });
  return (
    <tr className="k-row k-line-subtle border-b last:border-0" data-script={script.id}>
      <td className={TD}>
        <span className="flex items-center gap-2">
          <ProviderLogo script={script} size={22} />
          <span className="font-medium">{script.name}</span>
        </span>
      </td>
      <td className={TD}>{engineName(model.catalogue, script.outcome)}</td>
      <td className={`${TDN} ${isFull ? "text-[var(--data-amber)]" : ""}`}>{formatCount(today)}</td>
      <td className={TDN}>
        <InlineNumber value={cap.perDay} onSave={(n) => save({ perDay: n })} label={`Most per day for ${script.name}`} />
      </td>
      <td className={TDN}>
        <InlineNumber value={cap.daysPerUnit} onSave={(n) => save({ daysPerUnit: n })} label={`Days per Unit for ${script.name}`} />
      </td>
      <td className={TDN}>{formatCount(scriptFigures(model, script.dynasty).produced)}</td>
    </tr>
  );
}

/** A figure that reads as text; a click turns it into its field; leaving it saves; Esc drops it. */
function InlineNumber({ value, onSave, label }: { value: number | undefined; onSave: (n: number) => string | null; label: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  if (!editing)
    return (
      <button type="button" className="rounded-[6px] px-1.5 py-0.5 tabular-nums hover:bg-[var(--bg-hover)]" onClick={() => setEditing(true)} aria-label={label}>
        {value === undefined ? <span className="k-fg4">—</span> : formatCount(value)}
      </button>
    );
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n < 0) {
      setError("A number, 0 or more.");
      return;
    }
    const err = onSave(n);
    setError(err);
    if (!err) setEditing(false);
  };
  return (
    <span className="inline-flex flex-col items-end">
      <input
        autoFocus
        aria-label={label}
        value={text}
        size={Math.max(2, text.length)}
        onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setText(value === undefined ? "" : String(value));
            setEditing(false);
          }
        }}
        className="rounded-[6px] bg-[var(--bg-inset)] px-1.5 py-0.5 text-right tabular-nums outline-none ring-1 ring-inset ring-[var(--accent)]"
        style={{ font: "inherit" }}
      />
      {error && <span className="mt-0.5 text-[11px] text-[var(--data-rose)]">{error}</span>}
    </span>
  );
}
