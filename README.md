# GTM Factory

An open framework for running go-to-market as an agentic factory: outcomes, pipes that turn one outcome into the next, implementations that compete inside each pipe (rules, AI, humans), and one engine that picks the path with the best value per dollar.

Built by [distribute.you](https://distribute.you). Revenue made easy.

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
| `apps/` | Reserved for the live dashboard. |

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

## License

MIT, see [LICENSE](LICENSE).
