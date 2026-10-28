import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A follow-up in the same thread with a new angle. Waits its "Days since last message" after the message sent. */
export default function run(ctx: ScriptContext): ScriptResult {
  const sent = ctx.get("message_sent");
  const wait = Number(ctx.tactics.wait_days ?? 4);
  if (sent.ageDays < wait) ctx.wait(wait - sent.ageDays);
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  const r = ctx.vendor.call("smtp.reply", { thread: sent.id, model: llm.content.model, angle: "new angle" });
  return r.ok ? { content: { angle: "new angle" } } : null;
}
