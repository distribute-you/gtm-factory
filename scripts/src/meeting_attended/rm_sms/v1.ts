import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** An email and an SMS reminder the day before. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("meeting_booked");
  const r = ctx.vendor.call("sms.reminder");
  return r.ok ? { content: { channel: "sms" } } : null;
}
