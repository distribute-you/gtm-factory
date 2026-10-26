"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PushPinIcon, PushPinSlashIcon } from "@phosphor-icons/react";
import { BillOfMaterials, ProviderLogo, ScriptCard, VersionEditor } from "@/components/catalogue-bits";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TDN, TH, TopBar } from "@/components/ui";
import { PageSkeleton } from "./today";
import { headScript, outcomeLabel, pipeLine, type Model } from "@/lib/model";
import { FunnelLine } from "@/components/funnel-line";
import { linePipes, namedLine } from "@/lib/funnels";
import { pinnedPage, type PinnedPage as PageData } from "@/lib/pinned";
import { parsePin, pinHref, pinKey, togglePin, type Pin } from "@/lib/pins";
import { formatCount, formatRatePct, plural } from "@/lib/format";
import { useSim } from "@/lib/sim";

/** The page of a pinned outcome or pipe: the same code for every pin. */
export function PinnedPage() {
  const { model, scope, pins } = useSim();
  const key = useSearchParams().get("pin");
  const pin = parsePin(key, pins);
  return (
    <>
      <TopBar crumbs={[{ label: "Pinned" }, { label: pin?.label ?? "Unknown pin" }]} actions={pin ? <PinButton pin={pin} /> : undefined} />
      <Page>{model ? pin ? <Pinned model={model} pin={pin} scope={scope} /> : <EmptyNote>Nothing is pinned under this address.</EmptyNote> : <PageSkeleton />}</Page>
    </>
  );
}

function PinButton({ pin }: { pin: Pin }) {
  const { pins, setPins } = useSim();
  const on = pins.some((p) => pinKey(p) === pinKey(pin));
  return (
    <button type="button" className="k-btn" onClick={() => setPins(togglePin(pins, pin))}>
      {on ? <PushPinSlashIcon size={13} /> : <PushPinIcon size={13} />}
      {on ? "Unpin" : "Pin to the menu"}
    </button>
  );
}

function Pinned({ model, pin, scope }: { model: Model; pin: Pin; scope: string | null }) {
  const data = useMemo(() => pinnedPage(model, pin, scope), [model, pin, scope]);
  if (data.kind === "missing") return <EmptyNote>The catalogue has no {pin.kind} with this id any more.</EmptyNote>;
  if (data.kind === "path") return <PathPage model={model} data={data} />;
  if (data.kind === "funnel") return <FunnelPage model={model} data={data} />;
  return data.kind === "outcome" ? <OutcomePage model={model} data={data} /> : <PipePage model={model} data={data} />;
}

// ---------------------------------------------------------------------------
// An outcome: its dynasties, each with its versions (read, edit, compare)
// ---------------------------------------------------------------------------

