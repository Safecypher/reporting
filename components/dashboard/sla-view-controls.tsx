"use client";

import { useMemo, useState } from "react";

import { SlaChart } from "@/components/dashboard/sla-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BucketTimeZone, Granularity } from "@/lib/dashboard/bucketing";
import { rebucketSla, type SlaDailyRow } from "@/lib/dashboard/sla-bucketing";

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

/**
 * Breach-count KPI card. Mirrors the brand `.metric` treatment from
 * kpi-cards.tsx's MetricCard, but secondary (accent=false per UI-SPEC —
 * SLA's headline anchor is the chart itself, not this KPI).
 */
function BreachCountCard({ value }: { value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Verifications over 750ms
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span className="inline-block border-b-2 border-[var(--cypher-blue)] pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]">
          {value.toLocaleString()}
        </span>
      </CardContent>
    </Card>
  );
}

interface SlaViewControlsProps {
  dailyRows: SlaDailyRow[];
}

/**
 * Owns the granularity + timezone selection and re-buckets the SLA daily
 * series client-side via `rebucketSla` on every change. Session-only state
 * (D-09, mirroring ViewControls) — intentionally held in component state
 * only, resets to the UTC default on every reload.
 */
export function SlaViewControls({ dailyRows }: SlaViewControlsProps) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [timeZone, setTimeZone] = useState<BucketTimeZone>("UTC");

  const bucketed = useMemo(
    () => rebucketSla(dailyRows, granularity, timeZone),
    [dailyRows, granularity, timeZone],
  );

  const totalBreaches = useMemo(
    () => bucketed.reduce((sum, point) => sum + point.breachCount, 0),
    [bucketed],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-medium text-foreground">
          Average duration over time
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

      <SlaChart data={bucketed} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BreachCountCard value={totalBreaches} />
      </div>
    </div>
  );
}
