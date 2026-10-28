/**
 * Direct calls to the model vendors (no distribute.you service in between).
 * Each call is metered on its real token usage.
 */

import { LLM_PRICES, type Meter } from "./meter";

export interface LlmAnswer {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function anthropic(model: string, system: string, prompt: string, maxTokens: number): Promise<LlmAnswer> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await r.json().catch(() => null)) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message?: string } } | null;
  if (!r.ok || !body) throw new Error(`Anthropic ${model} answered ${r.status}: ${body?.error?.message ?? "no body"}`);
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, model, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
}

async function gemini(model: string, system: string, prompt: string, maxTokens: number): Promise<LlmAnswer> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  type G = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; error?: { message?: string } };
  const body = (await r.json().catch(() => null)) as G | null;
  if (!r.ok || !body) throw new Error(`Gemini ${model} answered ${r.status}: ${body?.error?.message ?? "no body"}`);
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  const u = body.usageMetadata ?? {};
  // Thinking tokens are billed as output.
  return { text, model, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

/** The model behind each LLM script dynasty. */
export const MODEL_OF_SCRIPT: Record<string, string> = {
  claude_sonnet_5_5: "claude-sonnet-5-5",
  claude_haiku_5_5: "claude-haiku-5-5",
  gemini_3_7_flash: "gemini-3.7-flash",
};

export async function complete(model: string, system: string, prompt: string, meter: Meter, maxTokens = 1200): Promise<LlmAnswer> {
  const price = LLM_PRICES[model];
  if (!price) throw new Error(`no price for model ${model}`);
  const answer = model.startsWith("claude-") ? await anthropic(model, system, prompt, maxTokens) : await gemini(model, system, prompt, maxTokens);
  meter.add(price.vendor, `${model} input tokens`, answer.inputTokens, (answer.inputTokens * price.inputPerM) / 1_000_000 * 1_000_000);
  meter.add(price.vendor, `${model} output tokens`, answer.outputTokens, (answer.outputTokens * price.outputPerM) / 1_000_000 * 1_000_000);
  return answer;
}

/** The first JSON object in a model's answer. Throws when there is none. */
export function parseJsonObject<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`no JSON object in the answer: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/** No em or en dash ever leaves in a message to a prospect. */
export function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
}
