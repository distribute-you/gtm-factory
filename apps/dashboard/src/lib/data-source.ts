/**
 * Where the dashboard reads from, fixed at BUILD time:
 *  - "sim" (default, the GitHub Pages demo): a fixed example database (a fictional brand and its
 *    history), generated once offline and shipped as files; nothing is computed in the browser;
 *  - "api": a running factory serving the factory API (packages/engine/src/factory-api.ts)
 *    under NEXT_PUBLIC_FACTORY_API_URL (default "/api", same origin).
 */
export const DATA_SOURCE: "sim" | "api" = process.env.NEXT_PUBLIC_DATA_SOURCE === "api" ? "api" : "sim";
export const IS_API = DATA_SOURCE === "api";
export const FACTORY_API_URL = (process.env.NEXT_PUBLIC_FACTORY_API_URL ?? "/api").replace(/\/$/, "");

/** The public repository of the framework. */
export const REPO_URL = "https://github.com/distribute-you/gtm-factory";

/** Where the app is served from (GitHub Pages: /gtm-factory). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/gtm-factory";
