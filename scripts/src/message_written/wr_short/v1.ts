import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Writes a short email from the template and the brand context, without a company research. */
export default function run(ctx: ScriptContext): ScriptResult {
  const email = ctx.get("email_found");
  const template = ctx.get("template_written");
  let context = ctx.get("brand_context");
  if (context.ageDays > 90) context = ctx.get("brand_context");
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const r = ctx.vendor.call("llm.complete", { template: template.content.text, context: context.content.summary, model: llm.content.model, to: email.subject });
  return r.ok ? { content: { body: String(r.data.text ?? ""), template: template.id } } : null;
}
