"use client";

/**
 * Keel's primitives as distribute.you dashboard v2 draws them (copied from its `components/v2/ui.tsx`),
 * on the tokens in `keel.css`. Presentation only: every figure is handed in.
 */

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "@phosphor-icons/react";
import { formatRoi, roiIsGood } from "@/lib/format";
import { useOpenNav } from "./nav-context";

export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[var(--data-track)] ${className}`} />;
}

export interface Crumb {
  label: React.ReactNode;
  href?: string;
}

/** The 48px bar at the top of the panel: breadcrumbs left, actions right. */
export function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: React.ReactNode }) {
  const onOpenNav = useOpenNav();
  return (
    <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 bg-[var(--bg-surface)] px-4 md:px-6">
      <span className="-ml-2 lg:hidden">
        <button type="button" onClick={onOpenNav} aria-label="Open navigation" className="k-btn-ghost">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </span>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-2">
              {i > 0 && (
                <svg width="12" height="12" viewBox="0 0 12 12" className="k-fg4 shrink-0" aria-hidden="true">
                  <path d="M4.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {c.href && !last ? (
                <Link href={c.href} className="k-fg2 truncate hover:text-[var(--fg-1)]">
                  {c.label}
                </Link>
              ) : (
                <span className={`truncate ${last ? "k-fg font-medium" : "k-fg2"}`}>{c.label}</span>
              )}
            </span>
          );
        })}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

/** A list page's header: a live sentence as h1, a 14px sub, a status on the right. */
export function PageHeader({ title, sub, right }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.02em]">{title}</h1>
        {sub && <p className="k-fg2 mt-1 max-w-[720px] text-[14px]">{sub}</p>}
      </div>
      {right && <div className="k-fg3 flex items-center gap-2 text-[13px]">{right}</div>}
    </div>
  );
}

export function Page({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto ${narrow ? "max-w-[1100px]" : "max-w-[1280px]"} px-4 pb-16 pt-6 md:px-6`}>{children}</div>;
}

/** A Keel stat tile: mono label + right note, a figure, and a visual under it. */
export function StatTile({
  label,
  note,
  children,
  href,
  className = "",
}: {
  label: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="k-label line-clamp-2 min-w-0">{label}</span>
        {note != null && <span className="k-fg3 shrink-0 truncate text-[12px]">{note}</span>}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  );
  const cls = `k-card flex min-w-0 flex-col px-4 pb-3.5 pt-3 ${className}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A big figure with an optional unit/sub beside it. */
export function Figure({ value, unit, sub, tone }: { value: React.ReactNode; unit?: string; sub?: React.ReactNode; tone?: "run" | "muted" }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={`text-[22px] font-medium leading-7 tracking-[-0.02em] tabular-nums ${tone === "run" ? "text-[var(--run)]" : tone === "muted" ? "k-fg3" : ""}`}>{value}</span>
      {unit && <span className="k-fg2 text-[13px]">{unit}</span>}
      {sub != null && <span className="k-fg3 ml-1 truncate text-[12px]">{sub}</span>}
    </div>
  );
}

/** A series as a soft line. Draws what it is handed; computes nothing. */
export function SparkLine({ values, className = "h-8", color = "var(--accent)" }: { values: number[] | null; className?: string; color?: string }) {
  const id = useId();
  if (!values || values.length < 2) return <div className={className} />;
  const w = 200;
  const h = 40;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ color }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="currentColor" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Keel's vertical "run" bars: one per day, the last ones strongest. */
export function BarSpark({ values, className = "", color = "var(--accent)" }: { values: number[] | null; className?: string; color?: string }) {
  if (!values || values.length === 0) return <div className={`h-6 ${className}`} />;
  const shown = values.slice(-30);
  const max = Math.max(...shown, 1);
  return (
    <div className={`flex h-6 items-end gap-[3px] ${className}`} aria-hidden="true">
      {shown.map((v, i) => (
        <span
          key={i}
          className="w-[5px] rounded-[2px]"
          style={{
            height: `${Math.max(3, (v / max) * 24)}px`,
            background: v > 0 ? color : "var(--data-track)",
            opacity: v > 0 ? 0.35 + 0.65 * (i / Math.max(1, shown.length - 1)) : 1,
          }}
        />
      ))}
    </div>
  );
}

/** A horizontal meter: `value` of `max`. */
export function Meter({ value, max, className = "", color = "var(--accent)" }: { value: number | null; max: number | null; className?: string; color?: string }) {
  const pct = value != null && max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-[var(--data-track)] ${className}`}>
      <div className="k-fill h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** A square initials tile, the way Keel draws a company or a person. */
