"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BucketPoint } from "@/lib/dashboard/bucketing";

/**
 * Data-viz palette per 01-UI-SPEC.md — Cypher Blue for the primary
 * (Authenticated) series, CVD-safe amber for the secondary (Failed) series.
 * Never red/green (brand + accessibility contract).
 */
const chartConfig = {
  authenticated: {
    label: "Authenticated",
    color: "#382aff",
  },
  failed: {
    label: "Failed",
    color: "#d97706",
  },
} satisfies ChartConfig;

interface VerificationsChartProps {
  data: BucketPoint[];
}

export function VerificationsChart({ data }: VerificationsChartProps) {
  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[320px] w-full"
    >
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          label={{ value: "Period", position: "insideBottom", offset: -4 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          allowDecimals={false}
          label={{ value: "Verifications", angle: -90, position: "insideLeft" }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="tabular-nums">
                  {(chartConfig[name as keyof typeof chartConfig]?.label ?? name) +
                    ": " +
                    Number(value).toLocaleString()}
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="authenticated"
          name="authenticated"
          fill="var(--color-authenticated)"
          radius={4}
        />
        <Bar
          dataKey="failed"
          name="failed"
          fill="var(--color-failed)"
          radius={4}
        />
      </BarChart>
    </ChartContainer>
  );
}
