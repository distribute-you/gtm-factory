/**
 * Script code kept in the database runs here, in a hard sandbox: each run gets its own V8 isolate
 * (isolated-vm), with its own heap capped at ISOLATE_MEMORY_MB and RUN_TIMEOUT_MS of time. The
 * isolate holds the language's built-ins and nothing of Node: no require, no process, no fetch, no
 * timers, no file system, and no object of this process. The script sees one object, its context
 * (its subject, its brand, the day, its tactics, its Engine's storage, `get` on the Providers,
 * `ask` and the Request it was handed, the vendor, `wait`), built inside the isolate from copied JSON; every call it makes crosses
 * one callback that takes and returns text. A script that loops forever is stopped at the time
 * limit; one that eats memory is stopped at the limit; neither takes the app down.
 */

import ivm from "isolated-vm";
import { transformSync } from "esbuild";
import { readMaterials } from "@gtm-factory/core";

export const RUN_TIMEOUT_MS = 2000;
export const ISOLATE_MEMORY_MB = 64;

/** What a script asks the host for, one call at a time (JSON in, JSON out). */
export type BridgeOp = "get" | "ask" | "vendor" | "wait" | "accounts" | "storage.get" | "storage.set" | "storage.delete" | "storage.count";
/** The host's answer: a value, or a stop (the run cannot go on now: a piece is missing, it waits). */
export type BridgeAnswer = { v: unknown } | { stop: string };
export type Bridge = (op: BridgeOp, args: unknown[]) => BridgeAnswer;

export interface ScriptSpec {
  subject: string | null;
  brand: string;
  day: number;
  tactics: Record<string, unknown>;
  /** For a script whose outcome's subject is the run: the Request of the run that ordered it (null otherwise). */
  request?: Record<string, unknown> | null;
}

export type RunOutcome =
  | { kind: "done"; result: { content?: Record<string, unknown>; found?: string } | null }
  | { kind: "stopped"; reason: string }
  | { kind: "error"; message: string };

/** Builds the script's context inside the isolate: every call goes through `__host`, text in, text out. */
const BOOT = `
var __make = (function (host) {
  "use strict";
  var call = function (op, args) {
    var a = JSON.parse(host.applySync(undefined, [op, JSON.stringify(args)]));
    if (a && typeof a.stop === "string") throw new Error("stopped: " + a.stop);
    return a ? a.v : undefined;
  };
  var freeze = Object.freeze;
  return function make(specJson) {
    var s = JSON.parse(specJson);
    return freeze({
      subject: s.subject,
      brand: s.brand,
      day: s.day,
      tactics: freeze(s.tactics),
      request: s.request ? freeze(s.request) : null,
      storage: freeze({
        get: function (t, k) { return call("storage.get", [t, k]); },
        set: function (t, k, v) { call("storage.set", [t, k, v === undefined ? null : v]); },
        delete: function (t, k) { call("storage.delete", [t, k]); },
        count: function (t) { return call("storage.count", [t]); },
      }),
      get: function (outcome) { return freeze(call("get", [outcome])); },
      ask: function (request) { call("ask", [request === undefined ? null : request]); },
      vendor: freeze({ call: function (name, args) { return freeze(call("vendor", [name, args === undefined ? null : args])); } }),
      accounts: function (channel, role) { return freeze(call("accounts", [channel, role]).map(function (a) { return freeze(a); })); },
      wait: function (days) { call("wait", [days]); throw new Error("wait"); },
    });
  };
})(__host);
delete globalThis.__host;
`;

/** Transpile a script's TypeScript text to a CommonJS module (type imports vanish; a value import is refused). */
export function transpile(source: string): string {
  const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  if (/\brequire\s*\(/.test(code)) throw new Error("a script may only import types: it gets everything else from its context");
  return code;
}

/** The module of a script inside the isolate: its default export, the run function. */
const moduleOf = (js: string) =>
  `var __run = (function () { var module = { exports: {} }; (function (module, exports) {\n${js}\n})(module, module.exports); return module.exports.default || module.exports; })();\n` +
  `if (typeof __run !== "function") throw new Error("a script's default export must be its run(ctx) function");\n`;

/**
 * Check a script's text before it becomes a version: it transpiles, its module evaluates in an
 * isolate, its default export is a function, and every Provider it calls is named by a literal
 * (`ctx.get("email_found")`): that is how its materials are read from the code.
 */
export function validateSource(source: string): { materials: string[] } {
  new CompiledScript(source).check();
  const calls = (source.match(/\.get\s*\(/g) ?? []).length - (source.match(/storage\.get\s*\(/g) ?? []).length;
  const literal = (source.match(/(?<!storage)\.get\s*\(\s*["'`][a-z0-9_]+["'`]\s*\)/g) ?? []).length;
  if (literal !== calls) throw new Error("every ctx.get(...) must name its outcome with a literal string, so the materials can be read from the code");
  return { materials: readMaterials(source) };
}

/** One script version: transpiled once; each run gets a fresh isolate. */
export class CompiledScript {
  private readonly js: string;

  constructor(source: string) {
    this.js = transpile(source);
  }

  /** Evaluate the module once in a throwaway isolate: it must load and export a function. */
  check(): void {
    const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_MB });
    try {
      const context = isolate.createContextSync();
      isolate.compileScriptSync(moduleOf(this.js)).runSync(context, { timeout: RUN_TIMEOUT_MS });
    } finally {
      if (!isolate.isDisposed) isolate.dispose();
    }
  }

  /** Run once in its own isolate; the result comes back as JSON text. */
  run(spec: ScriptSpec, bridge: Bridge): RunOutcome {
    const isolate = new ivm.Isolate({ memoryLimit: ISOLATE_MEMORY_MB });
    let stopped: string | null = null;
    try {
      const context = isolate.createContextSync();
      // The only thing of this process the isolate holds: a callback that takes and returns text.
      context.global.setSync(
        "__host",
        new ivm.Reference((op: string, args: string) => {
          const a = bridge(op as BridgeOp, JSON.parse(args) as unknown[]);
          if ("stop" in a) stopped = a.stop;
          return JSON.stringify(a);
        }),
      );
      const program = `${BOOT}${moduleOf(this.js)}JSON.stringify((function () { var r = __run(__make(${JSON.stringify(JSON.stringify(spec))})); return r === undefined ? null : r; })());`;
      const text = isolate.compileScriptSync(program).runSync(context, { timeout: RUN_TIMEOUT_MS }) as string;
      if (stopped) return { kind: "stopped", reason: stopped };
      return { kind: "done", result: JSON.parse(text) as { content?: Record<string, unknown>; found?: string } | null };
    } catch (e) {
      if (stopped) return { kind: "stopped", reason: stopped };
      const message = e instanceof Error ? e.message : String(e);
      if (isolate.isDisposed || /memory limit/i.test(message)) return { kind: "error", message: `the script went over its ${ISOLATE_MEMORY_MB} MB memory limit` };
      if (/timed out/i.test(message)) return { kind: "error", message: `the script ran longer than its ${RUN_TIMEOUT_MS} ms limit` };
      return { kind: "error", message };
    } finally {
      if (!isolate.isDisposed) isolate.dispose();
    }
  }
}
