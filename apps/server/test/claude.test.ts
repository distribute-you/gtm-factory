/**
 * "Use my Claude" on a real Postgres (TEST_DATABASE_URL, wiped; skipped without one): a run asks
 * the LLM completion it orders for what it wants written (the Request); the client's own Claude
 * answers through the GTM Factory app, minutes later, at $0; the tactic "Runs on" and its
 * strategies choose where an LLM completion is written. The other vendors are test stand-ins.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Catalogue } from "@gtm-factory/core";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(!!url)("Use my Claude", () => {
  let server: Server;
  let base = "";
  let q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let tickNow: () => Promise<void>;
  let catalogue: () => Promise<Catalogue>;
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  /** A live campaign of the demo brand that writes a message to one person whose email was found, the brief keeping one strategy at the LLM completion Engine. */
  const writingCampaign = async (id: string, strategy: string, lead: string) => {
    await q(
      `INSERT INTO campaigns (id, brand_id, offer_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, start_outcome, target, verdicts) VALUES ($1, 'northwind', 'northwind-offer', $1, '', '', '["email_found","message_written"]', '[]', 'live', 1000, 'email_found', 'message_written', $2)`,
      [id, JSON.stringify({ llm_completion: strategy })],
    );
    await q(`INSERT INTO leads (id, brand_id, campaign_id, first_name, last_name, email, company, domain, source) VALUES ($1, 'northwind', $2, 'Ada', 'Moreau', $3, 'Bluefield Systems', 'bluefield.test.invalid', 'test')`, [lead, id, `${lead}@bluefield.test.invalid`]);
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory, content) VALUES ($1, 'lead_identified', 'lead', $2, 'northwind', $3, 'ours', '{}')`, [`u_id_${lead}`, lead, id]);
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory, content) VALUES ($1, 'email_found', 'lead', $2, 'northwind', $3, 'ours', $4)`, [`u_${lead}`, lead, id, JSON.stringify({ email: `${lead}@bluefield.test.invalid`, verified: true })]);
  };
  const written = async (lead: string) => q(`SELECT content FROM units WHERE subject_id = $1 AND outcome = 'message_written'`, [lead]);
  const seen = (minutesAgo: number) => q(`INSERT INTO vendor_presence (vendor, last_seen_at) VALUES ('claude_local', now() - make_interval(mins => $1)) ON CONFLICT (vendor) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`, [minutesAgo]);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.PRODUCTION_IMPORT = "off";
    process.env.FACTORY_SENDERS = "[]";
    process.env.MAILBOX_CREDENTIALS_B64 = Buffer.from("[]").toString("base64");
    const db = await import("../src/db");
    await db.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    for (const r of await db.q<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pipe\\_%' OR nspname LIKE 'engine\\_%'`)) await db.pool.query(`DROP SCHEMA ${r.nspname} CASCADE`);
    const { SEED_CATALOGUE } = await import("../src/catalogue-seed");
    await db.migrate(SEED_CATALOGUE.outcomes.map((o) => o.id));
    const f = await import("../src/factory");
    catalogue = f.loadCatalogue;
    await f.loadCatalogue();
    await (await import("../src/code")).seedCode();
    await f.retirePreV7Scripts();
    const demo = await import("../src/demo");
    await demo.seedDemo();
    await f.seedTemplates();
    await demo.seedAccounts();
    q = db.q;
    tickNow = (await import("../src/scheduler")).tickNow;
    // Stand-ins for every vendor the scripts call (never done in production), then the real adapters production registers: the client's Claude.
    const { registerMockVendors } = await import("../src/mock-vendor");
    registerMockVendors((await q(`SELECT source FROM script_code`)).map((r) => String(r.source)));
    (await import("../src/vendors/claude-local")).registerProductionVendors();
    const { registerVendor } = await import("../src/vendors");
    registerVendor("llm.complete", () => ({ ok: true, data: { text: "Written by our API." } }));
    const { handle } = await import("../src/api");
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });

  afterAll(async () => {
    server?.close();
    const db = await import("../src/db");
    await db.pool.end();
  });

  it("the tactic Runs on: each LLM completion script carries one value; the strategy \"Runs on is Client's Claude\" keeps only those, the default keeps all", async () => {
    const cat = await catalogue();
    const { allowedScripts } = await import("../src/factory");
    const heads = cat.scriptsOf("llm_completion");
    expect(Object.fromEntries(heads.map((s) => [s.id, s.tactics.runs_on]))).toEqual({
      glm_v2: "Our API",
      gemini_flash_v2: "Our API",
      gemini_pro_v2: "Our API",
      clients_claude: "Client's Claude",
      clients_claude_first: "Client's Claude, else our API",
    });
    const campaign = (verdicts: Record<string, string>) => ({ verdicts, factory: "ours" }) as unknown as Parameters<typeof allowedScripts>[2];
    expect(allowedScripts(cat, "llm_completion", campaign({})).map((s) => s.id)).toEqual(heads.map((s) => s.id));
    expect(allowedScripts(cat, "llm_completion", campaign({ llm_completion: "llm_completion#clients-claude" })).map((s) => s.id)).toEqual(["clients_claude"]);
    expect(allowedScripts(cat, "llm_completion", campaign({ llm_completion: "llm_completion#clients-claude-first" })).map((s) => s.id)).toEqual(["clients_claude_first"]);
    // The brief's judge may keep either preference at that Engine; an upgrade retired the versions before it.
    const { briefQuestions } = await import("../src/brief");
    expect(Object.keys(briefQuestions(cat)["keep:llm_completion"]!.criteria)).toEqual(expect.arrayContaining(["llm_completion#clients-claude", "llm_completion#clients-claude-first"]));
    expect(cat.script("glm")!.status).toBe("retired");
    expect(cat.headOf("wr_short")!.id).toBe("wr_short_v2");
  });

  it("a writer asks; the client's Claude gets the Request, the run waits; the app posts the text; the next tick lands the LLM completion at $0 and the message is that text", async () => {
    await seen(0);
    await writingCampaign("claude-only", "llm_completion#clients-claude", "lead_ada");
    await tickNow();
    expect(await written("lead_ada")).toEqual([]);
    expect(await q(`SELECT id FROM units WHERE outcome = 'llm_completion'`)).toEqual([]);

    const listed = await api("GET", "/api/claude/requests");
    expect(listed.status).toBe(200);
    const requests = listed.body.requests as { id: string; brandId: string; prompt: string; askedAt: string }[];
    expect(requests).toHaveLength(1);
    expect(requests[0]!.brandId).toBe("northwind");
    expect(requests[0]!.prompt).toMatch(/^Write a (short )?cold email to lead_ada@bluefield\.test\.invalid/);
    expect((await api("GET", "/api/claude/status")).body).toMatchObject({ online: true, pending: 1 });

    // Still no answer: the next tick asks again for the same work, and the queue holds it once.
    await tickNow();
    expect(((await api("GET", "/api/claude/requests")).body.requests as unknown[]).length).toBe(1);
    expect(await written("lead_ada")).toEqual([]);

    expect((await api("POST", `/api/claude/requests/${requests[0]!.id}/answer`, { text: "Hi Ada, a quick idea for Bluefield.", model: "claude-opus" })).status).toBe(200);
    expect((await api("POST", `/api/claude/requests/${requests[0]!.id}/answer`, { text: "again" })).status).toBe(409);
    expect((await api("POST", "/api/claude/requests/nope/answer", { text: "x" })).status).toBe(404);
    expect((await api("POST", `/api/claude/requests/${requests[0]!.id}/answer`, {})).status).toBe(400);
    await tickNow();

    const [llm] = await q(`SELECT u.content, u.subject_kind, r.script_id, r.spend_micro, r.status FROM units u JOIN runs r ON r.id = u.run_id WHERE u.outcome = 'llm_completion'`);
    expect(llm).toMatchObject({ content: { model: "claude-opus", text: "Hi Ada, a quick idea for Bluefield." }, subject_kind: "run", script_id: "clients_claude", spend_micro: 0, status: "ok" });
    expect(await q(`SELECT vendor, item FROM run_costs`)).toEqual([]);
    const message = await written("lead_ada");
    expect(message).toHaveLength(1);
    expect(message[0]!.content).toMatchObject({ body: "Hi Ada, a quick idea for Bluefield." });
    expect((await q(`SELECT status FROM vendor_requests`)).map((r) => r.status)).toEqual(["taken"]);
    expect(((await api("GET", "/api/claude/requests")).body.requests as unknown[]).length).toBe(0);
    await q(`UPDATE campaigns SET status = 'paused' WHERE id = 'claude-only'`);
  });

  it("the client's Claude first: while the app is online the run waits; after 10 minutes with no app, the fallback calls our API", async () => {
    await seen(1);
    await writingCampaign("claude-first", "llm_completion#clients-claude-first", "lead_bo");
    await tickNow();
    expect(await written("lead_bo")).toEqual([]);
    expect((await q(`SELECT status FROM vendor_requests WHERE brand_id = 'northwind' ORDER BY created_at DESC LIMIT 1`))[0]!.status).toBe("pending");
    expect((await api("GET", "/api/claude/status")).body).toMatchObject({ online: true, pending: 1 });

    await seen(11);
    expect((await api("GET", "/api/claude/status")).body).toMatchObject({ online: false });
    await tickNow();
    const message = await written("lead_bo");
    expect(message).toHaveLength(1);
    expect(message[0]!.content).toMatchObject({ body: "Written by our API." });
    const [llm] = await q(`SELECT u.content, r.script_id FROM units u JOIN runs r ON r.id = u.run_id WHERE u.outcome = 'llm_completion' AND r.script_id = 'clients_claude_first'`);
    expect(llm).toMatchObject({ content: { model: "gemini-3.7-flash", text: "Written by our API." } });
    // The request the app never answered no longer waits for it.
    expect((await q(`SELECT status FROM vendor_requests ORDER BY created_at DESC LIMIT 1`))[0]!.status).toBe("abandoned");
    expect((await api("GET", "/api/claude/status")).body).toMatchObject({ pending: 0 });
  });
});
