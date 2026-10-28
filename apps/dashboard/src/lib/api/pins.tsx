"use client";

/**
 * Sidebar pins: an outcome pinned gets a menu entry whose page lists, reads, edits and compares
 * what it holds (its Units, its Engine's scripts). The backend serves default pins; a visitor's
 * own pins are kept in this browser and replace them once changed. No page knows an outcome by name.
 */

import { useCallback, useEffect, useState } from "react";
import type { Pin } from "@gtm-factory/core";
import { IS_API } from "@/lib/data-source";
import { useOverview } from "./overview";

const KEY = `gtm-factory:v10:pins:${IS_API ? "api" : "demo"}`;
const EVENT = "gtm-factory:pins";

export const pinKey = (p: Pick<Pin, "kind" | "id">): string => `${p.kind}:${p.id}`;
export const pinHref = (p: Pick<Pin, "kind" | "id">): string => `/pinned/?pin=${encodeURIComponent(pinKey(p))}`;

function readOwn(): Pin[] | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pin[]) : null;
  } catch {
    return null;
  }
}

/** The pins shown in the sidebar, and a toggle kept in this browser. */
export function usePins(): { pins: Pin[]; isPinned: (p: Pick<Pin, "kind" | "id">) => boolean; toggle: (p: Pin) => void } {
  const { data } = useOverview();
  const [own, setOwn] = useState<Pin[] | null>(null);
  useEffect(() => {
    setOwn(readOwn());
    const on = () => setOwn(readOwn());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const pins = own ?? data?.pins ?? [];
  const isPinned = useCallback((p: Pick<Pin, "kind" | "id">) => pins.some((x) => pinKey(x) === pinKey(p)), [pins]);
  const toggle = useCallback(
    (p: Pin) => {
      const next = pins.some((x) => pinKey(x) === pinKey(p)) ? pins.filter((x) => pinKey(x) !== pinKey(p)) : [...pins, p];
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: the pin holds for this visit */
      }
      setOwn(next);
      window.dispatchEvent(new Event(EVENT));
    },
    [pins],
  );
  return { pins, isPinned, toggle };
}
