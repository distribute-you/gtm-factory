"use client";

import { useState } from "react";
import type { ApiScriptStats, ApiTask, ApiTaskField, CatalogueData } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { engineTitle } from "@/lib/api/labels";
import { formatCents, formatCount, plural } from "@/lib/format";
import { Read } from "./common";

/** The "Performed by" value of the scripts the client's own people perform. */
const TEAM = "Client's team";

/**
 * Done by your team: the work the Plan orders from the client's own people. Each task is
 * one run of such a script (a closing call with one person); the person is notified by
 * email, answers here, and the answer becomes the Unit. Capacity is asked only for work
 * that repeats; work done once (the offer, the ICP) shows as done.
 */
export function ApiTeamPage() {
  const read = useApi<ApiScriptStats[]>("/scripts");
  const { data: o } = useOverview();
  const { scope } = useScope();
  const tasks = useApi<ApiTask[]>(scope.brandId ? `/tasks?brandId=${encodeURIComponent(scope.brandId)}&status=open` : null, 15_000);
  return (
    <>
      <TopBar crumbs={[{ label: "Done by your team" }]} />
      <Page>
        <Read read={read}>
          {(all) => {
            const scripts = all.filter((s) => s.performedBy === TEAM && s.status === "active");
            return (
              <>
                <PageHeader title={<>{plural(tasks.data?.length ?? 0, "task waits", "tasks wait")} for your team</>} sub="Answer each task when it is done: your answer counts as the result and credits the scripts that brought the person." />
                <section className="mb-8">
                  <SectionTitle count={tasks.data?.length ?? 0}>Your team&apos;s tasks</SectionTitle>
                  {(tasks.data ?? []).length === 0 ? (
                    <div className="k-card">
                      <EmptyNote>Nothing to do right now.</EmptyNote>
                    </div>
                  ) : (
                    <div className="k-card divide-y divide-[var(--line-subtle)]">
                      {tasks.data!.map((t) => (
                        <TaskRow key={t.id} task={t} onDone={tasks.refresh} />
                      ))}
                    </div>
                  )}
                </section>
                <SectionTitle count={scripts.length}>What your team does</SectionTitle>
                {scripts.length === 0 ? (
                  <div className="k-card">
                    <EmptyNote>Your team performs no script yet.</EmptyNote>
                  </div>
                ) : (
                  <CardTable note="Work your team does by hand, and how much of it fits in a day.">
                    <thead>
                      <tr className="k-line-subtle border-b">
                        <th className={`${TH} w-full`}>Script</th>
                        <th className={TH}>Makes</th>
                        <th className={`${TH} text-right`}>Today</th>
                        <th className={TH}>Most per day</th>
                        <th className={TH}>Days per task</th>
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
      {catalogue?.outcomes.find((x) => x.id === s.outcome)?.subject === "brand" ? (
        <td className={`${TD} text-right text-[var(--run)]`} colSpan={3}>
          {s.outputs > 0 ? "Done" : <span className="k-fg3">Done once, when the client tells us</span>}
        </td>
      ) : (
        <>
          <td className={`${TDN} ${full ? "text-[var(--data-amber)]" : ""}`}>{formatCount(s.runsToday)}</td>
          <td className={TD}>
            <CapacityField script={s} field="perDay" />
          </td>
          <td className={TD}>
            <CapacityField script={s} field="daysPerUnit" />
          </td>
        </>
      )}
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

/** One open task: who it is about, what is asked, the answer form. */
function TaskRow({ task, onDone }: { task: ApiTask; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/tasks/${encodeURIComponent(task.id)}/answer`, { values });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-4 py-3" data-task={task.id}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{task.asked}</p>
          <p className="k-fg3 truncate text-[12px]">
            {task.scriptName}
            {task.subjectName ? ` with ${task.subjectName}` : ""}
          </p>
        </div>
        <button type="button" className="k-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Answer
        </button>
      </div>
      {open && (
        <form
          className="k-inset mt-3 grid gap-3 rounded-[8px] p-3 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {task.fields.map((f) => (
            <TaskInput key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
          ))}
          <div className="flex items-end gap-2">
            <button type="submit" className="k-btn-strong" disabled={busy}>
              Save answer
            </button>
            {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function TaskInput({ field, value, onChange }: { field: ApiTaskField; value: string | number | boolean | undefined; onChange: (v: string | number | boolean) => void }) {
  if (field.type === "yesno")
    return (
      <div>
        <p className="k-label mb-1.5">{field.label}</p>
        <div className="flex gap-1">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" className={`k-chip ${value === v ? "k-chip-on" : ""}`} onClick={() => onChange(v)} aria-pressed={value === v}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <label className="block">
      <span className="k-label mb-1.5 block">{field.label}</span>
      <input
        className="k-input w-full px-2"
        style={{ font: "inherit" }}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(field.type === "text" ? e.target.value : Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
      />
    </label>
  );
}
