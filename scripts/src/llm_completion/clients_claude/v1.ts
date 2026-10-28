import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * The client's own Claude writes the answer, on the client's subscription: $0 to us. The
 * Request goes to the client's GTM Factory app; while the Mac is closed, the run waits.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const prompt = String(ctx.request?.prompt ?? "");
  if (!prompt) return null;
  const r = ctx.vendor.call("claude_local.complete", { prompt });
  return r.ok ? { content: { model: String(r.data.model ?? "claude"), text: String(r.data.text ?? "") } } : null;
}