function OutcomePage({ model, data }: { model: Model; data: Extract<PageData, { kind: "outcome" }> }) {
  const { dispatch } = useSim();
  const [selected, setSelected] = useState<string | null>(null);
  const keyOf = (d: { brandId: string; dynasty: string }) => `${d.brandId}|${d.dynasty}`;
  const current = data.dynasties.find((d) => keyOf(d) === selected) ?? data.dynasties[0];
  const brandName = (id: string) => model.clients.find((c) => c.brand.id === id)?.brand.name ?? id;
  return (
    <>
      <PageHeader
        title={<>{plural(data.dynasties.length, "dynasty", "dynasties")} of {data.title.toLowerCase()}</>}
        sub={data.description ?? "Each dynasty competes at the Materials that consume it; an edit is a new version of the same dynasty."}
      />
      {data.dynasties.length === 0 ? (
        <div className="k-card">
          <EmptyNote>No Unit of this outcome yet.</EmptyNote>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="k-card h-fit divide-y divide-[var(--line-subtle)]">
            {data.dynasties.map((d) => {
              const on = current && keyOf(d) === keyOf(current);
              return (
                <button key={keyOf(d)} type="button" onClick={() => setSelected(keyOf(d))} className={`k-hover flex w-full items-center gap-3 px-4 py-3 text-left first:rounded-t-[12px] last:rounded-b-[12px] ${on ? "k-selected" : ""}`}>
                  <Mark kind="object" id={`${d.brandId}:${d.dynasty}`} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{d.name}</span>
                    <span className="k-fg3 block truncate text-[12px]">
                      {brandName(d.brandId)} · v{d.head.version}
                      {d.versions.length > 1 ? ` of ${d.versions.length}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] tabular-nums">{formatRatePct(d.share)}</span>
                    <span className="k-fg3 block text-[11px] tabular-nums">{formatCount(d.picks)} picks</span>
                  </span>
                </button>
              );
            })}
          </div>
          {current && (
            <div className="k-card h-fit p-5">
              <div className="mb-4 flex items-start gap-3">
                <Mark kind="object" id={`${current.brandId}:${current.dynasty}`} size={40} />
                <div className="min-w-0">
                  <h2 className="text-[18px] font-medium">{current.name}</h2>
                  <p className="k-fg3 text-[12px]">
                    {brandName(current.brandId)}
                    {current.parentDynasty ? ` · forked from ${data.dynasties.find((x) => x.brandId === current.brandId && x.dynasty === current.parentDynasty)?.name ?? current.parentDynasty}` : ""} · {formatRatePct(current.share)} of picks this week
                  </p>
                </div>
              </div>
              <VersionEditor
                key={`${keyOf(current)}|${current.versions.length}`}
                model={model}
                versions={current.versions}
                type={data.contentType}
                onSave={(text) => dispatch({ type: "objectVersion", brandId: current.brandId, outcome: data.id, dynasty: current.dynasty, text })}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A pipe: its scripts, where it is plugged, its pipe storage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A sales path: its named funnels, and who runs each today
// ---------------------------------------------------------------------------

function PathPage({ model, data }: { model: Model; data: Extract<PageData, { kind: "path" }> }) {
  const running = data.funnels.reduce((n, f) => n + f.campaigns.length, 0);
  return (
    <>
      <PageHeader title={data.title} sub={`A sales path: a straight line of lead states. ${plural(data.funnels.length, "sales funnel plays it", "sales funnels play it")}, ${plural(running, "campaign runs", "campaigns run")} one today.`} />
      <div className="k-card mb-6 px-4 py-3">
        <p className="k-label mb-1.5">Lead states</p>
        <p className="text-[13px]">{[data.path.start, ...data.path.line].map((o) => outcomeLabel(model.catalogue, o)).join(" → ")}</p>
      </div>
      <SectionTitle count={data.funnels.length}>Sales funnels</SectionTitle>
      <div className="k-card divide-y divide-[var(--line-subtle)]">
        {data.funnels.map(({ funnel, campaigns }) => (
          <div key={funnel.id} className="px-4 py-3">
            <Link href={pinHref({ kind: "funnel", id: funnel.id })} className="inline-flex items-center gap-2 text-[13px] font-medium hover:underline">
              <Mark kind="funnel" id={funnel.id} size={20} />
              {funnel.name}
            </Link>
            <div className="mt-1.5">
              <FunnelLine model={model} line={namedLine(model, funnel)} />
            </div>
            <p className="k-fg3 mt-1 text-[12px]">{campaigns.length > 0 ? `Run today by ${campaigns.map((c) => c.name).join(", ")}` : "No campaign runs it today."}</p>
          </div>
        ))}
        {data.funnels.length === 0 && <EmptyNote>No sales funnel has played this path yet.</EmptyNote>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// A sales funnel: its line, every pipe it runs through, who runs it
// ---------------------------------------------------------------------------

function FunnelPage({ model, data }: { model: Model; data: Extract<PageData, { kind: "funnel" }> }) {
  const line = namedLine(model, data.funnel);
  const pipes = line ? linePipes(line) : [];
  return (
    <>
      <PageHeader title={data.title} sub={data.path ? `A sales funnel: the path ${data.path.name.toLowerCase()}, one play per leg.` : "A sales funnel."} />
      <div className="k-card mb-6 px-4 py-3">
        <p className="k-label mb-1.5">Sales funnel</p>
        <FunnelLine model={model} line={line} size="md" />
      </div>
      <SectionTitle count={pipes.length}>Pipes it runs through</SectionTitle>
      <div className="k-card mb-6 divide-y divide-[var(--line-subtle)]">
        {pipes.map((p) => (
          <div key={p.id} className="flex items-center gap-2.5 px-4 py-2.5">
            <Mark kind="pipe" id={p.id} icon={p.icon} size={22} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{p.name}</span>
              <span className="k-fg3 block truncate text-[12px]">{pipeLine(model.catalogue, p)}</span>
            </span>
          </div>
        ))}
      </div>
      <SectionTitle count={data.campaigns.length}>Campaigns running it today</SectionTitle>
      <div className="k-card divide-y divide-[var(--line-subtle)]">
        {data.campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`} className="block px-4 py-2.5 text-[13px] hover:underline">
            {c.name}
          </Link>
        ))}
        {data.campaigns.length === 0 && <EmptyNote>No campaign runs it today.</EmptyNote>}
      </div>
    </>
  );
}

function PipePage({ model, data }: { model: Model; data: Extract<PageData, { kind: "pipe" }> }) {
  const pipe = model.catalogue.pipe(data.id)!;
  return (
    <>
      <PageHeader
        title={<>{plural(data.dynasties.length, "script competes", "scripts compete")} on {data.title}</>}
        sub={data.description ?? data.line}
        right={<span className="k-fg3">{data.line}</span>}
      />
      <section className="mb-8">
        <SectionTitle count={pipe.materials.length} right={<span>What it consumes per Unit produced, one Material per line.</span>}>Bill of materials</SectionTitle>
        <BillOfMaterials model={model} pipe={pipe} />
      </section>

      <section className="mb-8">
        <SectionTitle count={data.dynasties.length}>Scripts</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.dynasties.map((d) => (
            <ScriptCard key={d} model={model} dynasty={d} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle count={data.plugged.length} right={<span>The choice lives on the Material: each one has its own best script.</span>}>
          Where it is plugged
        </SectionTitle>
        <CardTable>
          <thead>
            <tr className="k-line-subtle border-b">
              <th className={TH}>Material</th>
              <th className={TH}>Best script there</th>
              <th className={`${TH} text-right`}>Picks</th>
            </tr>
          </thead>
          <tbody>
            {data.plugged.map((p) => {
              const best = p.bestScript ? headScript(model.catalogue, p.bestScript) : undefined;
              return (
                <tr key={p.point} className="k-row k-line-subtle border-b">
                  <td className={TD}>
                    <Link href={`/research/?point=${encodeURIComponent(p.point)}`} className="hover:underline">
                      {p.info.title}
                    </Link>
                  </td>
                  <td className={TD}>
                    {best ? (
                      <span className="flex items-center gap-2">
                        <ProviderLogo script={best} size={20} />
                        {best.name}
                      </span>
                    ) : (
                      <span className="k-fg4">—</span>
                    )}
                  </td>
                  <td className={TDN}>{formatCount(p.picks)}</td>
                </tr>
              );
            })}
            {data.plugged.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <EmptyNote>{"No pipe has chosen this pipe's scripts at a Material yet."}</EmptyNote>
                </td>
              </tr>
            )}
          </tbody>
        </CardTable>
      </section>

      <section>
        <SectionTitle right={<span>Only this pipe's scripts read and write it.</span>}>Pipe storage</SectionTitle>
        {data.storage.tables.length === 0 ? (
          <div className="k-card">
            <EmptyNote>Its scripts keep nothing yet.</EmptyNote>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.storage.tables.map((t) => (
              <div key={t.name} className="k-card p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="k-mono text-[13px]">{t.name}</span>
                  <span className="k-fg3 text-[12px] tabular-nums">{plural(t.rows, "row", "rows")}</span>
                </div>
                <ul className="space-y-1">
                  {t.sample.map((r) => (
                    <li key={r.key} className="flex gap-3 text-[12px]">
                      <span className="k-mono k-fg2 min-w-0 flex-1 truncate">{r.key}</span>
                      <span className="k-mono k-fg3 truncate">{JSON.stringify(r.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
