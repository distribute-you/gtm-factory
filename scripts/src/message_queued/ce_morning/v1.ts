import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Hands the written message to one of our mailboxes for the lead's next morning. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("message_written");
  ctx.get("rating");
  const r = ctx.vendor.call("smtp.queue");
  return r.ok ? { content: { window: "morning" } } : null;
}
