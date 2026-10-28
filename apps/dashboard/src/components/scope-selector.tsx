"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Mark } from "./mark";
import type { ScopeOrg, ScopeValue } from "@/lib/scope";

/**
 * The switch at the top of the sidebar, drawn like distribute.you's dashboard v2 tenant
 * switcher: the brand and its offer on the button; the menu lists the brands of the
 * organization, then the brand's offers, then the organizations (with a search past a
 * handful). "All brands" and "All offers" are explicit picks. Every page shows only what
 * the switch picks.
 */
const itemCls =
  "flex h-8 w-full min-w-0 items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-[var(--fg-1)] hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)] focus-visible:outline-none";
const currentCls = "bg-[var(--bg-selected)] font-medium";

const Updown = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" className="k-fg3 ml-auto shrink-0" aria-hidden="true">
    <path d="M4 4.5 6 2.5l2 2M4 7.5l2 2 2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Plus = () => (
  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
    <svg width="14" height="14" viewBox="0 0 14 14" className="k-fg3" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  </span>
);
const AllMark = () => (
  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--bg-hover)]">
    <svg width="12" height="12" viewBox="0 0 12 12" className="k-fg3" aria-hidden="true">
      <path d="M2 2h3v3H2zM7 2h3v3H7zM2 7h3v3H2zM7 7h3v3H7z" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  </span>
);

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="k-fg3 px-2 pb-1 pt-2 text-[12px]">{children}</p>;
}

export function ScopeSelector({ orgs, value, onChange, note }: { orgs: ScopeOrg[]; value: ScopeValue; onChange: (v: ScopeValue) => void; note?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const org = orgs.find((o) => o.id === value.orgId);
  const brand = org?.brands.find((b) => b.id === value.brandId) ?? null;
  const offer = brand?.offers.find((x) => x.id === value.offerId) ?? null;
  const pick = (v: ScopeValue) => {
    onChange(v);
    setOpen(false);
  };
  const shownOrgs = orgs.filter((o) => !search.trim() || o.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Organization, brand and offer"
        className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left hover:bg-[var(--bg-hover)]"
        data-testid="scope-selector"
      >
        {brand ? <Mark kind="audience" id={brand.id} size={20} /> : <AllMark />}
        <span className="min-w-0 leading-4">
          <span className="block truncate text-[13px] font-semibold">{brand?.name ?? (org ? `All brands of ${org.name}` : "No organization yet")}</span>
          {brand && <span className="k-fg3 block truncate text-[12px]">{offer?.name ?? (brand.offers.length ? "All offers" : "No offer yet")}</span>}
        </span>
        <Updown />
      </button>
      {note && <p className="k-fg3 px-2 text-[11px]">{note}</p>}
      {open && (
        <div role="menu" className="k-popover absolute left-0 right-0 top-9 z-50 mt-1 p-1" data-testid="scope-menu">
          <div className="k-scroll max-h-56 overflow-y-auto">
            <button type="button" role="menuitem" aria-current={!brand ? "true" : undefined} className={`${itemCls} ${!brand ? currentCls : ""}`} onClick={() => pick({ orgId: org?.id ?? null, brandId: null, offerId: null })}>
              <AllMark />
              <span className="truncate">All brands</span>
            </button>
            {(org?.brands ?? []).map((b) => (
              <button key={b.id} type="button" role="menuitem" aria-current={b.id === brand?.id ? "true" : undefined} className={`${itemCls} ${b.id === brand?.id ? currentCls : ""}`} onClick={() => pick({ orgId: org!.id, brandId: b.id, offerId: b.offers[0]?.id ?? null })}>
                <Mark kind="audience" id={b.id} size={20} />
                <span className="truncate">{b.name}</span>
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-[var(--line-subtle)]" />
          <Link href="/brands/new/" role="menuitem" className={itemCls} onClick={() => setOpen(false)}>
            <Plus />
            New brand
          </Link>
          {brand && (
            <>
              <div className="my-1 h-px bg-[var(--line-subtle)]" />
              <MenuLabel>Offers</MenuLabel>
              <div className="k-scroll max-h-48 overflow-y-auto">
                <button type="button" role="menuitem" aria-current={!offer ? "true" : undefined} className={`${itemCls} ${!offer ? currentCls : ""}`} onClick={() => pick({ orgId: org!.id, brandId: brand.id, offerId: null })}>
                  <AllMark />
                  <span className="truncate">All offers</span>
                </button>
                {brand.offers.map((x) => (
                  <button key={x.id} type="button" role="menuitem" aria-current={x.id === offer?.id ? "true" : undefined} className={`${itemCls} ${x.id === offer?.id ? currentCls : ""}`} onClick={() => pick({ orgId: org!.id, brandId: brand.id, offerId: x.id })}>
                    <Mark kind="object" id={x.id} size={20} />
                    <span className="truncate">{x.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="my-1 h-px bg-[var(--line-subtle)]" />
          <MenuLabel>Organizations</MenuLabel>
          {orgs.length > 5 && (
            <div className="px-1 pb-1">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search organizations…" aria-label="Search organizations" className="k-input w-full px-2" />
            </div>
          )}
          <div className="k-scroll max-h-48 overflow-y-auto">
            {shownOrgs.length === 0 && <p className="k-fg3 px-2 py-1.5 text-[12px]">No organization matches.</p>}
            {shownOrgs.map((o) => (
              <button key={o.id} type="button" role="menuitem" aria-current={o.id === org?.id ? "true" : undefined} className={`${itemCls} ${o.id === org?.id ? currentCls : ""}`} onClick={() => (o.id === org?.id ? setOpen(false) : pick({ orgId: o.id, brandId: o.brands[0]?.id ?? null, offerId: o.brands[0]?.offers[0]?.id ?? null }))}>
                <Mark kind="company" id={o.id} size={20} />
                <span className="truncate">{o.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
