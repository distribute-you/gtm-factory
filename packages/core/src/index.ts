export * from "./rng";
export * from "./stats";
export * from "./delay";
export * from "./tactics";
export * from "./catalogue";
export * from "./storage";
export * from "./calculations";
export * from "./script";
export * from "./prioritizer";
export * from "./splits";
export * from "./ledger";
export * from "./reliability";
export * from "./world";
export * from "./simulator";
export * from "./truth";
export * from "./evidence";

import { Catalogue } from "./catalogue";
import type { ScriptLibrary } from "./script";
import { loadWorld as load, type WorldData, type WorldSpec } from "./world";

/** Build a world from its data (seed/fictional-world.json or your own) and the code of its scripts. */
export function worldFromData(data: WorldData, library: ScriptLibrary, seed?: number | string): WorldSpec {
  return load(data, { Catalogue, library, ...(seed !== undefined ? { seed } : {}) });
}
export * from "./factory-api";
