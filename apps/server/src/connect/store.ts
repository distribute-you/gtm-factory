/**
 * The account rows a connection writes: created "connecting" with its role, moved to "connected"
 * with its address and sealed credentials, or "failed" with the reason in plain words. What a page
 * shows next (a code to scan, a question) is the row's "shown"; a page polls it.
 */

import { randomBytes } from "node:crypto";
import type { ApiAccountStatus, ApiConnectAttempt } from "@gtm-factory/core";
import { one, q } from "../db";
import { seal, unseal } from "./secrets";

export interface ConnectRow {
  id: string;
  brand_id: string;
  channel: string;
  address: string;
  role: string;
  status: ApiAccountStatus;
  connector: string | null;
  credentials: string | null;
  meta: Record<string, unknown>;
  shown: ApiConnectAttempt["next"];
  error: string | null;
  last_read_at: Date | null;
}

export async function createConnecting(brandId: string, connector: string, accountChannel: string, role: string, address = ""): Promise<ConnectRow> {
  const id = `${brandId}:${connector}:${randomBytes(6).toString("hex")}`;
  return (await one<ConnectRow>(
    `INSERT INTO accounts (id, brand_id, channel, address, role, status, connector) VALUES ($1,$2,$3,$4,$5,'connecting',$6) RETURNING *`,
    [id, brandId, accountChannel, address, role, connector],
  ))!;
}

export async function accountRow(id: string): Promise<ConnectRow | null> {
  return one<ConnectRow>(`SELECT * FROM accounts WHERE id = $1`, [id]);
}

export async function setShown(id: string, step: ApiConnectAttempt["next"], meta?: Record<string, unknown>): Promise<void> {
  await q(`UPDATE accounts SET shown = $2, meta = meta || $3::jsonb, updated_at = now() WHERE id = $1`, [id, step ? JSON.stringify(step) : null, JSON.stringify(meta ?? {})]);
}

export async function markConnected(id: string, address: string, credentials: unknown, meta: Record<string, unknown> = {}): Promise<void> {
  await q(
    `UPDATE accounts SET status = 'connected', address = $2, credentials = $3, meta = meta || $4::jsonb, shown = NULL, error = NULL, updated_at = now() WHERE id = $1`,
    [id, address, credentials === null ? null : seal(credentials), JSON.stringify(meta)],
  );
}

export async function markFailed(id: string, error: string, status: ApiAccountStatus = "failed"): Promise<void> {
  await q(`UPDATE accounts SET status = $2, error = $3, shown = NULL, updated_at = now() WHERE id = $1`, [id, status, error]);
}

export function credentialsOf<T>(row: ConnectRow): T {
  if (!row.credentials) throw new Error(`The account ${row.address || row.id} holds no credentials.`);
  return unseal<T>(row.credentials);
}

export function attemptOf(row: ConnectRow): ApiConnectAttempt {
  return { accountId: row.id, status: row.status, next: row.shown ?? null, error: row.error };
}

/** One thing read from an account (a message, a contact, a payment): kept once, by its id at the vendor. */
export async function keepItem(accountId: string, externalId: string, kind: string, direction: "in" | "out" | "event", at: Date, data: Record<string, unknown>): Promise<boolean> {
  const r = await q(
    `INSERT INTO account_items (account_id, external_id, kind, direction, at, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id, external_id) DO NOTHING RETURNING id`,
    [accountId, externalId, kind, direction, at, JSON.stringify(data)],
  );
  return r.length > 0;
}
