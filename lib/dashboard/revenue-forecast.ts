import type { createClient } from "@/lib/supabase/server";
import type { RevenueSource } from "@/lib/dashboard/revenue-source";

/**
 * Server-side fetcher and pure formatters for `revenue_forecast_for_period` /
 * `revenue_forecast_daily_for_period` (supabase/migrations/0037_revenue_forecast.sql,
 * plan 07-04). Mirrors `lib/dashboard/alignment.ts`'s discriminated-result
 * convention: uses the session-scoped `createClient()` client so RLS applies
 * (never the secret-key writer), narrows the untyped RPC result through
 * `as unknown` first (never a direct cast, matching `fetchAlignmentTotals`),
 * never throws, and logs the raw error server-side.
 *
 * Every NUMERIC column the RPCs return arrives as a string over the
 * supabase-js wire format — converted to `number` exactly once, at this
 * boundary. A null NUMERIC column (the degraded-forecast case: every
 * projected/low/high column reads null, never zero) is preserved as `null`
 * rather than coerced to `0` — coercing it would render a degraded forecast
 * as a confident projection of nothing, which D-12/D-14 explicitly forbid.
 *
 * Neither fetcher decides whether a projection should be SHOWN at all — that
 * gate (the D-12 current-period predicate exported from
 * `lib/dashboard/period.ts`, RESEARCH Pitfall 5: `resolvePeriod` returning
 * successfully is not evidence a period is the current one, since it also
 * succeeds for every valid past period) belongs at the call site, which
 * already holds the single `today` value the gate needs. This module
 * deliberately never imports that predicate.
 */

export type ForecastScope = "month" | "year";

export interface RevenueForecastRow {
  as_of_day: string | null;
  covered_days: number;
  usable_days: number;
  inferred_days: number;
  run_rate: number | null;
  min_day_volume: number | null;
  max_day_volume: number | null;
  actual_volume: number;
  projected_volume: number | null;
  low_volume: number | null;
  high_volume: number | null;
  projected_revenue: number | null;
  low_revenue: number | null;
  high_revenue: number | null;
  degraded: boolean;
  degraded_reason: string | null;
}

export type RevenueForecastResult =
  | { data: RevenueForecastRow; error: null }
  | { data: null; error: string };

export interface RevenueForecastDailyRow {
  day: string;
  revenue: number;
  is_projected: boolean;
}

export type RevenueForecastDailyResult =
  | { data: RevenueForecastDailyRow[]; error: null }
  | { data: null; error: string };

/** Raw shape as returned over the wire, before the NUMERIC-string -> number
 * conversion this module performs exactly once at the fetch boundary. */
interface RawRevenueForecastRow {
  as_of_day: string | null;
  covered_days: number;
  usable_days: number;
  inferred_days: number;
  run_rate: string | null;
  min_day_volume: string | null;
  max_day_volume: string | null;
  actual_volume: string;
  projected_volume: string | null;
  low_volume: string | null;
  high_volume: string | null;
  projected_revenue: string | null;
  low_revenue: string | null;
  high_revenue: string | null;
  degraded: boolean;
  degraded_reason: string | null;
}

interface RawRevenueForecastDailyRow {
  day: string;
  revenue: string;
  is_projected: boolean;
}

