"use client";

import type { ApiChoicePoint } from "@gtm-factory/engine";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { plural } from "@/lib/format";
import { PointsList, Read } from "./common";

export function ApiResearchPage() {
  const read = useApi<ApiChoicePoint[]>("/research");
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(points) => (
            <>
              <PageHeader
                title={plural(points.length, "choice point", "choice points")}
                sub="At every input where several options compete, the belief the engine holds about each one. It picks by value per dollar, with one Thompson draw."
              />
              <PointsList points={points} />
            </>
          )}
        </Read>
      </Page>
    </>
  );
}
