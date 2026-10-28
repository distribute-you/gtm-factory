import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * Hands the written message to one of the brand's mailboxes with this script's
 * role (its "Account role" tactic) for the lead's inbox, now. The mailbox picked is the
 * connected one that sent the least today: the brand's mailboxes share the load.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("message_written");
  ctx.get("rating");
  const mailboxes = ctx.accounts("Email", String(ctx.tactics.account_role ?? "AI agent")).filter((a) => a.status === "connected");
  if (mailboxes.length === 0) return null;
  const from = mailboxes.reduce((best, a) => (a.sentToday < best.sentToday ? a : best));
  const r = ctx.vendor.call("smtp.queue", { from: from.address });
  return r.ok ? { content: { window: "now", account: from.id, via: "sent" } } : null;
}
