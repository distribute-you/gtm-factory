"use client";

import type { ApiCandidates } from "@gtm-factory/core";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { plural } from "@/lib/format";
import { PointsList, Read } from "./common";

export function ApiResearchPage() {
  const read = useApi<ApiCandidates[]>("/research");
  const { data: o } = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(points) => (
            <>
              <PageHeader
                title={plural(points.length, "candidate place", "candidate places")}
                sub="At every Material where several candidates compete, the belief the Supplier rating holds about each one. The picking script picks by value per dollar, with one Thompson draw."
              />
              <PointsList points={points} catalogue={o?.catalogue} />
            </>
          )}
        </Read>
      </Page>
    </>
  );
}
