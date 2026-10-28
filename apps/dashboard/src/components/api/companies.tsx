"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApiCompany } from "@gtm-factory/core";
import { CardTable, Initials, Page, PageHeader, TD, TDN, TH, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { outcomeName } from "@/lib/api/labels";
import { useOverview, useScope } from "@/lib/api/overview";
import { formatCount, plural } from "@/lib/format";
import { Read } from "./common";

/** The companies the leads belong to: one research of a company serves every lead there. */
export function ApiCompaniesPage() {
  const { scope } = useScope();
  const { data: o } = useOverview();
  const read = useApi<ApiCompany[]>(`/companies${scope.brandId ? `?brandId=${encodeURIComponent(scope.brandId)}` : ""}`);
  const [shown, setShown] = useState(50);
  const tactics = (o?.catalogue.tactics ?? []).filter((t) => t.describes.includes("company"));
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <>
      <TopBar crumbs={[{ label: "Companies" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(all) => {
            const rank = (c: ApiCompany) => (c.furthest ? (o?.catalogue.outcomes.find((x) => x.id === c.furthest)?.track?.rank ?? 0) : -1);
            const rows = [...all].sort((a, b) => rank(b) - rank(a) || b.leads - a.leads || a.name.localeCompare(b.name));
            const shownTactics = tactics.filter((t) => rows.some((r) => r.values[t.id] !== undefined));
            return (
              <>
                <PageHeader title={plural(rows.length, "company", "companies")} sub="Every person found belongs to one company. One research of a company serves everyone who works there." />
                <CardTable note="Companies your leads work at, and how far the best of them went."
                  footer={
                    <span className="flex items-center justify-between">
                      <span>
                        {formatCount(Math.min(shown, rows.length))} of {formatCount(rows.length)}
                      </span>
                      {shown < rows.length && (
                        <button type="button" className="k-btn-ghost" onClick={() => setShown((n) => n + 50)}>
                          Show 50 more
                        </button>
                      )}
                    </span>
                  }
                >
                  <thead>
                    <tr className="k-line-subtle border-b">
                      <th className={TH}>Company</th>
                      {shownTactics.map((t) => (
                        <th key={t.id} className={TH}>
                          {t.name}
                        </th>
                      ))}
                      <th className={TH}>Furthest milestone</th>
                      <th className={TH}>Researched</th>
                      <th className={`${TH} text-right`}>Leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((r) => (
                      <tr key={`${r.brandId}:${r.id}`} className="k-row k-line-subtle border-b">
                        <td className={TD}>
                          <span className="flex items-center gap-2">
                            <Initials name={r.name} size={22} />
                            <span className="truncate font-medium">{r.name}</span>
                          </span>
                        </td>
                        {shownTactics.map((t) => {
                          const v = r.values[t.id];
                          return (
                            <td key={t.id} className={`${TD} tabular-nums`}>
                              {v === undefined ? <span className="k-fg4">—</span> : valueText(v, t.type.kind === "number" ? t.type.unit : undefined)}
                            </td>
                          );
                        })}
                        <td className={TD}>{r.furthest ? outcomeName(o?.catalogue, r.furthest) : <span className="k-fg4">—</span>}</td>
                        <td className={TD}>
                          {r.researchedAt ? (
                            <span className="k-fg2 text-[12px]">
                              {day(r.researchedAt)}
                              {r.researchUses === 1 ? ", used once" : r.researchUses > 1 ? `, used ${r.researchUses} times` : ""}
                            </span>
                          ) : (
                            <span className="k-fg4">—</span>
                          )}
                        </td>
                        <td className={TDN}>
                          {r.leadId ? (
                            <Link href={`/leads/view/?id=${encodeURIComponent(r.leadId)}`} className="hover:underline">
                              {formatCount(r.leads)}
                            </Link>
                          ) : (
                            formatCount(r.leads)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CardTable>
              </>
            );
          }}
        </Read>
      </Page>
    </>
  );
}

/** A tactic value in plain words: Yes or No, a number rounded to what a person reads. */
function valueText(v: string | number | boolean, unit?: string): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 10) / 10);
    return unit ? `${n} ${unit}` : n;
  }
  return v;
}
