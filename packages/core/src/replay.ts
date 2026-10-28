/**
 * Replay: prove a script against real recorded cases.
 *
 * A case is what a production system did once: the Units the work started from,
 * every vendor call it made in order (with the answer the vendor gave, and the
 * request it was sent when that was recorded), and what it produced. Replaying
 * runs the script on the same Units with a vendor that answers from the record,
 * then compares: the same calls in the same order, the same requests where they
 * were recorded, the same result. A script ported from another system is done
 * only when every case it has matches.
 *
 * The vendor here is a mock adapter: it answers from the record and never calls
 * the outside world. A host maps the same vendor names to its real adapters.
 */

import type { OutcomeId } from "./catalogue";
import type { AccountView, RunRequest, ScriptCode, ScriptContext, ScriptResult, VendorAnswer } from "./script";
import { StorageHouse } from "./storage";
import type { TacticValue } from "./tactics";

/** One recorded vendor call: its name, the request when it was recorded, and the answer. */
export interface RecordedCall {
  name: string;
  /** The request sent, when the record holds it: the replay requires the script to send exactly this. */
  args?: Record<string, unknown>;
  answer: VendorAnswer;
}

/** One recorded unit of work. */
export interface ReplayCase {
  id: string;
  /** The Units the work started from, by outcome; a list when the script asks the same outcome again. */
  units: Record<OutcomeId, Record<string, unknown> | Record<string, unknown>[]>;
  subject?: string | null;
  tactics?: Record<string, TacticValue>;
  day?: number;
  /** For a script whose outcome's subject is the run: the Request the run that ordered it handed it. */
  request?: Record<string, unknown>;
  /** The Requests the work handed to the pieces it ordered, in order, when the record holds them: the replay requires the same. */
  asks?: Record<string, unknown>[];
  /** The brand's connected accounts as they stood at that moment (a sending or reading script picks among them). */
  accounts?: AccountView[];
  /** Every vendor call, in the order it was made. */
  calls: RecordedCall[];
  /** What the work produced: the script must return a result with these fields (deep equal), or fail when `fails`. */
  expect: { content?: Record<string, unknown>; found?: string; nothing?: true; fails?: string };
}

export interface ReplayReport {
  id: string;
  match: boolean;
  /** What differed, in words (empty on a match). */
  diffs: string[];
}

/** Deep equality on JSON values (key order does not matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** The first place two values differ, for a readable report. */
function firstDiff(path: string, a: unknown, b: unknown): string {
  if (typeof a === "string" && typeof b === "string") {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return `${path}: differs at char ${i}: got ${JSON.stringify(a.slice(Math.max(0, i - 30), i + 60))}, want ${JSON.stringify(b.slice(Math.max(0, i - 30), i + 60))}`;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) {
      const x = (a as Record<string, unknown>)[k];
      const y = (b as Record<string, unknown>)[k];
      if (!sameJson(x, y)) return firstDiff(`${path}.${k}`, x, y);
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: ${a.length} items, want ${b.length}`;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], b[i])) return firstDiff(`${path}[${i}]`, a[i], b[i]);
  }
  return `${path}: got ${JSON.stringify(a)?.slice(0, 200)}, want ${JSON.stringify(b)?.slice(0, 200)}`;
}

class ReplayStop extends Error {}

/** Run one script on one case and compare. */
export function replayCase(code: ScriptCode, c: ReplayCase): ReplayReport {
  const diffs: string[] = [];
  const gotten = new Map<OutcomeId, number>();
  let next = 0;
  const asked: RunRequest[] = [];
  const ctx: ScriptContext = {
    subject: c.subject ?? null,
    request: c.request ?? null,
    ask(request) {
      asked.push(request);
    },
    brand: "replay",
    day: c.day ?? 0,
    tactics: c.tactics ?? {},
    storage: new StorageHouse().forEngine("replay"),
    accounts(channel, role) {
      return (c.accounts ?? []).filter((a) => a.channel === channel && a.role === role);
    },
    get(outcome) {
      const held = c.units[outcome];
      if (held === undefined) {
        diffs.push(`asked for ${outcome}, which the case does not hold`);
        throw new ReplayStop();
      }
      const n = gotten.get(outcome) ?? 0;
      gotten.set(outcome, n + 1);
      const list = Array.isArray(held) ? held : [held];
      const content = list[Math.min(n, list.length - 1)]!;
      return { id: `${c.id}:${outcome}:${n}`, outcome, subject: c.subject ?? "", ageDays: 0, content };
    },
    vendor: {
      call(name, args) {
        const rec = c.calls[next];
        if (!rec) {
          diffs.push(`call ${next + 1} ${name}: the record made no more calls`);
          throw new ReplayStop();
        }
        if (rec.name !== name) {
          diffs.push(`call ${next + 1}: called ${name}, the record called ${rec.name}`);
          throw new ReplayStop();
        }
        if (rec.args !== undefined && !sameJson(args ?? {}, rec.args)) diffs.push(`call ${next + 1} ${name}: ${firstDiff("request", args ?? {}, rec.args)}`);
        next++;
        return rec.answer;
      },
    },
    wait(days) {
      diffs.push(`asked to wait ${days} days`);
      throw new ReplayStop();
    },
  };
  let result: ScriptResult = null;
  let failed: string | null = null;
  try {
    result = code(ctx);
  } catch (e) {
    if (e instanceof ReplayStop) return { id: c.id, match: false, diffs };
    failed = e instanceof Error ? e.message : String(e);
  }
  if (c.asks !== undefined && !sameJson(asked, c.asks)) diffs.push(firstDiff("asks", asked, c.asks));
  if (next < c.calls.length) diffs.push(`made ${next} calls, the record made ${c.calls.length} (next: ${c.calls[next]!.name})`);
  const want = c.expect;
  if (want.fails !== undefined) {
    if (failed === null) diffs.push(`returned a result, the record failed: ${want.fails}`);
    else if (!failed.includes(want.fails)) diffs.push(`failed with "${failed.slice(0, 200)}", want a failure naming "${want.fails}"`);
  } else if (failed !== null) {
    diffs.push(`failed: ${failed.slice(0, 300)}`);
  } else if (want.nothing) {
    if (result !== null) diffs.push(`returned ${JSON.stringify(result).slice(0, 200)}, the record made nothing`);
  } else {
    if (want.content !== undefined && !sameJson(result?.content, want.content)) diffs.push(firstDiff("content", result?.content, want.content));
    if (want.found !== undefined && result?.found !== want.found) diffs.push(`found ${String(result?.found)}, want ${want.found}`);
  }
  return { id: c.id, match: diffs.length === 0, diffs };
}

/** Every case of a script: how many match, and the reports of those that do not. */
export function replayAll(code: ScriptCode, cases: readonly ReplayCase[]): { cases: number; matches: number; failures: ReplayReport[] } {
  const reports = cases.map((c) => replayCase(code, c));
  return { cases: cases.length, matches: reports.filter((r) => r.match).length, failures: reports.filter((r) => !r.match) };
}
