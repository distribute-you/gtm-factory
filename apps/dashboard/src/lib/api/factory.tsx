"use client";

/** The overview, polled once for the whole app in api mode: the sidebar and every page read it. */

import { createContext, useContext } from "react";
import type { ApiOverview } from "@gtm-factory/engine";
import { useApi, type ApiRead } from "./client";

const FactoryContext = createContext<ApiRead<ApiOverview> | null>(null);

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const overview = useApi<ApiOverview>("/overview", 10_000);
  return <FactoryContext.Provider value={overview}>{children}</FactoryContext.Provider>;
}

export function useFactory(): ApiRead<ApiOverview> {
  const v = useContext(FactoryContext);
  if (!v) throw new Error("useFactory outside FactoryProvider");
  return v;
}
