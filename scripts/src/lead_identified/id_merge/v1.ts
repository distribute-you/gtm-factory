import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Merges name, company and title into one person. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_found");
  ctx.get("rating");
  const r = ctx.vendor.call("identity.merge");
  return r.ok ? { content: { method: "name, company and title" } } : null;
}
