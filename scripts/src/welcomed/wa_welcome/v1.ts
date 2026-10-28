import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * Welcomes a new client once, from the brand's number with this script's role
 * (Pro): they can write there any time. A person welcomed before is never
 * welcomed again.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const client = ctx.get("paid_client");
  ctx.get("rating");
  if (ctx.storage.get("welcomed", client.subject) !== undefined) return null;
  const numbers = ctx.accounts("WhatsApp", String(ctx.tactics.account_role ?? "Pro")).filter((a) => a.status === "connected");
  if (numbers.length === 0) return null;
  const from = numbers.reduce((best, a) => (a.sentToday < best.sentToday ? a : best));
  const r = ctx.vendor.call("whatsapp.send", { from: from.address, to: client.subject, text: "Welcome. Write to me here any time." });
  if (!r.ok) return null;
  ctx.storage.set("welcomed", client.subject, ctx.day);
  return { content: { channel: "WhatsApp", account: from.id, via: "sent" } };
}
