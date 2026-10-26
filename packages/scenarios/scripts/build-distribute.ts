/**
 * Rebuild the "distribute.you catalogue" scenario.
 *
 *   pnpm --filter @gtm-factory/scenarios build:distribute [channels.json steps.json]
 *
 * With two paths (the raw `GET /public/channels` and `GET /public/catalogue/steps`
 * bodies), the public catalogue is stripped again first. Without, the committed
 * stripped catalogue is used. Writes seed/distribute-catalogue.json and
 * seed/distribute-world.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDistributeWorld, stripPublicReads, type PublicCatalogue } from "../src";

const seed = (name: string) => fileURLToPath(new URL(`../../../seed/${name}`, import.meta.url));
const [channelsPath, stepsPath] = process.argv.slice(2);
let pub: PublicCatalogue;
if (channelsPath && stepsPath) {
  pub = stripPublicReads(JSON.parse(readFileSync(channelsPath, "utf8")), JSON.parse(readFileSync(stepsPath, "utf8")), {
    source: "features-service GET /public/channels and GET /public/catalogue/steps",
    readAt: new Date().toISOString().slice(0, 10),
  });
  writeFileSync(seed("distribute-catalogue.json"), JSON.stringify(pub, null, 2) + "\n");
} else pub = JSON.parse(readFileSync(seed("distribute-catalogue.json"), "utf8")) as PublicCatalogue;
writeFileSync(seed("distribute-world.json"), JSON.stringify(buildDistributeWorld(pub), null, 2) + "\n");
console.log(`${pub.channels.length} channels, ${pub.steps.length} steps, ${pub.facts.length} reported facts`);
