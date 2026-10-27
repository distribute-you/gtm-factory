/**
 * What the pages show: one organization, one of its brands, one of the brand's offers,
 * like distribute.you. Picked in the selector at the top of the sidebar and kept in this
 * browser. Both data sources feed the same tree.
 */

export interface ScopeOffer {
  id: string;
  name: string;
}

export interface ScopeBrand {
  id: string;
  name: string;
  offers: ScopeOffer[];
}

export interface ScopeOrg {
  id: string;
  name: string;
  brands: ScopeBrand[];
}

export interface ScopeValue {
  orgId: string | null;
  brandId: string | null;
  offerId: string | null;
}

const KEY = "gtm-factory:v7:scope";

export function readScope(): ScopeValue | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScopeValue) : null;
  } catch {
    return null;
  }
}

export function writeScope(v: ScopeValue): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the scope holds for this visit */
  }
}

/** The scope to show: the one asked for when it still exists, else the first org, brand and offer. */
export function resolveScope(orgs: readonly ScopeOrg[], asked: ScopeValue | null): ScopeValue {
  const org = orgs.find((o) => o.id === asked?.orgId) ?? orgs[0];
  const brand = org?.brands.find((b) => b.id === asked?.brandId) ?? org?.brands[0];
  const offer = brand?.offers.find((x) => x.id === asked?.offerId) ?? brand?.offers[0];
  return { orgId: org?.id ?? null, brandId: brand?.id ?? null, offerId: offer?.id ?? null };
}
