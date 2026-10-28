/** One formatter per kind of figure, shared by every page (never a local toFixed). */

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Dollars, adaptive: $0.42, $7.80, $1,240, $12.4k. */
export function formatUsd(dollars: number | null | undefined): string {
  if (dollars == null || !Number.isFinite(dollars)) return "—";
  const a = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (a >= 100_000) return `${sign}$${(a / 1000).toFixed(0)}k`;
  if (a >= 10_000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  if (a >= 100) return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  if (a >= 1) return `${sign}$${a.toFixed(2)}`;
  if (a === 0) return "$0";
  return `${sign}$${a.toFixed(a >= 0.1 ? 2 : 3)}`;
}

export function formatCents(cents: number | null | undefined): string {
  return cents == null ? "—" : formatUsd(cents / 100);
}

/** Words for a period of N days: "day", "week", "month", else "N days". */
export function periodWord(days: number): string {
  return days <= 1 ? "day" : days === 7 ? "week" : days >= 28 && days <= 31 ? "month" : `${days} days`;
}

/** "today", "this week", "this month", else "in the last N days": the period a budget is counted over. */
export function periodPhrase(days: number): string {
  return days <= 1 ? "today" : days === 7 ? "this week" : days >= 28 && days <= 31 ? "this month" : `per ${days} days`;
}

/** A campaign's budget as typed: "$40/day", "$200/week", "$90 per 3 days". */
export function formatBudget(cents: number, periodDays = 1): string {
  const p = periodWord(periodDays);
  return p.includes(" ") ? `${formatCents(cents)} per ${p}` : `${formatCents(cents)}/${p}`;
}

/** A campaign's optional volume: "100 new people/week". */
export function formatVolume(volume: { units: number; periodDays: number } | null | undefined): string | null {
  if (!volume) return null;
  const p = periodWord(volume.periodDays);
  const who = volume.units === 1 ? "person" : "people";
  return p.includes(" ") ? `${formatCount(volume.units)} new ${who} per ${p}` : `${formatCount(volume.units)} new ${who}/${p}`;
}

/** Exact cents, for the ledger: $1,234.56. */
export function formatCentsExact(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
}

/** A rate as a WHOLE percent; a decimal only below 1%; a non-zero rate rounding to 0 prints <0.1%. */
export function formatRatePct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const p = rate * 100;
  if (p === 0) return "0%";
  if (p < 0.1) return "<0.1%";
  if (p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

/** A return multiple: 3.2×. */
export function formatRoi(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x >= 100) return `${Math.round(x)}×`;
  if (x >= 10) return `${x.toFixed(0)}×`;
  return `${x.toFixed(1)}×`;
}

/** Above break-even (1×) a return is green, on every surface. */
export function roiIsGood(x: number | null | undefined): boolean {
  return x != null && Number.isFinite(x) && x >= 1;
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${Math.round(n) === 1 ? one : many}`;
}

/** "lead_interested" -> "Lead interested". */
export function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dayLabel(day: number): string {
  return `Day ${day}`;
}

/** A name with underscores as words, first letter up: "company_size: 201-1000" -> "Company size: 201-1000". */
export function sentenceCase(name: string): string {
  const s = name.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
