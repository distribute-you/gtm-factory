/**
 * Vendor answers that take minutes. A run lasts at most 2 s in its sandbox, so a vendor that
 * answers later (the client's own Claude, on the client's Mac) answers "pending": the run stops,
 * like a run missing a milestone, and is tried again at a later tick. The request waits in
 * `vendor_requests`, keyed by vendor + brand + request, so the retry of the same work finds its
 * answer. Adapters stay synchronous: what they read (answers, when each app was last seen) is
 * loaded at tick start, and what they write (a new request, an answer used) is kept here and
 * written right after the run's pass.
 */

import { createHash } from "node:crypto";
import { q } from "./db";

/** An app polling within this window shows as online. */
export const ONLINE_WINDOW_MS = 2 * 60_000;

interface Held {
  id: string;
  answer: Record<string, unknown>;
}

let answers = new Map<string, Held>();
let lastSeen = new Map<string, number>();

type Write =
  | { kind: "ask"; vendor: string; key: string; brandId: string | null; request: Record<string, unknown> }
  | { kind: "take"; id: string }
  | { kind: "abandon"; vendor: string; key: string };
const outbox: Write[] = [];

const slot = (vendor: string, key: string) => `${vendor}\u0000${key}`;

/** The key of a request: the same work asked again (the same brand, the same request) finds the same row. */
export function requestKey(vendor: string, brandId: string | null, request: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([vendor, brandId, request])).digest("hex").slice(0, 32);
}

/** Read the answers waiting to be used and when each vendor's app was last seen (at tick start). */
export async function loadPending(): Promise<void> {
  const rows = await q<{ id: string; vendor: string; key: string; answer: Record<string, unknown> }>(`SELECT id, vendor, key, answer FROM vendor_requests WHERE status = 'answered'`);
  answers = new Map(rows.map((r) => [slot(r.vendor, r.key), { id: r.id, answer: r.answer ?? {} }]));
  const seen = await q<{ vendor: string; last_seen_at: string }>(`SELECT vendor, last_seen_at FROM vendor_presence`);
  lastSeen = new Map(seen.map((r) => [r.vendor, new Date(r.last_seen_at).getTime()]));
}

/** The answer to this request, if it came: used once (it becomes a Unit). */
export function takeAnswer(vendor: string, key: string): Record<string, unknown> | undefined {
  const held = answers.get(slot(vendor, key));
  if (!held) return undefined;
  answers.delete(slot(vendor, key));
  outbox.push({ kind: "take", id: held.id });
  return held.answer;
}

/** Minutes since the vendor's app was last seen (Infinity when never). */
export function minutesOffline(vendor: string, now = Date.now()): number {
  const t = lastSeen.get(vendor);
  return t === undefined ? Infinity : Math.max(0, (now - t) / 60_000);
}

/** Queue the request for the vendor's app (once: asked again, it is the same row). */
export function askLater(vendor: string, key: string, brandId: string | null, request: Record<string, unknown>): void {
  outbox.push({ kind: "ask", vendor, key, brandId, request });
}

/** The request is answered elsewhere: the app no longer sees it. */
export function abandon(vendor: string, key: string): void {
  outbox.push({ kind: "abandon", vendor, key });
}

/** Write what the adapters noted during the last pass. */
export async function flushPending(): Promise<void> {
  while (outbox.length > 0) {
    const w = outbox.shift()!;
    if (w.kind === "ask") {
      await q(
        `INSERT INTO vendor_requests (id, vendor, key, brand_id, request) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (vendor, key) WHERE status IN ('pending','answered') DO NOTHING`,
        [`vreq_${createHash("sha256").update(`${w.vendor}:${w.key}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 20)}`, w.vendor, w.key, w.brandId, JSON.stringify(w.request)],
      );
    } else if (w.kind === "take") {
      await q(`UPDATE vendor_requests SET status = 'taken', taken_at = now() WHERE id = $1 AND status = 'answered'`, [w.id]);
    } else {
      await q(`UPDATE vendor_requests SET status = 'abandoned' WHERE vendor = $1 AND key = $2 AND status = 'pending'`, [w.vendor, w.key]);
    }
  }
}

/** The app polled: it is online now. */
export async function markSeen(vendor: string): Promise<void> {
  await q(`INSERT INTO vendor_presence (vendor, last_seen_at) VALUES ($1, now()) ON CONFLICT (vendor) DO UPDATE SET last_seen_at = now()`, [vendor]);
}

export interface PendingRequest {
  id: string;
  brandId: string | null;
  request: Record<string, unknown>;
  askedAt: string;
}

/** The requests waiting for the vendor's app, oldest first. */
export async function pendingRequests(vendor: string, limit = 20): Promise<PendingRequest[]> {
  const rows = await q<{ id: string; brand_id: string | null; request: Record<string, unknown>; created_at: string }>(
    `SELECT id, brand_id, request, created_at FROM vendor_requests WHERE vendor = $1 AND status = 'pending' ORDER BY created_at LIMIT $2`,
    [vendor, limit],
  );
  return rows.map((r) => ({ id: r.id, brandId: r.brand_id, request: r.request, askedAt: new Date(r.created_at).toISOString() }));
}

/** Post the app's answer to one request. "missing" when no such request; "closed" when it is no longer waiting. */
export async function answerRequest(vendor: string, id: string, answer: Record<string, unknown>): Promise<"answered" | "missing" | "closed"> {
  const r = await q<{ id: string }>(`UPDATE vendor_requests SET status = 'answered', answer = $3, answered_at = now() WHERE id = $1 AND vendor = $2 AND status = 'pending' RETURNING id`, [id, vendor, JSON.stringify(answer)]);
  if (r.length > 0) return "answered";
  const exists = await q(`SELECT 1 FROM vendor_requests WHERE id = $1 AND vendor = $2`, [id, vendor]);
  return exists.length > 0 ? "closed" : "missing";
}

/** Is the vendor's app online, when was it last seen, and how many requests wait for it. */
export async function presenceOf(vendor: string): Promise<{ online: boolean; lastSeenAt: string | null; pending: number }> {
  const seen = await q<{ last_seen_at: string }>(`SELECT last_seen_at FROM vendor_presence WHERE vendor = $1`, [vendor]);
  const n = await q<{ n: number }>(`SELECT count(*)::int AS n FROM vendor_requests WHERE vendor = $1 AND status = 'pending'`, [vendor]);
  const at = seen[0] ? new Date(seen[0].last_seen_at).getTime() : null;
  return { online: at !== null && Date.now() - at < ONLINE_WINDOW_MS, lastSeenAt: at === null ? null : new Date(at).toISOString(), pending: n[0]?.n ?? 0 };
}
