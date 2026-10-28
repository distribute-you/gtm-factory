# The api data source

The dashboard reads one of two data sources, picked at build time:

- **simulator** (default): the fictional world, computed in the browser. This is the GitHub Pages build.
- **api**: a running GTM Factory. The dashboard reads and writes its backend over JSON: brands, campaigns (start, Target, brief, launch, pause, daily cap, volume; their Plan, milestones and what their subjects went through), leads and their Units with their traceability, brand dynasties (templates, ICPs), scripts with their code, materials and capacity, the Supplier rating's beliefs and the ledger. This repository ships the contract, not a backend.

The contract is [`packages/core/src/factory-api.ts`](../packages/core/src/factory-api.ts): every endpoint and every shape, typed. A running GTM Factory implements it under one base URL. Every figure is computed by the backend; the dashboard divides nothing. Money is integer cents, times are ISO strings. Pins (the sidebar's pinned outcomes) are the backend's data too (`ApiOverview.pins`).

## Build it

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `api` (anything else: the simulator) |
| `NEXT_PUBLIC_FACTORY_API_URL` | base URL of the API, default `/api` (same origin) |
| `NEXT_OUTPUT` | `standalone` for a Node server; default is the static export |
| `NEXT_PUBLIC_BASE_PATH` | `""` to serve from the root |

```bash
NEXT_PUBLIC_DATA_SOURCE=api NEXT_OUTPUT=standalone NEXT_PUBLIC_BASE_PATH="" pnpm --filter dashboard build
# then serve apps/dashboard/.next/standalone/apps/dashboard/server.js,
# with .next/static and public copied beside it (Next's standalone layout)
```

Put the API on the same origin under `/api` (a reverse proxy sending `/api/*` to the backend) and the default needs no extra setting.

## Endpoints

| Method | Path | Answer |
|---|---|---|
| GET | `/overview` | `ApiOverview`: catalogue, brands, campaigns, totals, recent picks and runs, scheduler, pins |
| GET | `/catalogue` | `CatalogueData`: outcomes, tracks, scripts, tactics, strategies |
| GET, POST | `/brands` | `ApiBrand[]`, each with its organization (`orgId`, `orgName`) and its offers; create from `ApiNewBrand` |
| GET | `/brands/:id/plans` | `ApiPlanPreview[]`: what a new campaign toward each Target would run today (the milestones it passes through as `line`, its `ApiMilestone`s, cost per Target), best value per dollar first |
| GET, POST | `/campaigns` | `ApiCampaign[]`; create from `ApiNewCampaign` (brand, offer, start, Target, budget, `brief`), always paused |
| GET, PATCH | `/campaigns/:id` | `ApiCampaignDetail`: its milestones; its Plan as a tree of what ran over 7 days (`ApiPlanNode`: at each outcome every script that made it is an `ApiPlanBranch` with its share, cost per Unit, the brand inputs it used and its own children, the Plan's pick of this tick marked `current`); `flows`, what its subjects went through milestone to milestone and by which script; what competes at each Engine it calls (`candidates`); PATCH `{ dailyBudgetCents }` |
| POST | `/campaigns/:id/launch`, `/campaigns/:id/pause` | `ApiCampaign` |
| GET | `/leads?campaignId=&brandId=&state=` | `ApiLead[]` |
| GET | `/leads/:id` | `ApiLeadDetail` |
| POST | `/leads/:id/outcomes` | `{ outcome }` reported by another party |
| GET, POST | `/objects?outcome=` | `ApiObjectDynasty[]`; POST `ApiNewObjectVersion` (upgrade, fork or new dynasty) |
| GET | `/scripts?outcome=` | `ApiScriptStats[]`: the scripts of one Engine, with their code, materials and capacity |
| POST | `/scripts/:id/retire`, `/scripts/:id/restore` | `ApiScriptStats` |
| POST | `/scripts/:id/capacity` | `ApiCapacity` (`perDay`, `daysPerUnit`, null for no limit), typed by a person for a script a person performs; answers `ApiScriptStats` |
| GET | `/research` | `ApiCandidates[]`: at each place an Engine calls an outcome, the scripts that compete, with the Rating's belief about each and, on each script, the versions of the brand inputs (ICPs, templates) it used |
| GET | `/picks?campaignId=&leadId=` | `ApiPick[]`: each pick (a script, or the version of a brand input a script used: `kind`), the candidates as scored then, and why |
| GET | `/tasks?brandId=&status=` | `ApiTask[]`: the work the Plan ordered from the client's team, one per run of a script a person performs |
| POST | `/tasks/:id/answer` | `ApiTaskAnswer` (`values`, one per field of the task's form); answers `ApiTask`. The answer becomes the Unit's content |
| GET | `/ledger` | `ApiLedger`, per Engine, script, vendor and campaign, reconciled to the cent |

## What a campaign carries

- `brief`: its strategy in the client's words. `verdicts`: what the judge read in it, per Engine, a strategy id or `"none"` (the Plan routes around that Engine). `caps`: most Units per day at an Engine. `endsAt`: the end of a test of a stated length.
- `line`: the milestones its Plan passes through most this week, start excluded, Target last. Recomputed every tick, never named or stored.
- `performedBy`: absent for ours. A campaign another party runs (read through a connector) carries its name, and is never ticked, launched, paused or capped from the dashboard. Runs, Units and scripts carry `performedBy` too.

## Tasks for the client's team

A script a person performs (a closing call) declares a short form. Each run of it opens a task: the backend notifies the person by email, the person answers in the dashboard, and the answer becomes the Unit. Its first yes or no field says whether the outcome happened; the Unit then credits the picks that brought the person. Capacity is asked only for such work that repeats; code and AI scripts have none.

## Scope

The dashboard shows one organization, one of its brands and one offer at a time, picked at the top of the sidebar. A new campaign sells the offer picked there.

A failed write answers 4xx or 5xx with `{ "error": "<plain words>" }`; the dashboard shows those words.

## Connected accounts

`GET /accounts?brandId=` lists the brand's connected accounts (`ApiConnectedAccount`): channel, address or number, role, status, and counts (sent today, sent and read this week). `PATCH /accounts/:id` with `{ role }` gives an account another role: the next run follows it. `POST /accounts/connect` with `{ brandId, channel, role }` answers `{ url }`, the backend's own page that connects an account (a mailbox login, a WhatsApp link). The backend holds the accounts, roles and counts; the scripts pick the account.

