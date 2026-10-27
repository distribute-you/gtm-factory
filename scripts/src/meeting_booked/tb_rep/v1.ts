import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A sales rep of the client calls and books. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_interested");
  const r = ctx.vendor.call("team.call");
  return r.ok ? { content: { method: "call" } } : null;
}
