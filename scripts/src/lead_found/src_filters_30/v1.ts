import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/**
 * Draws people from Apollo filters, refreshed monthly and keeps one who fits the ICP it was served,
 * never someone it picked in the last "Days before recontact".
 */
export default function run(ctx: ScriptContext): ScriptResult {
  const icp = ctx.get("audience_built");
  ctx.get("rating");
  const window = Number(ctx.tactics.recontact_days ?? 365);
  for (let k = 0; k < 60; k++) {
    const drawn = ctx.vendor.call("market.draw", { source: "Apollo filters, refreshed monthly", icp: icp.id });
    if (!drawn.ok) return null;
    const key = String(drawn.data.key);
    const last = ctx.storage.get("picked", key);
    if (typeof last === "number" && ctx.day - last < window) continue;
    if (!ctx.vendor.call("market.fits", { key, icp: icp.id }).ok) continue;
    ctx.storage.set("picked", key, ctx.day);
    return { found: key, content: { recontact: typeof last === "number" } };
  }
  return null;
}
