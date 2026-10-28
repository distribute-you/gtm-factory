/**
 * Connected accounts: every mailbox, WhatsApp number and LinkedIn profile a brand connected,
 * with the role the brand gave it (Personal, Pro, AI agent) and its counts. A sending or
 * reading script asks for a role and gets every account with that role on its channel; its
 * own code picks one. This module only holds accounts, roles and counts: it never picks.
 * Counts come from the Units that name the account (content.account, content.via).
 */

import type { AccountView, ApiConnectedAccount } from "@gtm-factory/core";
import { one, q } from "./db";

interface AccountRow {
  id: string;
  brand_id: string;
  channel: string;
  address: string;
  role: string;
  status: "connected" | "to_reconnect";
  sent_today: number;
  sent_week: number;
  read_week: number;
}

const COUNTS = `
  SELECT a.id, a.brand_id, a.channel, a.address, a.role, a.status,
    count(u.id) FILTER (WHERE u.content->>'via' = 'sent' AND u.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS sent_today,
    count(u.id) FILTER (WHERE u.content->>'via' = 'sent' AND u.created_at >= now() - interval '7 days')::int AS sent_week,
    count(u.id) FILTER (WHERE u.content->>'via' = 'read' AND u.created_at >= now() - interval '7 days')::int AS read_week
  FROM accounts a
  LEFT JOIN units u ON u.brand_id = a.brand_id AND u.content->>'account' = a.id AND u.created_at >= now() - interval '7 days'`;

/** Every account of a brand, with its counts. */
export async function accountsOf(brandId: string): Promise<AccountView[]> {
  const rows = await q<AccountRow>(`${COUNTS} WHERE a.brand_id = $1 GROUP BY a.id ORDER BY a.channel, a.role, a.address`, [brandId]);
  return rows.map((r) => ({ id: r.id, channel: r.channel, address: r.address, role: r.role, status: r.status, sentToday: r.sent_today, sentWeek: r.sent_week, readWeek: r.read_week }));
}

export async function accountsOut(brandId: string): Promise<ApiConnectedAccount[]> {
  return (await accountsOf(brandId)).map((a) => ({ ...a, brandId }));
}

/** Give an account another role: the next run follows it. */
export async function setAccountRole(id: string, role: string): Promise<ApiConnectedAccount | null> {
  const row = await one<{ brand_id: string }>(`UPDATE accounts SET role = $2, updated_at = now() WHERE id = $1 RETURNING brand_id`, [id, role]);
  if (!row) return null;
  return (await accountsOut(row.brand_id)).find((a) => a.id === id) ?? null;
}
