export * from "./rng";
export * from "./stats";
export * from "./delay";
export * from "./tactics";
export * from "./catalogue";
export * from "./storage";
export * from "./funnels";
export * from "./prioritizer";
export * from "./splits";
export * from "./ledger";
export * from "./reliability";
export * from "./world";
export * from "./simulator";
export * from "./truth";
export * from "./evidence";

import { Catalogue } from "./catalogue";
import { loadWorld as load, type WorldData, type WorldSpec } from "./world";

/** Build a world from its data (seed/fictional-world.json or your own). */
export function worldFromData(data: WorldData, seed?: number | string): WorldSpec {
  return load(data, { Catalogue, ...(seed !== undefined ? { seed } : {}) });
}
export * from "./factory-api";
