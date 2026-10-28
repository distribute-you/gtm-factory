/**
 * The vendors, MOCKED (GTM Factory v7: a test, like the public preview, that costs nothing).
 * Every call a script makes (`ctx.vendor.call(name, args)`) is answered here, deterministically,
 * at $0, from the public fictional world's hidden truth: a script succeeds at the rate the world
 * gives it, and the market is the world's fictional people. Nothing leaves this process: no
 * email, no API call, no spend. A real vendor adapter replaces this file call by call later.
 */

import { Catalogue, loadWorld, meetsAll, personOf, type Condition, type Script, type TacticValue, type WorldSpec } from "@gtm-factory/core";
import { WORLD } from "./catalogue-seed";

let world: WorldSpec | null = null;
function theWorld(): WorldSpec {
  world ??= loadWorld(WORLD, { Catalogue, library: {} });
  return world;
}

/** A number in [0, 1) drawn from the text, the same on every call (FNV-1a). */
export function unitHash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("\u0000")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export interface MockCall {
  script: Script;
  name: string;
  args: Record<string, unknown> | null;
  /** Who the run is about (a person, a company, the brand, the run). */
  subject: string | null;
  brandId: string;
  day: number;
  /** A counter of this run's draws from the market (each draw is a new person). */
  draw: number;
  /** The run's served Units by id (an ICP's conditions, the brand's own words). */
  unit: (id: string) => { content: Record<string, unknown> | null } | undefined;
  /** The client's provided list, in order (keys `bl:<id>`). */
  providedList: string[];
  brand: { name: string; offer: string; icp: string };
}

export interface MockAnswer {
  ok: boolean;
  data: Record<string, unknown>;
}

/** The market's person behind a key `<brand>:p<index>`, if it is one. */
export function personOfKey(key: string): { index: number; values: Record<string, TacticValue> } | null {
  const m = /^(.*):p(\d+)$/.exec(key);
  if (!m) return null;
  const p = personOf(theWorld(), m[1]!, Number(m[2]));
  return { index: p.index, values: p.values };
}

/** How often the world says a script succeeds (its base rate times its own yield). */
function rateOf(script: Script): number {
  const t = theWorld().truth.scripts[script.id] ?? theWorld().truth.scripts[script.dynasty];
  if (!t) return 0.6;
  return Math.max(0, Math.min(1, (t.base ?? 1) * (t.ownYield ?? 1)));
}

export function answer(c: MockCall): MockAnswer {
  const w = theWorld();
  switch (c.name) {
    case "market.draw": {
      const index = Math.floor(unitHash("draw", c.brandId, c.script.dynasty, c.day, c.draw) * w.settings.marketSize);
      return { ok: true, data: { key: `${c.brandId}:p${index}` } };
    }
    case "market.fits": {
      const p = personOfKey(String(c.args?.key ?? ""));
      const icp = c.unit(String(c.args?.icp ?? ""))?.content;
      const conditions = (icp?.conditions as Condition[] | undefined) ?? [];
      return { ok: !!p && meetsAll(p.values, conditions), data: {} };
    }
    case "list.next": {
      const key = c.providedList[Number(c.args?.after ?? 0)];
      return key ? { ok: true, data: { key } } : { ok: false, data: {} };
    }
    case "client.form": {
      const field = String(c.args?.field ?? "");
      return { ok: true, data: { text: field === "offer" ? c.brand.offer : field === "icp" ? c.brand.icp : `${c.brand.name}, ${field}` } };
    }
    default: {
      const ok = unitHash(c.name, c.script.id, c.subject ?? "", c.day) < rateOf(c.script);
      return {
        ok,
        data: {
          mock: true,
          text: `${c.script.name}: a test answer for ${c.subject ?? c.brand.name}.`,
          summary: `${c.brand.name} sells ${c.brand.offer}`,
          email: c.subject ? `${c.subject.replace(/[^a-z0-9]/gi, ".").toLowerCase()}@test.invalid` : null,
          model: c.script.dynasty,
        },
      };
    }
  }
}
