import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** A search ad shown to people who fit the ICP; a click is a visit. */
export default function run(ctx: ScriptContext): ScriptResult {
  const icp = ctx.get("audience_built");
  ctx.get("rating");
  for (let k = 0; k < 60; k++) {
    const drawn = ctx.vendor.call("market.draw", { source: "Google search", icp: icp.id });
    if (!drawn.ok) return null;
    const key = String(drawn.data.key);
    if (ctx.storage.get("shown", key) !== undefined) continue;
    if (!ctx.vendor.call("market.fits", { key, icp: icp.id }).ok) continue;
    ctx.storage.set("shown", key, ctx.day);
    return { found: key };
  }
  return null;
}
