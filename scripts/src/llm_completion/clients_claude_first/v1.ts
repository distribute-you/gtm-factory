import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * The client's own Claude first, on the client's subscription ($0 to us). When the client's
 * app has not been online for 10 minutes, our API writes the answer instead.
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const prompt = String(ctx.request?.prompt ?? "");
  if (!prompt) return null;
  const mine = ctx.vendor.call("claude_local.complete", { prompt, offline_after_minutes: 10 });
  if (mine.ok) return { content: { model: String(mine.data.model ?? "claude"), text: String(mine.data.text ?? "") } };
  if (mine.data.offline !== true) return null;
  const r = ctx.vendor.call("llm.complete", { model: "gemini-3.7-flash", prompt });
  return r.ok ? { content: { model: "gemini-3.7-flash", text: String(r.data.text ?? "") } } : null;
}
