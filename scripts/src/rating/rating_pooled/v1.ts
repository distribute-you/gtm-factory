import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the ledger and the traceability; the factory turns it into today's beliefs about value per dollar. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("ledger.read");
  return r.ok ? { content: {} } : null;
}
