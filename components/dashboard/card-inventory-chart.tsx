"use client";

import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * Data-viz palette per 01-UI-SPEC.md — Cypher Blue for the single series.
 */
const chartConfig = {
  cardCount: {
    label: "Cards enrolled",
    color: "#382aff",
  },
} satisfies ChartConfig;

export interface CardInventoryChartPoint {
  /** UTC-midnight epoch ms of `day` — the numeric x-value that spaces
   * snapshots by their real calendar distance. */
  timestamp: number;
  day: string;
  cardCount: number;
}

interface CardInventoryChartProps {
  data: CardInventoryChartPoint[];
}

function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatDayLong(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * Design decision (PLAN.md "Enrolment chart uses a TIME-SCALED x-axis"):
 * a categorical x-axis would space the 9 snapshots evenly, making an 11-day
 * gap look identical to a 1-day gap — hiding exactly the sparseness the
 * reader needs to see. A numeric/timestamp x-axis renders the true gaps as
 * whitespace instead. Points are plotted with `Scatter` (dots), never
 * connected by a line — a line would imply we know the values on the days
 * between snapshots, which we don't (this report is not delivered daily).
 */
export function CardInventoryChart({ data }: CardInventoryChartProps) {
  const first = data[0];
  const last = data[data.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
        <ScatterChart accessibilityLayer margin={{ bottom: 12, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatDay}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            label={{ value: "Snapshot date", position: "insideBottom", offset: -4 }}
          />
          <YAxis
            dataKey="cardCount"
            type="number"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            allowDecimals={false}
            label={{ value: "Cards enrolled", angle: -90, position: "insideLeft" }}
          />
          <ZAxis range={[120, 120]} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_label, payload) => {
                  const point = payload?.[0]?.payload as CardInventoryChartPoint | undefined;
                  return point ? formatDayLong(point.timestamp) : "";
                }}
                formatter={(value) => (
                  <span className="tabular-nums">
                    {`Cards enrolled: ${Number(value).toLocaleString()}`}
                  </span>
                )}
              />
            }
          />
          <Scatter data={data} dataKey="cardCount" fill="var(--color-cardCount)" />
        </ScatterChart>
      </ChartContainer>
      <p className="text-sm font-light text-muted-foreground">
        {data.length === 0
          ? "No inventory snapshots in this window."
          : `${data.length} snapshot${data.length === 1 ? "" : "s"} between ${formatDayLong(
              first.timestamp,
            )} and ${formatDayLong(last.timestamp)} — this report is not delivered daily.`}
      </p>
    </div>
  );
}
