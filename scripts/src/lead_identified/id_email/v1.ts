import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Matches the email and the domain to one person. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_found");
  ctx.get("rating");
  const r = ctx.vendor.call("identity.match_email");
  return r.ok ? { content: { method: "email and domain" } } : null;
}
