import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** An AI reads the offer and proposes who to reach. */
export default function run(ctx: ScriptContext): ScriptResult {
  const offer = ctx.get("offer_described");
  const r = ctx.vendor.call("llm.complete", { task: "icp", offer: offer.content.text });
  return r.ok ? { content: { text: String(r.data.text ?? "") } } : null;
}
