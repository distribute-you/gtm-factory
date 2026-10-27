"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { START, describeCondition, type Campaign, type OutcomeId, type RankedFunnel } from "@gtm-factory/engine";
import { Mark } from "./mark";
import { HoverScroll } from "./ui";
import { outcomeLabel, type Model } from "@/lib/model";
import { campaignLine, rankedLine, type FunnelLineModel, type LinePart } from "@/lib/funnels";

/**
 * A sales funnel (a view of the campaign's tree) drawn as its straight line: its start outcome
 * (Start, or the outcome whose Units a reactive campaign pushes), then every leg each step runs
 * through, in the order they run, with what each makes, up to the Target. Beside each leg, a
 * "<n> materials" badge opens the Bill of materials of the script it runs, each Material with the
 * leg that supplies it. The plays list of a campaign reads the same model: they never disagree.
 */
export function FunnelLine({ model, campaign, funnel, line: given, size = "sm", scroll = true }: { model: Model; campaign?: Campaign; funnel?: RankedFunnel; line?: FunnelLineModel | null; size?: "sm" | "md"; scroll?: boolean }) {
  const line: FunnelLineModel | null = given ?? (campaign ? campaignLine(model, campaign) : funnel ? rankedLine(model, funnel) : null);
  if (!line) return null;
  const icon = size === "md" ? 18 : 14;
  const drawn = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[13px]" : "text-[12px]"}`} data-funnel={line.funnel?.id ?? line.path.id}>
      <OutcomeChip model={model} outcome={line.start} size={icon} />
      {line.steps.map((l, k) => (
        <span key={`${k}:${l.from}>${l.to}`} className="inline-flex items-center gap-1.5">
          {l.parts.map((p) => (
            <span key={p.leg.id} className="inline-flex items-center gap-1.5">
              <Arrow />
              <span className="inline-flex items-center gap-1 rounded-[6px] px-1 py-px" data-leg={p.leg.id}>
                <Mark kind="leg" id={p.leg.id} icon={p.leg.icon} size={icon} />
                <span className="k-fg">{p.leg.name}</span>
                {p.materials.length > 0 && <MaterialsBadge model={model} part={p} interactive={size === "md"} />}
              </span>
              <Arrow />
              <OutcomeChip model={model} outcome={p.output} size={icon} />
            </span>
          ))}
          {l.parts.length === 0 && (
            <>
              <Arrow />
              <OutcomeChip model={model} outcome={l.to} size={icon} />
            </>
          )}
        </span>
      ))}
    </span>
  );
  return scroll ? <HoverScroll>{drawn}</HoverScroll> : drawn;
}

/**
 * "<n> materials" beside a leg: a button that opens the Bill of materials of the script the leg
 * runs, each Material with the leg that supplies it. Inside a link (a list row) it is a plain chip.
 */
export function MaterialsBadge({ model, part, interactive = true }: { model: Model; part: Pick<LinePart, "leg" | "scriptId" | "materials">; interactive?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const label = `${part.materials.length} ${part.materials.length === 1 ? "material" : "materials"}`;
  if (!interactive) return <span className="k-chip k-fg3 ml-0.5 text-[11px]">{label}</span>;
  return (
    <>
      <button ref={btn} type="button" className="k-chip ml-0.5 cursor-pointer text-[11px] hover:bg-[var(--bg-hover)]" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-materials={part.leg.id}>
        {label}
      </button>
      {open && <BillPopover model={model} part={part} anchor={btn.current} onClose={() => setOpen(false)} />}
    </>
  );
}

function BillPopover({ model, part, anchor, onClose }: { model: Model; part: Pick<LinePart, "leg" | "scriptId" | "materials">; anchor: HTMLElement | null; onClose: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.getElementById("portal"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host || !anchor) return null;
  const r = anchor.getBoundingClientRect();
  const script = part.scriptId ? model.catalogue.script(part.scriptId) : undefined;
  const width = 360;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" onClick={onClose}>
      <div className="k-popover fixed p-3" style={{ width, top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Bill of materials">
        <p className="k-label mb-1">Bill of materials</p>
        <p className="mb-2 flex items-center gap-1.5 text-[13px]">
          <Mark kind="script" id={script?.dynasty ?? part.leg.id} size={16} />
          <span className="truncate font-medium">{script?.name ?? part.leg.name}</span>
          <span className="k-fg3 truncate text-[12px]">runs {part.leg.name}</span>
        </p>
        <ul className="divide-y divide-[var(--line-subtle)]">
          {part.materials.map((m) => (
            <MaterialRow key={m.material} model={model} material={m.material} supplier={m.leg} conditions={script?.materials.find((x) => x.outcome === m.material)?.conditions ?? []} />
          ))}
        </ul>
      </div>
    </div>,
    host,
  );
}

function MaterialRow({ model, material, supplier, conditions }: { model: Model; material: OutcomeId; supplier: string | null; conditions: import("@gtm-factory/engine").Condition[] }) {
  const leg = supplier ? model.catalogue.leg(supplier) : undefined;
  const o = model.catalogue.outcome(material);
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12px]">
      <Mark kind="material" id={material} icon={o?.icon} size={16} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{outcomeLabel(model.catalogue, material)}</span>
        {conditions.length > 0 && <span className="k-fg3 block truncate">{conditions.map((c) => describeCondition(c, model.catalogue)).join(", ")}</span>}
      </span>
      <span className="k-fg3 inline-flex shrink-0 items-center gap-1">
        {leg ? (
          <>
            from <Mark kind="leg" id={leg.id} icon={leg.icon} size={14} />
            <span className="k-fg2">{leg.name}</span>
          </>
        ) : o?.track ? (
          "the step it starts from"
        ) : (
          "the stock"
        )}
      </span>
    </li>
  );
}

/** The two views of a campaign's tree, each with its short name: the sales funnel and the sales path. */
export function FunnelName({ model, campaign, funnel }: { model: Model; campaign?: Campaign; funnel?: RankedFunnel }) {
  const line = campaign ? campaignLine(model, campaign) : funnel ? rankedLine(model, funnel) : null;
  if (!line) return null;
  return (
    <span className="flex min-w-0 flex-col gap-1 text-[13px]">
      <span className="flex min-w-0 items-center gap-1.5">
        <Mark kind="funnel" id={line.funnel?.id ?? line.path.id} size={16} />
        <span className="k-fg3 shrink-0">Sales funnel:</span>
        <span className="truncate font-medium">{line.funnel?.name ?? "Not run yet"}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Mark kind="path" id={line.path.id} size={16} />
        <span className="k-fg3 shrink-0">Sales path:</span>
        <span className="truncate font-medium">{line.path.name}</span>
      </span>
    </span>
  );
}

export function OutcomeChip({ model, outcome, size = 14 }: { model: Model; outcome: string; size?: number }) {
  const o = model.catalogue.outcome(outcome);
  return (
    <span className="inline-flex items-center gap-1">
      {outcome === START ? <Mark kind="start" id="start" size={size} quiet /> : <Mark kind="outcome" id={outcome} icon={o?.icon} size={size} />}
      <span className="k-fg2">{outcomeLabel(model.catalogue, outcome)}</span>
    </span>
  );
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="k-fg4 shrink-0" aria-hidden="true">
      <path d="M2 6h8m-3-3 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
