"use client";

import { useState } from "react";
import type { ApiNewObjectVersion, ApiObjectDynasty, ApiObjectVersion, ApiScriptStats } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { Drawer, EmptyNote, Page, PageHeader, TD, TDN, TH, ToneDot, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { engineLine, engineTitle, outcomeName, performerTitle } from "@/lib/api/labels";
import { useSearchParams } from "next/navigation";
import type { Pin } from "@gtm-factory/core";
import { formatCents, formatCount, formatRatePct, plural } from "@/lib/format";
import { Field, Read, ShimmerRows, formatTime } from "./common";

/** A pinned page: a brand outcome lists its Unit dynasties, any other outcome its Engine's scripts. Pins are served as data. */
export function ApiPinnedPage() {
  const key = useSearchParams().get("pin") ?? "";
  const { data: o, answered } = useOverview();
  const pin = o?.pins?.find((p) => `${p.kind}:${p.id}` === key) ?? null;
  if (!answered) return <Page><ShimmerRows /></Page>;
  if (!pin) {
    return (
      <>
        <TopBar crumbs={[{ label: "Pinned" }]} />
        <Page>
          <div className="k-card">
            <EmptyNote>This pin is not served here.</EmptyNote>
          </div>
        </Page>
      </>
    );
  }
  const brandOutcome = o?.catalogue.outcomes.find((x) => x.id === pin.id)?.subject === "brand";
  return brandOutcome ? <ObjectsPage pin={pin} /> : <ScriptsPage pin={pin} />;
}

// ---------------------------------------------------------------------------
// An outcome pin: the dynasties of its object Units (templates, ICPs...)
// ---------------------------------------------------------------------------

function ObjectsPage({ pin }: { pin: Pin }) {
  const { data: o } = useOverview();
  const outcome: string | null = pin.id;
  const read = useApi<ApiObjectDynasty[]>(outcome ? `/objects?outcome=${encodeURIComponent(outcome)}` : null);
  const [open, setOpen] = useState<{ dynasty: ApiObjectDynasty; version: ApiObjectVersion } | null>(null);
  const [editor, setEditor] = useState<{ mode: "upgrade" | "fork" | "new"; dynasty: ApiObjectDynasty | null } | null>(null);
  const brandName = (id: string | null) => (id ? o?.brands.find((b) => b.id === id)?.name ?? "" : "Every brand");
  return (
    <>
      <TopBar crumbs={[{ label: pin.label }]} actions={<button type="button" className="k-btn-strong" onClick={() => setEditor({ mode: "new", dynasty: null })}>New dynasty</button>} />
      <Page>
        {(
          <Read read={read}>
            {(dynasties) => (
              <>
                <PageHeader title={`${formatCount(dynasties.length)} ${pin.label.toLowerCase()}`} sub="Each one is a dynasty of versions. Editing makes a new version; forking starts a new dynasty from its belief." />
                {dynasties.length === 0 ? (
                  <div className="k-card">
                    <EmptyNote>Nothing here yet.</EmptyNote>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {dynasties.map((d) => {
                      const head = d.versions.find((v) => v.head) ?? d.versions[d.versions.length - 1];
                      return (
                        <div key={d.dynasty} className="k-card p-4">
                          <div className="flex flex-wrap items-start gap-3">
                            <Mark kind="object" id={d.dynasty} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[14px] font-medium">{head?.name ?? d.dynasty}</span>
                                <span className="k-chip">v{head?.version ?? 1}</span>
                                <span className="k-chip">{brandName(d.brandId)}</span>
                                {d.parentDynasty && <span className="k-chip">Fork</span>}
                                {d.retired && <ToneDot tone="muted">Retired</ToneDot>}
                              </div>
                              {head && <p className="k-fg2 mt-1 line-clamp-2 whitespace-pre-wrap text-[12px]">{head.content}</p>}
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button type="button" className="k-btn" onClick={() => setEditor({ mode: "upgrade", dynasty: d })}>
                                Edit
                              </button>
                              <button type="button" className="k-btn" onClick={() => setEditor({ mode: "fork", dynasty: d })}>
                                Fork
                              </button>
                            </div>
                          </div>
                          {d.stats.length > 0 && (
                            <div className="k-inset mt-3 grid gap-px overflow-hidden rounded-[8px] sm:grid-cols-2 lg:grid-cols-3">
                              {d.stats.map((s) => (
                                <div key={s.place} className="px-3 py-2 text-[12px]">
                                  <span className="k-label block truncate">{s.placeLabel}</span>
                                  <span className="mt-0.5 block tabular-nums">
                                    {formatRatePct(s.rateMean)} reach the next milestone · {formatCount(s.successes)} of {formatCount(s.picks)} picks
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {d.versions.map((v) => (
                              <button key={v.id} type="button" className="k-chip hover:bg-[var(--bg-hover)]" onClick={() => setOpen({ dynasty: d, version: v })}>
                                v{v.version}
                                {v.head ? " (runs now)" : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Read>
        )}
      </Page>
      {open && (
        <Drawer title={`Version ${open.version.version}`} onClose={() => setOpen(null)} width={560}>
          <p className="text-[14px] font-medium">{open.version.name}</p>
          <p className="k-fg3 mt-0.5 text-[12px]">
            {formatTime(open.version.createdAt)}
            {open.version.head ? " · runs now" : ""}
          </p>
          <pre className="k-inset k-mono mt-3 whitespace-pre-wrap rounded-[8px] p-3 text-[12px]">{open.version.content}</pre>
        </Drawer>
      )}
      {editor && <TemplateEditor outcome={outcome} mode={editor.mode} dynasty={editor.dynasty} onClose={() => setEditor(null)} />}
    </>
  );
}

function TemplateEditor({ outcome, mode, dynasty, onClose }: { outcome: string; mode: "upgrade" | "fork" | "new"; dynasty: ApiObjectDynasty | null; onClose: () => void }) {
  const { data: o } = useOverview();
  const head = dynasty?.versions.find((v) => v.head) ?? dynasty?.versions[dynasty.versions.length - 1];
  const [name, setName] = useState(mode === "fork" && head ? `${head.name} (fork)` : head?.name ?? "");
  const [content, setContent] = useState(head?.content ?? "");
  const [brandId, setBrandId] = useState<string>(dynasty?.brandId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = mode === "upgrade" ? "New version" : mode === "fork" ? "Fork into a new dynasty" : "New dynasty";
  const save = async () => {
    setBusy(true);
    setError(null);
    const body: ApiNewObjectVersion = { outcome, name: name.trim(), content };
    if (mode === "upgrade" && dynasty) body.dynasty = dynasty.dynasty;
    if (mode === "fork" && dynasty) body.parentDynasty = dynasty.dynasty;
    if (mode !== "upgrade") body.brandId = brandId || null;
    try {
      await apiSend("POST", "/objects", body);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Drawer title={title} onClose={onClose} width={620}>
      <div className="space-y-4">
        <p className="k-fg2 text-[13px]">
          {mode === "upgrade"
            ? "The new version runs from now on. The dynasty keeps its history and its belief."
            : mode === "fork"
              ? "A new dynasty that competes with its parent. It starts from the parent's belief."
              : "A new dynasty that competes with the others at every Material it is offered."}{" "}
          Variables are written {"{{like_this}}"}.
        </p>
        <Field label="Name">
          <input className="k-input w-full" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {mode !== "upgrade" && (
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
        )}
        <Field label={outcomeName(o?.catalogue, outcome)}>
          <textarea className="k-input k-mono w-full py-2 text-[12px]" style={{ height: "auto", minHeight: 320 }} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        {error && <p className="text-[13px] text-[var(--data-rose)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="k-btn-strong" disabled={busy || !name.trim() || !content.trim()} onClick={save}>
            {busy ? "Saving" : mode === "upgrade" ? "Save the new version" : "Create"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Any other outcome: the scripts competing in its Engine (LLMs...)
// ---------------------------------------------------------------------------

function ScriptsPage({ pin }: { pin: Pin }) {
  const { data: o } = useOverview();
  const read = useApi<ApiScriptStats[]>(`/scripts?outcome=${encodeURIComponent(pin.id)}`);
  return (
    <>
      <TopBar crumbs={[{ label: pin.label }]} />
      <Page>
        {(
          <Read read={read}>
            {(scripts) => (
              <>
                <PageHeader title={`${plural(scripts.length, "script", "scripts")} of the ${engineTitle(o?.catalogue, pin.id)} Engine`} sub={`Scripts compete in this Engine. ${engineLine(o?.catalogue, pin.id)}: each caller picks its own best one.`} />
                {scripts.length === 0 ? (
                  <div className="k-card">
                    <EmptyNote>No script yet.</EmptyNote>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {scripts.map((s) => (
                      <ScriptCard key={s.id} s={s} catalogue={o?.catalogue} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Read>
        )}
      </Page>
    </>
  );
}

/** A script of an Engine: its figures, who performs it, its code file, what its code calls, and where it competes. */
export function ScriptCard({ s, catalogue }: { s: ApiScriptStats; catalogue?: import("@gtm-factory/core").CatalogueData }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/scripts/${encodeURIComponent(s.id)}/${s.status === "active" ? "retire" : "restore"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="k-card overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <Mark kind={`script:${s.kind}`} id={s.dynasty} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">{s.name}</span>
            <span className="k-chip">v{s.version}</span>
            {s.provider && <span className="k-chip">{s.provider}</span>}
            {Object.entries(s.tactics).map(([k, v]) => (
              <span key={k} className="k-chip">
                {k}: {String(v)}
              </span>
            ))}
          </div>
          <p className="k-fg3 mt-1 text-[12px] tabular-nums">
            {formatCount(s.runs)} runs · {formatCents(s.spentCents)} spent · {formatCents(s.costCentsPrior)} expected per run · performed by {performerTitle(s.performedBy)}
          </p>
          <p className="k-fg3 mt-0.5 font-mono text-[12px]">scripts/src/{s.code}.ts</p>
          <p className="k-fg2 mt-1 text-[12px]">
            {s.materials.length > 0 ? `Calls ${s.materials.map((m) => outcomeName(catalogue, m)).join(", ")}` : "Calls nothing"}
            <span className="k-fg3"> · {s.materialsLabel === "measured" ? "measured on its runs" : "read from its code"}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button type="button" className="k-btn" disabled={busy} onClick={toggle}>
            {s.status === "active" ? <ToneDot tone="run">Active</ToneDot> : <ToneDot tone="muted">Retired</ToneDot>}
            <span className="k-fg3">{s.status === "active" ? "Retire" : "Restore"}</span>
          </button>
          {error && <span className="text-[12px] text-[var(--data-rose)]">{error}</span>}
        </div>
      </div>
      {s.places.length > 0 && (
        <div className="k-scroll overflow-x-auto"><table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="k-line-subtle border-b border-t">
              <th className={`${TH} w-full`}>Material</th>
              <th className={`${TH} text-right`}>Rate</th>
              <th className={`${TH} text-right`}>Cost to next milestone</th>
              <th className={`${TH} text-right`}>Picks</th>
              <th className={`${TH} text-right`}>Reached</th>
            </tr>
          </thead>
          <tbody>
            {s.places.map((p) => (
              <tr key={p.place} className="k-row k-line-subtle border-b last:border-b-0">
                <td className={TD}>{p.placeLabel}</td>
                <td className={TDN}>{formatRatePct(p.rateMean)}</td>
                <td className={TDN}>{formatCents(p.costMeanCents)}</td>
                <td className={TDN}>{formatCount(p.picks)}</td>
                <td className={TDN}>{formatCount(p.successes)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
