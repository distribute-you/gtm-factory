/**
 * GTM Factory in production. One process: the API (port 8080) and the scheduler. Boot:
 * migrations, the catalogue merged with its seed, the code seeded into the database, scripts of
 * the pre-v7 app code retired, the demo brand, templates; listen; then the first tick ~60 s later.
 */

import { createServer } from "node:http";
import { migrate } from "./db";
import { SEED_CATALOGUE } from "./catalogue-seed";
import { loadCatalogue, retirePreV7Scripts, seedTemplates } from "./factory";
import { seedCode } from "./code";
import { seedAccounts, seedDemo } from "./demo";
import { handle } from "./api";
import { startScheduler } from "./scheduler";
import { registerProductionVendors } from "./vendors/claude-local";

async function main(): Promise<void> {
  await migrate(SEED_CATALOGUE.outcomes.map((o) => o.id));
  registerProductionVendors();
  await loadCatalogue();
  const code = await seedCode();
  const retired = await retirePreV7Scripts();
  const demo = await seedDemo();
  await seedTemplates();
  const accounts = await seedAccounts();
  console.log(`[boot] code: ${code} new versions; ${retired} pre-v7 scripts retired; demo brand ${demo ? "seeded" : "present"}; ${accounts} accounts connected`);
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => void handle(req, res)).listen(port, () => console.log(`[boot] listening on ${port}`));
  if (process.env.SCHEDULER !== "off") startScheduler();
}

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
main().catch((e) => {
  console.error("[boot] failed", e);
  process.exit(1);
});
