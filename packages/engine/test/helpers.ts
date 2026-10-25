import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { worldFromData, type WorldData, type WorldSpec } from "../src";

export const WORLD_PATH = fileURLToPath(new URL("../../../seed/fictional-world.json", import.meta.url));

export function worldData(): WorldData {
  return JSON.parse(readFileSync(WORLD_PATH, "utf8")) as WorldData;
}

export function defaultWorld(seed?: number): WorldSpec {
  return worldFromData(worldData(), seed);
}
