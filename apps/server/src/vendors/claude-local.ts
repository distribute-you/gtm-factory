/**
 * The client's own Claude as a vendor (`claude_local.complete`): the client's GTM Factory app
 * (a Mac app running the official `claude` CLI on the client's Pro or Max subscription) writes
 * the answer. $0 to us: nothing is metered. The request waits in the queue the app polls; the
 * run stops and comes back at a later tick, when the app has posted the answer.
 *
 * A script may ask to hear "offline" instead of waiting: `offline_after_minutes` in its request.
 * When the app has not been seen for that long, the answer is `{ ok: false, data: { offline: true } }`
 * and the script decides what to do (the fallback script then calls our API).
 */

import { registerVendor, type VendorAnswer, type VendorCall } from "../vendors";
import { abandon, askLater, minutesOffline, requestKey, takeAnswer } from "../pending";

export const CLAUDE_LOCAL = "claude_local";

export function claudeLocalComplete(call: VendorCall): VendorAnswer {
  const prompt = typeof call.args?.prompt === "string" ? call.args.prompt : "";
  if (!prompt.trim()) return { ok: false, data: { error: "no prompt" } };
  const request = { prompt };
  const key = requestKey(CLAUDE_LOCAL, call.brandId, request);
  const answer = takeAnswer(CLAUDE_LOCAL, key);
  if (answer) return { ok: true, data: { model: String(answer.model ?? "claude"), text: String(answer.text ?? "") } };
  const after = Number(call.args?.offline_after_minutes);
  if (Number.isFinite(after) && after > 0 && minutesOffline(CLAUDE_LOCAL) >= after) {
    abandon(CLAUDE_LOCAL, key);
    return { ok: false, data: { offline: true } };
  }
  askLater(CLAUDE_LOCAL, key, call.brandId, request);
  return { ok: false, pending: true, data: {} };
}

/** The real adapters this server runs in production. */
export function registerProductionVendors(): void {
  registerVendor(`${CLAUDE_LOCAL}.complete`, claudeLocalComplete);
}
