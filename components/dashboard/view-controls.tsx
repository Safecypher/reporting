"use client";

import { useMemo, useState } from "react";

import { KpiCards } from "@/components/dashboard/kpi-cards";
import { VerificationsChart } from "@/components/dashboard/verifications-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  rebucket,
  type BucketTimeZone,
  type DailyRow,
  type Granularity,
} from "@/lib/dashboard/bucketing";

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

interface ViewControlsProps {
  dailyRows: DailyRow[];
}

/**
 * Owns the granularity + timezone selection and re-buckets the daily series
 * client-side via `rebucket` on every change. Session-only state (D-03) —
 * intentionally held in component state only (no localStorage/URL/cookie),
 * so it resets to the UTC default on every reload.
 */
export function ViewControls({ dailyRows }: ViewControlsProps) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [timeZone, setTimeZone] = useState<BucketTimeZone>("UTC");

  const bucketed = useMemo(
    () => rebucket(dailyRows, granularity, timeZone),
    [dailyRows, granularity, timeZone],
  );

  const totals = useMemo(
    () =>
      bucketed.reduce(
        (acc, point) => ({
          authenticated: acc.authenticated + point.authenticated,
          failed: acc.failed + point.failed,
        }),
        { authenticated: 0, failed: 0 },
      ),
    [bucketed],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-medium text-foreground">
          Verifications over time
        </h2>
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

      <VerificationsChart data={bucketed} />

      <KpiCards
        total={totals.authenticated + totals.failed}
        authenticated={totals.authenticated}
        failed={totals.failed}
      />
    </div>
  );
}
