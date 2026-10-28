"use client";

/**
 * The catalogue's side panels and the pieces they share, read off the factory API only: the
 * Engine drawer (its scripts, who calls it, its storage, a pin), the Script drawer (its Engine,
 * who performs it, capacity, what its code calls and from which Provider, its code, the
 * versions of its dynasty, Upgrade, Fork, Retire, who calls its Engine), a script's card, the
 * code editor that makes a new version or a fork, and the pin button. No piece knows an
 * outcome or a script by name.
 */

import Link from "next/link";
import { useState } from "react";
import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { Catalogue, OURS, type ApiCandidates, type ApiScriptStats, type ApiStorage, type CatalogueData, type OutcomeId, type Pin } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { Drawer, EmptyNote, ToneDot } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { engineLine, engineTitle, outcomeName, performerTitle } from "@/lib/api/labels";
import { usePins } from "@/lib/api/pins";
import { formatCents, formatCount, formatRatePct } from "@/lib/format";
import { Field } from "./common";

/** Pin an outcome to the sidebar: its page lists what it holds and its Engine's scripts. */
export function PinButton({ pin }: { pin: Pin }) {
  const { isPinned, toggle } = usePins();
  const on = isPinned(pin);
  return (
    <button
      type="button"
      className="k-btn"
      onClick={(e) => {
        e.stopPropagation();
        toggle(pin);
      }}
      title={on ? "Remove from the sidebar" : "Add a page for it in the sidebar"}
    >
      {on ? <PushPinSlashIcon size={13} /> : <PushPinIcon size={13} />}
      {on ? "Unpin" : "Pin"}
    </button>
  );
}

export function outcomePin(c: CatalogueData | null | undefined, outcome: OutcomeId): Pin {
  const o = c?.outcomes.find((x) => x.id === outcome);
  return { kind: "outcome", id: outcome, label: o?.plural ?? o?.label ?? outcome, ...(o?.icon ? { icon: o.icon } : {}) };
}

/** A place where an Engine's scripts compete, for one caller: the caller, the Rating's favourite there, and the picks made. */
export interface Caller {
  point: string;
  consumer: string;
  label: string;
  best: { id: string; label: string; chance: number } | null;
  picks: number;
}

/** Who calls an Engine, from the research places (the same place across campaigns counted once). */
export function callersOf(points: readonly ApiCandidates[] | null | undefined, catalogue: CatalogueData | null | undefined, engine: OutcomeId): Caller[] {
  const by = new Map<string, Caller>();
  for (const p of points ?? []) {
    if (p.material !== engine) continue;
    const point = `${p.consumer}|${p.material}`;
    const best = [...p.candidates].sort((a, b) => b.chanceBest - a.chanceBest || b.meanScore - a.meanScore)[0];
    const picks = p.candidates.reduce((x, o) => x + o.picks, 0);
    const seen = by.get(point);
    if (seen) {
      seen.picks += picks;
      continue;
    }
    by.set(point, {
      point,
      consumer: p.consumer,
      label: p.consumer === "campaign" ? "The campaign's Target" : `Called by ${engineTitle(catalogue, p.consumer)}`,
      best: best ? { id: best.id, label: best.label, chance: best.chanceBest } : null,
      picks,
    });
  }
  return [...by.values()];
}

export const researchHref = (point: string) => `/research/?point=${encodeURIComponent(point)}`;

/** Cost per run and yield of a script, measured on its runs, else as stated. */
function figures(s: ApiScriptStats): { cost: string; costNote: string; yieldRate: number | null } {
  return {
    cost: s.runs > 0 ? formatCents(Math.round(s.spentCents / s.runs)) : formatCents(s.costCentsPrior),
    costNote: s.runs > 0 ? "measured" : "stated",
    yieldRate: s.runs > 0 ? s.outputs / s.runs : null,
  };
}

const KIND: Record<string, string> = { ai: "AI", human: "A person", rules: "Rules" };

