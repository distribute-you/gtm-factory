/**
 * The client's own tools, connected with a key the client pastes (the same four distribute.you
 * offers): GoHighLevel (contacts), PostHog (identified visitors), Stripe (payments, restricted key
 * only) and Clerk (signups). Connecting checks the key with one read; reading keeps what is new.
 * GTM Factory never writes to any of them.
 */

import { toolFields, toolLabel, type ToolId } from "@gtm-factory/core";
import { keepItem, markConnected, markFailed, type ConnectRow } from "./store";

export type TokenTool = ToolId;

type Creds = Record<string, string>;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`answered ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

const phHost = (c: Creds) => (c.region === "us" ? "https://us.posthog.com" : "https://eu.posthog.com");

/** One page of the tool's newest records, as items: id, when, what. */
async function fetchRecent(tool: TokenTool, c: Creds): Promise<{ id: string; at: Date; kind: string; data: Record<string, unknown> }[]> {
  if (tool === "gohighlevel") {
    const r = (await getJson(`https://services.leadconnectorhq.com/contacts/?${new URLSearchParams({ locationId: c.locationId ?? "", limit: "100" })}`, { authorization: `Bearer ${c.token}`, version: "2021-07-28" })) as { contacts?: { id: string; email?: string; firstName?: string; lastName?: string; dateAdded?: string }[] };
    return (r.contacts ?? []).map((x) => ({ id: x.id, at: new Date(x.dateAdded ?? Date.now()), kind: "contact", data: { email: x.email ?? null, name: [x.firstName, x.lastName].filter(Boolean).join(" ") } }));
  }
  if (tool === "posthog") {
    const r = (await getJson(`${phHost(c)}/api/projects/${encodeURIComponent(c.projectId ?? "")}/persons/?limit=100`, { authorization: `Bearer ${c.token}` })) as { results?: { uuid?: string; id?: string; created_at?: string; properties?: Record<string, unknown> }[] };
    return (r.results ?? []).filter((p) => typeof p.properties?.email === "string").map((p) => ({ id: String(p.uuid ?? p.id), at: new Date(p.created_at ?? Date.now()), kind: "visitor", data: { email: p.properties!.email } }));
  }
  if (tool === "stripe") {
    const r = (await getJson("https://api.stripe.com/v1/charges?limit=100", { authorization: `Bearer ${c.token}` })) as { data?: { id: string; created: number; amount: number; currency: string; paid: boolean; billing_details?: { email?: string } }[] };
    return (r.data ?? []).map((x) => ({ id: x.id, at: new Date(x.created * 1000), kind: "payment", data: { amount: x.amount, currency: x.currency, paid: x.paid, email: x.billing_details?.email ?? null } }));
  }
  const r = (await getJson("https://api.clerk.com/v1/users?limit=100&order_by=-created_at", { authorization: `Bearer ${c.token}` })) as { id: string; created_at: number; email_addresses?: { email_address: string }[] }[];
  return (Array.isArray(r) ? r : []).map((u) => ({ id: u.id, at: new Date(u.created_at), kind: "signup", data: { email: u.email_addresses?.[0]?.email_address ?? null } }));
}

export async function connectTool(row: ConnectRow, tool: TokenTool, v: Record<string, string>): Promise<void> {
  const creds: Creds = {};
  for (const f of toolFields(tool)) creds[f.id] = (v[f.id] ?? "").trim();
  if (tool === "stripe" && creds.token?.startsWith("sk_")) return markFailed(row.id, "Stripe needs a restricted key (rk_...), so nothing connected here can move money.");
  try {
    await fetchRecent(tool, creds);
    const address = tool === "gohighlevel" ? `Sub-account ${creds.locationId}` : tool === "posthog" ? `Project ${creds.projectId}` : `${toolLabel(tool)} account`;
    await markConnected(row.id, address, creds);
  } catch (e) {
    await markFailed(row.id, `${toolLabel(tool)} refused the key: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function readTool(row: ConnectRow, tool: TokenTool, creds: Creds): Promise<number> {
  let items;
  try {
    items = await fetchRecent(tool, creds);
  } catch (e) {
    await markFailed(row.id, `${toolLabel(tool)} no longer accepts the key: connect it again.`, "to_reconnect");
    throw e;
  }
  let added = 0;
  for (const i of items) if (await keepItem(row.id, i.id, i.kind, "event", i.at, i.data)) added++;
  return added;
}
