import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** An AI writes a template from the offer. */
export default function run(ctx: ScriptContext): ScriptResult {
  const offer = ctx.get("offer_described");
  const r = ctx.vendor.call("llm.complete", { task: "template", offer: offer.content.text });
  return r.ok ? { content: { text: String(r.data.text ?? "") } } : null;
}
