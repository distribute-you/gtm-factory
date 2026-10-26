"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ApiChoice, ApiLead, ApiLeadDetail, ApiOccurrence, CatalogueData } from "@gtm-factory/engine";
import { Initials, CardTable, EmptyNote, Page, PageHeader, SectionTitle, TD, TH, ToneDot, TopBar } from "@/components/ui";
import { Mark } from "@/components/mark";
import { apiSend, useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { factoryTitle, outcomeName } from "@/lib/api/labels";
import { plural } from "@/lib/format";
import { ChoicesTable, Read, RunsTable, formatTime, timeAgo } from "./common";

export function ApiLeadsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const campaign = search.get("campaign") ?? "";
  const state = search.get("state") ?? "";
  const qs = new URLSearchParams();
  if (campaign) qs.set("campaignId", campaign);
  if (state) qs.set("state", state);
  const read = useApi<ApiLead[]>(`/leads${qs.toString() ? `?${qs}` : ""}`);
  const { data: o } = useFactory();
  const setFilter = (key: "campaign" | "state", value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/leads/${next.toString() ? `?${next}` : ""}`);
  };
  const leadStates = o?.catalogue.outcomes.filter((x) => x.subject === "lead" && !x.retired) ?? [];
  const campaignName = (id: string | null) => (id ? o?.campaigns.find((c) => c.id === id)?.name ?? "" : "");
  return (
    <>
      <TopBar crumbs={[{ label: "Leads" }]} />
      <Page>
        <PageHeader title={read.data ? plural(read.data.length, "lead", "leads") : "Leads"} sub="Every person a campaign found, and the furthest outcome each one reached." />
        <div className="mb-4 flex flex-wrap gap-2">
          <select aria-label="Campaign" className="k-input px-1.5" style={{ font: "inherit" }} value={campaign} onChange={(e) => setFilter("campaign", e.target.value)}>
            <option value="">Every campaign</option>
            {o?.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="State" className="k-input px-1.5" style={{ font: "inherit" }} value={state} onChange={(e) => setFilter("state", e.target.value)}>
            <option value="">Every state</option>
            {leadStates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <Read read={read} rows={10}>
          {(leads) =>
            leads.length === 0 ? (
              <div className="k-card">
                <EmptyNote>No lead here yet.</EmptyNote>
              </div>
            ) : (
              <CardTable footer={plural(leads.length, "lead", "leads")}>
                <thead>
                  <tr className="k-line-subtle border-b">
                    <th className={TH}>Name</th>
                    <th className={TH}>Email</th>
                    <th className={`${TH} w-full`}>Company</th>
                    <th className={TH}>State</th>
                    <th className={TH}>Campaign</th>
                    <th className={`${TH} text-right`}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="k-row k-line-subtle h-10 border-b last:border-b-0">
                      <td className={TD}>
                        <Link href={`/leads/view/?id=${encodeURIComponent(l.id)}`} className="flex items-center gap-2 whitespace-nowrap font-medium">
                          <Initials name={l.name || l.email || "?"} />
                          {l.name || <span className="k-fg4">—</span>}
                        </Link>
                      </td>
                      <td className={`${TD} k-fg2 whitespace-nowrap`}>{l.email ?? <span className="k-fg4">—</span>}</td>
                      <td className={`${TD} k-fg2`}>
                        {l.company ?? <span className="k-fg4">—</span>}
                        {l.title && <span className="k-fg3 ml-1.5 text-[12px]">{l.title}</span>}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <StateWord outcome={l.state} catalogue={o?.catalogue} />
                      </td>
                      <td className={`${TD} k-fg2 whitespace-nowrap`}>{campaignName(l.campaignId) || <span className="k-fg4">—</span>}</td>
                      <td className={`${TD} k-fg2 whitespace-nowrap text-right text-[12px]`}>{timeAgo(l.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            )
          }
        </Read>
      </Page>
    </>
  );
}

/** A lead state: a lead track state wears the run tone, any other outcome the muted one. */
function StateWord({ outcome, catalogue }: { outcome: string; catalogue: CatalogueData | undefined }) {
  const o = catalogue?.outcomes.find((x) => x.id === outcome);
  const tone = o?.track ? "run" : "muted";
  return <ToneDot tone={tone}>{outcomeName(catalogue, outcome)}</ToneDot>;
}

export function ApiLeadPage() {
  const id = useSearchParams().get("id");
  const read = useApi<ApiLeadDetail>(id ? `/leads/${encodeURIComponent(id)}` : null);
  const { data: o } = useFactory();
  return (
    <>
      <TopBar crumbs={[{ label: "Leads", href: "/leads/" }, { label: read.data?.lead.name || read.data?.lead.email || "Lead" }]} />
      <Page>
        {!id ? (
          <EmptyNote>No lead in the address.</EmptyNote>
        ) : (
          <Read read={read} rows={8}>
            {(d) => <Lead d={d} catalogue={o?.catalogue} campaignName={o?.campaigns.find((c) => c.id === d.lead.campaignId)?.name ?? null} />}
          </Read>
        )}
      </Page>
    </>
  );
}

function Lead({ d, catalogue, campaignName }: { d: ApiLeadDetail; catalogue: CatalogueData | undefined; campaignName: string | null }) {
  const l = d.lead;
  const paid = l.reached.includes("paid_client");
  const choiceById = new Map(d.choices.map((c) => [c.id, c]));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-start gap-3">
          <Initials name={l.name || l.email || "?"} size={40} round />
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.02em]">{l.name || l.email}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StateWord outcome={l.state} catalogue={catalogue} />
              {l.reached.filter((r) => r !== l.state).map((r) => (
                <span key={r} className="k-chip">
                  {outcomeName(catalogue, r)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <section>
          <SectionTitle count={d.occurrences.length}>Timeline</SectionTitle>
          {d.occurrences.length === 0 ? (
            <div className="k-card">
              <EmptyNote>Nothing reached yet.</EmptyNote>
            </div>
          ) : (
            <ol className="space-y-2">
              {d.occurrences.map((oc) => (
                <OccurrenceCard key={oc.id} oc={oc} catalogue={catalogue} choiceById={choiceById} />
              ))}
            </ol>
          )}
        </section>

        <section className="mt-8">
          <SectionTitle count={d.choices.length}>Choices made for this lead</SectionTitle>
          <ChoicesTable choices={d.choices} />
        </section>

        <section className="mt-8">
          <SectionTitle count={d.runs.length}>Runs</SectionTitle>
          <RunsTable runs={d.runs} catalogue={catalogue} />
        </section>
      </div>

      <aside className="k-card h-fit p-4">
        <dl className="space-y-3 text-[13px]">
          <Row label="Email">{l.email ?? <span className="k-fg4">—</span>}</Row>
          <Row label="Company">{l.company ?? <span className="k-fg4">—</span>}</Row>
          <Row label="Title">{l.title ?? <span className="k-fg4">—</span>}</Row>
          <Row label="Campaign">
            {l.campaignId ? (
              <Link href={`/campaigns/view/?id=${encodeURIComponent(l.campaignId)}`} className="k-accent">
                {campaignName ?? l.campaignId}
              </Link>
            ) : (
              <span className="k-fg4">—</span>
            )}
          </Row>
          <Row label="Updated">{formatTime(l.updatedAt)}</Row>
        </dl>
        <div className="k-line-subtle mt-4 border-t pt-4">
          <ReportPaid leadId={l.id} done={paid} />
        </div>
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="k-label">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function ReportPaid({ leadId, done }: { leadId: string; done: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <ToneDot tone="run">Paid client, reported by the client&apos;s team</ToneDot>;
  const report = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/leads/${encodeURIComponent(leadId)}/outcomes`, { outcome: "paid_client" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="k-label mb-1.5">Client&apos;s team</p>
      <button type="button" className="k-btn w-full justify-center" disabled={busy} onClick={report}>
        {busy ? "Reporting" : "Report paid client"}
      </button>
      <p className="k-fg3 mt-1.5 text-[12px]">The client&apos;s team is another factory. It reports this outcome.</p>
      {error && <p className="mt-1 text-[12px] text-[var(--data-rose)]">{error}</p>}
    </div>
  );
}

function OccurrenceCard({ oc, catalogue, choiceById }: { oc: ApiOccurrence; catalogue: CatalogueData | undefined; choiceById: Map<string, ApiChoice> }) {
  return (
    <li className="k-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Mark kind="outcome" id={oc.outcome} size={20} />
        <span className="text-[14px] font-medium">{outcomeName(catalogue, oc.outcome)}</span>
        <span className="k-mono k-fg2 text-[12px]">{formatTime(oc.at)}</span>
        <span className="k-chip">{factoryTitle(catalogue, oc.factory)}</span>
      </div>
      {oc.content && <Content content={oc.content} />}
      {oc.traceability.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="k-label">Traceability</span>
          {oc.traceability.map((cid) => {
            const c = choiceById.get(cid);
            return (
              <span key={cid} className="k-chip" title={c ? c.reason : cid}>
                {c ? `${c.pointLabel}: ${c.chosenLabel}` : cid}
              </span>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** What an occurrence holds, shown as is: a subject and a body as an email, text as text, other fields as a list. */
function Content({ content }: { content: Record<string, unknown> }) {
  const { subject, body, text, ...rest } = content as { subject?: unknown; body?: unknown; text?: unknown } & Record<string, unknown>;
  const entries = Object.entries(rest).filter(([, v]) => v != null && v !== "");
  return (
    <div className="k-inset mt-3 rounded-[8px] px-3 py-2.5 text-[13px]">
      {typeof subject === "string" && <p className="font-medium">{subject}</p>}
      {typeof body === "string" && <p className="k-fg2 mt-1 whitespace-pre-wrap">{body}</p>}
      {typeof text === "string" && <p className="k-fg2 whitespace-pre-wrap">{text}</p>}
      {entries.length > 0 && (
        <dl className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] ${subject || body || text ? "mt-2" : ""}`}>
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="k-fg3">{k}</dt>
              <dd className="break-words">{typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
