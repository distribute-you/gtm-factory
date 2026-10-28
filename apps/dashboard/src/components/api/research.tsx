"use client";

import type { ApiCandidates } from "@gtm-factory/core";
import { DayChart } from "@/components/charts";
import { ChartNote, Page, PageHeader, SectionTitle, TopBar } from "@/components/ui";
import { useApi } from "@/lib/api/client";
import { useOverview } from "@/lib/api/overview";
import { formatUsd, plural } from "@/lib/format";
import { CLEAR_WINNER, PointsList, Read, topChance } from "./common";

export function ApiResearchPage() {
  const read = useApi<ApiCandidates[]>("/research");
  const { data: o } = useOverview();
  return (
    <>
      <TopBar crumbs={[{ label: "Research" }]} />
      <Page>
        <Read read={read} rows={8}>
          {(points) => {
            // Only places where scripts compete can have a winner.
            const contested = points.filter((p) => p.candidates.length > 1);
            const clear = contested.filter((p) => topChance(p) >= CLEAR_WINNER).length;
            return (
              <>
                <PageHeader
                  title={contested.length === 0 ? "No scripts have competed yet" : `${clear} of ${plural(contested.length, "place has", "places have")} a clear winner`}
                  sub="A clear winner is a script the Rating believes is the best with a chance over 90%. Every figure here comes from its own estimates."
                />
                <EstimatedRegret points={points} />
                <PointsList points={points} catalogue={o?.catalogue} />
              </>
            );
          }}
        </Read>
      </Page>
    </>
  );
}

/** Value lost each day to picks the Rating believed weaker than its best, every place together. */
function EstimatedRegret({ points }: { points: ApiCandidates[] }) {
  const byDay = new Map<string, number>();
  for (const p of points) for (const d of p.daily) byDay.set(d.day.slice(0, 10), (byDay.get(d.day.slice(0, 10)) ?? 0) + d.regretCents);
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return null;
  const lines = [{ key: "r", label: "Value lost to weaker picks, per day", values: days.map((d) => byDay.get(d)! / 100), color: "var(--accent)" }];
  return (
    <section className="mb-6">
      <SectionTitle>Value lost to weaker picks</SectionTitle>
      <div className="k-card px-4 pb-3 pt-3">
        <DayChart series={lines} days={days} format={formatUsd} height={160} />
        <ChartNote>Dollars spent each day on scripts the Rating then believed weaker than its best. It falls as the Rating learns.</ChartNote>
      </div>
    </section>
  );
}
