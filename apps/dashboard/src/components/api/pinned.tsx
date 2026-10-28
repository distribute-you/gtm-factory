"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { ApiCandidates, ApiNewObjectVersion, ApiObjectDynasty, ApiObjectVersion, ApiScriptStats, ApiStorage, CatalogueData, Pin } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, Drawer, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview, useScope } from "@/lib/api/overview";
import { engineLine, engineTitle, outcomeName } from "@/lib/api/labels";
import { pinKey, usePins } from "@/lib/api/pins";
import { diffWords, variablesOf } from "@/lib/diff";
import { formatCount, formatRatePct, plural } from "@/lib/format";
import { Field, ShimmerRows, formatTime } from "./common";
import { PinButton, ScriptCalls, ScriptDrawer, ScriptTile, StorageList, callersOf, headsOf, researchHref } from "./catalogue-parts";
import Link from "next/link";

/** The page of a pinned outcome, the same code for every pin: the dynasties of its Units (read, edit, compare), then its Engine. */
export function ApiPinnedPage() {
  const key = useSearchParams().get("pin") ?? "";
  const { data: o, answered } = useOverview();
  const { pins } = usePins();
  const pin: Pin | null = useMemo(() => {
    const found = pins.find((p) => pinKey(p) === key);
    if (found) return found;
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    const out = o?.catalogue.outcomes.find((x) => x.id === id);
    return kind === "outcome" && out ? { kind: "outcome", id, label: out.plural ?? out.label, ...(out.icon ? { icon: out.icon } : {}) } : null;
  }, [pins, key, o]);
  if (!answered) return <Page><ShimmerRows /></Page>;
  return (
    <>
      <TopBar crumbs={[{ label: "Pinned" }, { label: pin?.label ?? "Unknown pin" }]} actions={pin ? <PinButton pin={pin} /> : undefined} />
      <Page>{pin ? <Pinned pin={pin} catalogue={o?.catalogue} /> : <EmptyNote>Nothing is pinned under this address.</EmptyNote>}</Page>
    </>
  );
}

function Pinned({ pin, catalogue }: { pin: Pin; catalogue: CatalogueData | undefined }) {
  const brandOutcome = catalogue?.outcomes.find((x) => x.id === pin.id)?.subject === "brand";
  return (
    <>
      {brandOutcome && <OutcomePage pin={pin} catalogue={catalogue} />}
      <EnginePage pin={pin} catalogue={catalogue} spaced={brandOutcome} />
    </>
  );
}

// ---------------------------------------------------------------------------
// An outcome: its dynasties, each with its versions (read, edit, compare)
// ---------------------------------------------------------------------------

function OutcomePage({ pin, catalogue }: { pin: Pin; catalogue: CatalogueData | undefined }) {
  const { data: o } = useOverview();
  const { scope } = useScope();
  const read = useApi<ApiObjectDynasty[]>(`/objects?outcome=${encodeURIComponent(pin.id)}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "fork" | "new"; dynasty: ApiObjectDynasty | null } | null>(null);
  const out = catalogue?.outcomes.find((x) => x.id === pin.id);
  const all = (read.data ?? []).filter((d) => !d.retired && (!scope.brandId || !d.brandId || d.brandId === scope.brandId));
  const keyOf = (d: ApiObjectDynasty) => `${d.brandId ?? ""}|${d.dynasty}`;
  const current = all.find((d) => keyOf(d) === selected) ?? all[0];
  const brandName = (id: string | null) => (id ? o?.brands.find((b) => b.id === id)?.name ?? id : "Every brand");
  const head = (d: ApiObjectDynasty) => d.versions.find((v) => v.head) ?? d.versions[d.versions.length - 1]!;
  return (
    <>
      <PageHeader
        title={<>{plural(all.length, "dynasty", "dynasties")} of {(out?.plural ?? pin.label).toLowerCase()}</>}
        sub={out?.description ?? "Each dynasty competes at the Materials that consume it; an edit is a new version of the same dynasty."}
        right={
          <button type="button" className="k-btn" onClick={() => setEditor({ mode: "new", dynasty: null })}>
            New dynasty
          </button>
        }
      />
      {all.length === 0 ? (
        <div className="k-card">
          <EmptyNote>{read.answered ? "No Unit of this outcome yet." : "Loading."}</EmptyNote>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="k-card h-fit divide-y divide-[var(--line-subtle)]">
            {all.map((d) => {
              const on = current && keyOf(d) === keyOf(current);
              return (
                <button key={keyOf(d)} type="button" onClick={() => setSelected(keyOf(d))} className={`k-hover flex w-full items-center gap-3 px-4 py-3 text-left first:rounded-t-[12px] last:rounded-b-[12px] ${on ? "k-selected" : ""}`}>
                  <Mark kind="object" id={`${d.brandId}:${d.dynasty}`} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{head(d).name}</span>
                    <span className="k-fg3 block truncate text-[12px]">
                      {brandName(d.brandId)}, v{head(d).version}
                      {d.versions.length > 1 ? ` of ${d.versions.length}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] tabular-nums">{formatRatePct(d.share ?? null)}</span>
                    <span className="k-fg3 block text-[11px] tabular-nums">{formatCount(d.picks ?? 0)} picks</span>
                  </span>
                </button>
              );
            })}
          </div>
          {current && (
            <div className="k-card h-fit p-5">
              <div className="mb-4 flex items-start gap-3">
                <Mark kind="object" id={`${current.brandId}:${current.dynasty}`} size={40} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[18px] font-medium">{head(current).name}</h2>
                  <p className="k-fg3 text-[12px]">
                    {brandName(current.brandId)}
                    {current.parentDynasty ? `, forked from ${head(all.find((x) => x.dynasty === current.parentDynasty) ?? current).name}` : ""}, {formatRatePct(current.share ?? null)} of picks this week
                  </p>
                </div>
                <button type="button" className="k-btn" onClick={() => setEditor({ mode: "fork", dynasty: current })}>
                  Fork
                </button>
              </div>
              <VersionEditor
                key={`${keyOf(current)}|${current.versions.length}`}
                versions={current.versions}
                contentType={out?.contentType}
                madeBy={current.producer?.name ?? null}
                onSave={async (content) => {
                  const body: ApiNewObjectVersion = { outcome: pin.id, name: head(current).name, content, dynasty: current.dynasty };
                  await apiSend("POST", "/objects", body);
                }}
              />
            </div>
          )}
        </div>
      )}
      {editor && <ObjectEditor outcome={pin.id} mode={editor.mode} dynasty={editor.dynasty} onClose={() => setEditor(null)} />}
    </>
  );
}

