import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** One answer of gemini-3.7-flash to the run that ordered it. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("llm.complete", { model: "gemini-3.7-flash" });
  return r.ok ? { content: { model: "gemini-3.7-flash", text: String(r.data.text ?? "") } } : null;
}
