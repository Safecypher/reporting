"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  serializePeriodParams,
  type PeriodScope,
  type ResolvedPeriod,
  type YearMode,
} from "@/lib/dashboard/period";

/**
 * URL-synced Month/Year/All-time control cluster (D-01, D-07) sitting inside
 * the period-scoped page's `PageHeader`. State lives ENTIRELY in the URL —
 * this component holds no React local-state hook at all — which is the
 * critical divergence from `ViewControls` (session-only granularity/timezone
 * state, D-09). Selecting any option navigates immediately; there is no
 * Apply button.
 *
 * `monthOptions`/`yearOptions` are computed server-side from
 * `lib/dashboard/period.ts` and passed down as props, so this component
 * never derives dates itself.
 */

const PERIOD_OPTIONS: { value: PeriodScope; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
];

const YEAR_MODE_OPTIONS: { value: YearMode; label: string }[] = [
  { value: "calendar", label: "Calendar" },
  { value: "financial", label: "Financial" },
];

interface PeriodOption {
  value: string;
  label: string;
}

interface PeriodControlsProps {
  period: ResolvedPeriod;
  monthOptions: PeriodOption[];
  yearOptions: PeriodOption[];
}

/**
 * Builds a placeholder `ResolvedPeriod`-shaped object carrying only the
 * fields `serializePeriodParams` actually reads (`scope`/`of`/`yearMode`).
 * `start`/`end`/`label` are never read by the serializer — the real values
 * are recomputed server-side by `resolvePeriod` once the navigation lands —
 * so they're filled with inert placeholders here rather than duplicating
 * the resolver's date math on the client.
 */
function buildNextPeriod(scope: PeriodScope, of: string | null, yearMode: YearMode | null): ResolvedPeriod {
  return { scope, yearMode, of, start: "", end: null, label: "" };
}

export function PeriodControls({ period, monthOptions, yearOptions }: PeriodControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigateTo(next: ResolvedPeriod) {
    const params = new URLSearchParams(searchParams.toString());
    // Clear this whitelist's own keys before re-applying the new set, so a
    // scope change (e.g. year -> month) never leaves a stale `yearMode`
    // behind in the URL. Every other key — including drill-params.ts's
    // `drill`/`date` — survives untouched, since this only ever touches the
    // three keys resolvePeriod reads.
    params.delete("period");
    params.delete("of");
    params.delete("yearMode");

    const serialized = serializePeriodParams(next);
    for (const [key, value] of Object.entries(serialized)) {
      params.set(key, value);
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  function handleScopeChange(value: string) {
    if (!value || value === period.scope) return;
    const scope = value as PeriodScope;

    if (scope === "all") {
      navigateTo(buildNextPeriod("all", null, null));
      return;
    }

    if (scope === "month") {
      const of = monthOptions[0]?.value ?? null;
      navigateTo(buildNextPeriod("month", of, null));
      return;
    }

    // scope === "year" — P-01: default yearMode is calendar.
    const of = yearOptions[0]?.value ?? null;
    navigateTo(buildNextPeriod("year", of, "calendar"));
  }

  function handleOfChange(value: string) {
    if (!value) return;
    navigateTo(buildNextPeriod(period.scope, value, period.yearMode));
  }

  function handleYearModeChange(value: string) {
    if (!value) return;
    navigateTo(buildNextPeriod("year", period.of, value as YearMode));
  }

  const ofOptions = period.scope === "year" ? yearOptions : monthOptions;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={period.scope}
        onValueChange={handleScopeChange}
        aria-label="Period"
      >
        {PERIOD_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {period.scope !== "all" && (
        <Select value={period.of ?? undefined} onValueChange={handleOfChange}>
          <SelectTrigger
            size="sm"
            aria-label={period.scope === "month" ? "Choose month" : "Choose year"}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ofOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* D-08 binding: unmounted (not CSS-hidden) for Month and All-time, so
          it can never hold stale selection state. */}
      {period.scope === "year" && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={period.yearMode ?? "calendar"}
          onValueChange={handleYearModeChange}
          aria-label="Year type"
        >
          {YEAR_MODE_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </div>
  );
}
