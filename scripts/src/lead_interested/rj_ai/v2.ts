import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the reply and asks the LLM completion it orders whether the person is interested: an answer opening on "no" is not. */
export default function run(ctx: ScriptContext): ScriptResult {
  const reply = ctx.get("reply_received");
  ctx.ask({ prompt: `Someone answered our message. Their answer:\n${String(reply.content.text ?? "")}\n\nIs this person interested? Answer yes or no.` });
  const llm = ctx.get("llm_completion");
  ctx.get("rating");
  if (/^\s*no\b/i.test(String(llm.content.text ?? ""))) return null;
  return { content: { verdict: "interested" } };
}
