import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The client types its offer when the brand is added: nothing to call. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("client.form", { field: "offer" });
  return r.ok ? { content: { text: String(r.data.text ?? "") } } : null;
}
