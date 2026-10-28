/**
 * Engine storage on Postgres: one schema per Engine, a key-value table of named
 * tables. A script is handed the storage of its own Engine and nothing else
 * (the same contract as the core's EngineStorage, asynchronous).
 */

import type { StoredValue } from "@gtm-factory/core";
import { engineSchema, one, q } from "./db";

export interface AsyncEngineStorage {
  get<T = StoredValue>(table: string, key: string): Promise<T | undefined>;
  set(table: string, key: string, value: StoredValue): Promise<void>;
  delete(table: string, key: string): Promise<void>;
  count(table: string): Promise<number>;
}

export function storageFor(engine: string): AsyncEngineStorage {
  const s = engineSchema(engine);
  return Object.freeze({
    async get<T = StoredValue>(table: string, key: string) {
      const r = await one<{ value: T }>(`SELECT value FROM ${s}.kv WHERE tbl = $1 AND key = $2`, [table, key]);
      return r?.value;
    },
    async set(table: string, key: string, value: StoredValue) {
      await q(`INSERT INTO ${s}.kv (tbl, key, value) VALUES ($1, $2, $3) ON CONFLICT (tbl, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [table, key, JSON.stringify(value)]);
    },
    async delete(table: string, key: string) {
      await q(`DELETE FROM ${s}.kv WHERE tbl = $1 AND key = $2`, [table, key]);
    },
    async count(table: string) {
      const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.kv WHERE tbl = $1`, [table]);
      return r?.n ?? 0;
    },
  });
}

/** For reports only: table names, row counts and the latest rows of one Engine's storage. */
export async function storageReport(engine: string, sample = 5) {
  const s = engineSchema(engine);
  const tables = await q<{ tbl: string; n: number }>(`SELECT tbl, count(*)::int AS n FROM ${s}.kv GROUP BY tbl ORDER BY tbl`);
  const out = [];
  for (const t of tables) {
    const rows = await q<{ key: string; value: StoredValue }>(`SELECT key, value FROM ${s}.kv WHERE tbl = $1 ORDER BY updated_at DESC LIMIT $2`, [t.tbl, sample]);
    out.push({ name: t.tbl, rows: t.n, sample: rows });
  }
  return { engine, tables: out };
}
