import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Answers with a booking link. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_interested");
  const r = ctx.vendor.call("calendar.link");
  return r.ok ? { content: { method: "link" } } : null;
}
