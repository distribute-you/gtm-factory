"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApiBrand, ApiNewBrand } from "@gtm-factory/core";
import { Mark } from "@/components/mark";
import { CardTable, EmptyNote, Page, PageHeader, TD, TDN, TH, TopBar } from "@/components/ui";
import { apiSend, useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { formatCents, formatCount, plural } from "@/lib/format";
import { Field, Read, formatTime, useOtherFactory } from "./common";

export function ApiBrandsPage() {
  const read = useApi<ApiBrand[]>("/brands");
  const rung = useFirstRung();
  return (
    <>
      <TopBar crumbs={[{ label: "Brands" }]} actions={<Link href="/brands/new/" className="k-btn-strong">New brand</Link>} />
      <Page>
        <Read read={read}>
          {(brands) => (
            <>
              <PageHeader title={plural(brands.length, "brand", "brands")} sub="Each brand brings its website, its offer and who it sells to." />
              {brands.length === 0 ? (
                <div className="k-card">
                  <EmptyNote>
                    No brand yet. <Link href="/brands/new/" className="k-accent">Add the first one</Link>.
                  </EmptyNote>
                </div>
              ) : (
                <CardTable>
                  <thead>
                    <tr className="k-line-subtle border-b">
                      <th className={TH}>Brand</th>
                      <th className={`${TH} w-full`}>Sells to</th>
                      <th className={`${TH} text-right`}>Lifetime revenue</th>
                      <th className={`${TH} text-right`}>Spent</th>
                      <th className={`${TH} text-right`}>{rung?.label ?? "Interested"}</th>
                      <th className={`${TH} text-right`}>Provided leads</th>
                      <th className={TH}>Added</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {brands.map((b) => (
                      <BrandRow key={b.id} b={b} />
                    ))}
                  </tbody>
                </CardTable>
              )}
            </>
          )}
        </Read>
      </Page>
    </>
  );
}

/** The first rung of the catalogue's first lead track (the outcome a client counts its interested leads by). */
function useFirstRung(): { id: string; label: string } | null {
  const { data } = useFactory();
  const c = data?.catalogue;
  const track = c?.leadTracks[0];
  const o = track ? c!.outcomes.filter((x) => x.track?.track === track.id && !x.retired).sort((a, b) => a.track!.rank - b.track!.rank)[0] : undefined;
  return o ? { id: o.id, label: o.plural ?? o.label } : null;
}

function BrandRow({ b }: { b: ApiBrand }) {
  const other = useOtherFactory(b.factory);
  const rung = useFirstRung();
  return (
                      <tr className="k-row k-line-subtle border-b last:border-b-0">
                        <td className={TD}>
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Mark kind="audience" id={b.id} size={28} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 font-medium">
                                <span className="truncate">{b.name}</span>
                                {b.test && <span className="k-chip">Staff test</span>}
                                {other && <span className="k-chip">{other}</span>}
                              </span>
                              <a href={b.website} target="_blank" rel="noreferrer" className="k-fg3 block truncate text-[12px] hover:text-[var(--fg-1)]">
                                {b.website.replace(/^https?:\/\//, "")}
                              </a>
                            </span>
                          </span>
                        </td>
                        <td className={`${TD} k-fg2 min-w-[260px]`}>{b.icp}</td>
                        <td className={TDN}>{b.lifetimeValueCents == null ? <span className="k-fg4">—</span> : formatCents(b.lifetimeValueCents)}</td>
                        <td className={TDN}>{b.spentTotalCents == null ? <span className="k-fg4">—</span> : formatCents(b.spentTotalCents)}</td>
                        <td className={TDN}>{rung && b.counts?.[rung.id] ? formatCount(b.counts[rung.id]!) : <span className="k-fg4">—</span>}</td>
                        <td className={TDN}>{b.providedLeads > 0 ? formatCount(b.providedLeads) : <span className="k-fg4">—</span>}</td>
                        <td className={`${TD} k-mono k-fg2 whitespace-nowrap text-[12px]`}>{formatTime(b.createdAt)}</td>
                        <td className={TD}>
                          {other ? (
                            <Link href={`/campaigns/?brand=${encodeURIComponent(b.id)}`} className="k-btn whitespace-nowrap">
                              Its campaigns
                            </Link>
                          ) : (
                            <Link href={`/campaigns/new/?brand=${encodeURIComponent(b.id)}`} className="k-btn whitespace-nowrap">
                              New campaign
                            </Link>
                          )}
                        </td>
                      </tr>
  );
}

/** One lead per line: email, first name, last name, company, title. */
export function parseLeadLines(text: string): NonNullable<ApiNewBrand["leads"]> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const [email, firstName, lastName, company, title] = l.split(",").map((x) => x.trim());
      const lead: NonNullable<ApiNewBrand["leads"]>[number] = {};
      if (email) lead.email = email;
      if (firstName) lead.firstName = firstName;
      if (lastName) lead.lastName = lastName;
      if (company) lead.company = company;
      if (title) lead.title = title;
      return lead;
    });
}