/** Read, edit and compare the versions of one dynasty. Saving an edit makes a new version: the picks keep the dynasty and serve its new head from the next run. */
function VersionEditor({ versions, contentType, madeBy, onSave }: { versions: ApiObjectVersion[]; contentType: string | undefined; madeBy: string | null; onSave: (content: string) => Promise<void> }) {
  const head = versions.find((v) => v.head) ?? versions[versions.length - 1]!;
  const [mode, setMode] = useState<"read" | "edit" | "compare">("read");
  const [draft, setDraft] = useState(head.content);
  const [left, setLeft] = useState(Math.max(0, versions.length - 2));
  const [right, setRight] = useState(versions.length - 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const vars = contentType === "text_with_variables" ? variablesOf(mode === "edit" ? draft : head.content) : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={`k-chip ${mode === "read" ? "k-chip-on" : ""}`} onClick={() => setMode("read")}>
          Read v{head.version}
        </button>
        <button
          type="button"
          className={`k-chip ${mode === "edit" ? "k-chip-on" : ""}`}
          onClick={() => {
            setDraft(head.content);
            setMode("edit");
          }}
        >
          Edit
        </button>
        {versions.length > 1 && (
          <button type="button" className={`k-chip ${mode === "compare" ? "k-chip-on" : ""}`} onClick={() => setMode("compare")}>
            Compare versions
          </button>
        )}
        <span className="k-fg3 ml-auto text-[12px]">
          {plural(versions.length, "version", "versions")}
          {madeBy ? `, made by ${madeBy}` : ""}
        </span>
      </div>
      {mode === "read" && <ContentView text={head.content} contentType={contentType} />}
      {mode === "edit" && (
        <div className="space-y-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} className="k-input w-full resize-y py-2 leading-6" style={{ font: "inherit", height: "auto" }} aria-label="New version" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="k-btn-strong"
              disabled={busy || !draft.trim() || draft === head.content}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onSave(draft);
                  setMode("read");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save as v{head.version + 1}
            </button>
            <button type="button" className="k-btn-ghost" onClick={() => setMode("read")}>
              Cancel
            </button>
            {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
          </div>
          {draft !== head.content && <VersionDiff from={head.content} to={draft} />}
        </div>
      )}
      {mode === "compare" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            <VersionPick versions={versions} value={left} onChange={setLeft} />
            <span className="k-fg3">to</span>
            <VersionPick versions={versions} value={right} onChange={setRight} />
          </div>
          <VersionDiff from={versions[left]?.content ?? ""} to={versions[right]?.content ?? ""} />
        </div>
      )}
      {vars.length > 0 && <p className="k-fg3 text-[12px]">Variables: {vars.map((v) => `{{${v}}}`).join(", ")}</p>}
    </div>
  );
}

function VersionPick({ versions, value, onChange }: { versions: ApiObjectVersion[]; value: number; onChange: (i: number) => void }) {
  return (
    <select className="k-input px-1.5" style={{ font: "inherit" }} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Version">
      {versions.map((v, i) => (
        <option key={v.id} value={i}>
          v{v.version}, {formatTime(v.createdAt)}
        </option>
      ))}
    </select>
  );
}

