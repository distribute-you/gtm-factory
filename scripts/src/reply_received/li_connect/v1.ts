import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Sends a LinkedIn connection with a note written from the template; an answer is a reply. */
export default function run(ctx: ScriptContext): ScriptResult {
  const lead = ctx.get("lead_identified");
  const template = ctx.get("template_written");
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const r = ctx.vendor.call("linkedin.connect", { lead: lead.subject, template: template.content.text, model: llm.content.model });
  return r.ok ? { content: { channel: "LinkedIn", text: String(r.data.text ?? "") } } : null;
}
