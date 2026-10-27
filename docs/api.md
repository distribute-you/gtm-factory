# The api data source

The dashboard reads one of two data sources, chosen at build time:

- **simulator** (default): the fictional world, computed in the browser. This is the GitHub Pages build.
- **api**: a running GTM Factory. The dashboard reads and writes its backend over JSON: brands, campaigns (start, Target, brief, launch, pause, daily cap, volume; their Plan, Routing and milestones), leads and their Units with their traceability, brand dynasties (templates, ICPs), scripts with their code, materials and capacity, the Supplier rating's beliefs and the ledger. This repository ships the contract, not a backend.

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

Put the API on the same origin under `/api` (a reverse proxy routing `/api/*` to the backend) and the default needs no extra setting.

## Endpoints

| Method | Path | Answer |
|---|---|---|
| GET | `/overview` | `ApiOverview`: catalogue, brands, campaigns, totals, recent choices and runs, scheduler, pins |
| GET | `/catalogue` | `CatalogueData`: outcomes, tracks, scripts, tactics, strategies |
| GET, POST | `/brands` | `ApiBrand[]`; create from `ApiNewBrand` |
| GET | `/brands/:id/plans` | `ApiPlanPreview[]`: what a new campaign toward each Target would run today (its `ApiRouting`, its `ApiMilestone`s, cost per Target), best value per dollar first |
| GET, POST | `/campaigns` | `ApiCampaign[]`; create from `ApiNewCampaign` (brand, start, Target, budget, `brief`), always paused |
| GET, PATCH | `/campaigns/:id` | `ApiCampaignDetail`: its milestones, its Plan (`ApiPlanNode`, with the branches used over 7 days), choice points; PATCH `{ dailyBudgetCents }` |
| POST | `/campaigns/:id/launch`, `/campaigns/:id/pause` | `ApiCampaign` |
| GET | `/leads?campaignId=&brandId=&state=` | `ApiLead[]` |
| GET | `/leads/:id` | `ApiLeadDetail` |
| POST | `/leads/:id/outcomes` | `{ outcome }` reported by another party |
| GET, POST | `/objects?outcome=` | `ApiObjectDynasty[]`; POST `ApiNewObjectVersion` (upgrade, fork or new dynasty) |
| GET | `/scripts?outcome=` | `ApiScriptStats[]`: the scripts of one Engine, with their code, materials and capacity |
| POST | `/scripts/:id/retire`, `/scripts/:id/restore` | `ApiScriptStats` |
| POST | `/scripts/:id/capacity` | `ApiCapacity` (`perDay`, `daysPerUnit`), typed by a person for a script of the client's team; answers `ApiScriptStats` |
| GET | `/research` | `ApiChoicePoint[]` |
| GET | `/choices?campaignId=&leadId=` | `ApiChoice[]` |
| GET | `/ledger` | `ApiLedger`, per Engine, script, vendor and campaign, reconciled to the cent |

## What a campaign carries

- `brief`: its strategy in the client's words. `verdicts`: what the judge read in it, per Engine, a strategy id or `"none"` (the Plan routes around that Engine). `caps`: most Units per day at an Engine. `endsAt`: the end of a test of a stated length.
- `routing`: the Routing its Plan runs, `{ id, name, line }`, a view with a short name.
- `performedBy`: absent for ours. A campaign another party runs (read through a connector) carries its name, and is never ticked, launched, paused or capped from the dashboard. Runs, Units and scripts carry `performedBy` too.

A failed write answers 4xx or 5xx with `{ "error": "<plain words>" }`; the dashboard shows those words.
