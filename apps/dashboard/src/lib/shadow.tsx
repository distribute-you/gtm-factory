"use client";

/**
 * Shadow mode as a data source: a snapshot of an OBSERVED world (a real factory, read by its own
 * exporter), loaded in this browser from a file picked here, or from a local URL in dev mode
 * (NEXT_PUBLIC_SHADOW_SNAPSHOT_URL). Nothing is uploaded, nothing is bundled: the public build
 * ships no data, and a snapshot lives in this tab's memory only. The engine computes every
 * recommendation and the actions it would launch; nothing executes them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ShadowSession, selfProduction, snapshotFromSimulation, validateSnapshot, type ShadowReport, type ShadowSnapshot } from "@gtm-factory/engine";
import type { Model } from "./model";

export interface ShadowState {
  snapshot: ShadowSnapshot;
  session: ShadowSession;
  report: ShadowReport;
  /** Where it came from: a file name, a URL, or "this simulation". */
  origin: string;
}

interface ShadowContextValue {
  shadow: ShadowState | null;
  /** Loading or computing: a sentence, else null. */
  busy: string | null;
  error: string | null;
  openFile: (file: File) => void;
  openUrl: (url: string) => void;
  /** A snapshot of the running simulation, read like a real factory (fictional data only). */
  openSimulation: (model: Model) => void;
  close: () => void;
}

const ShadowContext = createContext<ShadowContextValue | null>(null);

function nextFrame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 30));
}

export function ShadowProvider({ children }: { children: React.ReactNode }) {
  const [shadow, setShadow] = useState<ShadowState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const use = useCallback(async (text: string | ShadowSnapshot, origin: string) => {
    setError(null);
    setBusy("Reading the snapshot…");
    await nextFrame();
    try {
      const snapshot = typeof text === "string" ? (JSON.parse(text) as ShadowSnapshot) : text;
      const problems = validateSnapshot(snapshot);
      if (problems.length > 0) throw new Error(`Not a shadow snapshot: ${problems.join("; ")}.`);
      setBusy(`Computing what the engine would do for ${snapshot.clients.length} clients…`);
      await nextFrame();
      const session = new ShadowSession(snapshot);
      const report = session.compute();
      setShadow({ snapshot, session, report, origin });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const openUrl = useCallback(
    (url: string) => {
      setBusy("Loading the snapshot…");
      fetch(url, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`${url} answered ${r.status}.`);
          return r.text();
        })
        .then((t) => use(t, url))
        .catch((e) => {
          setBusy(null);
          setError(e instanceof Error ? e.message : String(e));
        });
    },
    [use],
  );

  // Dev mode: a local snapshot URL opens by itself.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SHADOW_SNAPSHOT_URL;
    if (url) openUrl(url);
  }, [openUrl]);

  const value = useMemo<ShadowContextValue>(
    () => ({
      shadow,
      busy,
      error,
      openFile: (file) => {
        file
          .text()
          .then((t) => use(t, file.name))
          .catch((e) => setError(String(e)));
      },
      openUrl,
      openSimulation: (model) => {
        void use(selfProduction(snapshotFromSimulation(model.session, { name: `Snapshot of the simulation, day ${model.day}` })), "this simulation");
      },
      close: () => {
        setShadow(null);
        setError(null);
      },
    }),
    [shadow, busy, error, use, openUrl],
  );
  return <ShadowContext.Provider value={value}>{children}</ShadowContext.Provider>;
}

export function useShadow(): ShadowContextValue {
  const v = useContext(ShadowContext);
  if (!v) throw new Error("useShadow outside ShadowProvider");
  return v;
}
