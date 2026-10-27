import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A copywriter writes a template from the offer (a person, about a day). */
export default function run(ctx: ScriptContext): ScriptResult {
  const offer = ctx.get("offer_described");
  const r = ctx.vendor.call("copywriter.write", { offer: offer.content.text });
  return r.ok ? { content: { text: String(r.data.text ?? "") } } : null;
}
