/**
 * The demo's example database is one JSON file per API read, named from the read: the method,
 * the path, and its query sorted. The generator and the browser name files the same way.
 */

export function demoKey(path: string): string {
  const url = new URL(path, "http://demo");
  const q = [...url.searchParams.entries()].filter(([, v]) => v !== "").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const clean = url.pathname.replace(/\/$/, "");
  return q.length > 0 ? `${clean}?${new URLSearchParams(q).toString()}` : clean;
}

/** The file holding one read (FNV-1a of its key, hex). */
export function demoFile(path: string): string {
  let h = 2166136261;
  for (const ch of demoKey(path)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")}.json`;
}
