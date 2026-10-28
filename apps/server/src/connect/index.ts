/**
 * What a brand can connect on this host, how, and the read pass that keeps every connected
 * account read. One registry for every channel: the page lists it, the start route reads it,
 * the read pass dispatches on it. Sending stays off everywhere until real vendors are wired.
 */

import { CONNECT_CHANNELS, type ApiConnectChannel, type ApiConnectStart } from "@gtm-factory/core";
import { q } from "../db";
import { answerBridge, bridgeAvailable, disconnectBridge, driving, readBridge, startBridge, type BridgeChannel, type BridgeMethod } from "./bridge";
import { googleAvailable, readGmail, startGoogle } from "./google";
import { connectImap, readImap, type ImapCreds } from "./imap";
import { secretsConfigured, SECRETS_KEY_ENV } from "./secrets";
import { accountRow, attemptOf, createConnecting, credentialsOf, markFailed, type ConnectRow } from "./store";
import { connectTool, readTool, type TokenTool } from "./tokens";

const BRIDGES: BridgeChannel[] = ["whatsapp", "telegram", "linkedin"];

function withKey(reason: string | null): string | null {
  return reason ?? (secretsConfigured() ? null : `Accounts cannot be connected yet: ${SECRETS_KEY_ENV} is not set on this host.`);
}

/** The catalogue's channels, each available when this host has set it up. */
export function channels(): ApiConnectChannel[] {
  return CONNECT_CHANNELS.map((c) => {
    const why = withKey(c.id === "gmail" ? googleAvailable() : BRIDGES.includes(c.id as BridgeChannel) ? bridgeAvailable(c.id as BridgeChannel) : null);
    return { ...c, available: !why, unavailableReason: why };
  });
}

/** Start a connection: the account exists at once, "connecting", and says what to show next. */
export async function startConnect(b: ApiConnectStart): Promise<ConnectRow> {
  const ch = channels().find((c) => c.id === b.channel);
  if (!ch) throw new Error(`There is no "${b.channel}" to connect here.`);
  if (!ch.available) throw new Error(ch.unavailableReason ?? `${ch.label} cannot be connected here yet.`);
  for (const f of ch.fields ?? []) if (!f.optional && !(b.values?.[f.id] ?? "").trim()) throw new Error(`${f.label} is required.`);
  const row = await createConnecting(b.brandId, ch.id, ch.accountChannel, b.role, ch.kind === "fields" && ch.id === "imap" ? (b.values?.address ?? "").trim() : "");
  try {
    if (ch.id === "gmail") await startGoogle(row);
    else if (ch.id === "imap") await connectImap(row, b.values ?? {});
    else if (ch.kind === "bridge") {
      const method = (b.method ?? ch.methods?.[0]) as BridgeMethod;
      if (!ch.methods?.includes(method)) throw new Error(`${ch.label} cannot be linked with "${method}".`);
      await startBridge(row, ch.id as BridgeChannel, method, method === "phone" ? (b.values?.phone ?? "").trim() || null : null);
    } else await connectTool(row, ch.id as TokenTool, b.values ?? {});
  } catch (e) {
    await markFailed(row.id, e instanceof Error ? e.message : String(e));
  }
  return (await accountRow(row.id))!;
}

export async function answerConnect(row: ConnectRow, values: Record<string, string>): Promise<ConnectRow> {
  if (row.status !== "connecting" || row.step?.type !== "input") throw new Error("This account asks nothing right now.");
  await answerBridge(row, values);
  return (await accountRow(row.id))!;
}

/** A connecting bridge row whose driver died with a restart says so instead of waiting forever. */
export async function connectState(row: ConnectRow) {
  const isBridge = BRIDGES.includes(row.connector as BridgeChannel);
  if (row.status === "connecting" && isBridge && row.step?.type !== "input" && !driving(row.id)) {
    await markFailed(row.id, "The link was interrupted. Start it again.");
    return attemptOf((await accountRow(row.id))!);
  }
  return attemptOf(row);
}

export async function disconnect(row: ConnectRow): Promise<void> {
  if (BRIDGES.includes(row.connector as BridgeChannel)) await disconnectBridge(row, row.credentials ? credentialsOf<{ accessToken: string }>(row) : null);
  await q(`DELETE FROM accounts WHERE id = $1`, [row.id]);
}

/** Read every connected account once: what is new since its last read. */
export async function readPass(): Promise<void> {
  const rows = await q<ConnectRow>(`SELECT * FROM accounts WHERE status = 'connected' AND connector IS NOT NULL AND credentials IS NOT NULL`);
  for (const row of rows) {
    try {
      const c = row.connector!;
      const n =
        c === "gmail"
          ? await readGmail(row, credentialsOf(row))
          : c === "imap"
            ? await readImap(row, credentialsOf<ImapCreds>(row))
            : BRIDGES.includes(c as BridgeChannel)
              ? await readBridge(row, credentialsOf(row))
              : await readTool(row, c as TokenTool, credentialsOf(row));
      await q(`UPDATE accounts SET last_read_at = now() WHERE id = $1`, [row.id]);
      if (n > 0) console.log(`[read] ${row.connector} ${row.id}: ${n} new`);
    } catch (e) {
      console.error(`[read] ${row.connector} ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

let reading = false;
export function startReading(everyMs = 5 * 60_000): void {
  const run = async () => {
    if (reading) return;
    reading = true;
    try {
      await readPass();
    } finally {
      reading = false;
    }
  };
  setTimeout(() => {
    void run();
    setInterval(() => void run(), everyMs);
  }, 30_000);
}
