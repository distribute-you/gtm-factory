/**
 * The two calculations, on the milestones of a campaign's Plan (each from the one
 * before it).
 *
 * Cost flows FORWARD from Start: C(to) = (C(from) + c) / y.
 * Value flows BACKWARD from the Target: V(s) = max(0, y x V(to) - c).
 * Per Target Unit, a line of milestones costs T = sum_i c_i / (y_i ... y_n) and
 * returns value / T per dollar.
 */

/** What a decision reads about reaching one milestone from the one before: cost per attempt and the share of attempts reaching it. */
export interface MilestoneFigures {
  /** Dollars per attempt (its own production, never what the milestones before it cost). */
  costPerAttempt: number;
  yieldRate: number;
}

/** Per milestone: attempts per Target Unit and dollars per Target Unit. */
export function targetBreakdown(line: readonly { costPerAttempt: number; yieldRate: number }[]): { attemptsPerTarget: number; costPerTarget: number }[] {
  const out: { attemptsPerTarget: number; costPerTarget: number }[] = [];
  let reach = 1;
  for (let i = line.length - 1; i >= 0; i--) {
    reach *= line[i]!.yieldRate;
    const attemptsPerTarget = reach > 0 ? 1 / reach : Number.POSITIVE_INFINITY;
    out.unshift({ attemptsPerTarget, costPerTarget: line[i]!.costPerAttempt * attemptsPerTarget });
  }
  return out;
}

/** Cost per Target Unit of a line of milestones: T = sum_i c_i / (y_i ... y_n). */
export function chainCostPerTarget(line: readonly { costPerAttempt: number; yieldRate: number }[]): number {
  let reach = 1;
  let cost = 0;
  for (let i = line.length - 1; i >= 0; i--) {
    reach *= line[i]!.yieldRate;
    if (!(reach > 0)) return Number.POSITIVE_INFINITY;
    cost += line[i]!.costPerAttempt / reach;
  }
  return cost;
}

/** Cost forward: the cost of one Unit at each milestone of a line, from its start. */
export function costForwardLine(line: readonly { costPerAttempt: number; yieldRate: number }[]): number[] {
  const out: number[] = [];
  let c = 0;
  for (const l of line) {
    c = (c + l.costPerAttempt) / l.yieldRate;
    out.push(c);
  }
  return out;
}

/**
 * Value backward along a line: V(target) = value, V(s) = max(0, y x V(next) - c).
 * Returns the net value at each milestone, start first, and the value per dollar of
 * each milestone (y x V(next) / c).
 */
export function valueBackwardLine(line: readonly { costPerAttempt: number; yieldRate: number }[], value: number): { values: number[]; valuePerDollar: (number | null)[] } {
  const values = new Array<number>(line.length + 1).fill(0);
  const vpd = new Array<number | null>(line.length).fill(null);
  values[line.length] = value;
  for (let i = line.length - 1; i >= 0; i--) {
    const l = line[i]!;
    const gross = l.yieldRate * values[i + 1]!;
    values[i] = Math.max(0, gross - l.costPerAttempt);
    vpd[i] = l.costPerAttempt > 0 ? gross / l.costPerAttempt : null;
  }
  return { values, valuePerDollar: vpd };
}

export interface FundableAction {
  id: string;
  valuePerDollar: number;
  /** Most this action can absorb, dollars. */
  capacity: number;
}

export interface BudgetAllocation {
  funded: { id: string; amount: number; valuePerDollar: number }[];
  unspent: number;
  /** Value of one more dollar: the marginal funded action's value per dollar when the budget binds, else 1. */
  dollarPrice: number;
}

/** Fund actions by value per dollar, only those returning more than they cost, until the budget. */
export function allocateBudget(actions: readonly FundableAction[], budget: number): BudgetAllocation {
  const sorted = [...actions].filter((a) => a.valuePerDollar > 1 && a.capacity > 0).sort((a, b) => b.valuePerDollar - a.valuePerDollar || (a.id < b.id ? -1 : 1));
  let left = budget;
  const funded: BudgetAllocation["funded"] = [];
  let dollarPrice = 1;
  for (const a of sorted) {
    if (left <= 0) break;
    const amount = Math.min(a.capacity, left);
    funded.push({ id: a.id, amount, valuePerDollar: a.valuePerDollar });
    left -= amount;
    if (left <= 0) dollarPrice = a.valuePerDollar;
  }
  return { funded, unspent: Math.max(0, left), dollarPrice };
}

/** A small binary heap. */
export class MinHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => number) {}
  get size(): number {
    return this.items.length;
  }
  push(x: T): void {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
