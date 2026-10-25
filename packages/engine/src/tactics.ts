/**
 * Typed tactics and the conditions strategies are made of. A tactic value is
 * yes/no, one value from a list, or a number. A condition reads one tactic:
 * equals a value, in a list of values, or within a range. `notReached` reads
 * the outcomes a subject has reached (an end state such as unsubscribed).
 */

import type { Catalogue, Tactic } from "./catalogue";

export type TacticValue = boolean | string | number;

export type Condition =
  | { op: "equals"; tactic: string; value: TacticValue }
  | { op: "in"; tactic: string; values: string[] }
  | { op: "range"; tactic: string; min?: number; max?: number }
  | { op: "notReached"; outcomes: string[] };

/** Does a set of tactic values meet one condition? A missing value never meets one. */
export function meets(values: Readonly<Record<string, TacticValue>>, c: Condition, reached?: ReadonlySet<string>): boolean {
  if (c.op === "notReached") return !c.outcomes.some((o) => reached?.has(o));
  const v = values[c.tactic];
  if (v === undefined) return false;
  if (c.op === "equals") return v === c.value;
  if (c.op === "in") return typeof v === "string" && c.values.includes(v);
  if (typeof v !== "number") return false;
  if (c.min !== undefined && v < c.min) return false;
  if (c.max !== undefined && v >= c.max) return false;
  return true;
}

export function meetsAll(values: Readonly<Record<string, TacticValue>>, conditions: readonly Condition[], reached?: ReadonlySet<string>): boolean {
  return conditions.every((c) => meets(values, c, reached));
}

/** A condition in plain words ("Revenue is 5 or more", "Country is France or Germany"). */
export function describeCondition(c: Condition, catalogue?: Catalogue): string {
  if (c.op === "notReached") return `Never reached ${c.outcomes.map((o) => (catalogue?.outcome(o)?.label ?? o).toLowerCase()).join(" or ")}`;
  const t: Tactic | undefined = catalogue?.tactic(c.tactic);
  const name = t?.name ?? c.tactic;
  const unit = t?.type.kind === "number" && t.type.unit ? ` ${t.type.unit}` : "";
  if (c.op === "equals") return typeof c.value === "boolean" ? (c.value ? name : `Not: ${name.toLowerCase()}`) : `${name} is ${c.value}`;
  if (c.op === "in") return `${name} is ${c.values.join(" or ")}`;
  if (c.min !== undefined && c.max !== undefined) return `${name} from ${fmtNum(c.min)} to ${fmtNum(c.max)}${unit}`;
  if (c.min !== undefined) return `${name} is ${fmtNum(c.min)}${unit} or more`;
  if (c.max !== undefined) return `${name} is under ${fmtNum(c.max)}${unit}`;
  return name;
}

export function fmtNum(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** A tactic's type in plain words: "Yes or no", "One of: US, FR", "A number (days)". */
export function describeTacticType(t: Tactic): string {
  if (t.type.kind === "yesno") return "Yes or no";
  if (t.type.kind === "list") return `One of: ${t.type.values.join(", ")}`;
  return `A number${t.type.unit ? ` (${t.type.unit})` : ""}`;
}
