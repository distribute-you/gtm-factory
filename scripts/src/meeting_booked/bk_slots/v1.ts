import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Answers with three slots that fit both calendars. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_interested");
  const r = ctx.vendor.call("calendar.slots");
  return r.ok ? { content: { method: "slots" } } : null;
}
