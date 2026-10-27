import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the reply and our message; answers interested or not. */
export default function run(ctx: ScriptContext): ScriptResult {
  const reply = ctx.get("reply_received");
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const r = ctx.vendor.call("llm.judge", { reply: reply.id, model: llm.content.model, question: "Is this person interested?" });
  return r.ok ? { content: { verdict: "interested" } } : null;
}
