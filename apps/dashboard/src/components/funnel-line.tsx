"use client";

import { START, type Catalogue } from "@gtm-factory/engine";
import { Mark } from "./mark";
import { HoverScroll } from "./ui";
import { channelName, playPipe, stepLabel } from "@/lib/model";

/**
 * A sales funnel drawn as its straight line: Start (or the trigger that wakes its first pipe),
 * then a channel between every two steps, up to the target. Read off the catalogue only.
 */
export function FunnelLine({ catalogue, plays, size = "sm", scroll = true }: { catalogue: Catalogue; plays: readonly string[]; size?: "sm" | "md"; scroll?: boolean }) {
  const pipes = plays.map((p) => playPipe(catalogue, p)).filter((p): p is NonNullable<typeof p> => !!p);
  if (pipes.length === 0) return <span className="k-fg4">—</span>;
  const first = pipes[0]!;
  const trigger = first.mode === "reactive" && first.triggerId ? catalogue.trigger(first.triggerId) : null;
  const icon = size === "md" ? 18 : 14;
  const line = (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${size === "md" ? "text-[13px]" : "text-[12px]"}`}>
      {trigger ? (
        <span className="inline-flex items-center gap-1">
          <Mark kind="trigger" id={trigger.id} size={icon} />
          <span className="k-fg2">{trigger.label}</span>
        </span>
      ) : (
        <StepChip catalogue={catalogue} step={first.from} size={icon} />
      )}
      {pipes.map((p) => {
        const ch = catalogue.channel(p.channel);
        return (
          <span key={p.id} className="inline-flex items-center gap-1.5">
            <Arrow />
            <span className="inline-flex items-center gap-1 rounded-[6px] px-1 py-px" title={`${p.name ?? p.id}: ${channelName(catalogue, p)}`}>
              <Mark kind="channel" id={p.channel} icon={ch?.icon} size={icon} />
              <span className="k-fg">{channelName(catalogue, p)}</span>
            </span>
            <Arrow />
            <StepChip catalogue={catalogue} step={p.to} size={icon} />
          </span>
        );
      })}
    </span>
  );
  return scroll ? <HoverScroll>{line}</HoverScroll> : line;
}

export function StepChip({ catalogue, step, size = 14 }: { catalogue: Catalogue; step: string; size?: number }) {
  const s = catalogue.step(step);
  return (
    <span className="inline-flex items-center gap-1">
      {step === START ? <Mark kind="start" id="start" size={size} quiet /> : <Mark kind="step" id={step} icon={s?.icon} size={size} />}
      <span className="k-fg2">{stepLabel(catalogue, step)}</span>
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
