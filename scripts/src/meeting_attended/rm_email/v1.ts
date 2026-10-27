import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** An email reminder the day before. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("meeting_booked");
  const r = ctx.vendor.call("smtp.reminder");
  return r.ok ? { content: { channel: "email" } } : null;
}
