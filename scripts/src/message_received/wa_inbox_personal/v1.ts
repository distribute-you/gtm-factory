import type { ScriptContext, ScriptResult } from "@gtm-factory/core";

/** WhatsApp reports each message someone sent on their own to the brand's numbers with this script's role. Called by another party: it reports, it is never ordered. */
export default function run(ctx: ScriptContext): ScriptResult {
  const r = ctx.vendor.call("whatsapp.report");
  return r.ok ? { content: { ...r.data } } : null;
}
