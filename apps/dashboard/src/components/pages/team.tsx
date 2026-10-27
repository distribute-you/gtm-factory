"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OURS, type Script, type TaskField, type TeamTask } from "@gtm-factory/core";
import { ProviderLogo } from "@/components/catalogue-bits";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { engineName, outcomeLabel, personName, scriptFigures, type Model } from "@/lib/model";
import { pinHref } from "@/lib/pins";
import { formatCount, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

/** Who performs the scripts this page lists. */
const TEAM = "Client's team";

/**
 * Done by your team: the work the Plan orders from the client's own people. A task is one
 * run of such a script (a closing call with one person): the person answers it and the
 * answer becomes the Unit. Capacity is asked only for work that repeats; work done once
 * (the offer, the ICP) shows as done.
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
  const { scope } = useSim();
  const scripts = model.catalogue.scripts.filter((s) => s.status === "active" && String(s.tactics.performed_by ?? OURS) === TEAM);
  const tasks = model.session.tasks(scope ?? undefined);
  return (
    <>
      <PageHeader
        title={<>{plural(tasks.length, "task waits", "tasks wait")} for your team</>}
        sub="Answer each task when it is done: your answer counts as the result and credits the scripts that brought the person."
      />
      <section className="mb-8">
        <SectionTitle count={tasks.length}>Your team&apos;s tasks</SectionTitle>
        {tasks.length === 0 ? (
          <div className="k-card">
            <EmptyNote>Nothing to do right now.</EmptyNote>
          </div>
        ) : (
          <div className="k-card divide-y divide-[var(--line-subtle)]" data-testid="team-tasks">
            {tasks.slice(0, 12).map((t) => (
              <TaskRow key={t.id} model={model} task={t} />
            ))}
            {tasks.length > 12 && <p className="k-fg3 px-4 py-2.5 text-[12px]">{formatCount(tasks.length - 12)} more, oldest first.</p>}
          </div>
        )}
      </section>
      <section>
        <SectionTitle count={scripts.length}>What your team does</SectionTitle>
        <CardTable footer="Capacity is how much your team can do each day. Empty means no limit. A full day sends the work elsewhere until tomorrow.">
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Script</th>
              <th className={TH}>Engine</th>
              <th className={`${TH} text-right`}>Today</th>
              <th className={`${TH} text-right`}>Most per day</th>
              <th className={`${TH} text-right`}>Days per task</th>
              <th className={`${TH} text-right`}>Done to date</th>
            </tr>
          </thead>
          <tbody>
            {scripts.map((s) => (
              <ScriptRow key={s.id} model={model} script={s} brandId={scope} />
            ))}
          </tbody>
        </CardTable>
      </section>
    </>
  );
}

/** One open task: who it is about, what is asked, the answer form. */
function TaskRow({ model, task }: { model: Model; task: TeamTask }) {
  const { dispatch } = useSim();
  const [open, setOpen] = useState(false);
  const script = model.catalogue.script(task.scriptId);
  const fields = script?.form ?? [];
  const who = task.subject ? personName(task.subject) : "the brand";
  const question = fields.find((f) => f.type === "yesno")?.label ?? "Done?";
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const campaign = model.campaigns.find((c) => c.id === task.campaignId);
  return (
    <div className="px-4 py-3" data-task={task.id}>
      <div className="flex flex-wrap items-center gap-3">
        {script && <ProviderLogo script={script} size={28} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            {script?.name ?? task.scriptId} with {who}
          </p>
          <p className="k-fg3 truncate text-[12px]">
            {question} · {campaign?.name ?? task.campaignId} · asked on day {task.dayOrdered}, due day {task.dueDay}
          </p>
        </div>
        {task.subject && (
          <Link href={`/leads/view/?id=${encodeURIComponent(task.subject)}`} className="k-btn-ghost">
            Open the person
          </Link>
        )}
        <button type="button" className="k-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Answer
        </button>
      </div>
      {open && (
        <form
          className="k-inset mt-3 grid gap-3 rounded-[8px] p-3 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"
          onSubmit={(e) => {
            e.preventDefault();
            const err = dispatch({ type: "answerTask", taskId: task.id, values });
            setError(err);
          }}
        >
          {fields.map((f) => (
            <AnswerField key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />
          ))}
          <div className="flex items-end gap-2">
            <button type="submit" className="k-btn-strong">
              Save answer
            </button>
            {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function AnswerField({ field, value, onChange }: { field: TaskField; value: string | number | boolean | undefined; onChange: (v: string | number | boolean) => void }) {
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
        inputMode={field.type === "text" ? "text" : "decimal"}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(field.type === "text" ? e.target.value : Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
      />
    </label>
  );
}

/** One script of the team: done once (the offer, the ICP), or repeated work with its capacity. */
function ScriptRow({ model, script, brandId }: { model: Model; script: Script; brandId: string | null }) {
  const { dispatch } = useSim();
  const once = model.catalogue.outcome(script.outcome)?.subject === "brand";
  const held = once && brandId ? model.session.objectDynasties(brandId, script.outcome).length > 0 : false;
  const today = model.session.runsTodayOf(script.id);
  const cap = script.capacity ?? {};
  const isFull = cap.perDay !== undefined && today >= cap.perDay;
  const save = (patch: { perDay?: number; daysPerUnit?: number }) => {
    const next = { ...cap, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    return dispatch({ type: "capacity", scriptId: script.id, capacity: next });
  };
  return (
    <tr className="k-row k-line-subtle border-b last:border-0" data-script={script.id}>
      <td className={TD}>
        <span className="flex items-center gap-2">
          <ProviderLogo script={script} size={22} />
          <span className="font-medium">{script.name}</span>
        </span>
      </td>
      <td className={TD}>{engineName(model.catalogue, script.outcome)}</td>
      {once ? (
        <td className={`${TD} text-right`} colSpan={3}>
          {held ? (
            <Link href={pinHref({ kind: "outcome", id: script.outcome })} className="inline-flex items-center gap-1.5 text-[var(--run)] hover:underline">
              Done: see the {outcomeLabel(model.catalogue, script.outcome)}
            </Link>
          ) : (
            <span className="k-fg3">Done once, when the client tells us</span>
          )}
        </td>
      ) : (
        <>
          <td className={`${TDN} ${isFull ? "text-[var(--data-amber)]" : ""}`}>{formatCount(today)}</td>
          <td className={TDN}>
            <InlineNumber value={cap.perDay} onSave={(n) => save({ perDay: n })} label={`Most per day for ${script.name}`} />
          </td>
          <td className={TDN}>
            <InlineNumber value={cap.daysPerUnit} onSave={(n) => save({ daysPerUnit: n })} label={`Days per task for ${script.name}`} />
          </td>
        </>
      )}
      <td className={TDN}>{formatCount(scriptFigures(model, script.dynasty).produced)}</td>
    </tr>
  );
}

/** A figure that reads as text; a click turns it into its field; leaving it saves; empty means no limit; Esc drops it. */
function InlineNumber({ value, onSave, label }: { value: number | undefined; onSave: (n: number | undefined) => string | null; label: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  if (!editing)
    return (
      <button type="button" className="rounded-[6px] px-1.5 py-0.5 tabular-nums hover:bg-[var(--bg-hover)]" onClick={() => setEditing(true)} aria-label={label}>
        {value === undefined ? <span className="k-fg3">No limit</span> : formatCount(value)}
      </button>
    );
  const commit = () => {
    const n = text.trim() === "" ? undefined : Number(text);
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) {
      setError("A number, or empty for no limit.");
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
