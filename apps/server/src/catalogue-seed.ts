/**
 * The catalogue this GTM Factory runs (GTM Factory v7): the public fictional
 * world's catalogue (outcomes, one Engine each, scripts whose code is a file of
 * the public scripts/ folder, tactics, strategies, tracks), plus this app's own
 * objects. Everything lands in this app's database at boot: the catalogue in
 * `catalogue_state` (merged by id, stored objects never overwritten) and every
 * script's code in `script_code` (one immutable row per version). After the
 * first boot the runner reads code from the database only; the files are the
 * seed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OURS, PERFORMED_BY, type CatalogueData, type Script, type WorldData } from "@gtm-factory/core";

export const OUTCOMES = {
  offer: "offer_described",
  audience: "audience_built",
  template: "template_written",
  brandContext: "brand_context",
  llm: "llm_completion",
  leadFound: "lead_found",
  leadIdentified: "lead_identified",
  emailFound: "email_found",
  messageWritten: "message_written",
  messageQueued: "message_queued",
  messageSent: "message_sent",
  followUpQueued: "follow_up_queued",
  replyReceived: "reply_received",
  leadInterested: "lead_interested",
  notInterested: "not_interested",
  unsubscribed: "unsubscribed",
  meetingBooked: "meeting_booked",
  paidClient: "paid_client",
  rating: "rating",
} as const;

/** Who performs a script: the "Performed by" tactic's values. */
export const PERFORMERS = {
  ours: OURS,
  client: "Client",
  clientTeam: "Client's team",
  mailbox: "Mailbox",
  production: "distribute.you production",
} as const;

/** The `factory` column of a stored row (a brand, a campaign, a Unit) and who it says performed it. */
export const FACTORIES = { ours: "ours", clientTeam: "client_team", client: "client", mailbox: "mailbox", crm: "crm", organic: "organic" } as const;
const PERFORMER_OF_ROW: Record<string, string> = { ours: PERFORMERS.ours, client: PERFORMERS.client, client_team: PERFORMERS.clientTeam, mailbox: PERFORMERS.mailbox, crm: "CRM", organic: "Organic market", distribute_you: PERFORMERS.production };
export const performerOfRow = (factory: string): string => PERFORMER_OF_ROW[factory] ?? factory;
const ROW_OF_PERFORMER: Record<string, string> = Object.fromEntries(Object.entries(PERFORMER_OF_ROW).map(([k, v]) => [v, k]));
/** The `factory` column a Unit carries for the performer of the script that made it. */
export const rowOfPerformer = (performer: string): string => ROW_OF_PERFORMER[performer] ?? FACTORIES.ours;

/** The root of this repository (the seed of the catalogue, the code and the demo world). */
export const PUBLIC_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/** The public fictional world: its catalogue seeds ours, its client is the demo brand, its hidden truth answers the mocked vendors. */
export const WORLD: WorldData = JSON.parse(readFileSync(`${PUBLIC_DIR}seed/fictional-world.json`, "utf8")) as WorldData;

/** The code key of a version of a dynasty: `<outcome>/<dynasty>/v<n>` (the public files use the same keys). */
export const codeKey = (outcome: string, dynasty: string, version: number) => `${outcome}/${dynasty}/v${version}`;

/** The code key of a script this app ran before v7 (a branch of its own code, now history: its versions moved to the database). */
export const appCode = (dynasty: string) => `app/${dynasty}`;

/** This app's own scripts' code, seeded beside the public files (same contract: a default `run(ctx)`). */
export const APP_SOURCES: Record<string, string> = {
  [codeKey(OUTCOMES.leadFound, "provided_list", 2)]: [
    'import type { ScriptContext, ScriptResult } from "@gtm-factory/core";',
    "",
    "/** Reads the people the client provided, in order, once each: never someone it served in the last \"Days before recontact\". */",
    "export default function run(ctx: ScriptContext): ScriptResult {",
    '  ctx.get("audience_built");',
    '  ctx.get("rating");',
    "  const window = Number(ctx.tactics.recontact_days ?? 90);",
    "  for (let k = 0; k < 50; k++) {",
    '    const next = ctx.vendor.call("list.next", { after: k });',
    "    if (!next.ok) return null;",
    "    const key = String(next.data.key);",
    '    const last = ctx.storage.get("picked", key);',
    "    if (typeof last === \"number\" && ctx.day - last < window) continue;",
    '    ctx.storage.set("picked", key, ctx.day);',
    "    return { found: key, content: { recontact: typeof last === \"number\" } };",
    "  }",
    "  return null;",
    "}",
    "",
  ].join("\n"),
};

const by = (performer: string) => ({ [PERFORMED_BY]: performer });

