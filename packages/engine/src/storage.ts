/**
 * Storage: one database schema per leg. The scripts of a leg share their
 * leg's storage; nobody else reads or writes it. Across legs, data moves
 * only through consumed outcome Units. A script receives the storage of
 * its own leg and nothing that could reach another one: there is no lookup by
 * leg id on the interface it is handed.
 */

export type StoredValue = string | number | boolean | null | StoredValue[] | { [k: string]: StoredValue };

/** The storage a script sees: its leg's tables, nothing else. */
export interface LegStorage {
  get(table: string, key: string): StoredValue | undefined;
  set(table: string, key: string, value: StoredValue): void;
  delete(table: string, key: string): void;
  /** Number of rows in a table. */
  count(table: string): number;
}

/** In-memory storage of one leg (the simulator's implementation). */
class MemoryLegStorage implements LegStorage {
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

/** A read-only view of one leg's storage, for reports: table name, row count, a few rows. */
export interface StorageReport {
  legId: string;
  tables: { name: string; rows: number; sample: { key: string; value: StoredValue }[] }[];
}

/**
 * Holds one storage per leg. Only the engine holds it: a script is handed
 * `forLeg(itsOwnPipe)` and never this object.
 */
export class StorageHouse {
  private readonly byLeg = new Map<string, MemoryLegStorage>();

  /** The storage of one leg. The engine calls this with the leg of the running script only. */
  forLeg(legId: string): LegStorage {
    let s = this.byLeg.get(legId);
    if (!s) this.byLeg.set(legId, (s = new MemoryLegStorage()));
    return Object.freeze({
      get: s.get.bind(s),
      set: s.set.bind(s),
      delete: s.delete.bind(s),
      count: s.count.bind(s),
    });
  }

  report(legId: string, sampleSize = 5): StorageReport {
    const s = this.byLeg.get(legId);
    const tables = s
      ? [...s.tables].map(([name, rows]) => ({
          name,
          rows: rows.size,
          sample: [...rows].slice(-sampleSize).map(([key, value]) => ({ key, value })),
        }))
      : [];
    return { legId, tables };
  }
}