export function ApiNewBrandPage() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [offer, setOffer] = useState("");
  const [icp, setIcp] = useState("");
  const [ltv, setLtv] = useState("");
  const [test, setTest] = useState(false);
  const [leads, setLeads] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiBrand | null>(null);

  const ltvDollars = ltv.trim() === "" ? null : Number(ltv);
  const valid = name.trim() && website.trim() && offer.trim() && icp.trim() && (ltvDollars === null || (Number.isFinite(ltvDollars) && ltvDollars > 0));

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const body: ApiNewBrand = {
      name: name.trim(),
      website: website.trim(),
      offer: offer.trim(),
      icp: icp.trim(),
      lifetimeValueCents: ltvDollars === null ? null : Math.round(ltvDollars * 100),
      test,
    };
    const list = parseLeadLines(leads);
    if (list.length > 0) body.leads = list;
    try {
      setCreated(await apiSend<ApiBrand>("POST", "/brands", body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar crumbs={[{ label: "Brands", href: "/brands/" }, { label: "New brand" }]} />
      <Page narrow>
        <PageHeader title="Add a brand" sub="Tell the factory what the brand sells and to whom. It finds the leads and writes the emails." />
        {created ? (
          <div className="k-card p-5">
            <p className="text-[14px] font-medium">{created.name} is in the factory.</p>
            <p className="k-fg2 mt-1 text-[13px]">Next, pick a sales funnel and a daily cap.</p>
            <div className="mt-4 flex gap-2">
              <Link href={`/campaigns/new/?brand=${encodeURIComponent(created.id)}`} className="k-btn-strong">
                New campaign for {created.name}
              </Link>
              <Link href="/brands/" className="k-btn">
                All brands
              </Link>
            </div>
          </div>
        ) : (
          <div className="k-card space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name">
                <input className="k-input w-full" style={{ font: "inherit" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
              </Field>
              <Field label="Website">
                <input className="k-input w-full" style={{ font: "inherit" }} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" />
              </Field>
            </div>
            <Field label="Offer" hint="What the brand sells, in its own words.">
              <textarea className="k-input min-h-[72px] w-full py-1.5" style={{ font: "inherit", height: "auto" }} value={offer} onChange={(e) => setOffer(e.target.value)} />
            </Field>
            <Field label="Who it sells to" hint="One plain sentence. Example: heads of sales at US software companies with 50 to 500 people.">
              <textarea className="k-input min-h-[56px] w-full py-1.5" style={{ font: "inherit", height: "auto" }} value={icp} onChange={(e) => setIcp(e.target.value)} />
            </Field>
            <Field label="Lifetime revenue of one client (optional)" hint="In dollars. A paid client is valued at this amount.">
              <label className="k-input flex w-48 items-center gap-1 px-2">
                <span className="k-fg3">$</span>
                <input className="w-full min-w-0 bg-transparent tabular-nums outline-none" style={{ font: "inherit" }} value={ltv} onChange={(e) => setLtv(e.target.value.replace(/[^0-9.]/g, ""))} />
              </label>
            </Field>
            <Field label="Leads the brand provides (optional)" hint="One lead per line: email, first name, last name, company, title.">
              <textarea
                className="k-input k-mono min-h-[96px] w-full py-1.5 text-[12px]"
                style={{ height: "auto" }}
                value={leads}
                onChange={(e) => setLeads(e.target.value)}
                placeholder="jane@acme.com, Jane, Doe, Acme, Head of Sales"
              />
            </Field>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-1" checked={test} onChange={(e) => setTest(e.target.checked)} />
              <span>
                Staff test brand
                <span className="k-fg3 block text-[12px]">Every email goes to staff addresses only.</span>
              </span>
            </label>
            {error && <p className="text-[13px] text-[var(--data-rose)]">{error}</p>}
            <div className="flex justify-end">
              <button type="button" className="k-btn-strong" disabled={!valid || busy} onClick={submit}>
                {busy ? "Adding" : "Add the brand"}
              </button>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
