import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A person of the brand connects an account (a mailbox, a WhatsApp number) and gives it a role. The host runs the connection. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("host.connect");
  return r.ok ? { content: { ...r.data } } : null;
}
