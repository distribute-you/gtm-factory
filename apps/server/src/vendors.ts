/**
 * Vendor adapters: the only way a script's `ctx.vendor.call(name, args)` reaches a vendor. A
 * script runs only when every vendor its code calls has a real adapter registered here; until
 * then the scheduler computes Plans and runs nothing (owner 2026-10-28: nothing fake on factory).
 * No adapter is registered in production yet. Tests register stand-ins to exercise the runner.
 */

import type { Script } from "@gtm-factory/core";

export interface VendorCall {
  /** The script calling (its id, dynasty, tactics). */
  script: Script;
  name: string;
  args: Record<string, unknown> | null;
  /** Who the run is about (a person, a company, the brand, the run). */
  subject: string | null;
  brandId: string;
  day: number;
  /** A counter of this run's draws from the market (each draw is a new person). */
  draw: number;
  /** The run's served Units by id. */
  unit: (id: string) => { content: Record<string, unknown> | null } | undefined;
  /** The client's provided list, in order (keys `bl:<id>`). */
  providedList: string[];
  brand: { name: string; offer: string; icp: string };
}

export interface VendorAnswer {
  ok: boolean;
  data: Record<string, unknown>;
}

export type VendorAdapter = (call: VendorCall) => VendorAnswer;

const adapters = new Map<string, VendorAdapter>();

export function registerVendor(name: string, adapter: VendorAdapter): void {
  adapters.set(name, adapter);
}

/** Tests only: forget every adapter. */
export function clearVendors(): void {
  adapters.clear();
}

export function adapterOf(name: string): VendorAdapter | undefined {
  return adapters.get(name);
}

/** What a page says while no script can run. */
export const WAITING = "Nothing runs until real vendors are connected.";

/**
 * The vendors a script's code calls, read from its text: each `vendor.call("name"` literal.
 * A call whose name is not a literal is "*": no adapter ever matches it, so the script waits.
 */
export function vendorsOf(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/vendor\.call\(\s*(["'`])([^"'`]+)\1/g)) out.add(m[2]!);
  if (/vendor\.call\(\s*[^"'`\s]/.test(source)) out.add("*");
  return [...out];
}

/** Every vendor of the list has a real adapter. */
export const adaptersFor = (vendors: readonly string[]): boolean => vendors.every((v) => adapters.has(v));

/** Is any adapter registered at all? */
export const anyAdapter = (): boolean => adapters.size > 0;
