"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { SlaBucketPoint } from "@/lib/dashboard/sla-bucketing";

/**
 * SLA-01 / D-08: average verification duration vs the 750ms contractual
 * threshold. Cypher Blue for the trend line; the reference line is always
 * neutral --fg-3 dashed (never a data-series colour); breach points are
 * always --error (never Cypher Blue) per 03-UI-SPEC.md Color contract.
 */
const chartConfig = {
  avgDurationMs: {
    label: "Avg duration (ms)",
    color: "var(--cypher-blue)",
  },
} satisfies ChartConfig;

const SLA_THRESHOLD_MS = 750;

function BreachAwareDot(props: {
  cx?: number;
  cy?: number;
  payload?: { avgDurationMs: number };
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;

  const breached = payload.avgDurationMs > SLA_THRESHOLD_MS;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={breached ? "var(--error)" : "var(--cypher-blue)"}
      stroke="none"
    />
  );
}

interface SlaChartProps {
  data: SlaBucketPoint[];
}

export function SlaChart({ data }: SlaChartProps) {
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
          allowDecimals={false}
          label={{ value: "Duration (ms)", angle: -90, position: "insideLeft" }}
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
        <ReferenceLine
          y={SLA_THRESHOLD_MS}
          stroke="var(--fg-3)"
          strokeDasharray="4 4"
          label={{ value: "750ms SLA", position: "insideTopRight" }}
        />
        <Line
          dataKey="avgDurationMs"
          name="avgDurationMs"
          stroke="var(--cypher-blue)"
          strokeWidth={2}
          dot={<BreachAwareDot />}
        />
      </LineChart>
    </ChartContainer>
  );
}
