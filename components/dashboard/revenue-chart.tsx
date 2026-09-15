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
 * REV-01 / D-07: revenue-over-time trend. Cypher-Blue actual series, plus an
 * optional dashed `--provisional` forward series (07-06, D-16/D-17) sharing
 * the same date axis. Tooltip formats each point as USD via
 * Intl.NumberFormat, never a plain `.toLocaleString()` count formatter.
 *
 * This component does not decide whether a projection exists — it renders
 * whatever `data` it is handed. When no point carries a `projected` value,
 * the `projected` `Line` simply has nothing to draw, so "no dashed segment,
 * no legend entry" falls out of the data rather than a conditional here.
 * This component must never read the URL's date-range selection, the D-12
 * current-vs-not gate, or the D-14 honest-degradation configuration — that
 * gating logic lives entirely in the Server Component that builds `data`
 * (07-PATTERNS binding).
 */
const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "var(--cypher-blue)",
  },
  projected: {
    label: "Projected",
    color: "var(--provisional)",
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
          connectNulls={false}
        />
        <Line
          dataKey="projected"
          name="projected"
          stroke="var(--provisional)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
