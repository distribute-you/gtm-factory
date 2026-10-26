/**
 * Storage: one database schema per pipe. The scripts of a pipe share their
 * pipe's storage; nobody else reads or writes it. Across pipes, data moves
 * only through consumed outcome Units. A script receives the storage of
 * its own pipe and nothing that could reach another one: there is no lookup by
 * pipe id on the interface it is handed.
 */

export type StoredValue = string | number | boolean | null | StoredValue[] | { [k: string]: StoredValue };

/** The storage a script sees: its pipe's tables, nothing else. */
export interface PipeStorage {
  get(table: string, key: string): StoredValue | undefined;
  set(table: string, key: string, value: StoredValue): void;
  delete(table: string, key: string): void;
  /** Number of rows in a table. */
  count(table: string): number;
}

/** In-memory storage of one pipe (the simulator's implementation). */
class MemoryPipeStorage implements PipeStorage {
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

/** A read-only view of one pipe's storage, for reports: table name, row count, a few rows. */
export interface StorageReport {
  pipeId: string;
  tables: { name: string; rows: number; sample: { key: string; value: StoredValue }[] }[];
}

/**
 * Holds one storage per pipe. Only the engine holds it: a script is handed
 * `forPipe(itsOwnPipe)` and never this object.
 */
export class StorageHouse {
  private readonly byPipe = new Map<string, MemoryPipeStorage>();

  /** The storage of one pipe. The engine calls this with the pipe of the running script only. */
  forPipe(pipeId: string): PipeStorage {
    let s = this.byPipe.get(pipeId);
    if (!s) this.byPipe.set(pipeId, (s = new MemoryPipeStorage()));
    return Object.freeze({
      get: s.get.bind(s),
      set: s.set.bind(s),
      delete: s.delete.bind(s),
      count: s.count.bind(s),
    });
  }

  report(pipeId: string, sampleSize = 5): StorageReport {
    const s = this.byPipe.get(pipeId);
    const tables = s
      ? [...s.tables].map(([name, rows]) => ({
          name,
          rows: rows.size,
          sample: [...rows].slice(-sampleSize).map(([key, value]) => ({ key, value })),
        }))
      : [];
    return { pipeId, tables };
  }
}
