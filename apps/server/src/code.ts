/**
 * Script code lives in this app's database: one immutable row per version (`script_code`, a
 * trigger refuses any UPDATE or DELETE). The public scripts/ files and this app's own scripts are
 * the SEED, loaded once; after that the runner reads code from here only. A change is a new
 * version of its dynasty, a fork a new dynasty: both start from code text through the API, which
 * checks it compiles in the sandbox and reads its materials from its literal `ctx.get` names.
 */

import { Catalogue, type Script } from "@gtm-factory/core";
import { one, q } from "./db";
import { APP_SOURCES, PUBLIC_DIR, codeKey } from "./catalogue-seed";
import { CompiledScript, validateSource } from "./sandbox";

/** The public scripts' text, by code key (the vendored public repository's generated list). */
async function publicSources(): Promise<Record<string, string>> {
  const mod = (await import(`${PUBLIC_DIR}scripts/src/sources.ts`)) as { SOURCES: Record<string, string> };
  return mod.SOURCES;
}

let keys: Set<string> = new Set();
const compiled = new Map<string, CompiledScript>();

/** Seed the code once (a key already stored is never touched), then load the keys held. */
export async function seedCode(): Promise<number> {
  const seed = await seedSources();
  let added = 0;
  for (const [key, source] of Object.entries(seed)) {
    const r = await q(`INSERT INTO script_code (key, source) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`, [key, source]);
    added += r.length;
  }
  await refreshKeys();
  return added;
}

export async function refreshKeys(): Promise<void> {
  setKnownCode((await q<{ key: string }>(`SELECT key FROM script_code`)).map((r) => r.key));
}

/** The code keys the database holds (loaded at boot; tests set them directly). */
export function setKnownCode(list: Iterable<string>): void {
  keys = new Set(list);
}

/** Every seed version's code key and text: the public scripts/ files and this app's own. */
export async function seedSources(): Promise<Record<string, string>> {
  return { ...(await publicSources()), ...APP_SOURCES };
}

/** Does the database hold this script's code (so this app can run it)? */
export const hasCode = (s: Pick<Script, "code">): boolean => keys.has(s.code);

export async function sourceOf(key: string): Promise<string | null> {
  return (await one<{ source: string }>(`SELECT source FROM script_code WHERE key = $1`, [key]))?.source ?? null;
}

/** The compiled sandbox of a version (compiled once per process: a version never changes). */
export async function compiledOf(key: string): Promise<CompiledScript | null> {
  const hit = compiled.get(key);
  if (hit) return hit;
  const source = await sourceOf(key);
  if (source === null) return null;
  const c = new CompiledScript(source);
  compiled.set(key, c);
  return c;
}

/** Store a new version's code (refused if the key exists: code is immutable). */
async function storeCode(key: string, source: string): Promise<void> {
  const r = await q(`INSERT INTO script_code (key, source) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`, [key, source]);
  if (r.length === 0) throw new Error(`code ${key} already exists: a change is a new version`);
  keys.add(key);
}

/**
 * A new version of a dynasty from code text: it runs from now on and keeps the dynasty's stats.
 * Its materials are read from the code.
 */
export async function upgradeFromCode(cat: Catalogue, dynasty: string, source: string, name?: string): Promise<Catalogue> {
  const head = cat.headOf(dynasty) ?? cat.versionsOf(dynasty).at(-1);
  if (!head) throw new Error(`no dynasty ${dynasty}`);
  const { materials } = validateSource(source);
  const version = Math.max(...cat.versionsOf(dynasty).map((s) => s.version)) + 1;
  const key = codeKey(head.outcome, dynasty, version);
  await storeCode(key, source);
  const data = cat.snapshot();
  const id = `${dynasty}_v${version}`;
  for (const s of data.scripts) if (s.dynasty === dynasty && s.status === "active") s.status = "retired";
  data.scripts.push({ ...JSON.parse(JSON.stringify(head)), id, version, name: name ?? head.name, code: key, materials, status: "active" });
  return new Catalogue(data);
}

/** A new dynasty forked from another, with its own code: it starts from its parent's belief. */
export async function forkFromCode(cat: Catalogue, parentDynasty: string, source: string, name: string): Promise<{ catalogue: Catalogue; id: string }> {
  const parent = cat.headOf(parentDynasty) ?? cat.versionsOf(parentDynasty).at(-1);
  if (!parent) throw new Error(`no dynasty ${parentDynasty}`);
  const { materials } = validateSource(source);
  let n = 1;
  while (cat.versionsOf(`${parentDynasty}_fork${n}`).length > 0) n++;
  const dynasty = `${parentDynasty}_fork${n}`;
  const key = codeKey(parent.outcome, dynasty, 1);
  await storeCode(key, source);
  const data = cat.snapshot();
  const script: Script = { ...JSON.parse(JSON.stringify(parent)), id: dynasty, dynasty, version: 1, parentDynasty, name, code: key, materials, status: "active" };
  data.scripts.push(script);
  return { catalogue: new Catalogue(data), id: dynasty };
}
