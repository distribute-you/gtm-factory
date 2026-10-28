/**
 * Connect an account (owner 2026-10-28): credentials sealed at rest, a channel the host has not
 * set up says so plainly, a pasted key is checked with one read and the account is then read,
 * disconnecting forgets it, and no mocked account survives the migration.
 * The database part needs a Postgres it may wipe: TEST_DATABASE_URL (skipped without one).
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://x@127.0.0.1:1/x";
process.env.FACTORY_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

describe("sealed credentials", () => {
  it("round trip, and the sealed text holds nothing readable", async () => {
    const { seal, unseal } = await import("../src/connect/secrets");
    const s = seal({ token: "sk_live_secret_value" });
    expect(s).not.toContain("sk_live");
    expect(unseal<{ token: string }>(s).token).toBe("sk_live_secret_value");
  });

  it("refuse to store anything without the host's key", async () => {
    const { seal, secretsConfigured } = await import("../src/connect/secrets");
    const k = process.env.FACTORY_SECRETS_KEY;
    delete process.env.FACTORY_SECRETS_KEY;
    expect(secretsConfigured()).toBe(false);
    expect(() => seal({ a: 1 })).toThrow(/FACTORY_SECRETS_KEY/);
    process.env.FACTORY_SECRETS_KEY = k;
  });
});

describe("channels", () => {
  it("every channel distribute.you offers is listed; one the host has not set up says so", async () => {
    const { channels } = await import("../src/connect");
    const ids = channels().map((c) => c.id);
    expect(ids).toEqual(["gmail", "imap", "whatsapp", "telegram", "linkedin", "gohighlevel", "posthog", "stripe", "clerk"]);
    const gmail = channels().find((c) => c.id === "gmail")!;
    expect(gmail.available).toBe(false);
    expect(gmail.unavailableReason).toMatch(/Google sign-in is not set up/);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "s";
    expect(channels().find((c) => c.id === "gmail")!.available).toBe(true);
    expect(channels().find((c) => c.id === "whatsapp")!.unavailableReason).toMatch(/WhatsApp is not set up/);
    expect(channels().find((c) => c.id === "clerk")!.available).toBe(true);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.runIf(!!url)("connecting a real account", () => {
  let server: Server;
  let base = "";
  let q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const db = await import("../src/db");
    await db.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    for (const r of await db.q<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pipe\\_%' OR nspname LIKE 'engine\\_%'`)) await db.pool.query(`DROP SCHEMA ${r.nspname} CASCADE`);
    const { SEED_CATALOGUE } = await import("../src/catalogue-seed");
    // Up to v10 first, with a mocked mailbox, to see the connect migration remove it.
    q = db.q;
    await db.migrate(SEED_CATALOGUE.outcomes.map((o) => o.id));
    const { loadCatalogue } = await import("../src/factory");
    await loadCatalogue();
    await q(`INSERT INTO brands (id, name, website, offer, icp, factory) VALUES ('b1', 'Staff test', 'https://example.com', 'Widgets', 'Ops', 'ours')`);
    const { handle } = await import("../src/api");
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    const db = await import("../src/db");
    await db.pool.end();
  });

  const api = (method: string, path: string, body?: unknown) => realFetch(`${base}/api${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown> }));

  it("no mocked account is left after the migration, and none is seeded", async () => {
    expect(await q(`SELECT id FROM accounts WHERE address LIKE '%.invalid' OR brand_id = 'northwind'`)).toEqual([]);
    const { seedAccounts } = await import("../src/demo");
    await seedAccounts();
    expect(await q(`SELECT id FROM accounts`)).toEqual([]);
  });

  it("a pasted key is checked with one read, sealed, then the account is read; disconnect forgets it", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.startsWith("https://api.clerk.com/")) {
        if ((init?.headers as Record<string, string>)?.authorization !== "Bearer sk_live_good") return new Response(JSON.stringify({ errors: [{ message: "bad key" }] }), { status: 401 });
        return new Response(JSON.stringify([{ id: "user_1", created_at: Date.now(), email_addresses: [{ email_address: "ada@example.com" }] }]), { status: 200 });
      }
      return realFetch(input, init);
    });
    const bad = await api("POST", "/accounts/connect", { brandId: "b1", channel: "clerk", role: "Pro", values: { token: "sk_live_bad" } });
    expect(bad.status).toBe(200);
    expect(bad.json.status).toBe("failed");
    expect(String(bad.json.error)).toMatch(/Clerk refused the key/);
    const ok = await api("POST", "/accounts/connect", { brandId: "b1", channel: "clerk", role: "Pro", values: { token: "sk_live_good" } });
    expect(ok.json.status).toBe("connected");
    const id = String(ok.json.accountId);
    const [row] = await q(`SELECT credentials FROM accounts WHERE id = $1`, [id]);
    expect(String(row!.credentials)).not.toContain("sk_live_good");
    const { readPass } = await import("../src/connect");
    await readPass();
    const list = await api("GET", "/accounts?brandId=b1");
    const acc = (list.json as unknown as { id: string; readWeek: number; status: string }[]).find((a) => a.id === id)!;
    expect(acc.status).toBe("connected");
    expect(acc.readWeek).toBe(1);
    expect((await api("DELETE", `/accounts/${encodeURIComponent(id)}`)).status).toBe(200);
    expect(await q(`SELECT id FROM account_items WHERE account_id = $1`, [id])).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("a role must be one the catalogue knows, and a channel the host has not set up is refused in words", async () => {
    expect((await api("POST", "/accounts/connect", { brandId: "b1", channel: "clerk", role: "Boss", values: { token: "x" } })).status).toBe(400);
    const wa = await api("POST", "/accounts/connect", { brandId: "b1", channel: "whatsapp", role: "Pro" });
    expect(wa.status).toBe(400);
    expect(String(wa.json.error)).toMatch(/WhatsApp is not set up/);
  });

  it("Gmail starts with Google's sign-in page, remembering who asked", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "s";
    const r = await api("POST", "/accounts/connect", { brandId: "b1", channel: "gmail", role: "Personal" });
    expect(r.json.status).toBe("connecting");
    const step = r.json.next as { type: string; url: string };
    expect(step.type).toBe("redirect");
    expect(step.url).toContain("accounts.google.com");
    expect(step.url).toContain(encodeURIComponent("https://factory.distribute.you/api/connect/google/callback"));
    expect(step.url).toContain("gmail.readonly");
    // A sign-in Google never finished leaves no account half connected: a wrong state is ignored.
    const back = await realFetch(`${base}/api/connect/google/callback?state=nope&code=x`, { redirect: "manual" });
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toContain("connect=expired");
  });
});
