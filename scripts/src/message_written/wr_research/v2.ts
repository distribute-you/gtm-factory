import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Researches the company first, then writes from the template and the brand context: the LLM completion it orders writes it. */
export default function run(ctx: ScriptContext): ScriptResult {
  const email = ctx.get("email_found");
  const company = ctx.get("company_researched");
  const template = ctx.get("template_written");
  let context = ctx.get("brand_context");
  if (context.ageDays > 90) context = ctx.get("brand_context");
  ctx.ask({
    prompt: [
      `Write a cold email to ${String(email.content.email ?? email.subject)}, in plain text, from this template. Open on something true about their company.`,
      `Template:\n${String(template.content.text ?? "")}`,
      `What we sell:\n${String(context.content.summary ?? "")}`,
      `What we know about their company:\n${JSON.stringify(company.content)}`,
    ].join("\n\n"),
  });
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  return { content: { body: String(llm.content.text ?? ""), template: template.id } };
}
