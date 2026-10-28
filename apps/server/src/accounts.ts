/**
 * Connected accounts: every mailbox, WhatsApp number and LinkedIn profile a brand connected,
 * with the role the brand gave it (Personal, Pro, AI agent) and its counts. A sending or
 * reading script asks for a role and gets every account with that role on its channel; its
 * own code picks one. This module only holds accounts, roles and counts: it never picks.
 * Sends come from the Units that name the account (content.account, content.via); reads from
 * what the read pass kept from the account (account_items).
 */

import type { AccountView, ApiConnectedAccount } from "@gtm-factory/core";
import { one, q } from "./db";

interface AccountRow {
  id: string;
  brand_id: string;
  channel: string;
  address: string;
  role: string;
  status: "connecting" | "connected" | "to_reconnect" | "failed";
  error: string | null;
  last_read_at: Date | null;
  sent_today: number;
  sent_week: number;
  read_week: number;
}

const COUNTS = `
  SELECT a.id, a.brand_id, a.channel, a.address, a.role, a.status, a.error, a.last_read_at,
    count(u.id) FILTER (WHERE u.content->>'via' = 'sent' AND u.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS sent_today,
    count(u.id) FILTER (WHERE u.content->>'via' = 'sent' AND u.created_at >= now() - interval '7 days')::int AS sent_week,
    (SELECT count(*) FROM account_items i WHERE i.account_id = a.id AND i.direction <> 'out' AND i.at >= now() - interval '7 days')::int AS read_week
  FROM accounts a
  LEFT JOIN units u ON u.brand_id = a.brand_id AND u.content->>'account' = a.id AND u.created_at >= now() - interval '7 days'`;

async function rowsOf(brandId: string): Promise<AccountRow[]> {
  return q<AccountRow>(`${COUNTS} WHERE a.brand_id = $1 GROUP BY a.id ORDER BY a.channel, a.role, a.address`, [brandId]);
}

/** The brand's accounts a script can use: connected ones, and those waiting to be reconnected. */
export async function accountsOf(brandId: string): Promise<AccountView[]> {
  return (await rowsOf(brandId))
    .filter((r) => r.status === "connected" || r.status === "to_reconnect")
    .map((r) => ({ id: r.id, channel: r.channel, address: r.address, role: r.role, status: r.status as "connected" | "to_reconnect", sentToday: r.sent_today, sentWeek: r.sent_week, readWeek: r.read_week }));
}

/** Every account of a brand for its page, connecting and failed ones included. */
export async function accountsOut(brandId: string): Promise<ApiConnectedAccount[]> {
  return (await rowsOf(brandId)).map((r) => ({
    id: r.id,
    brandId,
    channel: r.channel,
    address: r.address,
    role: r.role,
    status: r.status,
    sentToday: r.sent_today,
    sentWeek: r.sent_week,
    readWeek: r.read_week,
    error: r.error,
    lastReadAt: r.last_read_at ? r.last_read_at.toISOString() : null,
  }));
}

/** Give an account another role: the next run follows it. */
export async function setAccountRole(id: string, role: string): Promise<ApiConnectedAccount | null> {
  const row = await one<{ brand_id: string }>(`UPDATE accounts SET role = $2, updated_at = now() WHERE id = $1 RETURNING brand_id`, [id, role]);
  if (!row) return null;
  return (await accountsOut(row.brand_id)).find((a) => a.id === id) ?? null;
}
