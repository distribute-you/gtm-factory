/**
 * The expert step of a new client: reads the ideal customer profile in plain words and proposes
 * two or three audiences. Here a small rule set stands in for the person or the LLM who does it in
 * production (the engine only asks for an `AudienceExpert`). It reads the words of the ICP against
 * the lead attributes the world knows, never a channel or a step.
 */

import { FICTIONAL_ATTRIBUTES, type AudienceProposal, type SegmentRule } from "@gtm-factory/engine";

const CUES: { words: RegExp; attribute: string; values: string[]; name: string }[] = [
  { words: /\b(founder|founders|ceo|owner|owners)\b/i, attribute: "seniority", values: ["founder"], name: "Founders and owners" },
  { words: /\b(head|heads|vp|director|directors|lead|leads)\b/i, attribute: "seniority", values: ["head"], name: "Heads of team" },
  { words: /\b(manager|managers)\b/i, attribute: "seniority", values: ["manager"], name: "Managers" },
  { words: /\b(europe|european|eu)\b/i, attribute: "country", values: ["France", "Germany", "United Kingdom"], name: "Europe" },
  { words: /\b(france|french)\b/i, attribute: "country", values: ["France"], name: "France" },
  { words: /\b(germany|german)\b/i, attribute: "country", values: ["Germany"], name: "Germany" },
  { words: /\b(uk|united kingdom|british)\b/i, attribute: "country", values: ["United Kingdom"], name: "United Kingdom" },
  { words: /\b(us|usa|united states|american)\b/i, attribute: "country", values: ["United States"], name: "United States" },
  { words: /\b(startup|startups|small|solo)\b/i, attribute: "company_size", values: ["1-10", "11-50"], name: "Small teams" },
  { words: /\b(mid-sized|mid sized|midsize|growing|scale-up|scaleup)\b/i, attribute: "company_size", values: ["11-50", "51-200"], name: "Mid-sized companies" },
  { words: /\b(enterprise|large|corporate)\b/i, attribute: "company_size", values: ["201-1000"], name: "Large companies" },
];

export function audiencesFromIcp(icp: string): AudienceProposal[] {
  const found: AudienceProposal[] = [];
  for (const cue of CUES) {
    if (!cue.words.test(icp)) continue;
    if (found.some((f) => Object.keys(f.rule).includes(cue.attribute))) continue;
    found.push({ name: cue.name, description: `Leads where ${cue.attribute.replace("_", " ")} is ${cue.values.join(" or ")}.`, rule: { [cue.attribute]: cue.values } });
    if (found.length === 2) break;
  }
  const merged: SegmentRule = Object.assign({}, ...found.map((f) => f.rule));
  const out = found.length === 2 ? [...found, { name: `${found[0]!.name} · ${found[1]!.name}`, description: "Both conditions at once.", rule: merged }] : found;
  if (out.length === 0) {
    const size = FICTIONAL_ATTRIBUTES.find((a) => a.name === "company_size");
    return [
      { name: "Everyone in the profile", description: "Every lead the profile describes.", rule: {} },
      { name: "Small teams", description: "Leads in companies of 50 people or fewer.", rule: { company_size: size ? size.values.slice(0, 2) : [] } },
    ];
  }
  if (out.length === 1) out.push({ name: "Everyone in the profile", description: "Every lead the profile describes.", rule: {} });
  return out.slice(0, 3);
}
