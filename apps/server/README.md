# GTM Factory server

A hosted GTM Factory: the core of this repository running for real, with its own database (the ledger, the common stock of every Unit) and its scheduler. It serves https://factory.distribute.you.

**Every vendor is mocked for now** (`src/mock-vendor.ts` answers each call from the fictional world's hidden truth, deterministically, at $0: no email, no API call, no spend). It shows the demo brand (Northwind Analytics, seeded paused) and the host's own test brands.

| Path | What |
|---|---|
| `src/catalogue-seed.ts` | The seed: the fictional world's catalogue (outcomes, one Engine each, scripts, tactics, strategies, tracks) plus this server's own objects. Merged into `catalogue_state` at boot by id; stored objects are never overwritten. |
| `src/code.ts`, `src/sandbox.ts` | Script code lives in the database: one immutable row per version (`script_code`, a trigger refuses UPDATE and DELETE), seeded once from `scripts/`. Each run gets its own V8 isolate (isolated-vm): its own heap capped at 64 MB, 2 s of time, no Node globals (no require, process, fetch, timers), nothing of this process; its context (subject, brand, day, tactics, its Engine's storage, `get` on the Providers, the vendor, `wait`) is built inside from copied JSON, every call crossing one text-only callback. |
| `src/runner.ts` | One generic loop: each live campaign recomputes its Plan, then serves each Engine, the most advanced first. A run's code asks its Providers for what it needs (the stock, else a new piece ordered from that outcome's Engine, nested); a milestone it lacks makes it wait. |
| `src/tasks.ts` | A script the client's team performs is a task: the person is told by email (when the brand names a team address) and answers on the dashboard; the answer becomes the Unit. |
| `src/brief.ts` | A campaign's brief is read once by a judge: per Engine the strategy kept or none, daily caps, a test length. |
| `src/demo.ts` | The demo brand, seeded once from the fictional world: its organization, brand, offer, starting Units and three campaigns, paused. |
| `src/factory.ts` | Framework glue: stored catalogue, Runs, Units with traceability, the daily Rating, picks by Thompson sampling, each campaign's Plan. |
| `src/api.ts`, `src/read.ts` | The API (contract: `factory-api.ts` in the core). Plus `GET /api/scripts/:id/code`, `POST /api/scripts/:id/versions` and `POST /api/scripts/:id/forks` (code text in, checked in the sandbox, materials read from its literal `ctx.get` names). |
| `src/vendors/` | The real vendor adapters (Apollo, BounceVerify, BounceBan, Firecrawl, LLMs, SMTP, IMAP), kept for when a mock is replaced; only the mail sender runs (task notifications). |
| `Dockerfile` | This server (port 8080), built from the repository root. `apps/dashboard/Dockerfile`: the dashboard in api mode. |

Env: `DATABASE_URL`, `CHAT_SERVICE_URL` and `CHAT_SERVICE_API_KEY` (the brief's judge), `MAILBOX_CREDENTIALS_B64`, `FACTORY_SENDERS`, the vendor keys (unused while mocked).

```bash
pnpm install
pnpm --filter @gtm-factory/server typecheck
TEST_DATABASE_URL=<a Postgres it may wipe> pnpm --filter @gtm-factory/server test
docker build -f apps/server/Dockerfile .
docker build -f apps/dashboard/Dockerfile .
```
