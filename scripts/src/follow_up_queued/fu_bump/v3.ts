import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A two-line bump in the same thread, written by the LLM completion it orders. Waits its "Days since last message" after the message sent. */
export default function run(ctx: ScriptContext): ScriptResult {
  const sent = ctx.get("message_sent");
  const wait = Number(ctx.tactics.wait_days ?? 4);
  if (sent.ageDays < wait) ctx.wait(wait - sent.ageDays);
  ctx.ask({ prompt: `Write a two-line bump in the same thread, asking whether they saw our message. Plain text. To: ${sent.subject}.` });
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  // Same thread, same address: the follow-up leaves from the mailbox the first message left from.
  const account = String(sent.content.account ?? "");
  const r = ctx.vendor.call("smtp.reply", { thread: sent.id, account, text: String(llm.content.text ?? ""), angle: "bump" });
  return r.ok ? { content: { angle: "bump", account, via: "sent" } } : null;
}
