/**
 * The production import (the connector reading distribute.you production) is OFF in GTM Factory
 * v7: the app shows the demo brand and our own test brands only. Its code and its stored rows are
 * kept; `PRODUCTION_IMPORT=on` switches both the connector and the imported rows back on.
 */

export const IMPORT_ON = process.env.PRODUCTION_IMPORT === "on";

/** Brands shown and run: ours only while the import is off. SQL on a brand id column. */
export const shownBrand = (col: string): string => (IMPORT_ON ? "true" : `${col} IN (SELECT id FROM brands WHERE factory = 'ours')`);

/** Same, on a `brands` row alias. */
export const shownBrandRow = (alias: string): string => (IMPORT_ON ? "true" : `${alias}.factory = 'ours'`);

/**
 * The scope a page asked for (the brands picked in the sidebar's switch), as SQL on a brand id
 * column: the shown brands when none is asked. Ids are checked to be plain ids before they reach SQL.
 */
export function inScope(col: string, brandIds: readonly string[] | null): string {
  if (!brandIds) return shownBrand(col);
  const ok = brandIds.filter((id) => /^[A-Za-z0-9_:.-]{1,80}$/.test(id));
  return ok.length === 0 ? "false" : `(${shownBrand(col)} AND ${col} IN (${ok.map((id) => `'${id}'`).join(",")}))`;
}

/** The brand ids a read asked for (`brandIds=a,b` or `brandId=a`), null for every shown brand. */
export function brandIdsOf(url: URL): string[] | null {
  const list = url.searchParams.get("brandIds") ?? url.searchParams.get("brandId");
  return list ? list.split(",").map((x) => x.trim()).filter(Boolean) : null;
}
