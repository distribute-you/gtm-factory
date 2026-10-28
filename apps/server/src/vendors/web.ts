/** Reading a website: Firecrawl scrape (markdown of one page). */

import { UNIT_PRICES, type Meter } from "./meter";

export async function scrapePage(url: string, meter: Meter): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await r.json().catch(() => null)) as { success?: boolean; data?: { markdown?: string }; error?: string } | null;
  if (!r.ok || !body?.success) throw new Error(`Firecrawl answered ${r.status}: ${body?.error ?? "no body"}`);
  meter.add("Firecrawl", "scrape credit", 1, UNIT_PRICES.firecrawlScrape);
  return (body.data?.markdown ?? "").slice(0, 20_000);
}
