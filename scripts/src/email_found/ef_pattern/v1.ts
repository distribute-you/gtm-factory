import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Guesses the address from the company's email pattern, then verifies it. Never retries a lead it failed on within its "Days before retry". */
export default function run(ctx: ScriptContext): ScriptResult {
  const lead = ctx.get("lead_identified");
  ctx.get("rating");
  const failed = ctx.storage.get("failed", lead.subject);
  if (typeof failed === "number" && ctx.day - failed < Number(ctx.tactics.retry_days ?? 30)) return null;
  const r = ctx.vendor.call("bounceverify.check", { lead: lead.subject });
  if (!r.ok) {
    ctx.storage.set("failed", lead.subject, ctx.day);
    return null;
  }
  return { content: { email: r.data.email ?? null, verified: true } };
}
