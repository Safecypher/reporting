"use client";

import { useMemo, useState } from "react";

import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { RevenueKpiCards } from "@/components/dashboard/revenue-kpi-cards";
import {
  RevenueTierBreakdown,
  type RevenueTierRow,
} from "@/components/dashboard/revenue-tier-breakdown";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BucketTimeZone, Granularity } from "@/lib/dashboard/bucketing";
import { rebucketRevenue, type RevenueDailyRow } from "@/lib/dashboard/revenue-bucketing";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// Exactly these three options per D-04 — no full IANA picker.
const TIMEZONE_OPTIONS: { value: BucketTimeZone; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "America/Chicago", label: "America/Chicago" },
];

interface RevenueViewControlsProps {
  dailyRows: RevenueDailyRow[];
  tierRows: RevenueTierRow[];
  /** Pre-summed grand total (dollars) from the SQL view — never a client re-sum. */
  totalRevenue: number;
}

/**
 * Owns the granularity + timezone selection and re-buckets the revenue
 * daily series client-side via `rebucketRevenue` on every change (D-09,
 * mirrors ViewControls/SlaViewControls verbatim in shape). The Total
 * revenue KPI receives the SQL-computed grand total as a prop — it is never
 * derived from the client-side re-bucketed chart series.
 */
export function RevenueViewControls({
  dailyRows,
  tierRows,
  totalRevenue,
}: RevenueViewControlsProps) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [timeZone, setTimeZone] = useState<BucketTimeZone>("UTC");

  const bucketed = useMemo(
    () => rebucketRevenue(dailyRows, granularity, timeZone),
    [dailyRows, granularity, timeZone],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-medium text-foreground">Revenue over time</h2>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={granularity}
            onValueChange={(value) => {
              if (value) setGranularity(value as Granularity);
            }}
            aria-label="Granularity"
          >
            {GRANULARITY_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={timeZone}
            onValueChange={(value) => {
              if (value) setTimeZone(value as BucketTimeZone);
            }}
            aria-label="Timezone"
          >
            {TIMEZONE_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <RevenueChart data={bucketed} />

      <RevenueKpiCards total={totalRevenue} />

      <RevenueTierBreakdown rows={tierRows} />
    </div>
  );
}
