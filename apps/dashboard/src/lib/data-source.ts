/**
 * Where the dashboard reads from, fixed at BUILD time:
 *  - "sim" (default): the simulator, in the browser (the GitHub Pages build);
 *  - "api": a running factory serving the factory API (packages/engine/src/factory-api.ts)
 *    under NEXT_PUBLIC_FACTORY_API_URL (default "/api", same origin).
 */
export const DATA_SOURCE: "sim" | "api" = process.env.NEXT_PUBLIC_DATA_SOURCE === "api" ? "api" : "sim";
export const IS_API = DATA_SOURCE === "api";
export const FACTORY_API_URL = (process.env.NEXT_PUBLIC_FACTORY_API_URL ?? "/api").replace(/\/$/, "");