/** This app's objects beside the public world's: what a reply judged not interested is, and the client's own list of people. */
const APP_OBJECTS: Pick<CatalogueData, "outcomes" | "scripts" | "tactics" | "strategies"> = {
  outcomes: [{ id: OUTCOMES.notInterested, label: "Not interested", plural: "Not interested", subject: "lead", description: "A reply judged not interested. Never written to again." }],
  scripts: [
    {
      id: "provided_list_v2", outcome: OUTCOMES.leadFound, dynasty: "provided_list", version: 2, name: "Provided lead list", kind: "rules", code: codeKey(OUTCOMES.leadFound, "provided_list", 2),
      materials: [OUTCOMES.audience, OUTCOMES.rating], tactics: { source: "Provided list", recontact_days: 90, ...by(OURS) }, costCents: 0, status: "active",
      description: "Reads the people the client provided, in order, once each.",
    } satisfies Script,
  ],
  tactics: [{ id: "source", name: "Source", type: { kind: "list", values: ["Apollo", "Provided list"] }, describes: ["script"], source: "data" }],
  strategies: [{ id: "lead_found#provided_list", name: "Provided list only", outcome: OUTCOMES.leadFound, conditions: [{ op: "equals", tactic: "source", value: "Provided list" }] }],
};

const world = JSON.parse(JSON.stringify(WORLD.catalogue)) as CatalogueData;
export const SEED_CATALOGUE: CatalogueData = {
  ...world,
  outcomes: [...world.outcomes, ...APP_OBJECTS.outcomes],
  scripts: [...world.scripts, ...APP_OBJECTS.scripts],
  tactics: [...world.tactics, ...APP_OBJECTS.tactics.filter((t) => !world.tactics.some((x) => x.id === t.id))],
  strategies: [...world.strategies, ...APP_OBJECTS.strategies],
};

/**
 * The v5 legs this app ran, and the outcome each one made: the v5 rows (runs,
 * choice points, storage) move onto the Engine of that outcome.
 */
export const V5_LEG_OUTPUT: Record<string, string> = {
  offer_description: OUTCOMES.offer,
  icp_client: OUTCOMES.audience,
  template_writing: OUTCOMES.template,
  supplier_rating: OUTCOMES.rating,
  brand_context: OUTCOMES.brandContext,
  llm: OUTCOMES.llm,
  sourcing: OUTCOMES.leadFound,
  email_finding: OUTCOMES.emailFound,
  writer: OUTCOMES.messageWritten,
  cold_email: OUTCOMES.messageQueued,
  email_delivery: OUTCOMES.messageSent,
  email_replies: OUTCOMES.replyReceived,
  follow_up: OUTCOMES.followUpQueued,
  follow_up_replies: OUTCOMES.replyReceived,
  reply_judging: OUTCOMES.leadInterested,
  closing: OUTCOMES.paidClient,
};

/**
 * Where each Engine's choice of script is made in this app's Plan: the Engine
 * that calls it (the consumer). A choice point is `consumer|outcome`.
 */
export const CONSUMER_OF: Record<string, string> = {
  [OUTCOMES.leadFound]: OUTCOMES.emailFound,
  [OUTCOMES.emailFound]: OUTCOMES.messageWritten,
  [OUTCOMES.messageWritten]: OUTCOMES.messageQueued,
  [OUTCOMES.messageQueued]: OUTCOMES.replyReceived,
  [OUTCOMES.followUpQueued]: OUTCOMES.replyReceived,
  [OUTCOMES.replyReceived]: OUTCOMES.leadInterested,
  [OUTCOMES.leadInterested]: OUTCOMES.paidClient,
  [OUTCOMES.paidClient]: "campaign",
};

/** Templates seeded as brand dynasties (a template is a Unit of a brand outcome). */
export const SEED_TEMPLATES: { dynasty: string; name: string; content: string }[] = [
  {
    dynasty: "tpl_short_personal",
    name: "Short and personal",
    content: [
      "Write a cold email from {{sender_first_name}} at {{brand_name}} to {{lead_first_name}}, {{lead_title}} at {{lead_company}}.",
      "",
      "What {{brand_name}} sells: {{offer}}",
      "What its website says: {{brand_context}}",
      "Who it sells to: {{icp}}",
      "",
      "Rules: under 90 words. One idea. Open on something true about {{lead_company}} or their role, never on a compliment. Say plainly what {{brand_name}} does for a company like theirs. End with one easy question. No links, no attachments, no bullet points, no dashes, no exclamation marks. Plain text. Do not invent facts or numbers. Sign with {{sender_first_name}} only.",
      "",
      'Answer with JSON only: {"subject": "...", "body": "..."}. The subject has 2 to 5 words, lower case.',
    ].join("\n"),
  },
  {
    dynasty: "tpl_problem_first",
    name: "Problem first",
    content: [
      "Write a cold email from {{sender_first_name}} at {{brand_name}} to {{lead_first_name}} ({{lead_title}}, {{lead_company}}).",
      "",
      "Offer: {{offer}}",
      "Brand context: {{brand_context}}",
      "Ideal client: {{icp}}",
      "",
      "Start with the one problem a {{lead_title}} at a company like {{lead_company}} most likely has that {{brand_name}} solves, in one sentence. Then one sentence on how {{brand_name}} solves it. Then ask if it is worth a short call. Under 70 words. Plain text, no links, no dashes, no lists. Never invent a fact about the lead. Sign with {{sender_first_name}}.",
      "",
      'Answer with JSON only: {"subject": "...", "body": "..."}. Subject: 2 to 4 words, lower case.',
    ].join("\n"),
  },
];
