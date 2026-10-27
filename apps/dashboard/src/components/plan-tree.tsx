"use client";

import { START } from "@gtm-factory/core";
import { Mark, type MarkKind } from "./mark";
import { formatCount, formatRatePct, formatUsd } from "@/lib/format";

/** A brand input whose versions compete inside a script's runs (an ICP, a template), as a page shows it. */
export interface TreeInput {
  label: string;
  versions: { label: string; share: number }[];
}

/** One script that made its node's outcome this week, and what ran under it. */
export interface TreeBranch {
  key: string;
  name: string;
  kind: string;
  dynasty: string;
  units: number;
  share: number;
  costPerUnit: number | null;
  /** The script the Plan picks there this tick. */
  current: boolean;
  inputs: TreeInput[];
  /** Calls the same outcomes as a sibling drawn in full. */
  sameBelow: boolean;
  children: TreeNode[];
}

/** One outcome of the Plan tree and the scripts that made it. */
export interface TreeNode {
  outcome: string;
  label: string;
  icon?: string;
  candidates: number;
  branches: TreeBranch[];
}

/** The brand inputs of one script, in one line each: "ICP: Finer (day 21) 91%, Revenue $5M+ 9%". */
export function InputsLine({ inputs, className = "" }: { inputs: TreeInput[]; className?: string }) {
  if (inputs.length === 0) return null;
  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      {inputs.map((i) => (
        <span key={i.label} className="k-fg2 truncate text-[12px]" data-input={i.label}>
          <span className="k-fg3">{i.label}: </span>
          {i.versions.map((v, k) => (
            <span key={v.label} className="tabular-nums">
              {k > 0 ? ", " : ""}
              {v.label} {formatRatePct(v.share)}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * A campaign's Plan as a tree of what ran this week, read from the Target down: each outcome,
 * every script that made it (its share, its cost per Unit, the brand inputs it used), and
 * under each script the outcomes it calls. The Plan's pick of this tick is marked. A branch
 * that calls the same outcomes as its sibling is not drawn twice.
 */
export function PlanTree({ root, start, startLabel, target }: { root: TreeNode | null; start: string; startLabel: string; target: string }) {
  return (
    <div className="k-card overflow-x-auto px-5 py-4" data-testid="campaign-plan">
      {root ? <NodeView node={root} target={target} depth={0} /> : <p className="k-fg3 text-[13px]">No Plan yet: it is computed at the first tick.</p>}
      <div className="mt-3 flex items-center gap-2 border-t border-[var(--line-subtle)] pt-3 text-[12px]">
        {start === START ? <Mark kind="start" id="start" size={16} quiet /> : <Mark kind="outcome" id={start} size={16} />}
        <span className="k-fg2">
          Everything starts from <span className="font-medium text-[var(--fg-1)]">{startLabel}</span>
          {start === START ? ", pulled at each tick." : ": each one that lands is pushed up."}
        </span>
      </div>
    </div>
  );
}

function NodeView({ node, target, depth }: { node: TreeNode; target: string; depth: number }) {
  const isTarget = node.outcome === target && depth === 0;
  return (
    <div data-plan-node={node.outcome}>
      <div className="flex items-center gap-2 py-1">
        <Mark kind="engine" id={node.outcome} icon={node.icon} size={depth === 0 ? 26 : 20} />
        <span className={`truncate font-medium ${depth === 0 ? "text-[15px]" : "text-[13px]"}`}>{node.label}</span>
        {isTarget && <span className="k-chip">Target</span>}
        {node.candidates > 1 && <span className="k-fg3 text-[12px]">{formatCount(node.candidates)} scripts compete</span>}
      </div>
      <div className="ml-[9px] border-l border-[var(--line)] pl-4">
        {node.branches.map((b) => (
          <BranchView key={b.key} branch={b} target={target} depth={depth} />
        ))}
        {node.branches.length === 0 && <p className="k-fg3 py-1 text-[12px]">No script ran here this week.</p>}
      </div>
    </div>
  );
}

function BranchView({ branch: b, target, depth }: { branch: TreeBranch; target: string; depth: number }) {
  return (
    <div className="py-1" data-plan-branch={b.dynasty}>
      <div className={`flex items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13px] ${b.current ? "bg-[var(--accent-soft,var(--bg-inset))] ring-1 ring-inset ring-[var(--accent)]" : "bg-[var(--bg-inset)]"}`}>
        <Mark kind={`script:${b.kind}` as MarkKind} id={b.dynasty} size={18} />
        <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
        {b.current && <span className="k-chip shrink-0 text-[var(--accent)]">Plan&apos;s pick today</span>}
        <span className="inline-block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--data-track)]" aria-hidden="true">
          <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(b.share * 100)}%` }} />
        </span>
        <span className="w-10 shrink-0 text-right tabular-nums">{formatRatePct(b.share)}</span>
        <span className="k-fg3 w-[86px] shrink-0 text-right text-[12px] tabular-nums">{b.costPerUnit != null ? `${formatUsd(b.costPerUnit)} each` : "—"}</span>
      </div>
      <InputsLine inputs={b.inputs} className="mt-1 pl-9" />
      {b.sameBelow ? (
        <p className="k-fg3 pl-9 pt-0.5 text-[12px]">Calls the same outcomes as the Plan's pick above: drawn once.</p>
      ) : (
        b.children.length > 0 && (
          <div className="mt-1 pl-4">
            {b.children.map((c) => (
              <NodeView key={c.outcome} node={c} target={target} depth={depth + 1} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** One milestone reached from the one before, this week, and by which script. */
export interface FlowView {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  subjects: number;
  by: { name: string; subjects: number; share: number }[];
}

/** What a campaign's subjects went through this week, milestone to milestone. */
export function Flows({ flows, unit }: { flows: FlowView[]; unit: string }) {
  if (flows.length === 0) return <p className="k-fg3 text-[13px]">Nobody reached a milestone this week yet.</p>;
  return (
    <div className="k-card divide-y divide-[var(--line-subtle)]" data-testid="campaign-flows">
      {flows.map((f) => (
        <div key={`${f.from}>${f.to}`} className="grid gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="k-fg2 truncate">{f.fromLabel}</span>
            <span className="k-fg4">→</span>
            <span className="truncate font-medium">{f.toLabel}</span>
            <span className="k-fg3 ml-auto shrink-0 tabular-nums">
              {formatCount(f.subjects)} {unit}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            {f.by.map((b) => (
              <span key={b.name} className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="font-medium">{formatRatePct(b.share)}</span>
                <span className="k-fg2">by {b.name}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
