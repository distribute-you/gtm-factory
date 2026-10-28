/**
 * GTM Factory v7 on a real Postgres (TEST_DATABASE_URL, wiped; skipped without one): the code
 * lives in the database and runs in the sandbox on mocked vendors, the demo brand is seeded
 * paused, the production import is off, a person's script is a task answered on the dashboard,
 * a brief is read by Jev, and new versions come from code text through the API.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(!!url)("GTM Factory v7", () => {
  let server: Server;
  let jev: Server;
  let base = "";
  let q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  let tickNow: () => Promise<void>;
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> & Record<string, unknown>[] };
  };

  // A fresh person found for the campaign, waiting to be identified: the next tick has work for a new version.
  const waitingPerson = async (tag: string) => {
    await q(`INSERT INTO leads (id, brand_id, campaign_id, first_name, source) VALUES ($1, 'northwind', 'northwind-outbound', 'Wait', 'test')`, [`lead_wait_${tag}`]);
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory) VALUES ($1, 'lead_found', 'lead', $2, 'northwind', 'northwind-outbound', 'ours')`, [`u_wait_${tag}`, `lead_wait_${tag}`]);
    await q(`UPDATE leads SET updated_at = now() - interval '30 days' WHERE id = $1`, [`lead_wait_${tag}`]);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.PRODUCTION_IMPORT = "off";
    process.env.FACTORY_SENDERS = "[]";
    process.env.MAILBOX_CREDENTIALS_B64 = Buffer.from("[]").toString("base64");
    // A stand-in for chat-service's platform judgments: the brief rules out the LinkedIn script's Engine and caps sends.
    jev = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const b = JSON.parse(raw) as { questions: Record<string, { criteria: Record<string, string> }>; support?: unknown };
        const answers: Record<string, { type: string; choice: string; confidence: number }> = {};
        for (const [k, qn] of Object.entries(b.questions)) {
          const opts = Object.keys(qn.criteria);
          const choice = k === "keep:lead_found" ? "lead_found#recontact-60" : k === "cap:message_queued" ? "30" : k === "days" ? "30" : opts[0]!;
          answers[k] = { type: "choice", choice, confidence: 0.9 };
        }
        res.writeHead(b.support ? 200 : 400, { "content-type": "application/json" }).end(JSON.stringify({ judge: "jev", model: "jev", answers, usage: { inputTokens: 10, outputTokens: 0 } }));
      });
    });
    await new Promise<void>((r) => jev.listen(0, r));
    const ja = jev.address();
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${typeof ja === "object" && ja ? ja.port : 0}`;
    process.env.CHAT_SERVICE_API_KEY = "test";

    const db = await import("../src/db");
    await db.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    for (const r of await db.q<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pipe\\_%' OR nspname LIKE 'engine\\_%'`)) await db.pool.query(`DROP SCHEMA ${r.nspname} CASCADE`);
    const { SEED_CATALOGUE } = await import("../src/catalogue-seed");
    await db.migrate(SEED_CATALOGUE.outcomes.map((o) => o.id));
    const f = await import("../src/factory");
    await f.loadCatalogue();
    await (await import("../src/code")).seedCode();
    await f.retirePreV7Scripts();
    const demo = await import("../src/demo");
    await demo.seedDemo();
    await demo.seedAccounts();
    q = db.q;
    // An imported production brand and campaign, kept in the database.
    await q(`INSERT INTO brands (id, name, website, offer, icp, factory, source_ref) VALUES ('dy_b', 'Imported', 'https://imported.example', 'Widgets', 'Ops leads', 'distribute_you', 'b')`);
    await q(`INSERT INTO campaigns (id, brand_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, start_outcome, factory, source_ref) VALUES ('dy_c', 'dy_b', 'Imported funnel', 'f', 'F', '["start","lead_interested"]', '[]', 'live', 100000, 'start', 'distribute_you', 'c')`);
    tickNow = (await import("../src/scheduler")).tickNow;
    const { handle } = await import("../src/api");
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });

  afterAll(async () => {
    server?.close();
    jev?.close();
    const db = await import("../src/db");
    await db.pool.end();
  });

  it("keeps every script's code in the database, one immutable row per version", async () => {
    const rows = await q(`SELECT key FROM script_code`);
    expect(rows.length).toBeGreaterThanOrEqual(44);
    await expect(q(`UPDATE script_code SET source = 'x' WHERE key = 'lead_found/src_filters/v1'`)).rejects.toThrow(/immutable/);
    const code = await api("GET", "/api/scripts/src_filters/code");
    expect(code.status).toBe(200);
    expect(String(code.body.source)).toContain('ctx.vendor.call("market.draw"');
  });

  it("seeds the demo brand paused, in its organization, with its offer; the production import stays out of sight", async () => {
    const brands = (await api("GET", "/api/brands")).body as unknown as { id: string; orgName: string; offers: { id: string }[] }[];
    expect(brands.map((b) => b.id)).toEqual(["northwind"]);
    expect(brands[0]!.orgName).toBe("Northwind Analytics");
    expect(brands[0]!.offers.map((o) => o.id)).toEqual(["northwind-offer"]);
    const campaigns = (await api("GET", "/api/campaigns")).body as unknown as { id: string; status: string; offerId: string }[];
    expect(campaigns.map((c) => c.id).sort()).toEqual(["northwind-ads", "northwind-follow-ups", "northwind-outbound", "northwind-pro-answers", "northwind-welcome"]);
    for (const c of campaigns) expect(c).toMatchObject({ status: "paused", offerId: "northwind-offer" });
    expect((await api("GET", "/api/campaigns/dy_c")).status).toBe(404);
    await tickNow();
    expect(await q(`SELECT id FROM runs WHERE brand_id = 'dy_b' OR campaign_id = 'dy_c'`)).toEqual([]);
  });

  it("v10: nothing runs while no real vendor is connected: the Plan is computed, no pick, no run, and the pages say so", async () => {
    // The client's Claude is connected in production, yet it only answers pieces ordered by a lead's run: nothing runs on it alone.
    const { registerProductionVendors } = await import("../src/vendors/claude-local");
    registerProductionVendors();
    expect((await api("POST", "/api/campaigns/northwind-outbound/launch")).status).toBe(200);
    const before = { runs: (await q(`SELECT count(*)::int AS n FROM runs_all`))[0]!.n, choices: (await q(`SELECT count(*)::int AS n FROM choices_all`))[0]!.n };
    for (let i = 0; i < 3; i++) await tickNow();
    expect((await q(`SELECT count(*)::int AS n FROM runs_all`))[0]!.n).toBe(before.runs);
    expect((await q(`SELECT count(*)::int AS n FROM choices_all`))[0]!.n).toBe(before.choices);
    expect((await q(`SELECT plan FROM campaigns WHERE id = 'northwind-outbound'`))[0]!.plan).not.toBeNull();
    expect(((await api("GET", "/api/overview")).body.scheduler as { waiting: string }).waiting).toBe("Nothing runs until real vendors are connected.");
    expect((await api("POST", "/api/campaigns/northwind-outbound/pause")).status).toBe(200);
    // From here on, the tests stand the fictional world in for the vendors (never done in production).
    const { registerMockVendors } = await import("../src/mock-vendor");
    registerMockVendors((await q(`SELECT source FROM script_code`)).map((r) => String(r.source)));
    expect(((await api("GET", "/api/overview")).body.scheduler as { waiting: string | null }).waiting).toBeNull();
  });

  it("v10: a run made on mocked vendors is kept but flagged, and left out of every read", async () => {
    await q(`INSERT INTO runs_all (id, pipe_id, script_id, campaign_id, brand_id, status, note, mocked) VALUES ('run_mock', 'lead_found', 'src_filters', 'northwind-outbound', 'northwind', 'ok', 'mocked', true)`);
    await q(`INSERT INTO units_all (id, outcome, subject_kind, subject_id, brand_id, run_id, factory, mocked) VALUES ('unit_mock', 'lead_found', 'lead', 'x', 'northwind', 'run_mock', 'ours', true)`);
    expect(await q(`SELECT id FROM runs WHERE id = 'run_mock'`)).toEqual([]);
    expect(await q(`SELECT id FROM units WHERE id = 'unit_mock'`)).toEqual([]);
    expect(((await api("GET", "/api/ledger")).body.runs as { id: string }[]).some((r) => r.id === "run_mock")).toBe(false);
    expect((await q(`SELECT mocked FROM runs_all WHERE id = 'run_mock'`))[0]!.mocked).toBe(true);
  });

  it("runs a launched campaign on the scripts' code, the test stand-in answering for the vendors: Units land, nothing is spent", async () => {
    expect((await api("POST", "/api/campaigns/northwind-outbound/launch")).status).toBe(200);
    for (let i = 0; i < 6; i++) await tickNow();
    const runs = await q(`SELECT engine, status, spend_micro FROM runs WHERE campaign_id = 'northwind-outbound'`);
    expect(runs.length).toBeGreaterThan(5);
    expect(runs.filter((r) => r.status === "ok").length).toBeGreaterThan(3);
    expect(runs.every((r) => Number(r.spend_micro) === 0)).toBe(true);
    expect(await q(`SELECT id FROM run_costs`)).toEqual([]);
    const outcomes = new Set((await q(`SELECT DISTINCT outcome FROM units WHERE campaign_id = 'northwind-outbound'`)).map((r) => r.outcome));
    expect(outcomes.has("lead_found")).toBe(true);
    expect(outcomes.has("lead_identified")).toBe(true);
    const leads = await q(`SELECT email FROM leads WHERE campaign_id = 'northwind-outbound'`);
    for (const l of leads) expect(String(l.email)).toMatch(/\.invalid$/);
    expect(((await api("GET", "/api/campaigns/northwind-outbound")).body.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  it("v10: lists the brand's connected accounts with their role; a sending script picks its account among those with its role", async () => {
    type Account = { id: string; channel: string; role: string; status: string; sentWeek: number };
    const list = async () => (await api("GET", "/api/accounts?brandId=northwind")).body as unknown as Account[];
    const accounts = await list();
    expect(accounts).toHaveLength(7);
    expect(new Set(accounts.map((a) => a.role))).toEqual(new Set(["Personal", "Pro", "AI agent"]));
    const agents = accounts.filter((a) => a.channel === "Email" && a.role === "AI agent").map((a) => a.id);
    expect(agents).toHaveLength(3);
    // The morning send's stored code runs in the sandbox on the host's answer: it picks the least used AI agent mailbox.
    const { CompiledScript } = await import("../src/sandbox");
    const { accountsOf } = await import("../src/accounts");
    const source = String((await q(`SELECT source FROM script_code WHERE key = 'message_queued/ce_morning/v2'`))[0]!.source);
    const views = (await accountsOf("northwind")).map((a) => (a.id === agents[0] ? a : { ...a, sentToday: a.sentToday + 5 }));
    const asked: unknown[] = [];
    const out = new CompiledScript(source).run({ subject: "northwind:p1", brand: "northwind", day: 0, tactics: { account_role: "AI agent" } }, (op, args) => {
      if (op === "accounts") {
        asked.push(args);
        return { v: views.filter((a) => a.channel === args[0] && a.role === args[1]) };
      }
      if (op === "vendor") return { v: { ok: true, data: {} } };
      return { v: { id: "u", subject: "northwind:p1", content: {} } };
    });
    expect(asked).toEqual([["Email", "AI agent"]]);
    expect(out).toEqual({ kind: "done", result: { content: { window: "morning", account: agents[0], via: "sent" } } });
    // A Unit that left from an account counts on it.
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, factory, content) VALUES ('v10-sent', 'message_queued', 'lead', 'northwind:p1', 'northwind', 'ours', $1)`, [JSON.stringify({ account: agents[1], via: "sent" })]);
    expect((await list()).find((a) => a.id === agents[1])!.sentWeek).toBe(1);
    // The role is edited in place; an unknown role is refused; connecting says plainly it is not open yet.
    expect((await api("PATCH", `/api/accounts/${encodeURIComponent(agents[0]!)}`, { role: "Pro" })).status).toBe(200);
    expect((await list()).find((a) => a.id === agents[0])!.role).toBe("Pro");
    expect((await api("PATCH", `/api/accounts/${encodeURIComponent(agents[0]!)}`, { role: "Boss" })).status).toBe(400);
    expect((await api("PATCH", `/api/accounts/${encodeURIComponent(agents[0]!)}`, { role: "AI agent" })).status).toBe(200);
    expect((await api("POST", "/api/accounts/connect", { brandId: "northwind", channel: "Email", role: "AI agent" })).status).toBe(501);
  });

  it("v10: serves what the Today charts, the Companies page and the ICPs page read", async () => {
    type Series = { days: string[]; spendCents: number[]; outcomes: Record<string, number[]> };
    const s = (await api("GET", "/api/series?brandId=northwind")).body as unknown as Series;
    expect(s.days.length).toBeGreaterThan(0);
    expect(s.days[s.days.length - 1]).toBe(new Date().toISOString().slice(0, 10));
    expect(s.spendCents).toHaveLength(s.days.length);
    expect((s.outcomes.lead_found ?? []).reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    for (const v of Object.values(s.outcomes)) expect(v).toHaveLength(s.days.length);
    const companies = (await api("GET", "/api/companies?brandId=northwind")).body as unknown as { id: string; name: string; leads: number; leadId: string }[];
    const leads = (await q(`SELECT count(*)::int AS n FROM leads WHERE brand_id = 'northwind'`))[0]!.n as number;
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.reduce((x, c) => x + c.leads, 0)).toBe(leads);
    for (const c of companies) expect(c.id.startsWith("co:") && c.name.length > 0 && !!c.leadId).toBe(true);
    expect((await api("GET", "/api/proposals")).body).toEqual([]);
    // Research reads the beliefs only: the chance each script is the best, and its picks day by day with the estimated regret.
    const research = (await api("GET", "/api/research")).body as unknown as { candidates: { chanceBest: number; rateSd: number }[]; daily: { regretCents: number; bestMargin: number | null }[] }[];
    expect(research.length).toBeGreaterThan(0);
    for (const p of research) if (p.candidates.length > 0) expect(p.candidates.reduce((x, c) => x + c.chanceBest, 0)).toBeCloseTo(1, 6);
    expect(research.some((p) => p.daily.some((d) => d.bestMargin !== null))).toBe(true);
    expect(JSON.stringify(research)).not.toMatch(/"(truth|hiddenBest|onBest)"/);
    const icps = (await api("GET", "/api/objects?outcome=audience_built")).body as unknown as { picks?: number; share?: number }[];
    expect(icps.length).toBeGreaterThan(0);
    for (const d of icps) expect(typeof d.picks === "number" && typeof d.share === "number").toBe(true);
    expect(icps.some((d) => (d.picks ?? 0) > 0)).toBe(true);
  });

  it("v8: serves the Plan as the tree of what ran, its subjects' flows, the brand inputs inside each script, and no Routing", async () => {
    type Node = { outcome: string; scriptId: string | null; branches: { scriptId: string; runs: number; units: number; share: number; current: boolean; inputs: { material: string; versions: { id: string; share: number }[] }[]; children: Node[] }[] };
    const d = (await api("GET", "/api/campaigns/northwind-outbound")).body as unknown as { campaign: Record<string, unknown>; plan: Node; flows: { from: string; to: string; subjects: number; by: { subjects: number }[] }[]; candidates: { candidates: { inputs: unknown[] }[] }[] };
    expect("routing" in d.campaign).toBe(false);
    expect(Array.isArray(d.campaign.line)).toBe(true);
    // Every node of the tree has the Plan's pick marked, and a branch that ran carries its runs and its children.
    const all: Node[] = [];
    const walk = (n: Node) => {
      all.push(n);
      for (const b of n.branches) b.children.forEach(walk);
    };
    walk(d.plan);
    expect(all.length).toBeGreaterThan(3);
    for (const n of all) if (n.scriptId) expect(n.branches.filter((b) => b.current).length, n.outcome).toBe(1);
    const ran = all.flatMap((n) => n.branches).filter((b) => b.runs > 0);
    expect(ran.length).toBeGreaterThan(0);
    for (const n of all) {
      const shares = n.branches.reduce((x, b) => x + b.share, 0);
      if (n.branches.some((b) => b.units > 0)) expect(shares).toBeCloseTo(1, 6);
      // Two branches calling the same outcomes: what runs below is drawn once.
      for (const b of n.branches) if ((b as { sameBelow?: boolean }).sameBelow) expect(b.children).toEqual([]);
    }
    // A Unit of a brand input (an ICP) is never a node: it rides on the script that used it.
    expect(all.some((n) => n.outcome === "audience_built")).toBe(false);
    const withInputs = ran.filter((b) => b.inputs.length > 0);
    expect(withInputs.length).toBeGreaterThan(0);
    for (const b of withInputs) for (const i of b.inputs) expect(i.versions.reduce((x, v) => x + v.share, 0)).toBeCloseTo(1, 6);
    // The candidates of each Engine are scripts only; brand-input picks are inside each script's row.
    for (const place of d.candidates) for (const c of place.candidates) expect(Array.isArray(c.inputs)).toBe(true);
    // Flows: milestone to milestone, by script, counted once per subject.
    for (const f of d.flows) {
      expect(f.subjects).toBeGreaterThan(0);
      expect(f.by.reduce((x, b) => x + b.subjects, 0)).toBeGreaterThanOrEqual(f.subjects);
    }
    const picks = (await api("GET", "/api/campaigns/northwind-outbound")).body.recentPicks as unknown as { kind: string }[];
    for (const p of picks) expect(["script", "input"]).toContain(p.kind);
  });

  it("a new version made from code text through the API runs in the sandbox; a script reaching for the process fails loud", async () => {
    const src = String((await api("GET", "/api/scripts/id_merge/code")).body.source).replace('method: "name, company and title"', 'method: "name, company and title, v2"');
    const v2 = await api("POST", "/api/scripts/id_merge/versions", { source: src, name: "Name, company and title merge, v2" });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ dynasty: "id_merge", version: 2, materials: ["lead_found", "rating"] });
    expect((await api("POST", "/api/scripts/id_email/retire")).status).toBe(200);
    await waitingPerson("v2");
    for (let i = 0; i < 3; i++) await tickNow();
    const made = await q(`SELECT u.content FROM units u JOIN runs r ON r.id = u.run_id WHERE r.script_id = $1`, [v2.body.id]);
    expect(made.length).toBeGreaterThan(0);
    expect(made[0]!.content).toEqual({ method: "name, company and title, v2" });

    const bad = await api("POST", "/api/scripts/id_merge/versions", { source: 'import fs from "node:fs";\nexport default function run(ctx: any) { ctx.get("lead_found"); return { content: { x: String(fs) } }; }' });
    expect(bad.status).toBe(400);
    const named = await api("POST", "/api/scripts/id_merge/versions", { source: 'export default function run(ctx: any) { const o = "lead_found"; ctx.get(o); return null; }' });
    expect(named.status).toBe(400);
    const v3 = await api("POST", "/api/scripts/id_merge/versions", { source: 'export default function run(ctx: any) { ctx.get("lead_found"); ctx.get("rating"); return { content: { env: Object.keys(process.env).length, f: typeof fetch } }; }' });
    expect(v3.status).toBe(200);
    await waitingPerson("v3");
    for (let i = 0; i < 3; i++) await tickNow();
    const failed = await q(`SELECT status, note FROM runs WHERE script_id = $1`, [v3.body.id]);
    expect(failed.length).toBeGreaterThan(0);
    for (const r of failed) {
      expect(r.status).toBe("failed");
      expect(String(r.note)).toMatch(/process is not defined/);
    }
  });

  it("each run is its own isolate: no escape through constructor chains, a loop dies at 2 s, a memory bomb at its limit, and the app keeps ticking", async () => {
    const versions = {
      escape: 'export default function run(ctx: any) { ctx.get("lead_found"); ctx.get("rating"); let out = "none"; try { out = typeof (this as any).constructor.constructor("return process")(); } catch (e) { out = String(e); } const viaCtx = ctx.get.constructor.constructor("return typeof process + typeof require + typeof __host")(); return { content: { out, viaCtx } }; }',
      loop: 'export default function run(ctx: any) { ctx.get("lead_found"); ctx.get("rating"); for (;;) {} }',
      bomb: 'export default function run(ctx: any) { ctx.get("lead_found"); ctx.get("rating"); const a: string[] = []; for (;;) a.push("x".repeat(1e6) + Math.random()); }',
    };
    const results: Record<string, Record<string, unknown>[]> = {};
    for (const [name, source] of Object.entries(versions)) {
      const v = await api("POST", "/api/scripts/id_merge/versions", { source, name: `id merge ${name}` });
      expect(v.status, name).toBe(200);
      // A fresh person found for the campaign, waiting to be identified.
      await q(`INSERT INTO leads (id, brand_id, campaign_id, first_name, source) VALUES ($1, 'northwind', 'northwind-outbound', 'Iso', 'test')`, [`lead_iso_${name}`]);
      await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory) VALUES ($1, 'lead_found', 'lead', $2, 'northwind', 'northwind-outbound', 'ours')`, [`u_iso_${name}`, `lead_iso_${name}`]);
      await q(`UPDATE leads SET updated_at = now() - interval '30 days' WHERE id = $1`, [`lead_iso_${name}`]);
      const before = Number((await q(`SELECT ticks FROM scheduler_state WHERE id = 1`))[0]!.ticks);
      await tickNow();
      const after = await q(`SELECT ticks, last_error FROM scheduler_state WHERE id = 1`);
      expect(Number(after[0]!.ticks), name).toBe(before + 1);
      expect(after[0]!.last_error, name).toBeNull();
      results[name] = await q(`SELECT r.status, r.note, u.content FROM runs r LEFT JOIN units u ON u.run_id = r.id WHERE r.script_id = $1`, [v.body.id]);
      expect(results[name]!.length, name).toBeGreaterThan(0);
    }
    for (const r of results.escape!) expect(r.content).toEqual({ out: "ReferenceError: process is not defined", viaCtx: "undefinedundefinedundefined" });
    for (const r of results.loop!) expect(r).toMatchObject({ status: "failed", note: expect.stringMatching(/2000 ms limit/) });
    // A memory bomb dies at its memory limit, or at the time limit on a loaded machine that allocates slower: killed either way.
    for (const r of results.bomb!) expect(r).toMatchObject({ status: "failed", note: expect.stringMatching(/64 MB memory limit|2000 ms limit/) });
  });

  it("a fork made from code text is a new dynasty of the same Engine", async () => {
    const src = String((await api("GET", "/api/scripts/ef_lookup/code")).body.source);
    const fork = await api("POST", "/api/scripts/ef_lookup/forks", { source: src, name: "Provider lookup, fork" });
    expect(fork.status).toBe(200);
    expect(fork.body).toMatchObject({ outcome: "email_found", version: 1, materials: ["lead_identified", "rating"] });
    expect(fork.body.dynasty).not.toBe("ef_lookup");
  });

  it("a person's script is a task: the answer becomes the Unit, crediting the picks that brought the subject", async () => {
    await q(`INSERT INTO leads (id, brand_id, campaign_id, first_name, last_name, email, source) VALUES ('lead_t', 'northwind', 'northwind-outbound', 'Marie', 'Dubois', 'marie@test.invalid', 'test')`);
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory, traceability) VALUES ('u_att', 'meeting_attended', 'lead', 'lead_t', 'northwind', 'northwind-outbound', 'ours', '{ch_x}')`);
    await q(
      `INSERT INTO campaigns (id, brand_id, offer_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, start_outcome, target) VALUES ('northwind-close', 'northwind', 'northwind-offer', 'Close every attended meeting', '', '', '["meeting_attended","paid_client"]', '[]', 'live', 1000, 'meeting_attended', 'paid_client')`,
    );
    await tickNow();
    const tasks = (await api("GET", "/api/tasks?brandId=northwind&status=open")).body as unknown as { id: string; leadId: string; fields: { key: string }[]; asked: string; subjectName: string }[];
    const t = tasks.find((x) => x.leadId === "lead_t")!;
    expect(t.subjectName).toBe("Marie Dubois");
    expect(t.fields.map((f) => f.key)).toEqual(["paid", "amount", "notes"]);
    const answered = await api("POST", `/api/tasks/${t.id}/answer`, { values: { paid: true, amount: 6000, notes: "Signed" } });
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe("answered");
    const [paid] = await q(`SELECT content, traceability, factory FROM units WHERE subject_id = 'lead_t' AND outcome = 'paid_client'`);
    expect(paid).toMatchObject({ content: { paid: true, amount: 6000, notes: "Signed" }, factory: "client_team" });
    expect(paid!.traceability).toContain("ch_x");
    expect((await api("POST", `/api/tasks/${t.id}/answer`, { values: { paid: true } })).status).toBe(409);
  });

  it("a brief is read once by Jev: per Engine the strategy kept, a daily cap, a test length", async () => {
    const r = await api("POST", "/api/campaigns", { brandId: "northwind", offerId: "northwind-offer", start: "start", target: "lead_interested", dailyBudgetCents: 500, brief: "Cold email only, at most 30 a day, a 30-day test." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verdicts: { lead_found: "lead_found#recontact-60" }, caps: { message_queued: 30 }, offerId: "northwind-offer" });
    expect((await api("POST", "/api/campaigns", { brandId: "northwind", offerId: "nope", target: "lead_interested", dailyBudgetCents: 500 })).status).toBe(400);
  });
});
