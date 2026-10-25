# GTM Factory

An open framework for running go-to-market as an agentic factory: outcomes, pipes that turn one outcome into the next, implementations that compete inside each pipe (rules, AI, humans), and one engine that picks the path with the best value per dollar.

Built by [distribute.you](https://distribute.you). Revenue made easy.

**Live dashboard: https://distribute-you.github.io/gtm-factory/** (fictional data, runs in your browser)

[![The GTM Factory dashboard after 30 simulated days](docs/screenshots/today.png)](https://distribute-you.github.io/gtm-factory/)

## What it is

- **A model.** Steps, lead tracks, triggers, channels, pipes, plays, workflows, templates, LLMs, clients, offers, audiences, campaigns, runs and occurrences, all as data. Add, remove or retire any of them while the factory runs.
- **An engine.** Ask "I want a paid client for this offer" and get the ranked sales funnels with their value per dollar. Value is computed backward from the target, cost forward from Start, and one universal prioritizer (Thompson sampling with partial pooling and delay correction) makes every choice: funnel, play, audience, workflow, template, LLM.
- **A ledger.** Every run is a production order. Decisions read each pipe's own cost; reports read the every-path ledger, reconciled to the cent.
- **A simulator.** A seeded synthetic world with hidden truths, played day by day, so you can watch the engine learn.

Read the spec: [docs/framework.md](docs/framework.md).

## Repository

| Path | What |
|---|---|
| `packages/engine` | The engine. TypeScript, zero runtime dependencies, pure and deterministic. |
| `seed/distribute-catalogue.json` | distribute.you's public catalogue: the engine's default catalogue. |
| `docs/framework.md` | The framework, in plain English, with worked examples checked by tests. |
| `apps/dashboard` | The live dashboard: the whole product on a simulated world, in the browser. Next.js static export, deployed to GitHub Pages on every push to `main`. |
| `docs/screenshots/` | One screenshot per dashboard page after 30 simulated days. |

## Quick start

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

```ts
import { readFileSync } from "node:fs";
import { loadSeedCatalogue, fictionalWorld, SimulationSession } from "@gtm-factory/engine";

const { catalogue } = loadSeedCatalogue(JSON.parse(readFileSync("seed/distribute-catalogue.json", "utf8")));
const session = new SimulationSession(fictionalWorld(catalogue, { seed: 42, clients: 3 }));
session.run(60);
const result = session.result(); // days, choices and why, runs, occurrences, ledger, audiences, evidence
```

## The dashboard

Open the [live site](https://distribute-you.github.io/gtm-factory/), press **Play**, and watch fictional clients win paying clients. Every page reads the engine:

| Page | What you see |
|---|---|
| Today | Spend, outcomes per lead state grouped by lead track, return and $ per outcome over time, measured beside expected, and why the engine chose. |
| New campaign | Pick or create a client, say what you want, get the best sales funnels by value per dollar, launch one. |
| Campaigns | Each sales funnel, pipe by pipe: volumes, conversion, $ per outcome, value per $1, budget, and the workflow, template, LLM and audience picks with their share. |
| Audiences | Expert audiences from the profile, the segments the data found, and the verdict of every split (noise, signal, conclusion). |
| Leads, Companies | A board with one column per lead state; each lead's timeline of runs, outcomes and evidence. |
| Research | Every choice node: options, measured figures, the engine's belief, share of picks, flash and mature views, and the hidden truth beside them. |
| Catalogue | Steps, lead tracks, triggers, channels, pipes, sales paths, plays, tactics, strategies, workflows, templates and LLMs. Add, retire or edit live. |
| Ledger | The cost of each outcome every path beside each pipe's own cost, reconciled to the cent. |
| How it works | The framework's core ideas, linked to the spec. |

Run it locally:

```bash
pnpm install
NEXT_PUBLIC_BASE_PATH="" pnpm --filter dashboard dev     # http://localhost:3000
pnpm --filter dashboard build                             # static site in apps/dashboard/out
pnpm --filter dashboard screenshots                       # render check: every page, day 30
```

## License

MIT, see [LICENSE](LICENSE).
