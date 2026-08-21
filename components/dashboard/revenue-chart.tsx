"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { RevenueBucketPoint } from "@/lib/dashboard/revenue-bucketing";

/**
 * REV-01 / D-07: revenue-over-time trend. Single Cypher-Blue series (no
 * secondary series — unlike Verifications' authenticated/failed split)
 * per 03-UI-SPEC.md Color contract. Tooltip formats each point as USD via
 * Intl.NumberFormat, never a plain `.toLocaleString()` count formatter.
 */
const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--cypher-blue)",
  },
} satisfies ChartConfig;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

interface RevenueChartProps {
  data: RevenueBucketPoint[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
      <LineChart data={data} accessibilityLayer>
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
          label={{ value: "Revenue (USD)", angle: -90, position: "insideLeft" }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="tabular-nums">
                  {(chartConfig[name as keyof typeof chartConfig]?.label ?? name) +
                    ": " +
                    currencyFormatter.format(Number(value))}
                </span>
              )}
            />
          }
        />
        <Line
          dataKey="revenue"
          name="revenue"
          stroke="var(--cypher-blue)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