function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Period bounds this module's RPCs require. `end` is always non-null here —
 * the RPCs themselves raise if it is null ("a projection needs a bounded
 * horizon"), and the caller only reaches this fetcher once the D-12
 * current-period gate has already confirmed a bounded, current-period scope.
 */
export interface ForecastPeriodBounds {
  start: string;
  end: string;
}

export async function fetchRevenueForecast(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: ForecastPeriodBounds,
  source: RevenueSource,
  minCoveredDays: number,
): Promise<RevenueForecastResult> {
  const { data, error } = await supabase.rpc("revenue_forecast_for_period", {
    p_start: period.start,
    p_end: period.end,
    p_source: source,
    p_min_covered_days: minCoveredDays,
  });

  if (error) {
    console.error("fetchRevenueForecast: RPC failed", { source, error });
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as unknown as RawRevenueForecastRow[];
  const row = rows[0];

  if (!row) {
    console.error("fetchRevenueForecast: RPC returned no rows", { source });
    return { data: null, error: "revenue_forecast_for_period returned no rows" };
  }

  return {
    data: {
      as_of_day: row.as_of_day,
      covered_days: row.covered_days,
      usable_days: row.usable_days,
      inferred_days: row.inferred_days,
      run_rate: toNullableNumber(row.run_rate),
      min_day_volume: toNullableNumber(row.min_day_volume),
      max_day_volume: toNullableNumber(row.max_day_volume),
      actual_volume: Number(row.actual_volume),
      projected_volume: toNullableNumber(row.projected_volume),
      low_volume: toNullableNumber(row.low_volume),
      high_volume: toNullableNumber(row.high_volume),
      projected_revenue: toNullableNumber(row.projected_revenue),
      low_revenue: toNullableNumber(row.low_revenue),
      high_revenue: toNullableNumber(row.high_revenue),
      degraded: row.degraded,
      degraded_reason: row.degraded_reason,
    },
    error: null,
  };
}

export async function fetchRevenueForecastDaily(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: ForecastPeriodBounds,
  source: RevenueSource,
  minCoveredDays: number,
): Promise<RevenueForecastDailyResult> {
  const { data, error } = await supabase.rpc("revenue_forecast_daily_for_period", {
    p_start: period.start,
    p_end: period.end,
    p_source: source,
    p_min_covered_days: minCoveredDays,
  });

  if (error) {
    console.error("fetchRevenueForecastDaily: RPC failed", { source, error });
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as unknown as RawRevenueForecastDailyRow[];
  return {
    data: rows.map((row) => ({
      day: row.day,
      revenue: Number(row.revenue),
      is_projected: row.is_projected,
    })),
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Pure formatters — 07-UI-SPEC.md's Copywriting Contract, verbatim. Ordinary
// exported functions over primitives: no React, and this file carries no
// client-component directive, so both Server Components and this module's
// own test suite can call them directly. One module-level Intl.NumberFormat
// USD instance serves every money figure below.
// ---------------------------------------------------------------------------

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(value: number): string {
  return currencyFormatter.format(value);
}

/** UTC-safe "d MMM yyyy" formatter, matching `/alignment`'s own as-of date
 * style (`lib/dashboard/alignment-status.ts`'s `formatCaptionDay`). */
function formatAsOfDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/** Copywriting Contract — projected card eyebrow, per scope. */
export function projectedCardEyebrow(scope: ForecastScope): string {
  return scope === "month" ? "Projected month-end" : "Projected year-end";
}

/**
 * Copywriting Contract — the D-05 explainability band sentence. Returns
 * null when either bound is null (the degraded case, where low/high revenue
 * are never fabricated). This sentence is this phase's own drift test: if
 * the implementation cannot produce it honestly, the projection logic has
 * left D-05.
 */
export function formatForecastBandSentence(
  scope: ForecastScope,
  lowRevenue: number | null,
  highRevenue: number | null,
): string | null {
  if (lowRevenue === null || highRevenue === null) return null;
  const low = formatMoney(lowRevenue);
  const high = formatMoney(highRevenue);
  if (scope === "month") {
    return `If the rest of the month runs at our quietest day's pace: ${low}. At our busiest day's pace: ${high}.`;
  }
  return `If the rest of the year runs at our quietest day's pace so far: ${low}. At our busiest day's pace: ${high}.`;
}

/**
 * Copywriting Contract — the D-17 permanent method caption, naming the
 * covered-day count, the rate, the as-at date and the inferred-day count.
 * Returns null whenever `runRate` or `asOfDay` is null — a caption cannot
 * honestly name a rate or an as-at date it does not have, and both are
 * exactly the columns the RPC leaves null for a source with zero covered
 * days (the concrete degraded case this phase's live TSYS September data
 * exercises). This function takes no separate `degraded` flag; the caller
 * is expected to gate on the row's own `degraded` field before deciding
 * whether to render this caption at all (D-14) — this null-return is a
 * second, independent safety net against an incomplete caption escaping.
 */
export function formatForecastMethodCaption(
  scope: ForecastScope,
  coveredDays: number,
  runRate: number | null,
  asOfDay: string | null,
  inferredDays: number,
): string | null {
  if (runRate === null || asOfDay === null) return null;
  const rate = runRate.toFixed(2);
  const asOf = formatAsOfDay(asOfDay);
  if (scope === "month") {
    return `Projected from ${coveredDays} covered days this month at ${rate}/day (as at ${asOf}); ${inferredDays} uncovered day(s) inferred at the same rate.`;
  }
  return `Projected from ${coveredDays} covered days year-to-date at ${rate}/day (as at ${asOf}); remaining months priced at this rate.`;
}

/**
 * Copywriting Contract — the D-14 honest-degradation message.
 *
 * 07-REVIEW WR-02: both arguments are **usable** days (covered days after
 * the D-02 drop of the most recent covered day, per `app_settings`'s own
 * "minimum number of USABLE covered days" column comment,
 * supabase/migrations/0035_app_settings_revenue_forecast.sql), not covered
 * days — the two are deliberately distinct counts elsewhere in this
 * codebase (compare `formatForecastMethodCaption` above, which genuinely
 * names a covered-day count). Labelling them "usable days" here keeps the
 * sentence accurate and keeps it from being read as one greater than it
 * actually is.
 */
export function formatForecastDegradedMessage(usableDays: number, threshold: number): string {
  return `Not enough data to project yet — ${usableDays} of ${threshold} usable days.`;
}

/**
 * Copywriting Contract — the D-18 home revenue tile sub-line. Returns null
 * when `pointRevenue` is null (not computable, degraded, or errored — the
 * caller collapses all three to "absent" before ever reaching this
 * function, per the home tile's "absent, never zeroed" rule).
 */
export function formatHomeProjectionSubLine(
  scope: ForecastScope,
  pointRevenue: number | null,
): string | null {
  if (pointRevenue === null) return null;
  const value = formatMoney(pointRevenue);
  return scope === "month" ? `Projected month-end: ${value}` : `Projected year-end: ${value}`;
}
