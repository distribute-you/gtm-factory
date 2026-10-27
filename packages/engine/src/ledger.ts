/**
 * The ledger. A run is a production order: it consumes Units, produces
 * Units and has a cost. From the runs alone the ledger answers two
 * different questions:
 *
 *  DECIDE (choices read this): each leg's OWN cost per input processed and
 *  its yield. Inputs bought from other legs are not in it.
 *
 *  REPORT (prices, indexes, reports read this): the unit cost of each outcome
 *  every path, inputs at their own unit cost, normal loss absorbed, cycles
 *  solved, abnormal loss and support stated apart.
 *
 * Money is integer cents. The to-the-cent check:
 *   sum of standard cost on Units (one charge per consumption)
 *   - reuse gain + spend of runs producing none = total run spend.
 */

type StepKey = string;

export interface LedgerUnit {
  id: string;
  outcome: StepKey;
  /** The lead or object this Unit is about. */
  subject: string;
  runId: string;
  day: number;
  /** Relative quantity when a run states one (default 1). */
  quantity?: number;
}

export interface LedgerRun {
  id: string;
  legId: string | null;
  /** The outcome this run works toward (its leg's to step). */
  target: StepKey | null;
  day: number;
  /** Integer cents. */
  spendCents: number;
  /** Ids of the Units this run consumed. */
  consumed: string[];
  /** Inputs processed, when they are not all consumed Units (a run from Start processes trials). Default: consumed count, or 1. */
  inputs?: number;
  /** Work for no outcome (setup, experiments...): stated apart. */
  support?: { kind: string; reason: string };
  /** Abnormal loss (a run on a lead already past its target, a loop): stated apart. */
  abnormalLoss?: string;
  /** Who ran it: our factory, or another one at its access cost (`spendCents`). */
  factory?: string;
  /** Context, for reports only (the arithmetic never reads it). */
  campaignId?: string;
  scriptId?: string;
}

export interface LegOwnCost {
  legId: string;
  spendCents: number;
  /** Inputs processed (each run's `inputs`, else its consumed Units, else 1). */
  inputs: number;
  outputs: number;
  /** Dollars per input processed. */
  costPerInput: number | null;
  /** Outputs per input. */
  yieldRate: number | null;
  /** Dollars per output, own production only. */
  costPerOutcome: number | null;
}

export interface OutcomeUnitCost {
  outcome: StepKey;
  produced: number;
  /** Own production of the runs working toward it (normal loss included), cents. */
  productionCents: number;
  /** Inputs from other outcomes, at their unit cost, dollars. */
  inputsValue: number;
  /** Every-path unit cost, dollars; null when nothing was produced or the cycle diverges. */
  unitCost: number | null;
}

export interface LedgerReport {
  totalSpendCents: number;
  /** Standard cost of each Unit (its share of its producing run), cents. */
  standardCents: Record<string, number>;
  /** Consumptions per Unit. */
  consumptions: Record<string, number>;
  standardChargedCents: number;
  reuseGainCents: number;
  runsProducingNone: { normalLossCents: number; abnormalLossCents: number; supportCents: number; totalCents: number };
  reconciles: boolean;
  decide: LegOwnCost[];
  report: OutcomeUnitCost[];
  /** Outcomes whose cycle of inputs does not converge. */
  divergent: StepKey[];
}

