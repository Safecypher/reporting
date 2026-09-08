"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** CVD-safe amber, matching the "Failed" secondary series elsewhere in the app. */
const chartConfig = {
  removedCount: {
    label: "Cards removed",
    color: "#d97706",
  },
} satisfies ChartConfig;

export interface CardRemovalsChartPoint {
  day: string;
  removedCount: number;
}

interface CardRemovalsChartProps {
  data: CardRemovalsChartPoint[];
}

/** The 4,426-removal incident day (D-06: Invex mobile-app enrolment revert). */
const INCIDENT_DAY = "2026-09-04";

function formatDayLong(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * Design decision (PLAN.md "Removals chart shows the 4 Sep spike at full
 * linear scale"): a log axis would compress a 100x spike into what reads as
 * a modest bump to a non-technical audience — worse than an unreadable
 * baseline. Full linear scale is used deliberately, and the flattening of
 * every other day IS the honest picture. The spike is paired with a callout
 * naming the incident rather than smoothed, truncated, or rescaled away.
 */
export function CardRemovalsChart({ data }: CardRemovalsChartProps) {
  const spike = data.find((point) => point.day === INCIDENT_DAY);

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
        <BarChart data={data} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(value: string) =>
              new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
              })
            }
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            label={{ value: "Day", position: "insideBottom", offset: -4 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            allowDecimals={false}
            label={{ value: "Cards removed", angle: -90, position: "insideLeft" }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_label, payload) => {
                  const point = payload?.[0]?.payload as CardRemovalsChartPoint | undefined;
                  return point ? formatDayLong(point.day) : "";
                }}
                formatter={(value) => (
                  <span className="tabular-nums">{`Removed: ${Number(value).toLocaleString()}`}</span>
                )}
              />
            }
          />
          <Bar dataKey="removedCount" name="removedCount" fill="var(--color-removedCount)" radius={4} />
        </BarChart>
      </ChartContainer>
      {spike ? (
        <p className="rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 p-3 text-sm font-light text-foreground">
          <strong className="font-medium">
            {formatDayLong(INCIDENT_DAY)} spike ({spike.removedCount.toLocaleString()} removals):
          </strong>{" "}
          Invex enabled the product to many customers via a mobile-app update around this date
          and reverted it. This is that revert, not churn.
        </p>
      ) : null}
    </div>
  );
}
