"use client";

import { RELEASE } from "@gtm-factory/core";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  BookOpenIcon,
  BuildingsIcon,
  CaretDownIcon,
  DiceFiveIcon,
  FlaskIcon,
  GithubLogoIcon,
  HouseIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ReceiptIcon,
  SkipForwardIcon,
  SquaresFourIcon,
  StackIcon,
  PlugsConnectedIcon,
  UserListIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { NavContext } from "./nav-context";
import { Mark } from "./mark";
import { useSim, SPEEDS, type Speed } from "@/lib/sim";
import { ScopeSelector } from "./scope-selector";
import { resolveScope, type ScopeOrg } from "@/lib/scope";
import { leadRows, scopedCampaigns } from "@/lib/model";
import { formatCount } from "@/lib/format";
import { pinHref, pinKey } from "@/lib/pins";

export const REPO_URL = "https://github.com/distribute-you/gtm-factory";

/** Keel's frame: a grey canvas, a one-level sidebar sitting on it, every page in one inset panel. */
export function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <NavContext.Provider value={() => setOpen(true)}>
      <div className="v2-root flex h-[100dvh] w-full overflow-hidden">
        {open && <div className="fixed inset-0 z-40 bg-[#10101247] lg:hidden" onClick={() => setOpen(false)} />}
        <div
          className={`fixed inset-y-0 left-0 z-50 flex bg-[var(--bg-canvas)] transition-transform duration-200 ease-[cubic-bezier(.23,1,.32,1)] lg:static lg:z-auto lg:translate-x-0 ${
            open ? "translate-x-0 ring-1 ring-[var(--line)]" : "-translate-x-full"
          }`}
        >
          <Suspense fallback={<aside className="w-[248px]" />}>
            <Sidebar />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <SimBar />
          <main className="k-panel k-scroll relative mb-2 ml-2 mr-2 min-w-0 flex-1 overflow-y-auto lg:ml-0">{children}</main>
        </div>
        <div id="portal" />
      </div>
    </NavContext.Provider>
  );
}

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
  const { model, scope, offer, pins } = useSim();
  const at = (p: string) => pathname === p || pathname === `${p}/`;
  const campaigns = model ? scopedCampaigns(model, scope, offer) : [];
  const campaignId = search.get("id");
  const pinned = search.get("pin");
  const leadsInScope = model ? leadRows(model, scope).length : null;
  const audience = model?.catalogue.outcomes.find((o) => o.contentType === "audience" && !o.retired);
  return (
    <aside className="flex h-full w-[248px] max-w-[85vw] shrink-0 flex-col">
      <div className="space-y-2 px-2 pt-2">
        <ScopeSwitcher />
        <Link href="/campaigns/new/" className="k-btn-strong w-full justify-center">
          <PlusIcon size={14} weight="bold" />
          New campaign
        </Link>
      </div>
      <nav className="k-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
          <>
            <div className="space-y-px">
              <NavItem href="/" label="Today" icon={<HouseIcon size={15} />} active={at("/")} />
            </div>
            <Group title="Campaigns">
              <NavItem href="/campaigns/" label="Overview" icon={<SquaresFourIcon size={15} />} active={at("/campaigns")} />
              {model &&
                campaigns.map((c) => {
                  const active = pathname.startsWith("/campaigns/view") && campaignId === c.id;
                  const brand = model.clients.find((x) => x.brand.id === c.brandId)?.brand.name ?? "";
                  return (
                    <NavItem
                      key={c.id}
                      href={`/campaigns/view/?id=${encodeURIComponent(c.id)}`}
                      label={scope ? c.name : `${brand}: ${c.name}`}
                      icon={<Mark kind="campaign" id={c.id} size={16} />}
                      active={active}
                      trailing={
                        c.status === "running" ? (
                          <span className="k-dot-pulse ml-auto mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--run)] text-[var(--run)]" aria-label="Running" />
                        ) : (
                          <span className="ml-auto mr-1 h-2 w-2 shrink-0 rounded-full border-[1.5px] border-[var(--fg-3)]" aria-label="Paused" />
                        )
                      }
                    />
                  );
                })}
            </Group>
            <Group title="Records">
              <NavItem href="/leads/" label="Leads" icon={<UsersIcon size={15} />} active={at("/leads") || pathname.startsWith("/leads/view")} trailing={<Count n={leadsInScope} />} />
              <NavItem href="/companies/" label="Companies" icon={<BuildingsIcon size={15} />} active={at("/companies")} />
              {audience && <NavItem href="/audiences/" label={audience.plural ?? audience.label} icon={<UsersThreeIcon size={15} />} active={at("/audiences")} />}
            </Group>
            {pins.length > 0 && (
              <Group title="Pinned">
                {pins.map((p) => (
                  <NavItem
                    key={pinKey(p)}
                    href={pinHref(p)}
                    label={p.label}
                    icon={<Mark kind="object" id={p.id} icon={p.icon} size={16} />}
                    active={pathname.startsWith("/pinned") && pinned === pinKey(p)}
                  />
                ))}
              </Group>
            )}
            <Group title="Production">
              <NavItem href="/research/" label="Research" icon={<FlaskIcon size={15} />} active={at("/research")} />
              <NavItem href="/team/" label="Done by your team" icon={<UserListIcon size={15} />} active={at("/team")} />
              <NavItem href="/accounts/" label="Connected accounts" icon={<PlugsConnectedIcon size={15} />} active={at("/accounts")} />
              <NavItem href="/catalogue/" label="Catalogue" icon={<StackIcon size={15} />} active={at("/catalogue")} />
              <NavItem href="/ledger/" label="Ledger" icon={<ReceiptIcon size={15} />} active={at("/ledger")} />
            </Group>
          </>
        <Group title="Learn">
          <NavItem href="/how-it-works/" label="How it works" icon={<BookOpenIcon size={15} />} active={at("/how-it-works")} />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex h-7 items-center gap-2 rounded-[8px] pl-2 pr-1.5 text-[13px] text-[var(--fg-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-1)]">
            <span className="flex h-4 w-4 items-center justify-center text-[var(--fg-3)]">
              <GithubLogoIcon size={15} />
            </span>
            Source code
          </a>
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

/** Which organization, brand and offer the pages show, like distribute.you. */
function ScopeSwitcher() {
  const { model, scope, offer, setScope } = useSim();
  const orgs = useMemo<ScopeOrg[]>(() => {
    const out: ScopeOrg[] = [];
    for (const c of model?.clients ?? []) {
      let org = out.find((o) => o.id === c.org.id);
      if (!org) out.push((org = { id: c.org.id, name: c.org.name, brands: [] }));
      org.brands.push({ id: c.brand.id, name: c.brand.name, offers: [{ id: c.offer.id, name: c.offer.name }] });
    }
    return out;
  }, [model?.clients]);
  const value = resolveScope(orgs, { orgId: null, brandId: scope, offerId: offer });
  // The pages always show one brand: the first one until another is picked.
  useEffect(() => {
    if (model && (value.brandId !== scope || value.offerId !== offer)) setScope(value.brandId, value.offerId);
  }, [model, value.brandId, value.offerId, scope, offer, setScope]);
  return <ScopeSelector orgs={orgs} value={value} onChange={(v) => setScope(v.brandId, v.offerId)} note={`GTM Factory ${RELEASE} · fictional data`} />;
}

/** The simulator, always in reach above every page: the day, run / pause / one day / speed, reset on a seed. */
function SimBar() {
  return <SimulatorBar />;
}

function SimulatorBar() {
  const { model, playing, run, pause, stepDay, speed, setSpeed, reset, seed } = useSim();
  const [seedText, setSeedText] = useState(String(seed));
  useEffect(() => setSeedText(String(seed)), [seed]);
  const nextSpeed = (): Speed => SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-2 lg:pl-0" role="toolbar" aria-label="Simulator">
      <span className="k-label hidden shrink-0 pl-1 sm:inline">Simulator</span>
      <span className="flex shrink-0 items-center gap-1.5 pl-1 pr-1">
        {playing ? <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" /> : <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-3)]" />}
        <span className="text-[15px] font-medium tabular-nums" data-testid="sim-day">
          Day {model ? model.day : "—"}
        </span>
      </span>
      <button type="button" onClick={playing ? pause : run} className="k-btn-strong shrink-0" aria-label={playing ? "Pause" : "Run"}>
        {playing ? <PauseIcon size={13} weight="fill" /> : <PlayIcon size={13} weight="fill" />}
        {playing ? "Pause" : "Run"}
      </button>
      <button type="button" onClick={stepDay} className="k-btn shrink-0" title="Run one more day">
        <SkipForwardIcon size={13} />
        One day
      </button>
      <button type="button" onClick={() => setSpeed(nextSpeed())} className="k-btn shrink-0 tabular-nums" title="Days per second" aria-label={`Speed: ${speed} days per second`}>
        {speed} days/s
      </button>
      <span className="mx-1 h-5 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
      <span className="k-input flex w-[104px] shrink-0 items-center gap-1 px-2">
        <span className="k-fg3 text-[12px]">Seed</span>
        <input
          aria-label="Seed"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          className="w-full min-w-0 bg-transparent tabular-nums outline-none"
          style={{ font: "inherit" }}
        />
      </span>
      <button type="button" className="k-btn shrink-0" title="Random seed" aria-label="Random seed" onClick={() => setSeedText(String(1 + Math.floor(Math.random() * 99_999)))}>
        <DiceFiveIcon size={13} />
      </button>
      <button type="button" className="k-btn shrink-0" title="Start the world again from day 0 on this seed" onClick={() => reset(Number(seedText) || 1)}>
        <ArrowCounterClockwiseIcon size={13} />
        Reset
      </button>
    </div>
  );
}
