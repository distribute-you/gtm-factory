/**
 * WhatsApp, Telegram and LinkedIn, through the mautrix bridges (bridgev2 provisioning API), the
 * way distribute.you links them: each connected account gets its OWN Matrix user on the host's
 * appservice namespace, logs in on the bridge (a QR code to scan, a phone pairing code, or a
 * LinkedIn login), and is then read through that user's own /sync. One user per account is what
 * keeps one account's chats unreachable from any other's. Read only: nothing here writes to a chat.
 *
 * Host settings: FACTORY_MATRIX_HOMESERVER_URL, FACTORY_MATRIX_APPSERVICE_TOKEN (an appservice
 * that owns FACTORY_MATRIX_USER_PREFIX, default "gtmfactory_"), and per channel
 * FACTORY_MATRIX_<CHANNEL>_PROVISIONING_URL / _SECRET.
 */

import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { ApiConnectAttempt, ApiConnectField } from "@gtm-factory/core";
import { q } from "../db";
import { seal } from "./secrets";
import { accountRow, keepItem, markFailed, setStep, type ConnectRow } from "./store";

export type BridgeChannel = "whatsapp" | "telegram" | "linkedin";
export type BridgeMethod = "qr" | "phone" | "password" | "cookies";

export const BRIDGE_METHODS: Record<BridgeChannel, BridgeMethod[]> = {
  whatsapp: ["qr", "phone"],
  telegram: ["qr", "phone"],
  linkedin: ["password", "cookies"],
};

export const bridgeEnv = (channel: BridgeChannel): string[] => [
  "FACTORY_MATRIX_HOMESERVER_URL",
  "FACTORY_MATRIX_APPSERVICE_TOKEN",
  `FACTORY_MATRIX_${channel.toUpperCase()}_PROVISIONING_URL`,
  `FACTORY_MATRIX_${channel.toUpperCase()}_PROVISIONING_SECRET`,
];

const LABEL: Record<BridgeChannel, string> = { whatsapp: "WhatsApp", telegram: "Telegram", linkedin: "LinkedIn" };

export function bridgeAvailable(channel: BridgeChannel): string | null {
  return bridgeEnv(channel).some((k) => !process.env[k]) ? `Linking ${LABEL[channel]} is not set up on this host yet.` : null;
}

const hs = () => process.env.FACTORY_MATRIX_HOMESERVER_URL!.replace(/\/+$/, "");
const prefix = () => process.env.FACTORY_MATRIX_USER_PREFIX ?? "gtmfactory_";

