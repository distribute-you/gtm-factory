"use client";

import { START, type Campaign } from "@gtm-factory/engine";
import { Mark } from "./mark";
import { HoverScroll } from "./ui";
import { legPlays, outcomeLabel, pipeName, type Model } from "@/lib/model";

/**
 * A sales funnel drawn as its straight line: Start (or the trigger whose events open it),
 * then the pipe playing each leg today, then the lead state it reaches, up to the target.
 */
export function FunnelLine({ model, campaign, size = "sm", scroll = true }: { model: Model; campaign: Campaign; size?: "sm" | "md"; scroll?: boolean }) {
  const legs = legPlays(model, campaign);
  const icon = size === "md" ? 18 : 14;
  const trigger = campaign.entry.kind === "trigger" ? model.catalogue.trigger(campaign.entry.triggerId) : null;
  const line = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[13px]" : "text-[12px]"}`}>
      {trigger ? (
        <span className="inline-flex items-center gap-1">
          <Mark kind="trigger" id={trigger.id} size={icon} />
          <span className="k-fg2">{trigger.label}</span>
        </span>
      ) : (
        <OutcomeChip model={model} outcome={START} size={icon} />
      )}
      {legs.map((l) => (
        <span key={`${l.from}>${l.to}`} className="inline-flex items-center gap-1.5">
          <Arrow />
          {l.pipeId && (
            <>
              <span className="inline-flex items-center gap-1 rounded-[6px] px-1 py-px" title={l.options.length > 1 ? `${l.options.length} pipes compete on this leg` : undefined}>
                <Mark kind="pipe" id={l.pipeId} icon={model.catalogue.pipe(l.pipeId)?.icon} size={icon} />
                <span className="k-fg">{pipeName(model.catalogue, l.pipeId)}</span>
              </span>
              <Arrow />
            </>
          )}
          <OutcomeChip model={model} outcome={l.to} size={icon} />
        </span>
      ))}
    </span>
  );
  return scroll ? <HoverScroll>{line}</HoverScroll> : line;
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
