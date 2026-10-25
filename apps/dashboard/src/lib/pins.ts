/**
 * Sidebar pins are configuration: pin an outcome or a pipe and it gets a menu entry whose
 * page lists, reads, edits and compares what it holds. The world ships its default pins as
 * data; a visitor's pins are kept in this browser. No page knows an outcome or a pipe by name.
 */

import type { Pin } from "@gtm-factory/engine";
import { WORLD } from "./world";

export type { Pin };

const KEY = "gtm-factory:v2:pins";

export const DEFAULT_PINS: Pin[] = WORLD.pins ?? [];

export function pinKey(p: Pick<Pin, "kind" | "id">): string {
  return `${p.kind}:${p.id}`;
}

export function pinHref(p: Pick<Pin, "kind" | "id">): string {
  return `/pinned/?pin=${encodeURIComponent(pinKey(p))}`;
}

export function parsePin(key: string | null, pins: readonly Pin[]): Pin | null {
  if (!key) return null;
  const found = pins.find((p) => pinKey(p) === key);
  if (found) return found;
  const [kind, ...rest] = key.split(":");
  if ((kind === "outcome" || kind === "pipe") && rest.length) return { kind, id: rest.join(":"), label: rest.join(":") };
  return null;
}

export function readPins(): Pin[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pin[]) : DEFAULT_PINS;
  } catch {
    return DEFAULT_PINS;
  }
}

export function writePins(pins: Pin[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    /* storage blocked: the pins hold for this visit */
  }
}

/** Add or remove a pin. */
export function togglePin(pins: readonly Pin[], pin: Pin): Pin[] {
  return pins.some((p) => pinKey(p) === pinKey(pin)) ? pins.filter((p) => pinKey(p) !== pinKey(pin)) : [...pins, pin];
}
