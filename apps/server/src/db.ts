/**
 * This GTM Factory's own database (gtm_factory_app on the box's Postgres). Core
 * tables live in `public`; each Engine gets its own schema `engine_<outcome>`
 * (Engine storage), read and written only by the scripts of that Engine (v5
 * kept one schema per leg, `pipe_<id>`: kept as history). Migrations run on
 * boot, in order, each once.
 */

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const pool = new pg.Pool({ connectionString: url, max: 8 });
pool.on("error", (err) => console.error("[db] idle client error", err));

// bigint and numeric come back as numbers (micro-dollars fit easily).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_core",
    sql: `
      CREATE TABLE IF NOT EXISTS catalogue_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS brands (
        id text PRIMARY KEY, name text NOT NULL, website text NOT NULL, offer text NOT NULL, icp text NOT NULL,
        lifetime_value_cents bigint, test boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS brand_leads (
        id text PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), position int NOT NULL,
        email text, first_name text, last_name text, company text, title text, domain text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id text PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), name text NOT NULL,
        funnel_id text NOT NULL, funnel_name text NOT NULL, line jsonb NOT NULL, plays jsonb NOT NULL,
        status text NOT NULL DEFAULT 'paused' CHECK (status IN ('paused','live')),
        daily_budget_cents bigint NOT NULL, strategies jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), launched_at timestamptz, last_tick_at timestamptz, cap_reached_on date
      );
      CREATE TABLE IF NOT EXISTS campaign_events (
        id bigserial PRIMARY KEY, campaign_id text NOT NULL REFERENCES campaigns(id), kind text NOT NULL, detail jsonb, at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS leads (
        id text PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), campaign_id text REFERENCES campaigns(id),
        first_name text, last_name text, email text, company text, domain text, title text, linkedin_url text,
        source text NOT NULL, source_ref text, data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS leads_campaign ON leads(campaign_id);
      CREATE TABLE IF NOT EXISTS runs (
        id text PRIMARY KEY, pipe_id text NOT NULL, script_id text NOT NULL, campaign_id text, brand_id text, lead_id text,
        status text NOT NULL CHECK (status IN ('running','ok','no_outcome','failed','refused')), note text NOT NULL DEFAULT '',
        spend_micro bigint NOT NULL DEFAULT 0, consumed text[] NOT NULL DEFAULT '{}', inputs int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS runs_campaign_day ON runs(campaign_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_lead ON runs(lead_id);
      CREATE TABLE IF NOT EXISTS run_costs (
        id bigserial PRIMARY KEY, run_id text NOT NULL REFERENCES runs(id), vendor text NOT NULL, item text NOT NULL,
        quantity numeric NOT NULL, micro bigint NOT NULL, at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS run_costs_run ON run_costs(run_id);
      CREATE TABLE IF NOT EXISTS occurrences (
        id text PRIMARY KEY, outcome text NOT NULL, subject_kind text NOT NULL, subject_id text NOT NULL,
        brand_id text, campaign_id text, run_id text REFERENCES runs(id), factory text NOT NULL,
        dynasty text, version int, parent_dynasty text, name text, retired boolean NOT NULL DEFAULT false,
        content jsonb, traceability text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS occ_subject ON occurrences(subject_id, outcome);
      CREATE INDEX IF NOT EXISTS occ_outcome ON occurrences(outcome, created_at);
      CREATE TABLE IF NOT EXISTS choices (
        id text PRIMARY KEY, campaign_id text NOT NULL, brand_id text NOT NULL, lead_id text, run_id text,
        point text NOT NULL, pipe_id text NOT NULL, input text, chosen text NOT NULL, options jsonb NOT NULL, reason text NOT NULL,
        day int NOT NULL, credited boolean NOT NULL DEFAULT false, failed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS choices_campaign ON choices(campaign_id, created_at);
      CREATE INDEX IF NOT EXISTS choices_lead ON choices(lead_id);
      CREATE TABLE IF NOT EXISTS scheduler_state (id int PRIMARY KEY, last_tick_at timestamptz, last_error text, ticks bigint NOT NULL DEFAULT 0);
      INSERT INTO scheduler_state (id) VALUES (1) ON CONFLICT DO NOTHING;
    `,
  },
  {
    // The GTM Factory v4 model. Every row is kept: what was an occurrence is a
    // Unit; a sent email becomes what the v4 catalogue says it is (a Message
    // queued by our send call, a Message sent reported by the mailbox, the
    // reply read by the mailbox); choice points live on a Material; a campaign
    // states its start outcome. Budgets and statuses are not touched.
    id: "002_v4_model",
    sql: `
      ALTER TABLE occurrences RENAME TO units;
      ALTER INDEX occ_subject RENAME TO units_subject;
      ALTER INDEX occ_outcome RENAME TO units_outcome;
      UPDATE units SET subject_kind = 'run' WHERE outcome = 'llm_completion';
      UPDATE units SET subject_kind = 'brand' WHERE subject_kind = 'object';
      CREATE INDEX IF NOT EXISTS units_message_id ON units ((content->>'messageId')) WHERE content ? 'messageId';

      ALTER TABLE choices RENAME COLUMN input TO material;
      UPDATE choices SET point = replace(point, ':', '|');

      ALTER TABLE campaigns ADD COLUMN start_outcome text NOT NULL DEFAULT 'start';
      ALTER TABLE campaigns ADD COLUMN volume jsonb;

      -- Each email our send call handed to a mailbox: a Message queued (first email) or a Follow-up queued, made by that send run.
      INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, run_id, factory, content, traceability, created_at)
      SELECT 'unit_q' || substr(md5(k.key), 1, 18),
             CASE WHEN k.value->>'kind' = 'follow_up' THEN 'follow_up_queued' ELSE 'message_queued' END,
             'lead', k.value->>'leadId', r.brand_id, r.campaign_id, r.id, 'ours',
             jsonb_build_object('messageId', k.key, 'sender', k.value->>'sender', 'login', k.value->>'login', 'to', k.value->>'to',
                                'subject', k.value->>'subject', 'references', coalesce(k.value->'references', '[]'::jsonb), 'kind', k.value->>'kind', 'message', k.value->>'messageOcc'),
             ARRAY(SELECT jsonb_array_elements_text(coalesce(k.value->'trace', '[]'::jsonb))), coalesce((k.value->>'at')::timestamptz, r.created_at)
        FROM pipe_cold_email.kv k JOIN runs r ON r.id = k.value->>'runId'
       WHERE k.tbl = 'sent';

      -- The mailbox's report of each of them: a webhook run and its Message sent.
      INSERT INTO runs (id, pipe_id, script_id, campaign_id, brand_id, lead_id, status, note, spend_micro, consumed, inputs, created_at, finished_at)
      SELECT 'run_w' || substr(md5(u.id), 1, 18), 'email_delivery', 'mailbox_send_report', u.campaign_id, u.brand_id, u.subject_id, 'ok',
             'The mailbox accepted ' || (u.content->>'messageId'), 0, '{}', 1, u.created_at, u.created_at
        FROM units u WHERE u.outcome IN ('message_queued', 'follow_up_queued');
      INSERT INTO units (id, outcome, subject_kind, subject_id, brand_id, campaign_id, run_id, factory, content, traceability, created_at)
      SELECT 'unit_s' || substr(md5(u.id), 1, 18), 'message_sent', 'lead', u.subject_id, u.brand_id, NULL, 'run_w' || substr(md5(u.id), 1, 18), 'mailbox',
             jsonb_build_object('messageId', u.content->>'messageId', 'queued', u.id), u.traceability, u.created_at
        FROM units u WHERE u.outcome = 'message_queued';

      -- Each reply already read: made by a run of the mailbox's reply pipe, consuming the queued email it answers.
      INSERT INTO runs (id, pipe_id, script_id, campaign_id, brand_id, lead_id, status, note, spend_micro, consumed, inputs, created_at, finished_at)
      SELECT 'run_r' || substr(md5(rep.id), 1, 18),
             CASE WHEN q.outcome = 'follow_up_queued' THEN 'follow_up_replies' ELSE 'email_replies' END,
             CASE WHEN q.outcome = 'follow_up_queued' THEN 'imap_follow_up_replies' ELSE 'imap_replies' END,
             rep.campaign_id, rep.brand_id, rep.subject_id, 'ok', 'Read the reply in the inbox', 0, ARRAY[q.id], 1, rep.created_at, rep.created_at
        FROM units rep JOIN units q ON q.run_id = rep.run_id AND q.outcome IN ('message_queued', 'follow_up_queued')
       WHERE rep.outcome = 'reply_received';
      UPDATE units rep SET run_id = 'run_r' || substr(md5(rep.id), 1, 18), factory = 'mailbox'
       WHERE rep.outcome = 'reply_received' AND EXISTS (SELECT 1 FROM runs r WHERE r.id = 'run_r' || substr(md5(rep.id), 1, 18));
      -- A first-email send run consumed the Message written; it now produced the Message queued (the reply moved to the mailbox run above).

      -- The mailbox's reading notes move to the storage of the pipe that reads the inbox.
      INSERT INTO pipe_email_replies.kv (tbl, key, value, updated_at)
      SELECT tbl, key, value, updated_at FROM pipe_cold_email.kv WHERE tbl IN ('imap_cursor', 'reply_seen')
      ON CONFLICT (tbl, key) DO NOTHING;
      DELETE FROM pipe_cold_email.kv WHERE tbl IN ('imap_cursor', 'reply_seen', 'sent', 'lead_thread');
    `,
  },
  {
    // Another factory's campaigns, read by a connector: who runs a brand and a campaign, the
    // production row each one mirrors, and the run group an imported run belongs to. The
    // scheduler ticks only this factory's campaigns.
    id: "003_production_connector",
    sql: `
      ALTER TABLE brands ADD COLUMN factory text NOT NULL DEFAULT 'ours';
      ALTER TABLE brands ADD COLUMN source_ref text;
      ALTER TABLE campaigns ADD COLUMN factory text NOT NULL DEFAULT 'ours';
      ALTER TABLE campaigns ADD COLUMN source_ref text;
      ALTER TABLE runs ADD COLUMN source_ref text;
      CREATE INDEX IF NOT EXISTS runs_source_ref ON runs(source_ref) WHERE source_ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS runs_brand ON runs(brand_id);
      CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at);
      CREATE INDEX IF NOT EXISTS units_campaign ON units(campaign_id, outcome);
      CREATE INDEX IF NOT EXISTS units_brand ON units(brand_id, outcome);
      CREATE INDEX IF NOT EXISTS units_queued ON units ((content->>'queued')) WHERE content ? 'queued';
      CREATE INDEX IF NOT EXISTS choices_created ON choices(created_at);
      CREATE TABLE IF NOT EXISTS connector_runs (
        id bigserial PRIMARY KEY, factory text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
        since timestamptz, ok boolean, error text, report jsonb
      );
    `,
  },
  {
    // The GTM Factory v6 model: a run names its Engine (the outcome its script makes); a
    // campaign states its Target, its strategy brief and what a judge read in it (the strategy
    // kept per Engine, daily caps, an end date), and keeps its Plan of the last tick. The v5
    // line and plays stay as history. The rows move onto v6 once the catalogue has (factory.ts).
    id: "004_v6_model",
    sql: `
      ALTER TABLE runs ADD COLUMN engine text;
      CREATE INDEX IF NOT EXISTS runs_engine ON runs(engine);
      ALTER TABLE campaigns ADD COLUMN target text;
      UPDATE campaigns SET target = line->>(jsonb_array_length(line) - 1) WHERE jsonb_array_length(line) > 0;
      ALTER TABLE campaigns ADD COLUMN brief text NOT NULL DEFAULT '';
      ALTER TABLE campaigns ADD COLUMN verdicts jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE campaigns ADD COLUMN caps jsonb NOT NULL DEFAULT '{}';
      ALTER TABLE campaigns ADD COLUMN ends_on date;
      ALTER TABLE campaigns ADD COLUMN plan jsonb;
    `,
  },
  {
    // GTM Factory v7. Script code lives in the database, one immutable row per version (a change
    // is a new version of its dynasty). A brand belongs to an organization and sells offers; a
    // campaign sells one offer. Work the Plan orders from the client's team is a task the person
    // answers. Budgets and statuses are not touched.
    id: "005_v7_model",
    sql: `
      CREATE TABLE IF NOT EXISTS script_code (key text PRIMARY KEY, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE OR REPLACE FUNCTION script_code_immutable() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'script code is immutable: a change is a new version of its dynasty'; END $f$ LANGUAGE plpgsql;
      CREATE TRIGGER script_code_no_change BEFORE UPDATE OR DELETE ON script_code FOR EACH ROW EXECUTE FUNCTION script_code_immutable();

      ALTER TABLE brands ADD COLUMN org_id text;
      ALTER TABLE brands ADD COLUMN org_name text;
      ALTER TABLE brands ADD COLUMN team_email text;
      UPDATE brands SET org_id = id, org_name = name;
      CREATE TABLE IF NOT EXISTS offers (id text PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO offers (id, brand_id, name) SELECT 'offer_' || id, id, left(offer, 200) FROM brands;
      ALTER TABLE campaigns ADD COLUMN offer_id text;
      UPDATE campaigns SET offer_id = 'offer_' || brand_id;
      ALTER TABLE campaigns ADD COLUMN test_days int;

      CREATE TABLE IF NOT EXISTS tasks (
        id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES campaigns(id), brand_id text NOT NULL REFERENCES brands(id),
        script_id text NOT NULL, outcome text NOT NULL, lead_id text, choices text[] NOT NULL DEFAULT '{}', consumed text[] NOT NULL DEFAULT '{}',
        asked text NOT NULL, fields jsonb NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered')),
        answer jsonb, unit_id text, notified_at timestamptz, notify_note text,
        created_at timestamptz NOT NULL DEFAULT now(), answered_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS tasks_open ON tasks(status, brand_id);
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_open ON tasks(campaign_id, script_id, coalesce(lead_id, '')) WHERE status = 'open';
    `,
  },
  {
    // GTM Factory v8. Routings are gone: a campaign's Plan is shown as the tree of what ran, and
    // its subjects' flows milestone to milestone. The stored named Routings leave the catalogue;
    // the v5 funnel columns of campaigns stay as history (nothing reads them). Budgets and
    // statuses are not touched.
    id: "006_v8_no_routing",
    sql: `
      UPDATE catalogue_state SET data = data - 'routings' - 'salesPaths' - 'salesFunnels';
    `,
  },
  {
    // GTM Factory v10. Every account a brand connected (a mailbox, a WhatsApp number, a LinkedIn
    // profile) with the role it gave it: Personal, Pro or AI agent. Scripts ask for a role and pick
    // among the accounts with it. Northwind gets the accounts of the public fictional world; each
    // staff test brand gets one mocked AI agent mailbox (vendors are mocked: nothing is sent).
    id: "007_v10_accounts",
    sql: `
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY, brand_id text NOT NULL REFERENCES brands(id), channel text NOT NULL, address text NOT NULL,
        role text NOT NULL, status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','to_reconnect')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS accounts_brand ON accounts(brand_id);
      CREATE INDEX IF NOT EXISTS units_account ON units ((content->>'account')) WHERE content ? 'account';
    `,
  },
  {
    // Owner 2026-10-28, nothing fake on factory: the runs made on mocked vendors, and what they
    // made (Units, picks, the people they drew), are kept but flagged, and every read leaves them
    // out. Each table moves to <table>_all with a "mocked" flag; <table> becomes the view of the
    // rows that are not, so every query and insert reads and writes it as before. A later
    // migration that alters one of these tables alters <table>_all and recreates its view.
    id: "008_v10_no_fake_runs",
    sql: `
      ALTER TABLE runs ADD COLUMN mocked boolean NOT NULL DEFAULT false;
      ALTER TABLE units ADD COLUMN mocked boolean NOT NULL DEFAULT false;
      ALTER TABLE choices ADD COLUMN mocked boolean NOT NULL DEFAULT false;
      ALTER TABLE leads ADD COLUMN mocked boolean NOT NULL DEFAULT false;
      ALTER TABLE tasks ADD COLUMN mocked boolean NOT NULL DEFAULT false;
      UPDATE runs SET mocked = true WHERE source_ref IS NULL;
      UPDATE units SET mocked = true WHERE run_id IN (SELECT id FROM runs WHERE mocked);
      UPDATE choices SET mocked = true WHERE brand_id IN (SELECT id FROM brands WHERE factory <> 'distribute_you');
      UPDATE leads SET mocked = true WHERE source = 'test_market';
      UPDATE tasks SET mocked = true;
      ALTER TABLE runs RENAME TO runs_all;
      ALTER TABLE units RENAME TO units_all;
      ALTER TABLE choices RENAME TO choices_all;
      ALTER TABLE leads RENAME TO leads_all;
      ALTER TABLE tasks RENAME TO tasks_all;
      CREATE VIEW runs AS SELECT * FROM runs_all WHERE NOT mocked;
      CREATE VIEW units AS SELECT * FROM units_all WHERE NOT mocked;
      CREATE VIEW choices AS SELECT * FROM choices_all WHERE NOT mocked;
      CREATE VIEW leads AS SELECT * FROM leads_all WHERE NOT mocked;
      CREATE VIEW tasks AS SELECT * FROM tasks_all WHERE NOT mocked;
    `,
  },
];

