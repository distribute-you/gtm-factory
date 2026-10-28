import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Sends a LinkedIn connection with a note written from the template, from the brand's profile with this script's role; an answer is a reply. */
export default function run(ctx: ScriptContext): ScriptResult {
  const lead = ctx.get("lead_identified");
  const template = ctx.get("template_written");
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const profiles = ctx.accounts("LinkedIn", String(ctx.tactics.account_role ?? "AI agent")).filter((a) => a.status === "connected");
  if (profiles.length === 0) return null;
  const from = profiles.reduce((best, a) => (a.sentToday < best.sentToday ? a : best));
  const r = ctx.vendor.call("linkedin.connect", { from: from.address, lead: lead.subject, template: template.content.text, model: llm.content.model });
  return r.ok ? { content: { channel: "LinkedIn", account: from.id, via: "read", text: String(r.data.text ?? "") } } : null;
}
