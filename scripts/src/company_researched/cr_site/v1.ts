import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the lead's company website. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_identified");
  const r = ctx.vendor.call("firecrawl.scrape");
  return r.ok ? { content: { depth: "site" } } : null;
}
