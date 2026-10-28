/**
 * The judge of a campaign's strategy brief: Jev (chat-service platform judgments) reads the
 * client's words once, and per Engine keeps one strategy (the scripts that fit), or "none" (the
 * Plan routes around that Engine), or every script; daily caps become per-Engine caps, a test
 * length an end date. Judged once, stored on the campaign. A judgment Jev is not sure of (low
 * confidence) keeps every script and sets no cap.
 */

import { isOurs, type Catalogue } from "@gtm-factory/core";
import { hasCode } from "./code";

export interface BriefVerdict {
  verdicts: Record<string, string>;
  caps: Record<string, number>;
  days: number | null;
}

/** What the judge may answer: per Engine of ours, its strategies (the default keeps every script). */
export function briefChoices(catalogue: Catalogue): { engine: string; label: string; strategies: { id: string; name: string }[] }[] {
  return catalogue
    .engines()
    .filter((e) => catalogue.scriptsOf(e).some((s) => isOurs(s) && hasCode(s) && !s.webhook))
    .map((e) => ({ engine: e, label: catalogue.outcome(e)?.label ?? e, strategies: catalogue.strategiesOf(e).filter((s) => !s.id.endsWith("#default")).map((s) => ({ id: s.id, name: s.name })) }));
}

/** Keep only what the catalogue holds: a strategy of that Engine or "none", a cap of 0 or more, a length of 1 to 365 days. */
export function cleanVerdict(catalogue: Catalogue, raw: Partial<BriefVerdict>): BriefVerdict {
  const choices = briefChoices(catalogue);
  const verdicts: Record<string, string> = {};
  for (const [e, sid] of Object.entries(raw.verdicts ?? {})) {
    const c = choices.find((x) => x.engine === e);
    if (!c) continue;
    if (sid === "none" || (c.strategies.some((s) => s.id === sid) && !sid.endsWith("#default"))) verdicts[e] = sid;
  }
  const caps: Record<string, number> = {};
  for (const [e, n] of Object.entries(raw.caps ?? {})) if (choices.some((x) => x.engine === e) && Number.isFinite(Number(n)) && Number(n) >= 0) caps[e] = Math.floor(Number(n));
  const d = Number(raw.days);
  return { verdicts, caps, days: Number.isFinite(d) && d >= 1 && d <= 365 ? Math.round(d) : null };
}

const KEEP_ALL = "every_script";
const NO_CAP = "no_cap";
const CAP_LEVELS = [5, 10, 20, 30, 50, 100, 120, 200, 500];
const DAY_LEVELS = [7, 14, 21, 30, 45, 60, 90];
/** Below this confidence, a judgment is not acted on. */
const MIN_CONFIDENCE = 0.5;

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
}

/** The questions Jev answers about one brief: per Engine, what it keeps and its daily cap; and the test length. */
export function briefQuestions(catalogue: Catalogue): Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> {
  const out: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  for (const c of briefChoices(catalogue)) {
    out[`keep:${c.engine}`] = {
      type: "choice",
      instructions: `A campaign makes "${c.label}" with the scripts of one Engine. Which of these does the brief ask for?`,
      criteria: {
        [KEEP_ALL]: "The brief says nothing that limits how this is made: every script may compete.",
        none: `The brief rules out making "${c.label}" at all for this campaign.`,
        ...Object.fromEntries(c.strategies.map((s) => [s.id, s.name])),
      },
    };
    out[`cap:${c.engine}`] = {
      type: "choice",
      instructions: `Does the brief set a most-per-day limit on "${c.label}"? Pick the closest number, or no limit.`,
      criteria: { [NO_CAP]: "No daily limit stated for this.", ...Object.fromEntries(CAP_LEVELS.map((n) => [String(n), `At most ${n} a day.`])) },
    };
  }
  out.days = {
    type: "choice",
    instructions: "Does the brief ask for a test of a stated length, after which the campaign stops? Pick the closest length, or none.",
    criteria: { none: "No test length stated: the campaign runs until someone pauses it.", ...Object.fromEntries(DAY_LEVELS.map((n) => [String(n), `A ${n}-day test.`])) },
  };
  return out;
}

/** Read a brief (no brief: every script kept, no cap, no end). Fails loud when Jev cannot be reached. */
export async function judgeBrief(catalogue: Catalogue, brief: string): Promise<BriefVerdict & { confidence: Record<string, number> }> {
  if (!brief.trim()) return { verdicts: {}, caps: {}, days: null, confidence: {} };
  const url = process.env.CHAT_SERVICE_URL;
  const key = process.env.CHAT_SERVICE_API_KEY;
  if (!url || !key) throw new Error("CHAT_SERVICE_URL and CHAT_SERVICE_API_KEY are required to read a brief");
  const r = await fetch(`${url}/internal/platform-judgments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ state: `A client's brief for a sales campaign:\n\n${brief}`, questions: briefQuestions(catalogue), support: { kind: "product_feature", reason: "GTM Factory reads a campaign's strategy brief once, per Engine" } }),
  });
  const body = (await r.json().catch(() => null)) as { answers?: Record<string, ChoiceAnswer>; error?: string } | null;
  if (!r.ok || !body?.answers) throw new Error(`Jev answered ${r.status}: ${body?.error ?? "no answers"}`);
  const verdicts: Record<string, string> = {};
  const caps: Record<string, number> = {};
  const confidence: Record<string, number> = {};
  let days: number | null = null;
  for (const [k, a] of Object.entries(body.answers)) {
    confidence[k] = a.confidence;
    if (a.confidence < MIN_CONFIDENCE) continue;
    const [kind, engine] = k.split(":") as [string, string | undefined];
    if (kind === "keep" && engine && a.choice !== KEEP_ALL) verdicts[engine] = a.choice;
    if (kind === "cap" && engine && a.choice !== NO_CAP) caps[engine] = Number(a.choice);
    if (k === "days" && a.choice !== "none") days = Number(a.choice);
  }
  return { ...cleanVerdict(catalogue, { verdicts, caps, days }), confidence };
}
