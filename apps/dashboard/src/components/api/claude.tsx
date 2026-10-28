"use client";

/**
 * The client's own Claude. Inside the GTM Factory Mac app (Tauri 2, this site loaded remotely),
 * a loop asks the server for the requests waiting for the client's Claude, has the app complete
 * each one (`invoke("claude_complete", { prompt })`, the official `claude` CLI on the client's
 * own subscription), and posts the text back; the next tick lands it as an LLM completion, at $0
 * to us. Each poll tells the server the app is online. Outside the app, the loop never starts.
 */

import type { ApiClaudeRequests, ApiClaudeStatus } from "@gtm-factory/core";
import { useEffect } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api/client";
import { IS_API } from "@/lib/data-source";

/** How often the app asks for waiting requests. */
const POLL_MS = 10_000;

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriWindow {
  __TAURI_INTERNALS__?: { invoke?: Invoke };
  __TAURI__?: { core?: { invoke?: Invoke } };
}

/** The app's `invoke`, when this page runs inside the GTM Factory Mac app (null in a browser). */
function tauriInvoke(): Invoke | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as TauriWindow;
  if (!w.__TAURI_INTERNALS__ && !w.__TAURI__) return null;
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

/** One pass: every waiting request, one at a time. A failed completion stops the pass; the next one tries again. */
async function completeWaiting(invoke: Invoke): Promise<void> {
  const { requests } = await apiGet<ApiClaudeRequests>("/claude/requests");
  for (const r of requests) {
    let text: unknown;
    try {
      text = await invoke("claude_complete", { prompt: r.prompt });
    } catch (e) {
      console.warn(`[claude] request ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (typeof text !== "string" || !text.trim()) return;
    await apiSend("POST", `/claude/requests/${encodeURIComponent(r.id)}/answer`, { text });
  }
}

/** Runs the loop when the page is inside the Mac app; renders nothing. */
export function ClaudeBridge() {
  useEffect(() => {
    if (!IS_API) return;
    const invoke = tauriInvoke();
    if (!invoke) return;
    let stopped = false;
    let busy = false;
    const tick = () => {
      if (busy || stopped) return;
      busy = true;
      completeWaiting(invoke)
        .catch((e: unknown) => console.warn(`[claude] ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          busy = false;
        });
    };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, []);
  return null;
}

/** "Your Claude: online" or "offline", from the server: is the client's Mac app polling. */
export function ClaudeMark() {
  const { data } = useApi<ApiClaudeStatus>(IS_API ? "/claude/status" : null, 15_000);
  if (!data) return null;
  return (
    <p className="k-fg3 flex items-center gap-1.5 px-2 text-[12px]" title={data.pending > 0 ? `${data.pending} waiting for your Claude` : undefined}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${data.online ? "bg-[var(--run)]" : "border-[1.5px] border-[var(--fg-3)]"}`} aria-hidden />
      Your Claude: {data.online ? "online" : "offline"}
    </p>
  );
}
