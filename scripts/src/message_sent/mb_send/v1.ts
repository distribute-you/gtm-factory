import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The mailbox reports each message it sent (SMTP acceptance). Called by another party: it reports, it is never ordered. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("webhook.report");
  return r.ok ? { content: {} } : null;
}
