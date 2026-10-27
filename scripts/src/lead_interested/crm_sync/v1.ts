import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** The client's CRM reports each lead it marked interested. Called by another party: it reports, it is never ordered. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("webhook.report");
  return r.ok ? { content: {} } : null;
}
