"use client";

/**
 * The api data source's client: JSON over HTTP against the GTM Factory API. A failed call throws
 * the server's own words (`{ error }`); nothing is defaulted. Reads poll and keep their last
 * answer while they refetch, so a page never blinks; every write refetches every read.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FACTORY_API_URL } from "@/lib/data-source";

const REFRESH_EVENT = "gtm-factory:refresh";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${FACTORY_API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} answered ${res.status} with a body that is not JSON.`);
    }
  }
  if (!res.ok) {
    const msg = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : `${method} ${path} answered ${res.status}.`;
    throw new Error(msg);
  }
  return parsed as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return call<T>("GET", path);
}

/** A write. Every read on the page refetches after it, whatever it answered. */
export async function apiSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  try {
    return await call<T>(method, path, body ?? {});
  } finally {
    refreshAll();
  }
}

export function refreshAll(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface ApiRead<T> {
  data: T | null;
  error: string | null;
  /** The read answered at least once (data or error): gate skeletons on this, never on "loading". */
  answered: boolean;
  refresh: () => void;
}

/** A polled read. `path` null = not asked yet (an input is still loading). */
export function useApi<T>(path: string | null, pollMs = 10_000): ApiRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(() => {
    const p = current.current;
    if (!p) return;
    apiGet<T>(p)
      .then((d) => {
        if (current.current !== p) return;
        setData(d);
        setError(null);
        setAnswered(true);
      })
      .catch((e: unknown) => {
        if (current.current !== p) return;
        setError(e instanceof Error ? e.message : String(e));
        setAnswered(true);
      });
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setAnswered(false);
    if (!path) return;
    load();
    const t = pollMs > 0 ? window.setInterval(load, pollMs) : undefined;
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      if (t) window.clearInterval(t);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [path, pollMs, load]);

  return { data, error, answered, refresh: load };
}
