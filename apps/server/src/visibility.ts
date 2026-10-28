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
