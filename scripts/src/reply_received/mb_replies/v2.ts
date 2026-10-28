import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the mailbox the message left from and matches each answer to the message it answers. */
export default function run(ctx: ScriptContext): ScriptResult {
  const queued = ctx.get("message_queued");
  const account = String(queued.content.account ?? "");
  const r = ctx.vendor.call("imap.read", { account });
  return r.ok ? { content: { thread: true, account, via: "read" } } : null;
}
