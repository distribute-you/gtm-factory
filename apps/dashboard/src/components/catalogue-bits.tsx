"use client";

/**
 * Shared catalogue pieces, all read off data: a script's card and provider logo, a leg's Bill of
 * materials, one renderer per content type of a brand outcome, and the version editor (read, edit =
 * new version, compare two versions). No piece knows an outcome, a leg or a script by name.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { describeCondition, type Catalogue, type ContentType, type Leg, type Unit, type Script } from "@gtm-factory/core";
import { Mark } from "./mark";
import { SelectItem } from "./ui";
import { billOfMaterials, diffWords, headScript, scriptFigures, variablesOf, type Model } from "@/lib/model";
import { formatCents, formatCount, formatRatePct } from "@/lib/format";

/**
 * A script's Bill of materials (the leg's first script when none is named): the outcomes it
 * consumes per Unit produced, one line per Material, the conditions of its Specification, the
 * legs producing each (they share one stock) and the choice made among them.
 */
export function BillOfMaterials({ model, leg, script }: { model: Model; leg: Leg; script?: Script }) {
  const rows = billOfMaterials(model, leg, script);
  if (rows.length === 0)
    return <p className="k-fg3 text-[13px]">{leg.webhook ? "No Material: another factory calls its webhook." : "No Material: it draws its subjects from the market."}</p>;
  return (
    <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]" data-testid="bill-of-materials">
      {rows.map((r) => (
        <div key={r.material} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
          <Mark kind="material" id={r.material} icon={model.catalogue.outcome(r.material)?.icon} size={20} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              <span className="font-medium">{r.label}</span>
              {r.subject && <span className="k-chip">Subject</span>}
            </p>
            <p className="k-fg3 text-[12px]">{r.how}</p>
            {r.conditions.length > 0 && <p className="k-fg2 text-[12px]">Specification: {r.conditions.map((c) => describeCondition(c, model.catalogue)).join(", ")}</p>}
            <p className="k-fg2 truncate text-[12px]">{r.producers.length ? `Made by ${r.producers.map((p) => p.name).join(", ")}` : "Made by no leg yet"}</p>
          </div>
          {r.point ? (
            <Link href={`/research/?point=${encodeURIComponent(r.point)}`} className="shrink-0 text-right hover:underline">
              <span className="k-fg3 block text-[11px]">Chosen</span>
              <span className="block max-w-[160px] truncate text-[12px] font-medium">{r.choice ?? "—"}</span>
            </Link>
          ) : (
            <span className="k-fg4 shrink-0 text-[12px]">No choice</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A script's provider, as its logo: an image when the data serves one, else its initials in its colour. */
export function ProviderLogo({ script, size = 20 }: { script: Script; size?: number }) {
  const p = script.provider;
  if (!p) return <Mark kind={`script:${script.kind}`} id={script.dynasty} size={size} />;
  if (p.logoUrl) return <img src={p.logoUrl} alt={p.name} width={size} height={size} className="shrink-0 rounded-[6px]" />;
  const color = p.color ?? "var(--fg-2)";
  return (
    <span
      title={p.name}
      aria-label={p.name}
      className="inline-flex shrink-0 items-center justify-center rounded-[6px] text-[10px] font-semibold"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 16%, transparent)`, color, fontSize: Math.max(8, Math.round(size * 0.42)) }}
    >
      {p.name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

/** A script's card, from its data: name, logo, cost, yield, dynasty and versions. */
export function ScriptCard({ model, dynasty, onClick, selected }: { model: Model; dynasty: string; onClick?: () => void; selected?: boolean }) {
  const s = headScript(model.catalogue, dynasty);
  if (!s) return null;
  const f = scriptFigures(model, dynasty);
  const versions = model.catalogue.versionsOf(dynasty);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={`k-card ${selected ? "k-card-on" : ""} flex w-full min-w-0 flex-col gap-3 p-4 text-left`}>
      <div className="flex items-start gap-2.5">
        <ProviderLogo script={s} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{s.name}</p>
          <p className="k-fg3 truncate text-[12px]">
            {s.provider ? `${s.provider.name} · ` : ""}
            {s.kind === "ai" ? "AI" : s.kind === "human" ? "A person" : "Rules"} · v{s.version}
            {s.parentDynasty ? ` · forked from ${headScript(model.catalogue, s.parentDynasty)?.name ?? s.parentDynasty}` : ""}
          </p>
        </div>
        <span className={`flex items-center gap-1.5 text-[12px] ${s.status === "active" ? "" : "k-fg3"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.status === "active" ? "bg-[var(--run)]" : "border-[1.5px] border-[var(--fg-3)]"}`} />
          {s.status === "active" ? "Active" : "Retired"}
        </span>
      </div>
      <div className="k-inset grid grid-cols-3 divide-x divide-[var(--line-subtle)] rounded-[8px]">
        <Cell label="Cost per run" value={f.costPerRun != null ? formatCents(Math.round(f.costPerRun * 100)) : formatCents(s.costCents)} note={f.costPerRun != null ? "measured" : "stated"} />
        <Cell label="Yield" value={formatRatePct(f.yieldRate)} note={`${formatCount(f.subjects)} runs`} />
        <Cell label="Versions" value={String(versions.length)} note={versions.map((v) => `v${v.version}`).join(" ")} />
      </div>
      {Object.keys(s.tactics).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(s.tactics).map(([k, v]) => (
            <span key={k} className="k-chip">
              {tacticValueText(model.catalogue, k, v)}
            </span>
          ))}
        </div>
      )}
    </Tag>
  );
}

function Cell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <p className="k-label truncate">{label}</p>
      <p className="text-[16px] font-medium tabular-nums">{value}</p>
      {note && <p className="k-fg3 truncate text-[11px]">{note}</p>}
    </div>
  );
}

export function tacticValueText(catalogue: Catalogue, tactic: string, value: unknown): string {
  const t = catalogue.tactic(tactic);
  const name = t?.name ?? tactic;
  if (typeof value === "boolean") return value ? name : `Not: ${name.toLowerCase()}`;
  const unit = t?.type.kind === "number" && t.type.unit ? ` ${t.type.unit}` : "";
  return `${name}: ${String(value)}${unit}`;
}

/** One renderer per content type: the same view for every outcome holding that type. */
export function ContentView({ model, unit, type }: { model: Model; unit: Unit; type: ContentType | undefined }) {
  const text = unit.text ?? "";
  if (type === "text_with_variables") return <TextWithVariables text={text} />;
  if (type === "audience")
    return (
      <div className="space-y-2">
        <p className="text-[14px] leading-6">{text}</p>
        <div className="flex flex-wrap gap-1">
          {(unit.conditions ?? []).map((c, i) => (
            <span key={i} className="k-chip">
              {describeCondition(c, model.catalogue)}
            </span>
          ))}
        </div>
      </div>
    );
  if (type === "list")
    return (
      <ul className="list-disc space-y-1 pl-5 text-[13px]">
        {text
          .split("\n")
          .filter(Boolean)
          .map((l, i) => (
            <li key={i}>{l}</li>
          ))}
      </ul>
    );
  return <p className="whitespace-pre-wrap text-[13px] leading-6">{text}</p>;
}

/** A text with {{variables}}: variables shown as chips in the flow of the text. */
export function TextWithVariables({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[a-z0-9_]+\s*\}\})/gi);
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-7">
      {parts.map((p, i) =>
        /^\{\{/.test(p) ? (
          <span key={i} className="mx-0.5 rounded-[5px] bg-[var(--accent-soft,rgba(80,110,240,.12))] px-1 py-px font-mono text-[12px] text-[var(--accent)]">
            {p.replace(/[{}\s]/g, "")}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

/** A word diff of two versions: removed words struck in rose, added words in green. */
export function VersionDiff({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffWords(from, to), [from, to]);
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-7">
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "add" ? (
          <ins key={i} className="rounded-[3px] px-0.5 text-[var(--run)] no-underline" style={{ background: "color-mix(in srgb, var(--run) 14%, transparent)" }}>
            {p.text}
          </ins>
        ) : (
          <del key={i} className="rounded-[3px] px-0.5 text-[var(--data-rose)]" style={{ background: "color-mix(in srgb, var(--data-rose) 12%, transparent)" }}>
            {p.text}
          </del>
        ),
      )}
    </p>
  );
}

/**
 * Read, edit and compare the versions of one object dynasty. Saving an edit makes a new
 * version: the choices keep the dynasty and serve its new head from the next run.
 */
export function VersionEditor({
  model,
  versions,
  type,
  onSave,
}: {
  model: Model;
  versions: Unit[];
  type: ContentType | undefined;
  onSave?: (text: string) => string | null;
}) {
  const head = versions[versions.length - 1]!;
  const [mode, setMode] = useState<"read" | "edit" | "compare">("read");
  const [draft, setDraft] = useState(head.text ?? "");
  const [left, setLeft] = useState(Math.max(0, versions.length - 2));
  const [right, setRight] = useState(versions.length - 1);
  const [error, setError] = useState<string | null>(null);
  const editable = type === "text_with_variables" || type === "text" || type === "list";
  const vars = type === "text_with_variables" ? variablesOf(mode === "edit" ? draft : head.text ?? "") : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={`k-chip ${mode === "read" ? "k-chip-on" : ""}`} onClick={() => setMode("read")}>
          Read v{head.version}
        </button>
        {editable && onSave && (
          <button
            type="button"
            className={`k-chip ${mode === "edit" ? "k-chip-on" : ""}`}
            onClick={() => {
              setDraft(head.text ?? "");
              setMode("edit");
            }}
          >
            Edit
          </button>
        )}
        {versions.length > 1 && (
          <button type="button" className={`k-chip ${mode === "compare" ? "k-chip-on" : ""}`} onClick={() => setMode("compare")}>
            Compare versions
          </button>
        )}
        <span className="k-fg3 ml-auto text-[12px]">
          {versions.length} {versions.length === 1 ? "version" : "versions"} · made by {headScript(model.catalogue, model.catalogue.script(head.scriptId ?? "")?.dynasty ?? "")?.name ?? "a script"}
        </span>
      </div>
      {mode === "read" && <ContentView model={model} unit={head} type={type} />}
      {mode === "edit" && (
        <div className="space-y-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} className="k-input w-full resize-y py-2 leading-6" style={{ font: "inherit", height: "auto" }} aria-label="New version" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="k-btn-strong"
              disabled={!draft.trim() || draft === head.text}
              onClick={() => {
                const err = onSave?.(draft) ?? null;
                setError(err);
                if (!err) {
                  setMode("read");
                  setRight(versions.length);
                  setLeft(versions.length - 1);
                }
              }}
            >
              Save as v{(head.version ?? 1) + 1}
            </button>
            <button type="button" className="k-btn-ghost" onClick={() => setMode("read")}>
              Cancel
            </button>
            {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
          </div>
          {draft !== head.text && <VersionDiff from={head.text ?? ""} to={draft} />}
        </div>
      )}
      {mode === "compare" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            <VersionPick versions={versions} value={left} onChange={setLeft} />
            <span className="k-fg3">to</span>
            <VersionPick versions={versions} value={right} onChange={setRight} />
          </div>
          <VersionDiff from={versions[left]?.text ?? ""} to={versions[right]?.text ?? ""} />
        </div>
      )}
      {vars.length > 0 && (
        <p className="k-fg3 text-[12px]">
          Variables: {vars.map((v) => `{{${v}}}`).join(", ")}
        </p>
      )}
    </div>
  );
}

function VersionPick({ versions, value, onChange }: { versions: Unit[]; value: number; onChange: (i: number) => void }) {
  return (
    <select className="k-input px-1.5" style={{ font: "inherit" }} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Version">
      {versions.map((v, i) => (
        <SelectItem key={v.id} value={i}>
          v{v.version} · day {v.day}
        </SelectItem>
      ))}
    </select>
  );
}
