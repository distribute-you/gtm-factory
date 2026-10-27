import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the company's site, news and hiring. */
export default function run(ctx: ScriptContext): ScriptResult {
  ctx.get("lead_identified");
  const r = ctx.vendor.call("firecrawl.crawl");
  return r.ok ? { content: { depth: "deep" } } : null;
}
