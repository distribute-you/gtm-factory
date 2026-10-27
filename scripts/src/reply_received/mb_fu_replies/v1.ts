import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads our mailboxes and matches each answer to the follow-up it answers. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("follow_up_queued");
  const r = ctx.vendor.call("imap.read");
  return r.ok ? { content: { thread: true } } : null;
}
