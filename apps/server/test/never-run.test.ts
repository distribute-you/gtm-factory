/**
 * A campaign another party runs is read, never run: the scheduler's tick makes no run, choice or
 * Unit for them and sends nothing, and the API refuses to launch, pause or cap them.
 * Needs a Postgres it may wipe: TEST_DATABASE_URL (skipped without one).
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(!!url)("a campaign another party runs", () => {
  let server: Server;
  let base = "";
  let q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    // A campaign another party runs is shown only while the production import is on.
    process.env.PRODUCTION_IMPORT = "on";
    process.env.FACTORY_SENDERS = "[]";
    process.env.MAILBOX_CREDENTIALS_B64 = Buffer.from("[]").toString("base64");
    const db = await import("../src/db");
    await db.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    for (const r of await db.q<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pipe\\_%' OR nspname LIKE 'engine\\_%'`)) await db.pool.query(`DROP SCHEMA ${r.nspname} CASCADE`);
    const { SEED_CATALOGUE } = await import("../src/catalogue-seed");
    await db.migrate(SEED_CATALOGUE.outcomes.map((o) => o.id));
    const { loadCatalogue } = await import("../src/factory");
    await loadCatalogue();
    q = db.q;
    await q(`INSERT INTO brands (id, name, website, offer, icp, factory, source_ref) VALUES ('dy_b', 'Fictional', 'https://fictional.example', 'Widgets', 'Ops leads', 'distribute_you', 'b')`);
    await q(
      `INSERT INTO campaigns (id, brand_id, name, funnel_id, funnel_name, line, plays, status, daily_budget_cents, start_outcome, factory, source_ref)
       VALUES ('dy_c', 'dy_b', 'Fictional funnel', 'f', 'F', '["lead_found","lead_interested"]', '["sourcing","email_finding","writer","cold_email"]', 'live', 100000, 'start', 'distribute_you', 'c')`,
    );
    await q(`INSERT INTO leads (id, brand_id, campaign_id, email, first_name, source) VALUES ('dyl_1', 'dy_b', 'dy_c', 'ada@fictional.example', 'Ada', 'distribute_you')`);
    await q(`INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory) VALUES ('dyu_1', 'message_written', 'lead', 'dyl_1', 'dy_b', 'dy_c', 'distribute_you')`);
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

  it("is never ticked: no run, no choice, no Unit, no send", async () => {
    const { tickNow } = await import("../src/scheduler");
    await tickNow();
    await tickNow();
    expect(await q(`SELECT id FROM runs WHERE campaign_id = 'dy_c' OR brand_id = 'dy_b'`)).toEqual([]);
    expect(await q(`SELECT id FROM choices WHERE campaign_id = 'dy_c'`)).toEqual([]);
    expect(await q(`SELECT id FROM units WHERE campaign_id = 'dy_c' AND id <> 'dyu_1'`)).toEqual([]);
    expect(await q(`SELECT id FROM runs WHERE engine IN ('message_queued', 'follow_up_queued', 'message_sent')`)).toEqual([]);
    expect((await q(`SELECT ticks FROM scheduler_state WHERE id = 1`))[0]!.ticks).toBe(2);
  });

  it("cannot be launched, paused or capped, and gets no new campaign or reported outcome", async () => {
    for (const [method, path, body] of [
      ["POST", "/api/campaigns/dy_c/launch", {}],
      ["POST", "/api/campaigns/dy_c/pause", {}],
      ["PATCH", "/api/campaigns/dy_c", { dailyBudgetCents: 500 }],
      ["POST", "/api/campaigns", { brandId: "dy_b", funnelId: "x", dailyBudgetCents: 500 }],
      ["POST", "/api/leads/dyl_1/outcomes", { outcome: "paid_client" }],
    ] as const) {
      const r = await fetch(`${base}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      expect(r.status, `${method} ${path}`).toBe(409);
    }
    const [c] = await q(`SELECT status, daily_budget_cents FROM campaigns WHERE id = 'dy_c'`);
    expect(c).toEqual({ status: "live", daily_budget_cents: 100000 });
  });

  it("is served with who performs it, and no Routing", async () => {
    const list = (await (await fetch(`${base}/api/campaigns`)).json()) as { id: string; performedBy?: string; line: string[]; target: string }[];
    const c = list.find((x) => x.id === "dy_c")!;
    expect(c.performedBy).toBe("distribute.you production");
    expect("routing" in c).toBe(false);
    expect(Array.isArray(c.line)).toBe(true);
    expect(c.target).toBe("lead_interested");
  });

  it("counts in its rates only the states our outreach caused (a state with another cause, or none known yet, does not)", async () => {
    for (const [lead, choice, cause] of [["dyl_2", "ch_a", true], ["dyl_3", "ch_b", null]] as const) {
      await q(`INSERT INTO leads (id, brand_id, campaign_id, first_name, source) VALUES ($1, 'dy_b', 'dy_c', 'Lead', 'distribute_you')`, [lead]);
      await q(
        `INSERT INTO choices (id, campaign_id, brand_id, lead_id, point, pipe_id, chosen, options, reason, day) VALUES ($1, 'dy_c', 'dy_b', $2, 'campaign|lead_found', 'campaign', 'opt', '[{"id":"opt","label":"Opt","meanScore":0,"sampledScore":0}]', 'picked', 1)`,
        [choice, lead],
      );
      await q(
        `INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, factory, content, traceability) VALUES ($1, 'lead_interested', 'lead', $2, 'dy_b', 'dy_c', 'distribute_you', $3, $4)`,
        [`u_${lead}`, lead, JSON.stringify({ causedByOutreach: cause }), [choice]],
      );
    }
    const { loadCatalogue, loadEvidence } = await import("../src/factory");
    const catalogue = await loadCatalogue();
    const tally = (await loadEvidence(catalogue)).tallies.get("campaign|lead_found\u0000opt");
    expect(tally).toMatchObject({ picks: 2, successes: 1 });
    const { campaignMilestones } = await import("../src/read");
    const [row] = await q(`SELECT * FROM campaigns WHERE id = 'dy_c'`);
    const milestones = await campaignMilestones(catalogue, row as never);
    expect(milestones[0]).toMatchObject({ from: "start", to: "lead_interested", yieldRate: 0.5 });
    // The count of states reached keeps both.
    const list = (await (await fetch(`${base}/api/campaigns`)).json()) as { id: string; counts: Record<string, number> }[];
    expect(list.find((c) => c.id === "dy_c")?.counts.lead_interested).toBe(2);
  });
});