async function hsCall<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${hs()}/_matrix/client/v3${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`The message server answered ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** A fresh Matrix user for one account, and its access token. */
async function newUser(): Promise<{ mxid: string; accessToken: string }> {
  const as = process.env.FACTORY_MATRIX_APPSERVICE_TOKEN!;
  const localpart = `${prefix()}${randomBytes(8).toString("hex")}`;
  const reg = await hsCall<{ user_id?: string }>("POST", "/register", as, { type: "m.login.application_service", username: localpart, inhibit_login: true });
  if (!reg.user_id) throw new Error("The message server created no user.");
  const login = await hsCall<{ access_token?: string }>("POST", "/login", as, { type: "m.login.application_service", identifier: { type: "m.id.user", user: localpart }, initial_device_display_name: "GTM Factory" });
  if (!login.access_token) throw new Error("The message server gave no access.");
  return { mxid: reg.user_id, accessToken: login.access_token };
}

interface LoginStep {
  login_id: string;
  type: string;
  step_id: string;
  instructions?: string;
  display_and_wait?: { type: string; data?: string };
  user_input?: { fields?: { id: string; name?: string; description?: string; type?: string }[] };
  cookies?: { fields?: { id: string }[] };
  complete?: { user_login_id?: string };
}

async function prov<T>(channel: BridgeChannel, mxid: string, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 45_000): Promise<T> {
  const key = channel.toUpperCase();
  const url = `${process.env[`FACTORY_MATRIX_${key}_PROVISIONING_URL`]!.replace(/\/+$/, "")}/_matrix/provision/v3${path}?${new URLSearchParams({ user_id: mxid })}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env[`FACTORY_MATRIX_${key}_PROVISIONING_SECRET`]!}` },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const parsed = (() => {
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: text.slice(0, 200) };
    }
  })();
  if (!res.ok) throw new Error(`${LABEL[channel]} refused: ${String(parsed.error ?? parsed.errcode ?? res.status)}`);
  return parsed as T;
}

/** Drivers alive in this process: a "connecting" row with none was interrupted by a restart. */
const drivers = new Set<string>();

export function driving(accountId: string): boolean {
  return drivers.has(accountId);
}

function fieldsOf(step: LoginStep): ApiConnectField[] {
  if (step.type === "cookies") return (step.cookies?.fields ?? []).map((f) => ({ id: f.id, label: f.id, secret: true }));
  return (step.user_input?.fields ?? []).map((f) => ({ id: f.id, label: f.name ?? f.id, help: f.description, secret: f.type === "password" }));
}

/** Show the step to the person, keep driving a code that refreshes, finish on completion. */
async function handle(row: ConnectRow, channel: BridgeChannel, mxid: string, step: LoginStep, phone: string | null): Promise<void> {
  const meta = { loginId: step.login_id, stepId: step.step_id, stepType: step.type };
  if (step.type === "complete") {
    const who = await prov<{ logins?: { id: string; name?: string }[] }>(channel, mxid, "GET", "/whoami").catch(() => ({ logins: [] as { id: string; name?: string }[] }));
    const login = who.logins?.find((l) => l.id === step.complete?.user_login_id) ?? who.logins?.[0];
    await q(`UPDATE accounts SET status = 'connected', address = $2, step = NULL, error = NULL, meta = meta || $3::jsonb, updated_at = now() WHERE id = $1`, [row.id, login?.name || step.complete?.user_login_id || "linked", JSON.stringify({ loginId: login?.id ?? null })]);
    return;
  }
  if (step.type === "user_input" || step.type === "cookies") {
    const fields = fieldsOf(step);
    // The phone number was given at the start: answer the bridge's first question with it.
    if (phone && fields.length === 1 && /phone/i.test(fields[0]!.id)) return next(row, channel, mxid, prov<LoginStep>(channel, mxid, "POST", `/login/step/${enc(step.login_id)}/${enc(step.step_id)}/${step.type}`, { [fields[0]!.id]: phone }), null);
    const s: ApiConnectAttempt["step"] = { type: "input", fields, instructions: step.instructions };
    await setStep(row.id, s, meta);
    return;
  }
  if (step.type === "display_and_wait") {
    const d = step.display_and_wait;
    const s: ApiConnectAttempt["step"] = d?.type === "qr" ? { type: "qr", data: await QRCode.toDataURL(d.data ?? "", { margin: 1, width: 240 }), instructions: step.instructions } : { type: "code", data: d?.data ?? "", instructions: step.instructions };
    await setStep(row.id, s, meta);
    return next(row, channel, mxid, prov<LoginStep>(channel, mxid, "POST", `/login/step/${enc(step.login_id)}/${enc(step.step_id)}/display_and_wait`, {}, 5 * 60_000), null);
  }
  await markFailed(row.id, `${LABEL[channel]} asked for a step GTM Factory cannot show (${step.type}).`);
}

const enc = encodeURIComponent;

async function next(row: ConnectRow, channel: BridgeChannel, mxid: string, p: Promise<LoginStep>, phone: string | null): Promise<void> {
  drivers.add(row.id);
  try {
    await handle(row, channel, mxid, await p, phone);
  } catch (e) {
    await markFailed(row.id, e instanceof Error ? e.message : String(e));
  } finally {
    const r = await accountRow(row.id);
    if (!r || r.status !== "connecting" || r.step?.type === "input") drivers.delete(row.id);
  }
}

export async function startBridge(row: ConnectRow, channel: BridgeChannel, method: BridgeMethod, phone: string | null): Promise<void> {
  const { mxid, accessToken } = await newUser();
  await q(`UPDATE accounts SET credentials = $2, meta = meta || $3::jsonb WHERE id = $1`, [row.id, seal({ accessToken }), JSON.stringify({ mxid, channel })]);
  const first = await prov<LoginStep>(channel, mxid, "POST", `/login/start/${method}`);
  // The first step (a QR, a question) is on the row before the page asks; a code that refreshes keeps being driven in the background.
  void next(row, channel, mxid, Promise.resolve(first), phone);
  for (let i = 0; i < 20; i++) {
    const r = await accountRow(row.id);
    if (!r || r.step || r.status !== "connecting") return;
    await new Promise((res) => setTimeout(res, 250));
  }
}

export async function answerBridge(row: ConnectRow, values: Record<string, string>): Promise<void> {
  const channel = row.meta.channel as BridgeChannel;
  const mxid = String(row.meta.mxid);
  const step = `/login/step/${enc(String(row.meta.loginId))}/${enc(String(row.meta.stepId))}/${String(row.meta.stepType)}`;
  await setStep(row.id, null);
  await next(row, channel, mxid, prov<LoginStep>(channel, mxid, "POST", step, values), null);
}

/** Messages since the last read, through the account's own /sync. Invites from the bridge are accepted. */
export async function readBridge(row: ConnectRow, creds: { accessToken: string }): Promise<number> {
  const mxid = String(row.meta.mxid);
  const since = typeof row.meta.since === "string" ? row.meta.since : null;
  const filter = JSON.stringify({ room: { timeline: { limit: 50 } }, presence: { not_types: ["*"] }, account_data: { not_types: ["*"] } });
  const sync = await hsCall<{
    next_batch: string;
    rooms?: { join?: Record<string, { timeline?: { events?: { event_id: string; type: string; sender: string; origin_server_ts: number; content?: { body?: string; msgtype?: string } }[] } }>; invite?: Record<string, unknown> };
  }>("GET", `/sync?${new URLSearchParams({ timeout: "0", filter, ...(since ? { since } : {}) })}`, creds.accessToken);
  for (const roomId of Object.keys(sync.rooms?.invite ?? {})) await hsCall("POST", `/join/${enc(roomId)}`, creds.accessToken, {}).catch(() => undefined);
  let added = 0;
  for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
    for (const ev of room.timeline?.events ?? []) {
      if (ev.type !== "m.room.message") continue;
      if (await keepItem(row.id, ev.event_id, "message", ev.sender === mxid ? "out" : "in", new Date(ev.origin_server_ts), { room: roomId, sender: ev.sender, body: ev.content?.body ?? "", msgtype: ev.content?.msgtype ?? null })) added++;
    }
  }
  await q(`UPDATE accounts SET meta = meta || $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ since: sync.next_batch })]);
  return added;
}

export async function disconnectBridge(row: ConnectRow, creds: { accessToken: string } | null): Promise<void> {
  const channel = row.meta.channel as BridgeChannel | undefined;
  if (channel && row.meta.mxid) await prov(channel, String(row.meta.mxid), "POST", "/logout/all").catch(() => undefined);
  if (creds) await hsCall("POST", "/logout", creds.accessToken, {}).catch(() => undefined);
}