/** Split integer cents in proportion to weights, largest remainder, exact to the cent. */
export function splitCents(totalCents: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return splitCents(totalCents, weights.map(() => 1));
  const raw = weights.map((w) => (totalCents * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let left = totalCents - out.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]! += 1;
  return out;
}

export function buildLedger(runs: readonly LedgerRun[], units: readonly LedgerUnit[]): LedgerReport {
  const runById = new Map(runs.map((r) => [r.id, r]));
  const unitById = new Map(units.map((o) => [o.id, o]));
  const producedBy = new Map<string, LedgerUnit[]>();
  for (const o of units) {
    if (!runById.has(o.runId)) throw new Error(`Unit ${o.id} names unknown run ${o.runId}`);
    producedBy.set(o.runId, [...(producedBy.get(o.runId) ?? []), o]);
  }

  const standardCents: Record<string, number> = {};
  const consumptions: Record<string, number> = {};
  const none = { normalLossCents: 0, abnormalLossCents: 0, supportCents: 0, totalCents: 0 };
  let totalSpendCents = 0;

  for (const r of runs) {
    if (!Number.isInteger(r.spendCents)) throw new Error(`run ${r.id}: spend must be integer cents`);
    totalSpendCents += r.spendCents;
    const produced = producedBy.get(r.id) ?? [];
    if ((r.support || r.abnormalLoss) && produced.length > 0)
      throw new Error(`run ${r.id}: a support or abnormal-loss run produces nothing`);
    if (new Set(produced.map((o) => o.outcome)).size > 1) throw new Error(`run ${r.id}: one run produces one outcome key`);
    for (const id of r.consumed) {
      if (!unitById.has(id)) throw new Error(`run ${r.id} consumes unknown Unit ${id}`);
      consumptions[id] = (consumptions[id] ?? 0) + 1;
    }
    if (produced.length === 0) {
      if (r.support) none.supportCents += r.spendCents;
      else if (r.abnormalLoss) none.abnormalLossCents += r.spendCents;
      else none.normalLossCents += r.spendCents;
      none.totalCents += r.spendCents;
      continue;
    }
    const shares = splitCents(r.spendCents, produced.map((o) => o.quantity ?? 1));
    produced.forEach((o, i) => (standardCents[o.id] = shares[i]!));
  }

  let standardChargedCents = 0;
  let reuseGainCents = 0;
  for (const o of units) {
    const s = standardCents[o.id] ?? 0;
    const charges = Math.max(1, consumptions[o.id] ?? 0);
    standardChargedCents += s * charges;
    reuseGainCents += s * (charges - 1);
  }

  // ---- DECIDE: each leg's own cost --------------------------------------
  const legAgg = new Map<string, { spend: number; inputs: number; outputs: number }>();
  for (const r of runs) {
    if (!r.legId || r.support || r.abnormalLoss) continue;
    const a = legAgg.get(r.legId) ?? { spend: 0, inputs: 0, outputs: 0 };
    a.spend += r.spendCents;
    a.inputs += r.inputs ?? (r.consumed.length > 0 ? r.consumed.length : 1);
    a.outputs += (producedBy.get(r.id) ?? []).reduce((s, o) => s + (o.quantity ?? 1), 0);
    legAgg.set(r.legId, a);
  }
  const decide: LegOwnCost[] = [...legAgg.entries()].map(([legId, a]) => ({
    legId,
    spendCents: a.spend,
    inputs: a.inputs,
    outputs: a.outputs,
    costPerInput: a.inputs > 0 ? a.spend / 100 / a.inputs : null,
    yieldRate: a.inputs > 0 ? a.outputs / a.inputs : null,
    costPerOutcome: a.outputs > 0 ? a.spend / 100 / a.outputs : null,
  }));

  // ---- REPORT: unit cost per outcome, every path ---------------------------
  const outcomes = [...new Set([...units.map((o) => o.outcome), ...runs.map((r) => r.target).filter((t): t is string => !!t)])];
  const produced = new Map<StepKey, number>();
  for (const o of units) produced.set(o.outcome, (produced.get(o.outcome) ?? 0) + (o.quantity ?? 1));
  const production = new Map<StepKey, number>();
  const inputCounts = new Map<StepKey, Map<StepKey, number>>();
  for (const r of runs) {
    if (r.support || r.abnormalLoss) continue;
    const out = (producedBy.get(r.id) ?? [])[0]?.outcome ?? r.target;
    if (!out) continue;
    production.set(out, (production.get(out) ?? 0) + r.spendCents);
    const m = inputCounts.get(out) ?? new Map<StepKey, number>();
    for (const id of r.consumed) {
      const input = unitById.get(id)!.outcome;
      m.set(input, (m.get(input) ?? 0) + 1);
    }
    inputCounts.set(out, m);
  }
  const { unit, divergent } = solveUnitCosts(outcomes, produced, production, inputCounts);
  const report: OutcomeUnitCost[] = outcomes.map((s) => {
    let inputsValue = 0;
    for (const [input, count] of inputCounts.get(s) ?? []) inputsValue += count * (unit.get(input) ?? 0);
    return {
      outcome: s,
      produced: produced.get(s) ?? 0,
      productionCents: production.get(s) ?? 0,
      inputsValue,
      unitCost: unit.has(s) ? unit.get(s)! : null,
    };
  });

  return {
    totalSpendCents,
    standardCents,
    consumptions,
    standardChargedCents,
    reuseGainCents,
    runsProducingNone: none,
    reconciles: standardChargedCents - reuseGainCents + none.totalCents === totalSpendCents,
    decide,
    report,
    divergent,
  };
}

/**
 * u(S) = (production(S) + sum over inputs T of count(T into S) x u(T)) / n(S),
 * solved by the Neumann series (fixed-point iteration). An outcome whose
 * iteration does not settle is named divergent and gets no unit cost.
 */
export function solveUnitCosts(
  outcomes: readonly StepKey[],
  produced: ReadonlyMap<StepKey, number>,
  productionCents: ReadonlyMap<StepKey, number>,
  inputCounts: ReadonlyMap<StepKey, ReadonlyMap<StepKey, number>>,
  maxIterations = 10_000,
): { unit: Map<StepKey, number>; divergent: StepKey[] } {
  const live = outcomes.filter((s) => (produced.get(s) ?? 0) > 0);
  let u = new Map<StepKey, number>(live.map((s) => [s, 0]));
  let converged = false;
  for (let it = 0; it < maxIterations; it++) {
    const next = new Map<StepKey, number>();
    let delta = 0;
    for (const s of live) {
      let total = (productionCents.get(s) ?? 0) / 100;
      for (const [input, count] of inputCounts.get(s) ?? []) total += count * (u.get(input) ?? 0);
      const v = total / produced.get(s)!;
      next.set(s, v);
      delta = Math.max(delta, Math.abs(v - (u.get(s) ?? 0)) / Math.max(1, Math.abs(v)));
    }
    u = next;
    if (delta < 1e-12) {
      converged = true;
      break;
    }
  }
  if (converged) return { unit: u, divergent: [] };
  // Name the outcomes still moving: those on a cycle that buys more than it makes.
  const divergent = live.filter((s) => (u.get(s) ?? 0) > 1e12 || !Number.isFinite(u.get(s) ?? 0));
  const unit = new Map([...u].filter(([s]) => !divergent.includes(s)));
  return { unit, divergent: divergent.length > 0 ? divergent : live };
}
