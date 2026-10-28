/**
 * A script is code. GTM Factory hands it a context and runs it; the script
 * calls the Providers it needs with `get(outcome)`, its vendors through the
 * metered `vendor` client, keeps its notes in its Engine's storage, and returns
 * the content of one Unit, or none. It never calls another script, an Engine
 * or the ledger. The same code runs in the simulator (the vendor answers from
 * the hidden truth) and in production (real vendors).
 */

import { transform } from "sucrase";
import type { OutcomeId } from "./catalogue";
import type { EngineStorage } from "./storage";
import type { TacticValue } from "./tactics";

/** A Unit as a script reads it. */
export interface UnitView {
  id: string;
  outcome: OutcomeId;
  /** Who or what it is about. */
  subject: string;
  /** Days since it landed. */
  ageDays: number;
  /** What it holds. */
  content: Readonly<Record<string, unknown>>;
}

/** What a vendor call answered. */
export interface VendorAnswer {
  ok: boolean;
  data: Readonly<Record<string, unknown>>;
}

/**
 * A connected account of the brand (a mailbox, a WhatsApp number, a LinkedIn
 * profile), as a sending or reading script sees it: its role and what it did.
 * The host holds the accounts, their roles and their counts; the script picks.
 */
export interface AccountView {
  id: string;
  channel: string;
  /** Its address or number. */
  address: string;
  /** The role the brand gave it (Personal, Pro, AI agent...). */
  role: string;
  status: "connected" | "to_reconnect";
  /** Messages it sent today, over the last 7 days, and messages it read over the last 7 days. */
  sentToday: number;
  sentWeek: number;
  readWeek: number;
}

/** The metered vendor client: every call is priced on the run that makes it. */
export interface Vendor {
  call(name: string, args?: Readonly<Record<string, unknown>>): VendorAnswer;
}

/**
 * Thrown by `get()` when the piece is being made (ordered, or in flight): the
 * run waits, and the script runs again once it has landed. A
 * script never catches it.
 */
export class Waiting extends Error {
  constructor(readonly outcome: OutcomeId) {
    super(`waiting for ${outcome}`);
  }
}

export interface ScriptContext {
  /** The subject the run works on (null while a script creating subjects has not found one). */
  readonly subject: string | null;
  /** The brand it works for. */
  readonly brand: string;
  readonly day: number;
  readonly tactics: Readonly<Record<string, TacticValue>>;
  /** Its Engine's storage: its notes, nobody else's. */
  readonly storage: EngineStorage;
  /**
   * The Provider of an outcome: the most recent Unit of it this run has not
   * received yet, for the run's context (its subject, its company, its brand,
   * or the run itself), from the stock, else made by its Engine. Called again,
   * it returns another one (a fresher piece, made if need be).
   */
  get(outcome: OutcomeId): UnitView;
  readonly vendor: Vendor;
  /**
   * The brand's connected accounts on a channel that carry a role, every one of
   * them, with their counts. The script picks which one to use: the host never does.
   */
  accounts(channel: string, role: string): AccountView[];
  /** Come back in this many days (a follow-up waiting its days since the last message). */
  wait(days: number): never;
}

/** What a run returns: the content of the Unit it makes (and, for a script creating subjects, who it found), or null. */
export type ScriptResult = { content?: Record<string, unknown>; found?: string } | null;

export type ScriptCode = (ctx: ScriptContext) => ScriptResult;

/** The code of every script, by its `code` key. */
export type ScriptLibrary = Readonly<Record<string, ScriptCode>>;

/**
 * Read the Materials a script's code calls (`get("...")`): what a judge reads
 * in a new version before its first run. The ledger then measures what its
 * runs consume.
 */
export function readMaterials(source: string): OutcomeId[] {
  const out: OutcomeId[] = [];
  for (const m of source.matchAll(/\bget\(\s*["'`]([a-z0-9_:.-]+)["'`]\s*\)/gi)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/**
 * A script's code given as text (the way a hosted GTM Factory keeps it, in its database):
 * transpiled at load into the function it exports. The text imports only types; it runs
 * with nothing but its context. Isolation (a sandbox, a time limit) is the host's call.
 */
export function compileScript(source: string): ScriptCode {
  const { code } = transform(source, { transforms: ["typescript", "imports"] });
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const load = (name: string): never => {
    throw new Error(`a script imports nothing at run time, it asked for "${name}"`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, load);
  const run = module.exports.default;
  if (typeof run !== "function") throw new Error("a script's code must export a default function run(ctx)");
  return run as ScriptCode;
}

/** A script library from code given as text, by code key. */
export function libraryFromSources(sources: Readonly<Record<string, string>>): ScriptLibrary {
  return Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, compileScript(source)]));
}