export function Initials({ name, size = 20, round = false }: { name: string; size?: number; round?: boolean }) {
  const letters =
    name
      .split(/[\s&.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-[var(--bg-inset)] font-medium text-[var(--fg-2)] ring-1 ring-inset ring-[var(--line)] ${round ? "rounded-full" : "rounded-[5px]"}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
    >
      {letters}
    </span>
  );
}

/** A one-line path wider than its cell: clipped with a right fade, slides to its end on hover. */
export function HoverScroll({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const b = box.current;
    const t = track.current;
    if (!b || !t) return;
    const measure = () => setShift(Math.max(0, Math.ceil(t.getBoundingClientRect().width - b.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(t);
    return () => ro.disconnect();
  }, []);
  const style = { "--k-hscroll-shift": `-${shift}px`, "--k-hscroll-dur": `${Math.max(0.6, shift / 40).toFixed(2)}s` } as React.CSSProperties;
  return (
    <span ref={box} className={`k-hscroll ${className}`} data-overflow={shift > 0 ? "" : undefined} style={style}>
      <span ref={track} className="k-hscroll-track">
        {children}
      </span>
    </span>
  );
}

/** "Label  N": Keel's section heading with a quiet count. */
export function SectionTitle({ children, count, right }: { children: React.ReactNode; count?: number | null; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[14px] font-medium">
        {children}
        {count != null && <span className="k-fg3 ml-1.5 font-normal tabular-nums">{count.toLocaleString("en-US")}</span>}
      </h2>
      {right && <div className="k-fg3 flex items-center gap-2 text-[12px]">{right}</div>}
    </div>
  );
}

/** Running / paused as Keel draws an agent's state: a dot and the producer's own word. */
export function StateDot({ running, label }: { running: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-2)]">
      {running ? (
        <span className="k-dot-pulse h-1.5 w-1.5 rounded-full bg-[var(--run)] text-[var(--run)]" />
      ) : (
        <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--fg-2)]" />
      )}
      {label ?? (running ? "Running" : "Paused")}
    </span>
  );
}

/** A dot in a tone and a word: one value wears one tone everywhere. */
export function ToneDot({ tone, children }: { tone: "run" | "teal" | "amber" | "rose" | "muted" | "accent"; children: React.ReactNode }) {
  const color = { run: "var(--run)", teal: "var(--data-teal)", amber: "var(--data-amber)", rose: "var(--data-rose)", muted: "var(--fg-4)", accent: "var(--accent)" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--fg-2)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="k-fg3 px-4 py-8 text-center text-[13px]">{children}</p>;
}

/** Keel's coverage gauge: a half ring of ticks, a marker on break-even. */
export function TickGauge({ value, max, marker, className = "" }: { value: number | null; max: number; marker?: number; className?: string }) {
  const ticks = 22;
  const cx = 60;
  const cy = 56;
  const r1 = 40;
  const r2 = 50;
  const reached = value == null ? 0 : Math.round(Math.min(1, Math.max(0, value / max)) * ticks);
  const at = (f: number, r: number) => {
    const a = Math.PI * (1 - f);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  return (
    <svg viewBox="0 0 120 62" className={`w-full max-w-[124px] ${className}`} aria-hidden="true">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const f = i / ticks;
        const [x1, y1] = at(f, r1);
        const [x2, y2] = at(f, r2);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="3.2" strokeLinecap="round" stroke={i < reached ? "var(--data-teal)" : "var(--data-track)"} />;
      })}
      {marker != null && marker <= max
        ? (() => {
            const [x1, y1] = at(marker / max, r1 - 4);
            const [x2, y2] = at(marker / max, r2 + 4);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg-1)" strokeWidth="1.6" strokeLinecap="round" />;
          })()
        : null}
    </svg>
  );
}