/** One renderer per content type: a text with variables shows them as chips in the flow of the text. */
function ContentView({ text, contentType }: { text: string; contentType: string | undefined }) {
  if (contentType === "text_with_variables") {
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
  if (contentType === "list")
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
  return <p className="whitespace-pre-wrap text-[14px] leading-6">{text}</p>;
}

/** A word diff of two versions: removed words struck in rose, added words in green. */
function VersionDiff({ from, to }: { from: string; to: string }) {
  const parts = useMemo(() => diffWords(from, to), [from, to]);
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-7" data-testid="version-diff">
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

function ObjectEditor({ outcome, mode, dynasty, onClose }: { outcome: string; mode: "fork" | "new"; dynasty: ApiObjectDynasty | null; onClose: () => void }) {
  const { data: o } = useOverview();
  const head = dynasty?.versions.find((v) => v.head) ?? dynasty?.versions[dynasty.versions.length - 1];
  const [name, setName] = useState(mode === "fork" && head ? `${head.name}, fork` : "");
  const [content, setContent] = useState(head?.content ?? "");
  const [brandId, setBrandId] = useState<string>(dynasty?.brandId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const body: ApiNewObjectVersion = { outcome, name: name.trim(), content, brandId: brandId || null };
    if (mode === "fork" && dynasty) body.parentDynasty = dynasty.dynasty;
    try {
      await apiSend("POST", "/objects", body);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Drawer title={mode === "fork" ? "Fork into a new dynasty" : "New dynasty"} onClose={onClose} width={620}>
      <div className="space-y-4">
        <p className="k-fg2 text-[13px]">{mode === "fork" ? "A new dynasty that competes with its parent. It starts from the parent's belief." : "A new dynasty that competes with the others wherever it is offered."} Variables are written {"{{like_this}}"}.</p>
        <Field label="Name">
          <input className="k-input w-full" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Brand">
          <select className="k-input w-full px-1.5" style={{ font: "inherit" }} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">Every brand</option>
            {o?.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={outcomeName(o?.catalogue, outcome)}>
          <textarea className="k-input w-full py-2 text-[13px]" style={{ height: "auto", minHeight: 240 }} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        {error && <p className="text-[13px] text-[var(--data-rose)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="k-btn-strong" disabled={busy || !name.trim() || !content.trim()} onClick={save}>
            {busy ? "Saving" : "Create"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Its Engine: its scripts, the outcomes each one's code calls, who calls it, its storage
// ---------------------------------------------------------------------------

function EnginePage({ pin, catalogue, spaced }: { pin: Pin; catalogue: CatalogueData | undefined; spaced: boolean }) {
  const scripts = useApi<ApiScriptStats[]>(`/scripts?outcome=${encodeURIComponent(pin.id)}`);
  const research = useApi<ApiCandidates[]>("/research");
  const storage = useApi<ApiStorage>(`/storage/${encodeURIComponent(pin.id)}`, 0);
  const [open, setOpen] = useState<string | null>(null);
  const all = scripts.data ?? [];
  const heads = headsOf(all).filter((s) => s.status === "active");
  const callers = callersOf(research.data, catalogue, pin.id);
  const title = engineTitle(catalogue, pin.id);
  return (
    <div className={spaced ? "mt-10" : ""}>
      <PageHeader title={<>{plural(heads.length, "script competes", "scripts compete")} in the {title} Engine</>} sub={engineLine(catalogue, pin.id)} />
      <section className="mb-8">
        <SectionTitle count={heads.length} right={<span>Each script&apos;s code calls the Providers it needs, one outcome per line.</span>}>
          What each script calls
        </SectionTitle>
        <div className="space-y-3">
          {heads.map((s) => (
            <div key={s.dynasty}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
                <Mark kind="script" id={s.dynasty} size={16} />
                {s.name}
              </p>
              <ScriptCalls s={s} catalogue={catalogue} points={research.data} />
            </div>
          ))}
          {scripts.answered && heads.length === 0 && <EmptyNote>No script yet.</EmptyNote>}
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle count={heads.length}>Scripts</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {heads.map((s) => (
            <ScriptTile key={s.dynasty} s={s} versions={all.filter((x) => x.dynasty === s.dynasty)} catalogue={catalogue} onClick={() => setOpen(s.dynasty)} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle count={callers.length} right={<span>The pick lives on the Material: each caller has its own best script.</span>}>
          Who calls it
        </SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Caller</th>
              <th className={TH}>Best script there</th>
              <th className={`${TH} text-right`}>Chance to be the best</th>
              <th className={`${TH} text-right`}>Picks</th>
            </tr>
          </thead>
          <tbody>
            {callers.map((c) => (
              <tr key={c.point} className="k-row k-line-subtle border-b">
                <td className={TD}>
                  <Link href={researchHref(c.point)} className="hover:underline">
                    {c.label}
                  </Link>
                </td>
                <td className={TD}>{c.best ? c.best.label : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{c.best ? formatRatePct(c.best.chance) : <span className="k-fg4">—</span>}</td>
                <td className={TDN}>{formatCount(c.picks)}</td>
              </tr>
            ))}
            {callers.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyNote>No Engine picked among its scripts yet.</EmptyNote>
                </td>
              </tr>
            )}
          </tbody>
        </CardTable>
      </section>

      <section>
        <SectionTitle right={<span>Only this Engine&apos;s scripts read and write it.</span>}>Storage</SectionTitle>
        <StorageList storage={storage.data} />
      </section>
      {open && <ScriptDrawer dynasty={open} catalogue={catalogue} onClose={() => setOpen(null)} />}
    </div>
  );
}
