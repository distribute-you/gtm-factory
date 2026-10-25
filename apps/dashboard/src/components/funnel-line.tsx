"use client";

import { START, type Campaign, type RankedFunnel } from "@gtm-factory/engine";
import { Mark } from "./mark";
import { HoverScroll } from "./ui";
import { outcomeLabel, type Model } from "@/lib/model";
import { campaignLine, rankedLine, type FunnelLineModel } from "@/lib/funnels";

/**
 * A sales funnel drawn as its straight line: Start (or the trigger whose events open it), then
 * every pipe each leg runs through, in the order they run, with what each makes, up to the target.
 * A pipe feeding a side input (a research, a model call) rides as a small mark beside the pipe it
 * feeds. The plays list of a campaign reads the same model: they never disagree.
 */
export function FunnelLine({ model, campaign, funnel, line: given, size = "sm", scroll = true }: { model: Model; campaign?: Campaign; funnel?: RankedFunnel; line?: FunnelLineModel | null; size?: "sm" | "md"; scroll?: boolean }) {
  const line: FunnelLineModel | null = given ?? (campaign ? campaignLine(model, campaign) : funnel ? rankedLine(model, funnel) : null);
  if (!line) return null;
  const icon = size === "md" ? 18 : 14;
  const drawn = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[13px]" : "text-[12px]"}`} data-funnel={line.funnel?.id ?? line.path.id}>
      {line.trigger ? (
        <span className="inline-flex items-center gap-1">
          <Mark kind="trigger" id={line.trigger.id} size={icon} />
          <span className="k-fg2">{line.trigger.label}</span>
        </span>
      ) : (
        <OutcomeChip model={model} outcome={START} size={icon} />
      )}
      {line.legs.map((l, k) => (
        <span key={`${k}:${l.from}>${l.to}`} className="inline-flex items-center gap-1.5">
          {l.parts.map((p) => (
            <span key={p.pipe.id} className="inline-flex items-center gap-1.5">
              <Arrow />
              <span className="inline-flex items-center gap-1 rounded-[6px] px-1 py-px" data-pipe={p.pipe.id}>
                {p.side.map((s) => (
                  <span key={s.id} title={`${s.name} feeds it`} data-pipe={s.id} className="inline-flex">
                    <Mark kind="pipe" id={s.id} icon={s.icon} size={icon - 2} />
                  </span>
                ))}
                <Mark kind="pipe" id={p.pipe.id} icon={p.pipe.icon} size={icon} />
                <span className="k-fg">{p.pipe.name}</span>
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

/** The sales funnel's name and its path's, in one line. */
export function FunnelName({ model, campaign, funnel }: { model: Model; campaign?: Campaign; funnel?: RankedFunnel }) {
  const line = campaign ? campaignLine(model, campaign) : funnel ? rankedLine(model, funnel) : null;
  if (!line) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px]">
      <Mark kind="funnel" id={line.funnel?.id ?? line.path.id} size={14} />
      <span className="truncate">{line.funnel?.name ?? "No play yet"}</span>
      <span className="k-fg3 truncate">on the path {line.path.name.toLowerCase()}</span>
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
