/**
 * Work the Plan orders from the client's team: a run of a script a person performs (a closing
 * call with one person) is never run here. It becomes a task: the person is told by email, and
 * answers on the dashboard. The answer becomes the content of the Unit (one Run, one Unit or
 * none), which carries the picks that brought the subject, so they get the credit.
 */

import type { ApiTask, ApiTaskField, Catalogue, Script } from "@gtm-factory/core";
import { one, q } from "./db";
import { FACTORIES } from "./catalogue-seed";
import { finishRun, newId, produce, startRun, type Brand, type CampaignRow, type Lead, type Unit } from "./factory";
import { sendMail, senders } from "./vendors/mail";

interface TaskRow {
  id: string;
  campaign_id: string;
  brand_id: string;
  script_id: string;
  outcome: string;
  lead_id: string | null;
  choices: string[];
  asked: string;
  fields: ApiTaskField[];
  status: "open" | "answered";
  answer: Record<string, string | number | boolean> | null;
  unit_id: string | null;
  created_at: string;
  answered_at: string | null;
}

/**
 * The answer form of a person's script: the fields its catalogue entry declares, else one
 * question, whether it ended in the outcome, and a note.
 */
export function fieldsOf(script: Script, outcomeLabel: string): ApiTaskField[] {
  if (script.form?.length) return script.form;
  return [
    { key: "done", label: `${outcomeLabel}?`, type: "yesno" },
    { key: "notes", label: "Notes", type: "text" },
  ];
}

const nameOf = (l: Lead | null) => (l ? [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.id : null);

/** Open the task for this script and subject (one open task at a time), and tell the person. */
export async function openTask(ctx: { catalogue: { outcome(id: string): { label: string } | undefined }; campaign: CampaignRow; brand: Brand }, script: Script, lead: Lead | null, choices: string[]): Promise<void> {
  const open = await one(`SELECT id FROM tasks WHERE campaign_id = $1 AND script_id = $2 AND coalesce(lead_id, '') = coalesce($3, '') AND status = 'open'`, [ctx.campaign.id, script.id, lead?.id ?? null]);
  if (open) return;
  const label = ctx.catalogue.outcome(script.outcome)?.label ?? script.outcome;
  const who = nameOf(lead);
  const asked = who ? `${script.name} with ${who}${lead?.company ? `, ${lead.company}` : ""}: did it end in ${label.toLowerCase()}?` : `${script.name} for ${ctx.brand.name}: ${label.toLowerCase()}.`;
  const id = newId("task");
  await q(
    `INSERT INTO tasks (id, campaign_id, brand_id, script_id, outcome, lead_id, choices, asked, fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [id, ctx.campaign.id, ctx.brand.id, script.id, script.outcome, lead?.id ?? null, choices, asked, JSON.stringify(fieldsOf(script, label))],
  );
  await notify(id, ctx.brand, asked);
}

/** Email the brand's team, when the brand names an address (a test never reaches anyone else). */
async function notify(taskId: string, brand: Brand & { team_email?: string | null }, asked: string): Promise<void> {
  const to = brand.team_email ?? null;
  const from = senders()[0];
  if (!to || !from) {
    await q(`UPDATE tasks SET notify_note = $2 WHERE id = $1`, [taskId, !to ? "No team address on this brand: shown on the dashboard only." : "No sending mailbox configured."]);
    return;
  }
  try {
    await sendMail({ from, to, subject: `A task from GTM Factory: ${asked.slice(0, 80)}`, text: `${asked}\n\nAnswer it on https://factory.distribute.you/team/\n` });
    await q(`UPDATE tasks SET notified_at = now(), notify_note = $2 WHERE id = $1`, [taskId, `Emailed ${to}`]);
  } catch (e) {
    await q(`UPDATE tasks SET notify_note = $2 WHERE id = $1`, [taskId, `The email failed: ${e instanceof Error ? e.message : String(e)}`]);
  }
}

export async function tasksOut(catalogue: Catalogue, where: string, params: unknown[]): Promise<ApiTask[]> {
  const rows = await q<TaskRow & { first_name: string | null; last_name: string | null; email: string | null }>(
    `SELECT t.*, l.first_name, l.last_name, l.email FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id ${where ? `WHERE ${where}` : ""} ORDER BY t.created_at`,
    params,
  );
  return rows.map(
    (t): ApiTask => ({
      id: t.id,
      campaignId: t.campaign_id,
      brandId: t.brand_id,
      scriptId: t.script_id,
      scriptName: catalogue.script(t.script_id)?.name ?? t.script_id,
      outcome: t.outcome,
      leadId: t.lead_id,
      subjectName: [t.first_name, t.last_name].filter(Boolean).join(" ") || t.email || null,
      asked: t.asked,
      fields: t.fields,
      status: t.status,
      createdAt: new Date(t.created_at).toISOString(),
      answeredAt: t.answered_at ? new Date(t.answered_at).toISOString() : null,
      answer: t.answer,
    }),
  );
}

/** Keep only the declared fields, each of its type. */
function cleanAnswer(fields: ApiTaskField[], values: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "yesno") {
      if (typeof v !== "boolean") throw new Error(`${f.label} is a yes or a no.`);
      out[f.key] = v;
    } else if (f.type === "number" || f.type === "money") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${f.label} is a number of 0 or more.`);
      out[f.key] = n;
    } else out[f.key] = String(v).slice(0, 4000);
  }
  return out;
}

/**
 * The person's answer: the run of the script is recorded, and when the answer says the outcome
 * happened (its yes or no field, when it has one), its Unit lands with the answer as content and
 * the picks that brought the subject on its traceability.
 */
export async function answerTask(id: string, values: Record<string, unknown>): Promise<"answered" | "not_found" | "already"> {
  const t = await one<TaskRow>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!t) return "not_found";
  if (t.status !== "open") return "already";
  const answer = cleanAnswer(t.fields, values);
  const yes = t.fields.find((f) => f.type === "yesno");
  const happened = yes ? answer[yes.key] === true : true;
  const run = await startRun(t.outcome, t.script_id, { campaignId: t.campaign_id, brandId: t.brand_id, leadId: t.lead_id }, t.choices);
  let unit: Unit | null = null;
  if (t.lead_id) {
    const held = await q<Unit>(`SELECT * FROM units WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 1`, [t.lead_id]);
    run.consumed = held;
  }
  if (happened) {
    const trace = [...new Set([...run.consumed.flatMap((u) => u.traceability), ...t.choices])];
    unit = await produce(run, t.outcome, t.lead_id ? { kind: "lead", id: t.lead_id } : { kind: "brand", id: t.brand_id }, answer, { factory: FACTORIES.clientTeam, traceability: trace });
  }
  await finishRun(run, happened ? "ok" : "no_outcome", "Answered by the client's team", null);
  await q(`UPDATE tasks SET status = 'answered', answer = $2, answered_at = now(), unit_id = $3 WHERE id = $1`, [id, JSON.stringify(answer), unit?.id ?? null]);
  return "answered";
}
