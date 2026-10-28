"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Series {
  key: string;
  label: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
}

/**
 * A day-by-day line chart in the v2 family: fg-3 ticks at 11px, no gridlines, a k-popover tooltip.
 * Draws what it is handed; divides nothing.
 */
export function DayChart({
  series,
  format,
  reference,
  days: labels,
  height = 180,
}: {
  series: Series[];
  /** The ISO day of each point, oldest first: the axis reads dates. */
  days?: string[];
  format: (v: number) => string;
  reference?: { y: number; label: string };
  height?: number;
}) {
  const days = Math.max(0, ...series.map((s) => s.values.length));
  const dayLabel = (d: number) => (labels ? (labels[d] ? new Date(labels[d]!).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "") : `Day ${d}`);
  const data = Array.from({ length: days }, (_, d) => {
    const row: Record<string, number | null> = { day: d };
    for (const s of series) row[s.key] = s.values[d] ?? null;
    return row;
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="transparent" />
          <XAxis
            dataKey="day"
            type="number"
            allowDecimals={false}
            domain={[0, Math.max(1, days - 1)]}
            tick={{ fontSize: 11, fill: "var(--fg-3)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
            tickFormatter={(d: number) => dayLabel(d)}
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--fg-3)" }} tickLine={false} axisLine={false} width={52} tickCount={4} tickFormatter={(v: number) => format(v)} />
          {reference && (
            <ReferenceLine y={reference.y} stroke="var(--line-strong)" strokeDasharray="3 3" label={{ value: reference.label, position: "insideTopLeft", fontSize: 11, fill: "var(--fg-3)" }} />
          )}
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="k-popover px-2.5 py-1.5 text-[12px]">
                  <p className="k-fg3 k-mono">{dayLabel(Number(label))}</p>
                  {payload.map((p) => {
                    const s = series.find((x) => x.key === p.dataKey);
                    return p.value == null ? null : (
                      <p key={String(p.dataKey)} className="flex items-center gap-1.5 tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: s?.color }} />
                        <span className="k-fg2">{s?.label}</span>
                        <span className="font-medium">{format(Number(p.value))}</span>
                      </p>
                    );
                  })}
                </div>
              ) : null
            }
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The legend under a chart: a dot (or a dash) and a word per series. */
export function Legend({ series }: { series: Pick<Series, "label" | "color" | "dashed">[] }) {
  return (
    <div className="k-fg3 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
      {series.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-3" style={{ borderTop: `1.5px ${s.dashed ? "dashed" : "solid"} ${s.color}` }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
