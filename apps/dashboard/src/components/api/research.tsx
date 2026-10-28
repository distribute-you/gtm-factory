"use client";

import type { ApiCandidates } from "@gtm-factory/core";
import { Page, PageHeader, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { plural } from "@/lib/format";
import { PointsList, Read, recentOnBest } from "./common";

export function ApiResearchPage() {
  const read = useApi<ApiCandidates[]>("/research");
  const { data: o } = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(points) => {
            // The simulator knows its world's hidden best at each place: say how many places the Rating found it at.
            const judged = points.filter((p) => p.onBest && p.onBest.reduce((x, d) => x + d.picks, 0) >= 200);
            const found = judged.filter((p) => (recentOnBest(p) ?? 0) >= 0.8).length;
            return (
            <>
              <PageHeader
                title={judged.length > 0 ? `${found} of ${plural(judged.length, "candidate place backs", "candidate places back")} the hidden best` : plural(points.length, "candidate place", "candidate places")}
                sub={
                  judged.length > 0
                    ? "The world hides the true best candidate at each place. Belief is what the Supplier rating reads today; truth is what the world really does, never read by any pick."
                    : "At every Material where several candidates compete, the belief the Supplier rating holds about each one. The picking script picks by value per dollar, with one Thompson draw."
                }
              />
              <PointsList points={points} catalogue={o?.catalogue} />
            </>
            );
          }}
        </Read>
      </Page>
    </>
  );
}
