"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  BookOpenIcon,
  FlaskIcon,
  HouseIcon,
  PlusIcon,
  ReceiptIcon,
  SquaresFourIcon,
  StackIcon,
  StorefrontIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { NavContext } from "@/components/nav-context";
import { Mark } from "@/components/mark";
import { FactoryProvider, useFactory } from "@/lib/api/factory";
import { formatCount } from "@/lib/format";
import { timeAgo } from "./common";

/** The frame in api mode: Keel's canvas and sidebar, every page in one inset panel, no simulator. */
export function ApiShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <FactoryProvider>
      <NavContext.Provider value={() => setOpen(true)}>
        <div className="v2-root flex h-[100dvh] w-full overflow-hidden">
          {open && <div className="fixed inset-0 z-40 bg-[#10101247] lg:hidden" onClick={() => setOpen(false)} />}
          <div
            className={`fixed inset-y-0 left-0 z-50 flex bg-[var(--bg-canvas)] transition-transform duration-200 ease-[cubic-bezier(.23,1,.32,1)] lg:static lg:z-auto lg:translate-x-0 ${
              open ? "translate-x-0 shadow-xl" : "-translate-x-full"
            }`}
          >
            <Suspense fallback={<aside className="w-[248px]" />}>
              <Sidebar />
            </Suspense>
          </div>
          <div className="flex min-w-0 flex-1 flex-col pt-2">
            <main className="k-panel k-scroll relative mb-2 ml-2 mr-2 min-w-0 flex-1 overflow-y-auto lg:ml-0">{children}</main>
          </div>
          <div id="portal" />
        </div>
      </NavContext.Provider>
    </FactoryProvider>
  );
}

const pinKey = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`;
const pinHref = (p: { kind: string; id: string }) => `/pinned/?pin=${encodeURIComponent(pinKey(p))}`;

function NavItem({ href, label, icon, active, trailing }: { href: string; label: string; icon?: React.ReactNode; active?: boolean; trailing?: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-7 min-w-0 items-center gap-2 rounded-[8px] pl-2 pr-1.5 text-[13px] outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        active ? "bg-[var(--bg-selected)] text-[var(--fg-1)]" : "text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-1)]"
      }`}
    >
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--fg-3)]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function Count({ n }: { n: number | null | undefined }) {
  if (n == null) return null;
  return <span className="k-fg3 ml-auto shrink-0 pr-1 text-[12px] tabular-nums">{formatCount(n)}</span>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="k-fg3 mb-1 px-2 text-[12px]">{title}</p>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const { data, error } = useFactory();
  const at = (p: string) => pathname === p || pathname === `${p}/`;
  const id = search.get("id");
  const brandName = (bid: string) => data?.brands.find((b) => b.id === bid)?.name ?? "";
  return (
    <aside className="flex h-full w-[248px] max-w-[85vw] shrink-0 flex-col">
      <div className="space-y-2 px-2 pt-2">
        <div className="flex h-9 items-center gap-2 px-2">
          <Mark kind="factory" id="factory" size={22} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">GTM Factory</span>
            <span className="k-fg3 block truncate text-[11px] leading-3">
              {error ? "Factory unreachable" : data?.scheduler.lastTickAt ? `Last tick ${timeAgo(data.scheduler.lastTickAt)}` : "Live factory"}
            </span>
          </span>
        </div>
        <Link href="/campaigns/new/" className="k-btn-strong w-full justify-center">
          <PlusIcon size={14} weight="bold" />
          New campaign
        </Link>
      </div>
      <nav className="k-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
        <div className="space-y-px">
          <NavItem href="/" label="Today" icon={<HouseIcon size={15} />} active={at("/")} />
        </div>
        <Group title="Brands">
          <NavItem href="/brands/" label="Overview" icon={<StorefrontIcon size={15} />} active={at("/brands")} trailing={<Count n={data?.brands.length} />} />
          <NavItem href="/brands/new/" label="New brand" icon={<PlusIcon size={15} />} active={at("/brands/new")} />
        </Group>
        <Group title="Campaigns">
          <NavItem href="/campaigns/" label="Overview" icon={<SquaresFourIcon size={15} />} active={at("/campaigns")} />
          {data?.campaigns.map((c) => (
            <NavItem
              key={c.id}
              href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`}
              label={`${brandName(c.brandId)}: ${c.name}`}
              icon={<Mark kind="funnel" id={c.funnelId} size={16} />}
              active={pathname.startsWith("/campaigns/view") && id === c.id}
              trailing={
                c.status === "live" ? (
                  <span className="k-dot-pulse ml-auto mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--run)] text-[var(--run)]" aria-label="Live" />
                ) : (
                  <span className="ml-auto mr-1 h-2 w-2 shrink-0 rounded-full border-[1.5px] border-[var(--fg-3)]" aria-label="Paused" />
                )
              }
            />
          ))}
        </Group>
        <Group title="Records">
          <NavItem href="/leads/" label="Leads" icon={<UsersIcon size={15} />} active={at("/leads") || pathname.startsWith("/leads/view")} />
        </Group>
        {data?.pins && data.pins.length > 0 && (
          <Group title="Pinned">
            {data.pins.map((p) => (
              <NavItem
                key={pinKey(p)}
                href={pinHref(p)}
                label={p.label}
                icon={<Mark kind={p.kind === "outcome" ? "object" : p.kind} id={p.id} icon={p.icon} size={16} />}
                active={pathname.startsWith("/pinned") && search.get("pin") === pinKey(p)}
              />
            ))}
          </Group>
        )}
        <Group title="Engine">
          <NavItem href="/research/" label="Research" icon={<FlaskIcon size={15} />} active={at("/research")} />
          <NavItem href="/catalogue/" label="Catalogue" icon={<StackIcon size={15} />} active={at("/catalogue")} />
          <NavItem href="/ledger/" label="Ledger" icon={<ReceiptIcon size={15} />} active={at("/ledger")} />
        </Group>
        <Group title="Learn">
          <NavItem href="/how-it-works/" label="How it works" icon={<BookOpenIcon size={15} />} active={at("/how-it-works")} />
        </Group>
      </nav>
      <p className="k-fg3 px-4 pb-3 pt-1 text-[12px]">
        Built by{" "}
        <a href="https://distribute.you" className="hover:text-[var(--fg-1)]" target="_blank" rel="noreferrer">
          distribute.you
        </a>
        . Revenue made easy.
      </p>
    </aside>
  );
}
