import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The client's team runs the closing call. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("meeting_attended");
  const r = ctx.vendor.call("team.close");
  return r.ok ? { content: { closed: true } } : null;
}
