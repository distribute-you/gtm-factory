/**
 * A campaign's name and description, written from its strategy at each save (owner 2026-10-28):
 * the strategy is long free text in the client's words; the name and description are short and
 * stay editable by hand. Written by chat-service (platform complete); fails loud when it cannot
 * be reached, so a save never leaves a name that no longer matches its strategy.
 */

import type { Catalogue } from "@gtm-factory/core";

export interface CampaignText {
  name: string;
  description: string;
}

const SYSTEM = [
  "You name sales campaigns from their strategy, written by the client.",
  "Return JSON with two fields.",
  "name: at most 6 words, plain English, says what the campaign gets and how (for example: Paid clients from cold email).",
  "description: one or two short sentences, plain English, what the campaign does and for whom.",
  "Never use dashes. Never invent a number, a channel or a limit the strategy does not state.",
].join("\n");

/** Strip what the copy rules forbid (dashes) and trim to the field's size. */
function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[–—]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function writeCampaignText(catalogue: Catalogue, input: { strategy: string; target: string; start: string; brandName: string }): Promise<CampaignText> {
  const url = process.env.CHAT_SERVICE_URL;
  const key = process.env.CHAT_SERVICE_API_KEY;
  if (!url || !key) throw new Error("CHAT_SERVICE_URL and CHAT_SERVICE_API_KEY are required to name a campaign from its strategy");
  const target = catalogue.outcome(input.target)?.label ?? input.target;
  const start = input.start === "start" ? "the market (it looks for new people every day)" : `each new "${catalogue.outcome(input.start)?.label ?? input.start}"`;
  const message = `Brand: ${input.brandName}\nThe campaign orders: ${target}\nIt starts from: ${start}\n\nStrategy:\n${input.strategy}`;
  const r = await fetch(`${url}/internal/platform-complete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      message,
      systemPrompt: SYSTEM,
      provider: "anthropic",
      model: "claude-haiku-5-5",
      responseSchema: {
        type: "object",
        properties: { name: { type: "string" }, description: { type: "string" } },
        required: ["name", "description"],
        additionalProperties: false,
      },
      support: { kind: "product_feature", reason: "GTM Factory names a campaign and describes it from its strategy at each save" },
    }),
  });
  const body = (await r.json().catch(() => null)) as { content?: string; error?: string } | null;
  if (!r.ok || typeof body?.content !== "string") throw new Error(`chat-service answered ${r.status}: ${body?.error ?? "no text"}`);
  let parsed: { name?: unknown; description?: unknown };
  try {
    parsed = JSON.parse(body.content) as { name?: unknown; description?: unknown };
  } catch {
    throw new Error("chat-service did not answer JSON");
  }
  const name = clean(parsed.name, 80);
  const description = clean(parsed.description, 300);
  if (!name) throw new Error("chat-service wrote no name");
  return { name, description };
}
