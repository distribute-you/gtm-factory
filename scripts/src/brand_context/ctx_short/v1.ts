import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the brand's home page and keeps three lines. */
export default function run(ctx: ScriptContext): ScriptResult {
  const offer = ctx.get("offer_described");
  const r = ctx.vendor.call("firecrawl.scrape", { page: "home", offer: offer.content.text });
  return r.ok ? { content: { summary: String(r.data.text ?? ""), depth: "short" } } : null;
}
