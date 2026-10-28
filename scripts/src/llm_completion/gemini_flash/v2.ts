import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** One answer of gemini-3.7-flash to the Request of the run that ordered it, written through our API. */
export default function run(ctx: ScriptContext): ScriptResult {
  const prompt = String(ctx.request?.prompt ?? "");
  if (!prompt) return null;
  const r = ctx.vendor.call("llm.complete", { model: "gemini-3.7-flash", prompt });
  return r.ok ? { content: { model: "gemini-3.7-flash", text: String(r.data.text ?? "") } } : null;
}
