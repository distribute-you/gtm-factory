/**
 * Storage: one database schema per Engine. The scripts of an Engine share their
 * Engine's storage; nobody else reads or writes it. Across Engines, data moves
 * only through consumed outcome Units. A script receives the storage of
 * its own Engine and nothing that could reach another one: there is no lookup by
 * Engine id on the interface it is handed.
 */

export type StoredValue = string | number | boolean | null | StoredValue[] | { [k: string]: StoredValue };

/** The storage a script sees: its Engine's tables, nothing else. */
export interface EngineStorage {
  get(table: string, key: string): StoredValue | undefined;
  set(table: string, key: string, value: StoredValue): void;
  delete(table: string, key: string): void;
  /** Number of rows in a table. */
  count(table: string): number;
}

/** In-memory storage of one Engine (the simulator's implementation). */
class MemoryEngineStorage implements EngineStorage {
  readonly tables = new Map<string, Map<string, StoredValue>>();
  get(table: string, key: string): StoredValue | undefined {
    return this.tables.get(table)?.get(key);
  }
  set(table: string, key: string, value: StoredValue): void {
    let t = this.tables.get(table);
    if (!t) this.tables.set(table, (t = new Map()));
    t.set(key, value);
  }
  delete(table: string, key: string): void {
    this.tables.get(table)?.delete(key);
  }
  count(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }
}

/** A read-only view of one Engine's storage, for reports: table name, row count, a few rows. */
export interface StorageReport {
  engine: string;
  tables: { name: string; rows: number; sample: { key: string; value: StoredValue }[] }[];
}

/**
 * Holds one storage per Engine. Only the engine holds it: a script is handed
 * `forEngine(itsOwnPipe)` and never this object.
 */
export class StorageHouse {
  private readonly byEngine = new Map<string, MemoryEngineStorage>();

  /** The storage of one Engine. The engine calls this with the Engine of the running script only. */
  forEngine(engine: string): EngineStorage {
    let s = this.byEngine.get(engine);
    if (!s) this.byEngine.set(engine, (s = new MemoryEngineStorage()));
    return Object.freeze({
      get: s.get.bind(s),
      set: s.set.bind(s),
      delete: s.delete.bind(s),
      count: s.count.bind(s),
    });
  }

  report(engine: string, sampleSize = 5): StorageReport {
    const s = this.byEngine.get(engine);
    const tables = s
      ? [...s.tables].map(([name, rows]) => ({
          name,
          rows: rows.size,
          sample: [...rows].slice(-sampleSize).map(([key, value]) => ({ key, value })),
        }))
      : [];
    return { engine, tables };
  }
}
