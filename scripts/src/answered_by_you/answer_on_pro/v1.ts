import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * Someone of the client's team answers, by hand, a person who wrote to an
 * account with this script's role (Pro). Messages on other accounts are not
 * theirs to answer here.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const message = ctx.get("message_received");
  if (message.content.role !== ctx.tactics.account_role) return null;
  const r = ctx.vendor.call("team.answer", { account: message.content.account });
  return r.ok ? { content: { channel: "WhatsApp", account: message.content.account, via: "sent" } } : null;
}
