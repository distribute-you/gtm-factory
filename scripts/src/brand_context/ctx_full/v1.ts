import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** Reads the brand's site (home, pricing, customers) and summarizes what it sells, to whom, and its proof. */
export default function run(ctx: ScriptContext): ScriptResult {
  const offer = ctx.get("offer_described");
  const r = ctx.vendor.call("firecrawl.crawl", { pages: ["home", "pricing", "customers"], offer: offer.content.text });
  return r.ok ? { content: { summary: String(r.data.text ?? ""), depth: "full" } } : null;
}
