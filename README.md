# GTM Factory v7

An open framework for running go-to-market as an industrial plant, in a plant's own words. A Campaign orders a Target. One Engine per outcome makes it, with competing scripts written as code. A script asks Providers for what it needs, at run time. Every Unit lands in one ledger, the common stock, and a Supplier rating makes every pick with the best value per dollar. The Plan is recomputed at every tick.

Built by [distribute.you](https://distribute.you). Revenue made easy.

**Live dashboard: https://distribute-you.github.io/gtm-factory/** (fictional data, runs in your browser)

[![The GTM Factory dashboard after 30 simulated days](docs/screenshots/today.png)](https://distribute-you.github.io/gtm-factory/)

## What it is

- **A model.** An outcome is a part reference; a Unit is one piece of it. One Engine per outcome makes it. Scripts compete inside each Engine (rules, AI, people), in dynasties of versions. "Performed by" says who runs a script: Ours, Client's team, Mailbox, CRM, Organic market. Tactics (yes or no, a list, a number) and strategies (conditions on tactics) describe them. Tracks order the milestones (CRM lifecycle, Conversation, Website visits).
- **Scripts are code.** Each script is a file of `scripts/`. It calls `ctx.get(outcome)` on the Providers it needs and returns one Unit or none. A Provider serves the most recent Unit the caller has not received, from the stock, else orders one from the Engine. A script unhappy with an old piece asks again, within its run's budget.
- **Pull and push, on a Plan recomputed every tick.** A Campaign fixes only its Target, its start, its budget and a brief in plain words, which a judge reads once per Engine. From Start it pulls from the Target down, most advanced Units first; from any other outcome it pushes each Unit that lands up toward the Target. Its Routing (the milestones it passes through) is a view with a short name.
- **A Supplier rating.** Thompson sampling on value per dollar, pooled from the candidate everywhere down to the client, with delay censoring, measured costs and the picks under each branch rated at their best. Every Unit carries its traceability, so every pick is credited when the next milestone lands.
- **A ledger.** The common stock of every Unit. Decisions read each candidate's own cost; reports price every outcome by every path, reconciled to the cent.
- **A simulator.** One fictional world as data, with a hidden truth, played tick by tick. It runs the same script code against a vendor that answers from the hidden truth, and grades the Rating by its regret.

**Open source and hosted.** This repository is the framework and one fictional world to adapt to your own use case. A hosted GTM Factory keeps its catalogue in its database: outcomes, Engines, scripts and every version of their code, Providers. It keeps every run's result there too. Its estimates sharpen over time, because what one client learns is pooled with the others.

Read the spec: [docs/framework.md](docs/framework.md).

## Repository

| Path | What |
|---|---|
| `packages/core` | The framework's code: catalogue, Engines and Providers, the Plan, ledger, Supplier rating, simulator, and the API contract. TypeScript, deterministic; one runtime dependency (sucrase) to load script code given as text. |
| `scripts/` | Every script as code: `scripts/src/<outcome>/<dynasty>/v<n>.ts`. |
| `seed/fictional-world.json` | The fictional world: Northwind Analytics starting from scratch, with cold email, LinkedIn and ads. Catalogue, campaigns and their briefs, market and hidden truth. Every scenario number lives here. |
| `docs/framework.md` | The framework, in plain English, with worked examples checked by tests. |
| `docs/api.md` | The API a running GTM Factory serves to the dashboard. |
| `apps/dashboard` | The live dashboard: the whole product on the simulated world, in the browser. Next.js static export, deployed to GitHub Pages on every push to `main`. |

## Quick start

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

```ts
import { readFileSync } from "node:fs";
import { SimulationSession, meanRegret, regretByDay, runGraded, worldFromData } from "@gtm-factory/core";
import { LIBRARY } from "@gtm-factory/scripts";

const world = worldFromData(JSON.parse(readFileSync("seed/fictional-world.json", "utf8")), LIBRARY);
const session = new SimulationSession(world);
const regret = regretByDay(session, runGraded(session, 60));
console.log(meanRegret(regret, 0, 10), meanRegret(regret, 50, 60));
```

## The dashboard

Open the [live site](https://distribute-you.github.io/gtm-factory/), start the clock, and watch a fictional client win paying clients. Every page reads the framework's code: the campaign page shows its Goal, proactive or reactive, its Plan with the share and cost of each branch, its Routing, the cost of each milestone from Start and the attempts per Target, and each script with its materials and the Provider each comes from. The "Done by your team" page holds the capacity of the scripts the client's team performs. The research page shows every pick beside the hidden best, and the ledger reconciles to the cent.

With `NEXT_PUBLIC_DATA_SOURCE=api`, the same dashboard runs a real GTM Factory through its API. See [docs/api.md](docs/api.md).

Run it locally:

```bash
pnpm install
NEXT_PUBLIC_BASE_PATH="" pnpm --filter dashboard dev     # http://localhost:3000
pnpm --filter dashboard build                             # static site in apps/dashboard/out
pnpm --filter dashboard screenshots                       # render check: every page, day 30
```

## License

MIT, see [LICENSE](LICENSE).
