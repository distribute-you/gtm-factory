import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIBRARY } from "../../../scripts/src";
import { worldFromData, type WorldData, type WorldSpec } from "../src";

export const WORLD_PATH = fileURLToPath(new URL("../../../seed/fictional-world.json", import.meta.url));
export const SCRIPTS_DIR = fileURLToPath(new URL("../../../scripts/src/", import.meta.url));

export function worldData(): WorldData {
  return JSON.parse(readFileSync(WORLD_PATH, "utf8")) as WorldData;
}

export function defaultWorld(seed?: number): WorldSpec {
  return worldFromData(worldData(), LIBRARY, seed);
}

export function worldOf(data: WorldData, seed?: number): WorldSpec {
  return worldFromData(data, LIBRARY, seed);
}

export { LIBRARY };

/** Words of retired objects, spelled in parts so that a search of the repository for them finds nothing. */
export const RETIRED = [["occ", "urrence"], ["sha", "dow"], ["unl", "ess"], ["trig", "ger"]].map((w) => new RegExp(w.join(""), "i"));
