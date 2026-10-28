import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Writes a short email from the template and the brand context, without a company research: the LLM completion it orders writes it. */
export default function run(ctx: ScriptContext): ScriptResult {
  const email = ctx.get("email_found");
  const template = ctx.get("template_written");
  let context = ctx.get("brand_context");
  if (context.ageDays > 90) context = ctx.get("brand_context");
  ctx.ask({
    prompt: [
      `Write a short cold email to ${String(email.content.email ?? email.subject)}, in plain text, from this template.`,
      `Template:\n${String(template.content.text ?? "")}`,
      `What we sell:\n${String(context.content.summary ?? "")}`,
    ].join("\n\n"),
  });
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  return { content: { body: String(llm.content.text ?? ""), template: template.id } };
}
