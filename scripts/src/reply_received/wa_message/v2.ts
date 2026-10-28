import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * Writes to the person on WhatsApp from one of the brand's numbers with the role
 * this script carries (its "Account role" tactic), the one that sent the least
 * today. The LLM completion it orders writes the message. An answer is a reply.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const lead = ctx.get("lead_identified");
  const template = ctx.get("template_written");
  ctx.ask({ prompt: `Write a short WhatsApp message to ${lead.subject}, from this template:\n${String(template.content.text ?? "")}` });
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const numbers = ctx.accounts("WhatsApp", String(ctx.tactics.account_role ?? "AI agent")).filter((a) => a.status === "connected");
  if (numbers.length === 0) return null;
  const from = numbers.reduce((best, a) => (a.sentToday < best.sentToday ? a : best));
  const r = ctx.vendor.call("whatsapp.send", { from: from.address, to: lead.subject, text: String(llm.content.text ?? "") });
  return r.ok ? { content: { channel: "WhatsApp", account: from.id, via: "read", text: String(r.data.text ?? "") } } : null;
}