/** Keel's stacked meter: one segment per part, in its colour, of a ceiling. */
export function StackMeter({ parts, max, className = "" }: { parts: { key: string; value: number; color: string }[]; max: number | null; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const scale = max && max > 0 ? Math.max(max, total) : total || 1;
  return (
    <div className={`flex h-2 gap-[2px] overflow-hidden rounded-full bg-[var(--data-track)] ${className}`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.key} className="k-fill h-full first:rounded-l-full" style={{ width: `${(p.value / scale) * 100}%`, background: p.color }} />
        ))}
    </div>
  );
}

export function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="k-keys k-fg3 inline-flex items-center gap-1 text-[12px]">
      {keys.map((k) => (
        <span key={k} className="k-kbd">
          {k}
        </span>
      ))}
      <span className="ml-0.5">{label}</span>
    </span>
  );
}

/** "ROI" with its (i): every return here is expected until enough results are measured. */
export const ROI_TIP = "Return on each $1 spent: value of the clients won, divided by what it cost. Expected = on today's estimates.";

export function RoiLabel({ children = "ROI" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1" title={ROI_TIP}>
      {children}
      <span aria-hidden="true" className="k-fg4 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] ring-1 ring-inset ring-[var(--line)]">
        i
      </span>
    </span>
  );
}

/** A return figure as every surface prints it: measured, with the expected one beside it; never blank. */
export function RoiValue({ measured, expected }: { measured: number | null; expected: number | null }) {
  if (measured == null || measured === 0) {
    if (expected == null) return <span className="k-fg4">—</span>;
    return (
      <span className="whitespace-nowrap">
        <span className={roiIsGood(expected) ? "text-[var(--run)]" : ""}>{formatRoi(expected)}</span>
        <span className="k-fg3 ml-1 text-[11px] font-normal">expected</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      <span className={roiIsGood(measured) ? "text-[var(--run)]" : ""}>{formatRoi(measured)}</span>
      {expected != null && <span className="k-fg3 ml-1 text-[11px] font-normal">Expected {formatRoi(expected)}</span>}
    </span>
  );
}

/** Underline tabs with counts (Keel's records tabs). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: React.ReactNode; count?: number | null }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="k-line-subtle mb-4 flex gap-5 overflow-x-auto border-b" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          aria-current={t.id === value ? "page" : undefined}
          onClick={() => onChange(t.id)}
          className="k-tab shrink-0 text-[13px]"
        >
          {t.label}
          {t.count != null && <span className="k-fg3 tabular-nums">{t.count.toLocaleString("en-US")}</span>}
        </button>
      ))}
    </div>
  );
}

/** A right drawer: `k-popover`, portalled, Esc closes it, header = label + ×. */
export function Drawer({ title, onClose, children, width = 440 }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; width?: number }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host) return null;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" style={{ background: "transparent" }}>
      <div className="absolute inset-0" style={{ background: "#10101224" }} onClick={onClose} />
      <aside className="k-popover k-drawer-in k-scroll absolute bottom-2 right-2 top-2 flex flex-col overflow-y-auto" style={{ width: `min(${width}px, calc(100vw - 16px))` }} role="dialog" aria-modal="true">
        <div className="k-line-subtle sticky top-0 z-10 flex h-11 shrink-0 items-center justify-between border-b bg-[var(--bg-raised)] px-4">
          <span className="k-label">{title}</span>
          <button type="button" onClick={onClose} className="k-btn-ghost" aria-label="Close">
            <XIcon size={14} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </aside>
    </div>,
    host,
  );
}

/** A card table, Keel style. */
export function CardTable({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="k-card overflow-hidden">
      <div className="k-scroll overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
      {footer && <div className="k-fg3 k-line-subtle border-t px-4 py-2.5 text-[12px] tabular-nums">{footer}</div>}
    </div>
  );
}

export const TH = "k-label px-3 py-2.5 text-left font-medium first:pl-4 last:pr-4 whitespace-nowrap";
export const TD = "px-3 py-2 first:pl-4 last:pr-4 align-middle";
export const TDN = "px-3 py-2 first:pl-4 last:pr-4 align-middle text-right tabular-nums whitespace-nowrap";

/** A small "Learning" tag beside a figure the data has not settled yet. */
export function LearningTag() {
  return <span className="k-chip">Learning</span>;
}
