/**
 * Every vendor call is metered: a run carries the cost lines of the calls it
 * made, in micro-dollars (1 cent = 10,000 micro). Prices are the vendors'
 * public list prices (no markup: this is our own cost), each with its source.
 */

export interface CostLine {
  vendor: string;
  item: string;
  quantity: number;
  micro: number;
}

export class Meter {
  readonly lines: CostLine[] = [];
  add(vendor: string, item: string, quantity: number, micro: number): void {
    if (!Number.isFinite(micro) || micro < 0) throw new Error(`bad cost for ${vendor} ${item}: ${micro}`);
    this.lines.push({ vendor, item, quantity, micro: Math.round(micro) });
  }
  get totalMicro(): number {
    return this.lines.reduce((s, l) => s + l.micro, 0);
  }
}

/** Dollars per million tokens, from each vendor's pricing page (read 2026-10-26). */
export const LLM_PRICES: Record<string, { vendor: string; inputPerM: number; outputPerM: number; source: string }> = {
  "claude-sonnet-5-5": { vendor: "Anthropic", inputPerM: 2, outputPerM: 10, source: "platform.claude.com/docs/en/about-claude/pricing" },
  "claude-haiku-5-5": { vendor: "Anthropic", inputPerM: 0.1, outputPerM: 0.5, source: "platform.claude.com/docs/en/about-claude/pricing (prompt up to 100k)" },
  "gemini-3.7-flash": { vendor: "Google", inputPerM: 1.5, outputPerM: 7.5, source: "ai.google.dev/gemini-api/docs/pricing (list rate after the 2026 promotion)" },
};

/** Unit prices in micro-dollars. */
export const UNIT_PRICES = {
  /** Apollo Basic: $59 / 2,500 credits. people/match = 1 credit; search is free. */
  apolloCredit: 23_600,
  /** Apify bounceverify actor: $0.00089 per email. */
  bounceVerify: 890,
  /** Firecrawl Hobby: $16 / 3,000 credits; one scrape = 1 credit. */
  firecrawlScrape: 5_333,
  /** A sending mailbox costs about $4.50 a month and sends about 30 emails a day: about half a cent per email. */
  mailboxEmail: 5_000,
} as const;
