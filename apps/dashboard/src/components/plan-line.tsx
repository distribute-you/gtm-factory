"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { START, type Campaign, type PlanNode } from "@gtm-factory/core";
import { Mark } from "./mark";
import { HoverScroll } from "./ui";
import { outcomeLabel, type Model } from "@/lib/model";
import { campaignPlanLine, type ChainPart, type PlanLine } from "@/lib/plan";

/**
 * A campaign's Plan drawn as its line: its start (Start, or the outcome whose Units a reactive
 * campaign pushes), then each Engine on the chain that carries the subject, as the script it
 * runs now and what it makes, up to the Target. Beside each script, "<n> materials" opens the
 * outcomes its code calls, each with the Provider it comes from.
 */
export function PlanLineView({ model, campaign, line: given, size = "sm", scroll = true }: { model: Model; campaign?: Campaign; line?: PlanLine | null; size?: "sm" | "md"; scroll?: boolean }) {
  const line: PlanLine | null = given ?? (campaign ? campaignPlanLine(model, campaign) : null);
  if (!line) return null;
  const icon = size === "md" ? 18 : 14;
  const drawn = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[13px]" : "text-[12px]"}`}>
      <OutcomeChip model={model} outcome={line.start} size={icon} />
      {line.parts.map((p) => {
        const script = p.scriptId ? model.catalogue.script(p.scriptId) : undefined;
        return (
          <span key={p.outcome} className="inline-flex items-center gap-1.5">
            <Arrow />
            <span className="inline-flex items-center gap-1 rounded-[6px] px-1 py-px" data-engine={p.outcome}>
              <Mark kind={script ? (`script:${script.kind}` as const) : "engine"} id={script?.dynasty ?? p.outcome} size={icon} />
              <span className="k-fg">{script?.name ?? outcomeLabel(model.catalogue, p.outcome)}</span>
              {p.materials.length > 0 && <MaterialsBadge model={model} part={p} interactive={size === "md"} />}
            </span>
            <Arrow />
            <OutcomeChip model={model} outcome={p.outcome} size={icon} />
          </span>
        );
      })}
    </span>
  );
  return scroll ? <HoverScroll>{drawn}</HoverScroll> : drawn;
}

/**
 * "<n> materials" beside a script: a button that opens the outcomes its code calls, each with
 * the Provider it comes from. Inside a link (a list row) it is a plain chip.
 */
export function MaterialsBadge({ model, part, interactive = true }: { model: Model; part: Pick<ChainPart, "outcome" | "scriptId" | "materials">; interactive?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const label = `${part.materials.length} ${part.materials.length === 1 ? "material" : "materials"}`;
  if (!interactive) return <span className="k-chip k-fg3 ml-0.5 text-[11px]">{label}</span>;
  return (
    <>
      <button ref={btn} type="button" className="k-chip ml-0.5 cursor-pointer text-[11px] hover:bg-[var(--bg-hover)]" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-materials={part.outcome}>
        {label}
      </button>
      {open && <MaterialsPopover model={model} part={part} anchor={btn.current} onClose={() => setOpen(false)} />}
    </>
  );
}

function MaterialsPopover({ model, part, anchor, onClose }: { model: Model; part: Pick<ChainPart, "outcome" | "scriptId" | "materials">; anchor: HTMLElement | null; onClose: () => void }) {
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
  const width = 380;
  return createPortal(
    <div className="v2-root fixed inset-0 z-50" style={{ background: "transparent" }} onClick={onClose}>
      <div className="k-popover fixed p-3" style={{ width, top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Materials">
        <p className="k-label mb-1">What its code calls</p>
        <p className="mb-2 flex items-center gap-1.5 text-[13px]">
          <Mark kind={script ? (`script:${script.kind}` as const) : "engine"} id={script?.dynasty ?? part.outcome} size={16} />
          <span className="truncate font-medium">{script?.name ?? outcomeLabel(model.catalogue, part.outcome)}</span>
          <span className="k-fg3 truncate text-[12px]">makes {outcomeLabel(model.catalogue, part.outcome)}</span>
        </p>
        <ul className="divide-y divide-[var(--line-subtle)]">
          {part.materials.map((m) => (
            <MaterialRow key={m.outcome} model={model} node={m} consumer={part.outcome} />
          ))}
        </ul>
      </div>
    </div>,
    host,
  );
}

function MaterialRow({ model, node, consumer }: { model: Model; node: PlanNode; consumer: string }) {
  const o = model.catalogue.outcome(node.outcome);
  const script = node.scriptId ? model.catalogue.script(node.scriptId) : undefined;
  const from = script
    ? script.name
    : o?.subject === "brand" && node.candidates > 0
      ? `the brand's ${node.candidates === 1 ? "Unit" : `${node.candidates} Units`}`
      : o?.contentType === "rating"
        ? "today's Rating"
        : o?.track
          ? "the milestone it starts from"
          : "the stock";
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12px]" data-material={`${consumer}|${node.outcome}`}>
      <Mark kind="material" id={node.outcome} icon={o?.icon} size={16} />
      <span className="min-w-0 flex-1 truncate">{outcomeLabel(model.catalogue, node.outcome)}</span>
      <span className="k-fg3 inline-flex shrink-0 items-center gap-1">
        Provider:
        {script && <Mark kind={`script:${script.kind}`} id={script.dynasty} size={14} />}
        <span className="k-fg2">{from}</span>
      </span>
    </li>
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
