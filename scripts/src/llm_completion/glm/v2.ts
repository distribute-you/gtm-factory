import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** One answer of glm-5 to the Request of the run that ordered it, written through our API. */
export default function run(ctx: ScriptContext): ScriptResult {
  const prompt = String(ctx.request?.prompt ?? "");
  if (!prompt) return null;
  const r = ctx.vendor.call("llm.complete", { model: "glm-5", prompt });
  return r.ok ? { content: { model: "glm-5", text: String(r.data.text ?? "") } } : null;
}
