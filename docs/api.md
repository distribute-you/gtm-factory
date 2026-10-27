# The api data source

The dashboard reads one of two data sources, chosen at build time:

- **simulator** (default): the fictional world, computed in the browser. This is the GitHub Pages build.
- **api**: a running factory. The dashboard reads and writes a factory backend over JSON: brands, campaigns (start, Target, strategy, launch, pause, daily cap, volume; their steps and production tree), leads and their Units with their traceability, brand dynasties (templates), scripts (LLMs), the Supplier rating's beliefs and the ledger. This repository ships the contract, not a backend.

The contract is [`packages/engine/src/factory-api.ts`](../packages/engine/src/factory-api.ts): every endpoint and every shape, typed. A factory implements it under one base URL. Every figure is computed by the factory; the dashboard divides nothing. Pins (the sidebar's pinned outcomes and legs) are the factory's data too (`ApiOverview.pins`).

## Build it

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `api` (anything else: the simulator) |
| `NEXT_PUBLIC_FACTORY_API_URL` | base URL of the factory API, default `/api` (same origin) |
| `NEXT_OUTPUT` | `standalone` for a Node server; default is the static export |
| `NEXT_PUBLIC_BASE_PATH` | `""` to serve from the root |

```bash
NEXT_PUBLIC_DATA_SOURCE=api NEXT_OUTPUT=standalone NEXT_PUBLIC_BASE_PATH="" pnpm --filter dashboard build
# then serve apps/dashboard/.next/standalone/apps/dashboard/server.js,
# with .next/static and public copied beside it (Next's standalone layout)
```

Put the factory API on the same origin under `/api` (a reverse proxy routing `/api/*` to the backend) and the default needs no extra setting.

## Endpoints

| Method | Path | Answer |
|---|---|---|
| GET | `/overview` | `ApiOverview`: catalogue, brands, campaigns, totals, recent choices and runs, scheduler, pins |
| GET | `/catalogue` | `CatalogueData` |
| GET, POST | `/brands` | `ApiBrand[]`; create from `ApiNewBrand` |
| GET | `/brands/:id/funnels` | `ApiRankedFunnel[]`: the sales funnels a tree can run (views), best value per dollar first |
| GET, POST | `/campaigns` | `ApiCampaign[]`; create from `ApiNewCampaign` (brand, start, Target, budget, strategy), always paused |
| GET, PATCH | `/campaigns/:id` | `ApiCampaignDetail` (its steps, production tree, choice points); PATCH `{ dailyBudgetCents }` |
| POST | `/campaigns/:id/launch`, `/campaigns/:id/pause` | `ApiCampaign` |
| GET | `/leads?campaignId=&brandId=&state=` | `ApiLead[]` |
| GET | `/leads/:id` | `ApiLeadDetail` |
| POST | `/leads/:id/outcomes` | `{ outcome }` reported by another factory |
| GET, POST | `/objects?outcome=` | `ApiObjectDynasty[]`; POST `ApiNewObjectVersion` (upgrade, fork or new dynasty) |
| GET | `/scripts?legId=` | `ApiScriptStats[]` |
| POST | `/scripts/:id/retire`, `/scripts/:id/restore` | `ApiScriptStats` |
| GET | `/research` | `ApiChoicePoint[]` |
| GET | `/choices?campaignId=&leadId=` | `ApiChoice[]` |
| GET | `/ledger` | `ApiLedger`, reconciled to the cent |

A failed write answers 4xx or 5xx with `{ "error": "<plain words>" }`; the dashboard shows those words.