/** The v5 legs whose storage schemas the v4 migration (002) still reads on a database created before it. */
const V5_LEG_SCHEMAS = ["sourcing", "email_finding", "brand_context", "llm", "writer", "cold_email", "email_delivery", "email_replies", "follow_up", "follow_up_replies", "reply_judging", "closing", "supplier_rating"];

async function kvSchema(schema: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.kv (tbl text NOT NULL, key text NOT NULL, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tbl, key))`);
}

/** One schema per Engine: its scripts' storage. */
export function engineSchema(outcome: string): string {
  if (!/^[a-z0-9_]+$/.test(outcome)) throw new Error(`outcome "${outcome}" cannot name a schema`);
  return `engine_${outcome}`;
}

export async function migrate(engines: readonly string[]): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`);
  // Storage first: a migration may move notes from one storage to another.
  for (const e of engines) await kvSchema(engineSchema(e));
  if (!(await one(`SELECT id FROM schema_migrations WHERE id = '002_v4_model'`))) for (const l of V5_LEG_SCHEMAS) await kvSchema(`pipe_${l}`);
  for (const m of MIGRATIONS) {
    const done = await one(`SELECT id FROM schema_migrations WHERE id = $1`, [m.id]);
    if (done) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(m.sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [m.id]);
      await client.query("COMMIT");
      console.log(`[db] migration ${m.id} applied`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
