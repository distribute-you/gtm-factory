"use client";

/** The overview, polled once for the whole app in api mode: the sidebar and every page read it. */

import { createContext, useContext } from "react";
import type { ApiOverview } from "@gtm-factory/core";
import { useApi, type ApiRead } from "./client";

const OverviewContext = createContext<ApiRead<ApiOverview> | null>(null);

export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const overview = useApi<ApiOverview>("/overview", 10_000);
  return <OverviewContext.Provider value={overview}>{children}</OverviewContext.Provider>;
}

export function useOverview(): ApiRead<ApiOverview> {
  const v = useContext(OverviewContext);
  if (!v) throw new Error("useOverview outside OverviewProvider");
  return v;
}
