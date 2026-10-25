# GTM Factory

An open framework for running go-to-market as an agentic factory: outcomes, pipes that turn input outcomes into the next one, scripts that compete inside each pipe (rules, AI, people), triggers that wake them, and one engine that makes every input choice with the best value per dollar.

Built by [distribute.you](https://distribute.you). Revenue made easy.

**Live dashboard: https://distribute-you.github.io/gtm-factory/** (fictional data, runs in your browser)

[![The GTM Factory dashboard after 30 simulated days](docs/screenshots/today.png)](https://distribute-you.github.io/gtm-factory/)

## What it is

- **A model.** Four objects carry a status: outcomes, pipes, triggers and scripts. Tactics (typed: yes/no, a list, a number) and strategies (conditions per input) describe them. Scripts and object occurrences (templates, ICPs) live in dynasties of versions. Everything is data.
- **An engine.** It orchestrates: for each subject it picks the play of each leg, then at every input of every pipe the script providing it or the occurrence to consume. One universal prioritizer makes every input choice: Thompson sampling on value per dollar, pooled from the script's level everywhere down to the client, with delay censoring and measured costs. Every occurrence carries its traceability, so every choice is credited on the end of its leg.
- **A ledger.** Every run is a production order, ours or another factory's. Decisions read each option's own cost; reports read the every-path ledger, reconciled to the cent.
- **A simulator.** A fictional world published as data, with a hidden truth, played day by day, so you can watch the engine converge.

Read the spec: [docs/framework.md](docs/framework.md).

## Repository

| Path | What |
|---|---|
| `packages/engine` | The engine. TypeScript, zero runtime dependencies, pure and deterministic. |
| `seed/fictional-world.json` | The fictional world: catalogue, clients, market and hidden truth. Every scenario number lives here. |
| `docs/framework.md` | The framework, in plain English, with worked examples checked by tests. |
| `apps/dashboard` | The live dashboard: the whole product on the simulated world, in the browser. Next.js static export, deployed to GitHub Pages on every push to `main`. |
| `docs/screenshots/` | One screenshot per dashboard page after 30 simulated days. |

## Quick start

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

```ts
import { readFileSync } from "node:fs";
import { SimulationSession, convergence, shareOnBest, worldFromData } from "@gtm-factory/engine";

const world = worldFromData(JSON.parse(readFileSync("seed/fictional-world.json", "utf8")));
const session = new SimulationSession(world);
session.run(60);
for (const point of convergence(session)) console.log(point.point, shareOnBest(point, 50, 60));
```

## The dashboard

Open the [live site](https://distribute-you.github.io/gtm-factory/), press **Play**, and watch fictional clients win paying clients. Every page reads the engine:

| Page | What you see |
|---|---|
| Today | Return measured beside expected on one formula, value won by our runs beside other factories, outcomes per lead track, why the engine chose. |
| New campaign | Pick a client, a target and an entry (Start or a trigger), get the best sales funnels by value per dollar, choose strategies per pipe, launch. |
| Campaigns | Each sales funnel leg by leg, its plays and strategies, every input choice with its options, beliefs and the hidden best. |
| ICPs | Competing ICP sentences per client, the finer ones the splits proposed, and the verdict of every split. |
| Leads, Companies | A board per lead state and track; each lead's timeline with the traceability of every occurrence. |
| Pinned pages | Pin any outcome or pipe: Templates and LLMs ship pinned. Read, edit (a new version) and compare versions; scripts as cards; where a pipe is plugged and the best script at each input; its pipe storage. |
| Research | Convergence of every choice point toward the hidden best option, beliefs beside the hidden truth, strategies proposed by splits. |
| Catalogue | Outcomes, pipes, scripts, triggers, tactics, strategies and factories. Upgrade, fork, retire, pin. |
| Ledger | Every-path unit costs beside each pipe's own cost, our spend beside other factories', reconciled to the cent. |
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