/** A script's card: its name, kind, version, cost per run, yield, versions and tactics. */
export function ScriptTile({ s, versions, catalogue, onClick }: { s: ApiScriptStats; versions: ApiScriptStats[]; catalogue: CatalogueData | null | undefined; onClick?: () => void }) {
  const f = figures(s);
  const parent = catalogue?.scripts.find((x) => x.dynasty === catalogue.scripts.find((y) => y.id === s.id)?.parentDynasty);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className="k-card k-hover flex w-full min-w-0 flex-col gap-3 p-4 text-left" data-script={s.dynasty}>
      <div className="flex items-start gap-2.5">
        <Mark kind={`script:${s.kind}`} id={s.dynasty} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{s.name}</p>
          <p className="k-fg3 truncate text-[12px]">
            {s.provider ? `${s.provider}, ` : ""}
            {KIND[s.kind] ?? s.kind}, v{s.version}
            {parent ? `, forked from ${parent.name}` : ""}
          </p>
        </div>
        {s.status === "active" ? <ToneDot tone="run">Active</ToneDot> : <ToneDot tone="muted">Retired</ToneDot>}
      </div>
      <div className="k-inset grid grid-cols-3 divide-x divide-[var(--line-subtle)] rounded-[8px]">
        <Cell label="Cost per run" value={f.cost} note={f.costNote} />
        <Cell label="Yield" value={formatRatePct(f.yieldRate)} note={`${formatCount(s.runs)} runs`} />
        <Cell label="Versions" value={String(versions.length)} note={versions.map((v) => `v${v.version}`).join(" ")} />
      </div>
      {Object.keys(s.tactics).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(s.tactics).map(([k, v]) => (
            <span key={k} className="k-chip">
              {tacticText(catalogue, k, v)}
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

export function tacticText(catalogue: CatalogueData | null | undefined, tactic: string, value: unknown): string {
  const t = catalogue?.tactics.find((x) => x.id === tactic);
  const name = t?.name ?? tactic;
  if (typeof value === "boolean") return value ? name : `Not: ${name.toLowerCase()}`;
  const unit = t?.type.kind === "number" && t.type.unit ? ` ${t.type.unit}` : "";
  return `${name}: ${String(value)}${unit}`;
}

/** Where each outcome a script's code calls comes from (its Provider) and the pick made there. */
export function ScriptCalls({ s, catalogue, points }: { s: ApiScriptStats; catalogue: CatalogueData | null | undefined; points: readonly ApiCandidates[] | null | undefined }) {
  if (s.materials.length === 0) return <p className="k-fg3 text-[13px]">Calls nothing: it draws its subjects from the market, or another party calls its webhook.</p>;
  const cat = catalogue ? new Catalogue(catalogue) : null;
  const subject = cat?.subjectOf(s) ?? null;
  return (
    <div>
      <p className="k-fg3 mb-1.5 text-[12px]">{s.materialsLabel === "measured" ? "Measured on its runs." : "Read from its code; measured once it runs."}</p>
      <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]" data-testid="script-materials">
        {s.materials.map((m) => {
          const o = catalogue?.outcomes.find((x) => x.id === m);
          const how =
            m === subject
              ? "The subject it works on, handed by the Plan"
              : o?.subject === "brand"
                ? "The brand's own Units: the Rating picks a version"
                : o?.contentType === "rating"
                  ? "Today's Rating"
                  : "The stock first, else its Engine makes one";
          const place = (points ?? []).find((p) => p.consumer === s.outcome && p.material === m);
          const pick = place ? [...place.candidates].sort((a, b) => b.chanceBest - a.chanceBest)[0] : undefined;
          return (
            <div key={m} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
              <Mark kind="material" id={m} icon={o?.icon} size={20} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <span className="font-medium">{outcomeName(catalogue, m)}</span>
                  {m === subject && <span className="k-chip">Subject</span>}
                </p>
                <p className="k-fg3 text-[12px]">Provider: {how}</p>
              </div>
              {place ? (
                <Link href={researchHref(`${place.consumer}|${place.material}`)} className="shrink-0 text-right hover:underline">
                  <span className="k-fg3 block text-[11px]">Picked</span>
                  <span className="block max-w-[160px] truncate text-[12px] font-medium">{pick?.label ?? "—"}</span>
                </Link>
              ) : (
                <span className="k-fg4 shrink-0 text-[12px]">No pick</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The Engine drawer: what it makes, its scripts, who calls it, what its scripts keep. */
export function EngineDrawer({ outcome, catalogue, onClose, onScript }: { outcome: OutcomeId; catalogue: CatalogueData | null | undefined; onClose: () => void; onScript?: (dynasty: string) => void }) {
  const scripts = useApi<ApiScriptStats[]>(`/scripts?outcome=${encodeURIComponent(outcome)}`, 0);
  const research = useApi<ApiCandidates[]>("/research", 0);
  const storage = useApi<ApiStorage>(`/storage/${encodeURIComponent(outcome)}`, 0);
  const o = catalogue?.outcomes.find((x) => x.id === outcome);
  const heads = headsOf(scripts.data ?? []).filter((s) => s.status === "active");
  const callers = callersOf(research.data, catalogue, outcome);
  const performers = [...new Set(heads.map((s) => performerTitle(s.performedBy)))].join(", ") || "—";
  return (
    <Drawer title="Engine" onClose={onClose} width={520}>
      <div className="flex items-start gap-3" data-testid="engine-drawer">
        <Mark kind="engine" id={outcome} icon={o?.icon} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-medium">{engineTitle(catalogue, outcome)}</h2>
          <p className="k-fg2 text-[13px]">{engineLine(catalogue, outcome)}</p>
          {o?.description && <p className="k-fg3 mt-1 text-[12px]">{o.description}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PinButton pin={outcomePin(catalogue, outcome)} />
      </div>
      <dl className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="k-label pt-0.5">Performed by</dt>
        <dd>{performers}</dd>
      </dl>

      <p className="k-label mb-1.5 mt-5">Its scripts</p>
      <p className="k-fg3 mb-2 text-[12px]">Each script that competes here, its yield and what one run costs.</p>
      <div className="space-y-1.5">
        {heads.map((s) => {
          const f = figures(s);
          return (
            <button key={s.dynasty} type="button" onClick={() => onScript?.(s.dynasty)} className="k-inset k-hover flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[13px]">
              <Mark kind={`script:${s.kind}`} id={s.dynasty} size={22} />
              <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
              <span className="k-fg3 text-[12px] tabular-nums">v{s.version}</span>
              <span className="k-fg2 w-14 text-right text-[12px] tabular-nums">{formatRatePct(f.yieldRate)}</span>
              <span className="k-fg2 w-16 text-right text-[12px] tabular-nums">{f.cost}</span>
            </button>
          );
        })}
        {scripts.answered && heads.length === 0 && <EmptyNote>No active script.</EmptyNote>}
      </div>

      <p className="k-label mb-1.5 mt-5">Who calls it</p>
      <p className="k-fg3 mb-2 text-[12px]">Each caller picks its own best script here.</p>
      <CallerList callers={callers} />

      <p className="k-label mb-1.5 mt-5">Storage</p>
      <p className="k-fg3 mb-2 text-[12px]">Private to this Engine&apos;s scripts. Other Engines get its data only through the Units it makes.</p>
      <StorageList storage={storage.data} />
    </Drawer>
  );
}

export function CallerList({ callers, highlight }: { callers: Caller[]; highlight?: string }) {
  if (callers.length === 0) return <EmptyNote>No Engine picked among its scripts yet.</EmptyNote>;
  return (
    <div className="k-inset divide-y divide-[var(--line-subtle)] rounded-[8px]">
      {callers.map((c) => (
        <Link key={c.point} href={researchHref(c.point)} className="k-hover flex items-center gap-2 px-3 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
          {highlight && c.best?.id === highlight ? (
            <span className="k-chip text-[var(--run)]">Best here</span>
          ) : (
            <>
              <span className="k-fg3 text-[12px]">best</span>
              <span className="font-medium">{c.best ? c.best.label : "—"}</span>
            </>
          )}
          <span className="k-fg3 w-20 text-right text-[12px] tabular-nums">{formatCount(c.picks)} picks</span>
        </Link>
      ))}
    </div>
  );
}

export function StorageList({ storage }: { storage: ApiStorage | null }) {
  if (!storage) return null;
  if (storage.tables.length === 0) return <EmptyNote>Nothing stored yet.</EmptyNote>;
  return (
    <div className="space-y-2">
      {storage.tables.map((t) => (
        <div key={t.name} className="k-inset rounded-[8px] px-3 py-2">
          <p className="flex justify-between text-[13px]">
            <span className="font-medium">{t.name}</span>
            <span className="k-fg3 tabular-nums">{formatCount(t.rows)} rows</span>
          </p>
          {t.sample.map((r) => (
            <p key={r.key} className="k-mono k-fg3 truncate text-[11px]">
              {r.key}: {JSON.stringify(r.value)}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The head version of each dynasty (the highest version), in first-seen order. */
export function headsOf(scripts: readonly ApiScriptStats[]): ApiScriptStats[] {
  const by = new Map<string, ApiScriptStats>();
  for (const s of scripts) {
    const seen = by.get(s.dynasty);
    if (!seen || s.version > seen.version) by.set(s.dynasty, s);
  }
  return [...by.values()];
}

/** The Script drawer: its Engine, who performs it, its capacity, what its code calls, its code, its versions, and what can be done with it. */
export function ScriptDrawer({ dynasty, catalogue, onClose }: { dynasty: string; catalogue: CatalogueData | null | undefined; onClose: () => void }) {
  const scripts = useApi<ApiScriptStats[]>("/scripts", 0);
  const research = useApi<ApiCandidates[]>("/research", 0);
  const versions = (scripts.data ?? []).filter((s) => s.dynasty === dynasty).sort((a, b) => a.version - b.version);
  const head = versions[versions.length - 1];
  const [editor, setEditor] = useState<"upgrade" | "fork" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!head) return <Drawer title="Script" onClose={onClose} width={580}>{scripts.answered ? <EmptyNote>No such script.</EmptyNote> : null}</Drawer>;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/scripts/${encodeURIComponent(head.id)}/${head.status === "active" ? "retire" : "restore"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const cap = head.capacity;
  return (
    <Drawer title="Script" onClose={onClose} width={580}>
      <div data-testid="script-drawer">
        <ScriptTile s={head} versions={versions} catalogue={catalogue} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="k-btn" onClick={() => setEditor("upgrade")} title="A new version of this dynasty: it runs from now on and keeps the dynasty's stats">
          Upgrade
        </button>
        <button type="button" className="k-btn" onClick={() => setEditor("fork")} title="A new dynasty that starts from this one's belief, its code copied">
          Fork
        </button>
        <button type="button" className="k-btn" disabled={busy} onClick={toggle}>
          {head.status === "active" ? "Retire" : "Restore"}
        </button>
        {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
      </div>
      <dl className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="k-label pt-0.5">Engine</dt>
        <dd>{engineTitle(catalogue, head.outcome)}</dd>
        <dt className="k-label pt-0.5">Performed by</dt>
        <dd>{performerTitle(head.performedBy ?? OURS)}</dd>
        <dt className="k-label pt-0.5">Capacity</dt>
        <dd>{cap.perDay != null ? `${formatCount(cap.perDay)} a day${cap.daysPerUnit ? `, ${cap.daysPerUnit} days each` : ""}` : "No limit stated"}</dd>
      </dl>
      <p className="k-label mb-1.5 mt-5">What its code calls</p>
      <ScriptCalls s={head} catalogue={catalogue} points={research.data} />
      <p className="k-label mb-1.5 mt-5">Its code</p>
      <p className="k-fg3 mb-1.5 font-mono text-[12px]">scripts/src/{head.code}.ts</p>
      {head.source ? (
        <pre className="k-inset k-scroll max-h-[420px] overflow-auto rounded-[8px] p-3 font-mono text-[12px] leading-[18px]" data-testid="script-code">
          {head.source}
        </pre>
      ) : (
        <p className="k-fg3 text-[13px]">This backend does not serve the code text.</p>
      )}
      <p className="k-label mb-1.5 mt-5">Versions of the dynasty</p>
      <div className="space-y-1.5">
        {versions.map((v) => (
          <div key={v.id} className="k-inset flex items-center gap-2 rounded-[8px] px-3 py-2 text-[13px]">
            <span className="font-medium">v{v.version}</span>
            <span className="min-w-0 flex-1 truncate">{v.name}</span>
            <span className="k-fg3 text-[12px] tabular-nums">{formatCount(v.runs)} runs</span>
            <span className="k-fg3 w-14 text-right text-[12px]">{v.status === "active" ? "Active" : "Retired"}</span>
          </div>
        ))}
      </div>
      <p className="k-fg3 mt-3 text-[12px]">Stats pool across the versions of a dynasty. A fork starts from its parent&apos;s belief.</p>
      <p className="k-label mb-1.5 mt-5">Who calls its Engine</p>
      <CallerList callers={callersOf(research.data, catalogue, head.outcome)} highlight={dynasty} />
      {editor && <CodeEditor head={head} mode={editor} onClose={() => setEditor(null)} />}
    </Drawer>
  );
}

/** Write the code of a new version (an upgrade) or of a new dynasty (a fork). It must compile in the sandbox. */
function CodeEditor({ head, mode, onClose }: { head: ApiScriptStats; mode: "upgrade" | "fork"; onClose: () => void }) {
  const [name, setName] = useState(mode === "fork" ? `${head.name}, fork` : `${head.name} v${head.version + 1}`);
  const [source, setSource] = useState(head.source ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/scripts/${encodeURIComponent(head.id)}/${mode === "fork" ? "forks" : "versions"}`, { source, name: name.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Drawer title={mode === "fork" ? "Fork into a new dynasty" : "New version"} onClose={onClose} width={680}>
      <div className="space-y-4">
        <p className="k-fg2 text-[13px]">
          {mode === "fork" ? "A new dynasty that competes with its parent, starting from the parent's belief." : "The new version runs from now on. The dynasty keeps its history and its belief."} The code runs in the sandbox and calls its Providers by name.
        </p>
        <Field label="Name">
          <input className="k-input w-full" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Code">
          <textarea className="k-input k-mono w-full py-2 text-[12px]" style={{ height: "auto", minHeight: 360 }} value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} />
        </Field>
        {error && <p className="text-[13px] text-[var(--data-rose)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="k-btn-strong" disabled={busy || !name.trim() || !source.trim()} onClick={save}>
            {busy ? "Saving" : mode === "fork" ? "Create the fork" : `Save as v${head.version + 1}`}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
