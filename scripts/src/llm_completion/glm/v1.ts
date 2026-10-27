import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** One answer of glm-5 to the run that ordered it. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("llm.complete", { model: "glm-5" });
  return r.ok ? { content: { model: "glm-5", text: String(r.data.text ?? "") } } : null;
}
