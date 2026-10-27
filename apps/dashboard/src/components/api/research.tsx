"use client";

import type { ApiChoicePoint } from "@gtm-factory/core";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useFactory } from "@/lib/api/factory";
import { plural } from "@/lib/format";
import { PointsList, Read } from "./common";

export function ApiResearchPage() {
  const read = useApi<ApiChoicePoint[]>("/research");
  const { data: o } = useFactory();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(points) => (
            <>
              <PageHeader
                title={plural(points.length, "choice point", "choice points")}
                sub="At every Material where several candidates compete, the belief the Supplier rating holds about each one. The choosing script picks by value per dollar, with one Thompson draw."
              />
              <PointsList points={points} catalogue={o?.catalogue} />
            </>
          )}
        </Read>
      </Page>
    </>
  );
}
