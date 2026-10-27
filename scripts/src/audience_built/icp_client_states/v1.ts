import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The client says who to reach, in one sentence. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("client.form", { field: "icp" });
  return r.ok ? { content: { text: String(r.data.text ?? "") } } : null;
}
