import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The client's website: a visitor signs up or books a demo. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_visited");
  ctx.get("rating");
  const r = ctx.vendor.call("website.form");
  return r.ok ? { content: { form: "signup" } } : null;
}
