/** Email verifiers: BounceVerify (an Apify actor) and BounceBan (through treg, charged per its header). */

import { UNIT_PRICES, type Meter } from "./meter";

export type Verdict = "valid" | "invalid" | "catch_all" | "risky" | "unknown";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function mapWord(s: unknown): Verdict | null {
  switch (typeof s === "string" ? s.trim().toLowerCase() : "") {
    case "valid":
    case "ok":
    case "deliverable":
      return "valid";
    case "invalid":
    case "undeliverable":
      return "invalid";
    case "accept_all":
    case "catch_all":
    case "catchall":
    case "accept-all":
      return "catch_all";
    case "risky":
    case "disposable":
      return "risky";
    case "unknown":
    case "unverified":
      return "unknown";
    default:
      return null;
  }
}

export async function bounceVerify(email: string, meter: Meter): Promise<Verdict> {
  const r = await fetch(`https://api.apify.com/v2/acts/bounceverify~bounceverify-email-verifier/run-sync-get-dataset-items?timeout=60`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env("APIFY_TOKEN")}` },
    body: JSON.stringify({ emails: [email] }),
    signal: AbortSignal.timeout(95_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`BounceVerify answered ${r.status}: ${text.slice(0, 300)}`);
  const rows = JSON.parse(text) as Record<string, unknown>[];
  const row = rows.find((x) => String(x.email ?? "").toLowerCase() === email.toLowerCase()) ?? rows[0];
  if (!row) throw new Error(`BounceVerify gave no row: ${text.slice(0, 300)}`);
  // Same precedence as distribute.you's verifier reader: invalid is terminal, catch-all cannot confirm, a spam trap is never valid.
  const raw = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const verdict: Verdict = raw === "invalid" ? "invalid" : row.is_catch_all === true ? "catch_all" : row.is_spamtrap === true ? "risky" : raw === "valid" ? "valid" : raw === "risky" ? "risky" : "unknown";
  meter.add("Apify", "BounceVerify email", 1, UNIT_PRICES.bounceVerify);
  return verdict;
}

async function treg(endpoint: string, query: Record<string, string>): Promise<{ body: Record<string, unknown>; micro: number }> {
  const r = await fetch(`https://treg.to/call/${endpoint}?${new URLSearchParams(query)}`, {
    headers: { "X-Treg-Token": env("TREG_TOKEN"), "X-Treg-Org": env("TREG_ORG"), "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await r.text();
  const micro = Number(r.headers.get("x-treg-cost-micro") ?? "NaN");
  if (!r.ok) throw new Error(`treg ${endpoint} answered ${r.status}: ${text.slice(0, 300)}`);
  if (!Number.isFinite(micro)) throw new Error(`treg ${endpoint} sent no X-Treg-Cost-Micro: the charge cannot be declared`);
  return { body: JSON.parse(text) as Record<string, unknown>, micro };
}

export async function bounceBan(email: string, meter: Meter): Promise<Verdict> {
  let { body, micro } = await treg("bounceban.people.email.verify", { email, mode: "regular" });
  meter.add("treg", "BounceBan verification", 1, micro);
  const started = Date.now();
  while (["verifying", "queue"].includes(String(body.status ?? body.state ?? "")) && Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, 10_000));
    const id = String(body.id ?? "");
    if (!id) break;
    const next = await treg("bounceban.people.email.verify.status", { id });
    body = next.body;
    if (next.micro > 0) meter.add("treg", "BounceBan status", 1, next.micro);
  }
  const verdict = mapWord(body.result);
  if (!verdict) throw new Error(`BounceBan gave no verdict: ${JSON.stringify(body).slice(0, 300)}`);
  return verdict;
}
