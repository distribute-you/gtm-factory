import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A two-line bump in the same thread. Waits its "Days since last message" after the message sent. */
export default function run(ctx: ScriptContext): ScriptResult {
  const sent = ctx.get("message_sent");
  const wait = Number(ctx.tactics.wait_days ?? 4);
  if (sent.ageDays < wait) ctx.wait(wait - sent.ageDays);
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  // Same thread, same address: the follow-up leaves from the mailbox the first message left from.
  const account = String(sent.content.account ?? "");
  const r = ctx.vendor.call("smtp.reply", { thread: sent.id, account, model: llm.content.model, angle: "bump" });
  return r.ok ? { content: { angle: "bump", account, via: "sent" } } : null;
}
