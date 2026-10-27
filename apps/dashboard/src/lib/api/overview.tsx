"use client";

/**
 * The overview, polled once for the whole app in api mode: the sidebar and every page read it,
 * scoped to the organization, brand and offer picked in the selector (kept in this browser).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ApiOverview } from "@gtm-factory/core";
import { readScope, resolveScope, writeScope, type ScopeOrg, type ScopeValue } from "../scope";
import { useApi, type ApiRead } from "./client";

interface OverviewValue {
  read: ApiRead<ApiOverview>;
  orgs: ScopeOrg[];
  scope: ScopeValue;
  setScope: (v: ScopeValue) => void;
}

const OverviewContext = createContext<OverviewValue | null>(null);

/** Every organization, its brands and their offers, from the overview. */
function scopeTree(o: ApiOverview | null | undefined): ScopeOrg[] {
  const out: ScopeOrg[] = [];
  for (const b of o?.brands ?? []) {
    let org = out.find((x) => x.id === b.orgId);
    if (!org) out.push((org = { id: b.orgId, name: b.orgName, brands: [] }));
    org.brands.push({ id: b.id, name: b.name, offers: b.offers ?? [] });
  }
  return out;
}

export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const read = useApi<ApiOverview>("/overview", 10_000);
  const [asked, setAsked] = useState<ScopeValue | null>(null);
  useEffect(() => setAsked(readScope()), []);
  const orgs = useMemo(() => scopeTree(read.data), [read.data]);
  const scope = resolveScope(orgs, asked);
  const setScope = useCallback((v: ScopeValue) => {
    setAsked(v);
    writeScope(v);
  }, []);
  const value = useMemo(() => ({ read, orgs, scope, setScope }), [read, orgs, scope.orgId, scope.brandId, scope.offerId, setScope]); // eslint-disable-line react-hooks/exhaustive-deps
  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}

function useValue(): OverviewValue {
  const v = useContext(OverviewContext);
  if (!v) throw new Error("useOverview outside OverviewProvider");
  return v;
}

/** The overview, scoped: the picked brand, its campaigns on the picked offer, their picks and runs. */
export function useOverview(): ApiRead<ApiOverview> {
  const { read, scope } = useValue();
  const data = useMemo(() => {
    const o = read.data;
    if (!o || !scope.brandId) return o;
    const campaigns = o.campaigns.filter((c) => c.brandId === scope.brandId && (!scope.offerId || !c.offerId || c.offerId === scope.offerId));
    const ids = new Set(campaigns.map((c) => c.id));
    return {
      ...o,
      brands: o.brands.filter((b) => b.id === scope.brandId),
      campaigns,
      recentPicks: o.recentPicks.filter((p) => ids.has(p.campaignId)),
      recentRuns: o.recentRuns.filter((r) => r.campaignId === null || ids.has(r.campaignId)),
    };
  }, [read.data, scope.brandId, scope.offerId]);
  return { ...read, data };
}

/** The organization, brand and offer picked, and every one the selector lists. */
export function useScope(): { orgs: ScopeOrg[]; scope: ScopeValue; setScope: (v: ScopeValue) => void } {
  const { orgs, scope, setScope } = useValue();
  return { orgs, scope, setScope };
}
