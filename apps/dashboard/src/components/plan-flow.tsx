"use client";

import { START } from "@gtm-factory/core";
import { Mark, type MarkKind } from "./mark";
import { formatRatePct, formatUsd } from "@/lib/format";

/** One script that made an Engine's outcome over the last 7 days: its share of the Units and its cost per Unit. */
export interface FlowBranch {
  name: string;
  share: number;
  costPerUnit: number | null;
}

/** What the script of a node calls besides the subject: a template, an LLM completion, the Rating. */
export interface FlowSide {
  outcome: string;
  label: string;
  icon?: string;
  /** Where its Provider gets it: a script name, the brand's Units, today's Rating. */
  from: string;
}

/** One Engine on the chain that carries the subject. */
export interface FlowNode {
  outcome: string;
  label: string;
  icon?: string;
  script: { name: string; kind: string; dynasty: string } | null;
  /** Scripts competing in this Engine. */
  candidates: number;
  branches: FlowBranch[];
  sides: FlowSide[];
}

/**
 * A campaign's Plan as a vertical workflow: its start at the top, then one card per Engine
 * on the chain that carries the subject, down to the Target. Each card says the script its
 * Engine runs now and what actually made the outcome this week; what the script calls hangs
 * off the card's side.
 */
export function PlanFlow({ start, startLabel, nodes, target }: { start: string; startLabel: string; nodes: FlowNode[]; target: string }) {
  return (
    <div className="k-card overflow-x-auto px-6 py-6" data-testid="campaign-plan">
      <div className="mx-auto flex w-fit min-w-[min(100%,760px)] flex-col items-start">
        <StartNode start={start} label={startLabel} />
        {nodes.map((s) => (
          <div key={s.outcome} className="flex flex-col items-start">
            <Connector />
            <EngineNode node={s} isTarget={s.outcome === target} />
          </div>
        ))}
      </div>
    </div>
  );
}

const CARD_W = 400;

function StartNode({ start, label }: { start: string; label: string }) {
  return (
    <div className="flex items-center justify-center" style={{ width: CARD_W }}>
      <span className="inline-flex items-center gap-2 rounded-full bg-[var(--bg-inset)] px-3 py-1.5 text-[13px] ring-1 ring-inset ring-[var(--line)]" data-plan-node={start}>
        {start === START ? <Mark kind="start" id="start" size={18} quiet /> : <Mark kind="outcome" id={start} size={18} />}
        <span className="font-medium">{label}</span>
        <span className="k-fg3">{start === START ? "pulls each tick" : "each one that lands is pushed"}</span>
      </span>
    </div>
  );
}

/** A vertical line with an arrowhead, centred under the card above. */
function Connector() {
  return (
    <div className="flex justify-center" style={{ width: CARD_W }} aria-hidden="true">
      <svg width="12" height="34" viewBox="0 0 12 34" className="text-[var(--line-strong,var(--fg-4))]">
        <path d="M6 0v28" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2 25l4 6 4-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function EngineNode({ node, isTarget }: { node: FlowNode; isTarget: boolean }) {
  return (
    <div className="flex items-start" data-plan-node={node.outcome}>
      <div className={`k-card shrink-0 p-3.5 ${isTarget ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`} style={{ width: CARD_W }}>
        <div className="flex items-center gap-2.5">
          <Mark kind="engine" id={node.outcome} icon={node.icon} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium leading-5">{node.label}</p>
            <p className="k-fg3 truncate text-[12px] leading-4">{isTarget ? "The Target" : "Engine"}</p>
          </div>
          {node.candidates > 1 && <span className="k-chip shrink-0">best of {node.candidates}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-[8px] bg-[var(--bg-inset)] px-2.5 py-2 text-[13px]">
          {node.script ? (
            <>
              <Mark kind={`script:${node.script.kind}` as MarkKind} id={node.script.dynasty} size={18} />
              <span className="k-fg3 shrink-0">Runs</span>
              <span className="min-w-0 flex-1 truncate font-medium">{node.script.name}</span>
            </>
          ) : (
            <span className="k-fg3">No script can run here today</span>
          )}
        </div>
        {node.branches.length > 0 && (
          <div className="mt-2.5 space-y-1">
            <p className="k-fg3 text-[11px]">Made this week by</p>
            {node.branches.slice(0, 3).map((b) => (
              <div key={b.name} className="flex items-center gap-2 text-[12px] tabular-nums">
                <span className="inline-block h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--data-track)]">
                  <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(b.share * 100)}%` }} />
                </span>
                <span className="w-9 shrink-0 text-right">{formatRatePct(b.share)}</span>
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <span className="k-fg3 shrink-0">{b.costPerUnit != null ? `${formatUsd(b.costPerUnit)} each` : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {node.sides.length > 0 && (
        <div className="flex items-start pt-5">
          <svg width="28" height="12" viewBox="0 0 28 12" className="mt-1.5 shrink-0 text-[var(--fg-4)]" aria-hidden="true">
            <path d="M0 6h28" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" />
          </svg>
          <div className="space-y-1.5">
            {node.sides.map((m) => (
              <div key={m.outcome} className="flex w-[260px] items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] ring-1 ring-inset ring-[var(--line)]" data-material={`${node.outcome}|${m.outcome}`}>
                <Mark kind="material" id={m.outcome} icon={m.icon} size={16} />
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                <span className="k-fg3 max-w-[120px] shrink-0 truncate">{m.from}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
