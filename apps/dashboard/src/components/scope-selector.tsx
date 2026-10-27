"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { Mark } from "./mark";
import type { ScopeOrg, ScopeValue } from "@/lib/scope";

/**
 * Organization, then brand, then offer: the one switch that scopes every page, like
 * distribute.you. The button shows where you are; the menu lists the three levels side by side.
 */
export function ScopeSelector({ orgs, value, onChange, note }: { orgs: ScopeOrg[]; value: ScopeValue; onChange: (v: ScopeValue) => void; note?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const org = orgs.find((o) => o.id === value.orgId);
  const brand = org?.brands.find((b) => b.id === value.brandId);
  const offer = brand?.offers.find((x) => x.id === value.offerId);
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Organization, brand and offer"
        className="flex h-11 w-full items-center gap-2 rounded-[8px] px-2 text-left hover:bg-[var(--bg-hover)]"
        data-testid="scope-selector"
      >
        <Mark kind="audience" id={brand?.id ?? "none"} size={30} quiet={!brand} />
        <span className="min-w-0 flex-1">
          <span className="k-fg3 block truncate text-[11px] leading-4">{org?.name ?? "No organization yet"}</span>
          <span className="block truncate text-[13px] font-medium leading-5">
            {brand?.name ?? "No brand"}
            {offer && <span className="k-fg3 font-normal"> · {offer.name}</span>}
          </span>
        </span>
        <CaretUpDownIcon size={13} className="k-fg3 shrink-0" />
      </button>
      {note && <p className="k-fg3 px-2 text-[11px]">{note}</p>}
      {open && <ScopeMenu orgs={orgs} value={value} anchor={btn.current} onClose={() => setOpen(false)} onChange={(v) => onChange(v)} />}
    </>
  );
}

function ScopeMenu({ orgs, value, anchor, onClose, onChange }: { orgs: ScopeOrg[]; value: ScopeValue; anchor: HTMLElement | null; onClose: () => void; onChange: (v: ScopeValue) => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [orgId, setOrgId] = useState(value.orgId);
  const [brandId, setBrandId] = useState(value.brandId);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const brand = org?.brands.find((b) => b.id === brandId) ?? org?.brands[0];
  const pick = (o: string, b: string | null, x: string | null) => {
    onChange({ orgId: o, brandId: b, offerId: x });
    onClose();
  };
  const col = "min-w-0 flex-1 p-1";
  const item = (on: boolean) => `flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] hover:bg-[var(--bg-hover)] ${on ? "k-selected" : ""}`;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" style={{ background: "transparent" }} onClick={onClose}>
      <div className="k-popover fixed flex w-[min(620px,calc(100vw-16px))] divide-x divide-[var(--line-subtle)]" style={{ top: r.bottom + 4, left: Math.max(8, r.left) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pick what to show">
        <div className={col}>
          <p className="k-label px-2 pb-1 pt-1.5">Organization</p>
          {orgs.map((o) => (
            <button key={o.id} type="button" className={item(o.id === org?.id)} onMouseEnter={() => setOrgId(o.id)} onClick={() => setOrgId(o.id)}>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="k-fg3 text-[11px] tabular-nums">{o.brands.length}</span>
            </button>
          ))}
        </div>
        <div className={col}>
          <p className="k-label px-2 pb-1 pt-1.5">Brand</p>
          {(org?.brands ?? []).map((b) => (
            <button key={b.id} type="button" className={item(b.id === brand?.id)} onMouseEnter={() => setBrandId(b.id)} onClick={() => pick(org!.id, b.id, b.offers[0]?.id ?? null)}>
              <Mark kind="audience" id={b.id} size={16} />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
            </button>
          ))}
          {org && org.brands.length === 0 && <p className="k-fg3 px-2 py-1.5 text-[12px]">No brand yet.</p>}
        </div>
        <div className={col}>
          <p className="k-label px-2 pb-1 pt-1.5">Offer</p>
          {(brand?.offers ?? []).map((x) => {
            const on = brand?.id === value.brandId && x.id === value.offerId;
            return (
              <button key={x.id} type="button" className={item(on)} onClick={() => pick(org!.id, brand!.id, x.id)}>
                <span className="min-w-0 flex-1 truncate">{x.name}</span>
                {on && <CheckIcon size={12} weight="bold" className="text-[var(--accent)]" />}
              </button>
            );
          })}
          {brand && brand.offers.length === 0 && <p className="k-fg3 px-2 py-1.5 text-[12px]">No offer yet.</p>}
        </div>
      </div>
    </div>,
    host,
  );
}
