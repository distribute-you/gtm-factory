/**
 * Gmail, by Google sign-in (OAuth 2 with PKCE), read only: GTM Factory reads the mailbox and
 * never sends from it (sends stay off until real vendors are wired). The host sets its own OAuth
 * client (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) with the callback
 * `${FACTORY_PUBLIC_URL}/api/connect/google/callback` registered on it.
 */

import { createHash, randomBytes } from "node:crypto";
import { one } from "../db";
import { keepItem, markConnected, markFailed, setStep, type ConnectRow } from "./store";

export const GOOGLE_ENV = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] as const;
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/userinfo.email"];

export function publicUrl(): string {
  return (process.env.FACTORY_PUBLIC_URL ?? "https://factory.distribute.you").replace(/\/+$/, "");
}

export const googleCallback = (): string => `${publicUrl()}/api/connect/google/callback`;

export function googleAvailable(): string | null {
  const missing = GOOGLE_ENV.filter((k) => !process.env[k]);
  return missing.length ? "Google sign-in is not set up on this host yet." : null;
}

/** The sign-in page for a new Gmail account; the row remembers the state and the PKCE verifier. */
export async function startGoogle(row: ConnectRow): Promise<void> {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const qs = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: googleCallback(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  await setStep(row.id, { type: "redirect", url: `${AUTHORIZE}?${qs.toString()}` }, { state, verifier });
}

async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google refused the sign-in: ${String(body.error_description ?? body.error ?? res.status)}`);
  return body as unknown as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Google came back: trade the code for a refresh token, read the address, the account is connected. Returns the account id. */
export async function finishGoogle(state: string, code: string | null, error: string | null): Promise<string | null> {
  const row = await one<ConnectRow>(`SELECT * FROM accounts WHERE connector = 'gmail' AND status = 'connecting' AND meta->>'state' = $1`, [state]);
  if (!row) return null;
  if (error || !code) {
    await markFailed(row.id, error === "access_denied" ? "The Google sign-in was cancelled." : `Google did not finish the sign-in (${error ?? "no code"}).`);
    return row.id;
  }
  try {
    const t = await token({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      code,
      redirect_uri: googleCallback(),
      grant_type: "authorization_code",
      code_verifier: String(row.meta.verifier ?? ""),
    });
    if (!t.refresh_token) throw new Error("Google gave no lasting access. Remove GTM Factory from your Google account's connected apps, then connect again.");
    const me = (await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })).json()) as { email?: string };
    if (!me.email) throw new Error("Google did not say which address this is.");
    await markConnected(row.id, me.email, { refreshToken: t.refresh_token }, { state: null, verifier: null });
  } catch (e) {
    await markFailed(row.id, e instanceof Error ? e.message : String(e));
  }
  return row.id;
}

/** Read the inbox since the last read (the last 7 days the first time). Returns how many new messages. */
export async function readGmail(row: ConnectRow, creds: { refreshToken: string }): Promise<number> {
  let access: string;
  try {
    access = (await token({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: creds.refreshToken, grant_type: "refresh_token" })).access_token;
  } catch (e) {
    await markFailed(row.id, "Google no longer gives access to this mailbox: connect it again.", "to_reconnect");
    throw e;
  }
  const since = Math.floor((row.last_read_at ? row.last_read_at.getTime() - 3600_000 : Date.now() - 7 * 86400_000) / 1000);
  const api = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const list = (await (await fetch(`${api}?${new URLSearchParams({ q: `after:${since}`, maxResults: "100" })}`, { headers: { authorization: `Bearer ${access}` } })).json()) as { messages?: { id: string; threadId: string }[] };
  let added = 0;
  for (const m of list.messages ?? []) {
    const msg = (await (await fetch(`${api}/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, { headers: { authorization: `Bearer ${access}` } })).json()) as {
      internalDate?: string;
      snippet?: string;
      labelIds?: string[];
      payload?: { headers?: { name: string; value: string }[] };
    };
    const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? null;
    const sent = (msg.labelIds ?? []).includes("SENT");
    if (await keepItem(row.id, m.id, "email", sent ? "out" : "in", new Date(Number(msg.internalDate ?? Date.now())), { from: h("From"), to: h("To"), subject: h("Subject"), snippet: msg.snippet ?? "", thread: m.threadId })) added++;
  }
  return added;
}
