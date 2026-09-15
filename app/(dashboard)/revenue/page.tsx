import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { VerificationDrillSheet } from "@/components/dashboard/verification-drill-sheet";
import {
  RevenueTierDrillSheet,
  type RevenueTierDrillRow,
} from "@/components/dashboard/revenue-tier-drill-sheet";
import { RevenueViewControls } from "@/components/dashboard/revenue-view-controls";
import type { RevenueTierRow } from "@/components/dashboard/revenue-tier-breakdown";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { RevenueDailyRow } from "@/lib/dashboard/revenue-bucketing";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  isProjectablePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";
import { fetchRevenueForecastSettings } from "@/lib/settings/revenue-forecast-settings";
import { fetchPerSourceRevenueTotals } from "@/lib/dashboard/revenue-source";
import {
  type RevenueActualPair,
  type RevenueProjection,
  RevenueProjectionCardSkeleton,
} from "@/components/dashboard/revenue-kpi-cards";
import { RevenueBasisCaption } from "@/components/dashboard/revenue-basis-caption";
import { SettingsFallbackNotice } from "@/components/dashboard/settings-fallback-notice";
import {
  fetchRevenueForecast,
  fetchRevenueForecastDaily,
  projectedCardEyebrow,
  formatForecastBandSentence,
  formatForecastMethodCaption,
  formatForecastDegradedMessage,
} from "@/lib/dashboard/revenue-forecast";
import {
  fetchVerificationDrillRows,
  type VerificationDrillFetchResult,
} from "@/lib/dashboard/verification-drill";

export const metadata: Metadata = {
  title: "Revenue — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type RevenueDailyViewRow = { day_utc: string | null; revenue: string | null };
type RevenueTierViewRow = {
  day_utc: string | null;
  tier_order: number | null;
  tier_revenue: string | null;
  tier_set_id: string | null;
};
/** All-verifications daily counts (D-02) — used only to distinguish "no
 * verification data at all" (EmptyState) from "verifications exist but no
 * pricing tier covers them" (ErrorState, never a silent $0). */
type RevenueDailyCountsRow = { day_utc: string | null };
type PricingTierSetRow = { id: string };
type IngestedFileFreshness = { uploaded_at: string };

function FreshnessBadge({ uploadedAt }: { uploadedAt: string | null }) {
  const label = uploadedAt
    ? `Data as of last import: ${new Date(uploadedAt).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : "Data as of last import: no imports yet";

  return (
    <Badge
      variant="outline"
      className="gap-1.5 font-normal text-muted-foreground"
    >
      <svg aria-hidden="true" className="size-3">
        <use href="/icons.svg#clock" />
      </svg>
      {label}
    </Badge>
  );
}

type PeriodOption = { value: string; label: string };

function PageHeader({
  uploadedAt,
  period,
  monthOptions,
  yearOptions,
}: {
  uploadedAt: string | null;
  period: ResolvedPeriod | null;
  monthOptions: PeriodOption[];
  yearOptions: PeriodOption[];
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">Revenue</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period && <ScopeBadge period={period} />}
          <FreshnessBadge uploadedAt={uploadedAt} />
        </div>
      </div>
      {period && (
        <PeriodControls period={period} monthOptions={monthOptions} yearOptions={yearOptions} />
      )}
      <p className="text-sm font-light text-muted-foreground">
        {DATA_WINDOW_CAPTION}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground">
        <use href="/icons.svg#chart" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">No revenue data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the daily verification report to see computed revenue over
        time.{" "}
        <Link
          href="/uploads"
          className="text-primary underline underline-offset-4"
        >
          Upload report
        </Link>
      </p>
    </div>
  );
}

/**
 * Binding rule (03-UI-SPEC.md / T-03-17): a revenue-computation failure
 * caused by missing pricing tier configuration is an explicit error state
 * with actionable copy — never a silent $0 presented as a real answer.
 */
function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Revenue could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong computing revenue — try refreshing the page, and
        check the pricing tiers are configured correctly.
      </p>
    </div>
  );
}

/**
 * WR-03: v_revenue_tier_set_by_day's inner `cross join lateral` silently
 * drops any day with verification activity but no `pricing_tier_sets` row
 * whose `effective_from <= day` — a PARTIAL gap (as opposed to "zero tier
 * sets at all", already caught by ErrorState above). Rendered ADDITIONALLY
 * to, never instead of, the populated view — the days that ARE priced still
 * show their real numbers.
 */
function PartialCoverageBanner({ missingDayCount }: { missingDayCount: number }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] p-4"
    >
      <svg aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--warning)]">
        <use href="/icons.svg#alert" />
      </svg>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          Revenue is understated — pricing coverage gap
        </p>
        <p className="text-sm font-light text-muted-foreground">
          {missingDayCount === 1
            ? "1 day has verification activity but no pricing tier configured for it, so it is excluded from the totals below."
            : `${missingDayCount} days have verification activity but no pricing tier configured for them, so they are excluded from the totals below.`}{" "}
          Add an earlier-effective pricing tier set to cover the gap.
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Skeleton className="h-[320px] w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 w-full" />
        <RevenueProjectionCardSkeleton />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Server-fetches the per-day contribution rows for one tier (the
 * "revenue-tier" drill entity, D-07/D-11). `tierOrder` is validated as a
 * whitelisted integer by `parseDrillParams` before it ever reaches this
 * `.eq()` call (T-03-19).
 */
async function fetchRevenueTierDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tierOrder: number | undefined,
  range: { start: string; end: string | null },
): Promise<RevenueTierDrillRow[]> {
  if (tierOrder === undefined) return [];

  let query = supabase
    .from("v_revenue_by_tier")
    .select("day_utc, overlap_count, rate, tier_revenue")
    .eq("tier_order", tierOrder)
    .gt("overlap_count", 0)
    .gte("day_utc", range.start);
  if (range.end !== null) {
    query = query.lt("day_utc", range.end);
  }

  const { data, error } = await query
    .order("day_utc", { ascending: false })
    .returns<RevenueTierDrillRow[]>();

  if (error) return [];
  return data ?? [];
}

/**
 * Async Server Component reading `v_revenue_daily` / `v_revenue_by_tier`
 * (REV-01) plus the grand total for the "Total revenue" KPI (summed in
 * Postgres via a PostgREST aggregate — never re-summed in JS, Pitfall
 * 2/T-03-16), and the "as of last import" freshness timestamp via the
 * session-scoped server client so RLS applies. Also checks
 * `pricing_tier_sets` so a missing pricing configuration renders
 * ErrorState, never a silent $0 (T-03-17).
 *
 * Also reads the Next 16 `searchParams` prop (a Promise — must be awaited)
 * for the drill-down Sheet (DASH-03): `parseDrillParams` whitelists the
 * entity/keys before any query is built.
 */
async function RevenueBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isVerificationDrill = drillFilter?.drill === "verification";
  const isRevenueTierDrill = drillFilter?.drill === "revenue-tier";

  // D-01/D-05: resolve the period BEFORE any query is built — `now` is
  // captured once here from the runtime clock and passed in, so
  // `resolvePeriod` itself stays pure (no wall-clock access inside it).
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);

  // D-15/FCST-05: the live honest-degradation threshold, read before the
  // forecast gate below so it is available for both forecast RPC calls. A
  // non-null `forecastSettingsError` surfaces `SettingsFallbackNotice`
  // above the KPI row (WR-03 precedent) — a projection computed from a
  // silently defaulted threshold is exactly the case that notice exists to
  // prevent.
  const { settings: forecastSettings, error: forecastSettingsError } =
    await fetchRevenueForecastSettings(supabase);

  // D-12 gate (RESEARCH Pitfall 5): explicit, never inferred from
  // `resolvePeriod` having returned successfully — it also returns
  // successfully for every valid past month/year. Reuses the single `now`
  // already captured above; no second clock read anywhere in this file.
  // Only when `projectable` is true are the two forecast RPCs issued at
  // all — otherwise both promises resolve to `null` placeholders so
  // neither RPC reaches the database for a past period.
  const projectable = isProjectablePeriod(period, now);
  const forecastPromise =
    projectable && period.end !== null
      ? fetchRevenueForecast(
          supabase,
          { start: period.start, end: period.end },
          "bit_addict",
          forecastSettings.minCoveredDays,
        )
      : Promise.resolve(null);
  const forecastDailyPromise =
    projectable && period.end !== null
      ? fetchRevenueForecastDaily(
          supabase,
          { start: period.start, end: period.end },
          "bit_addict",
          forecastSettings.minCoveredDays,
        )
      : Promise.resolve(null);

  // RESEARCH Pattern 1: an outer .gte()/.lt() predicate on the unchanged
  // v_revenue_daily / v_revenue_by_tier / v_revenue_daily_counts views —
  // never a rewrite of any view itself. `.lt` is applied only when the
  // period has a defined end ("all" leaves it open-ended). D-08/D-10: every
  // query below is source-explicit to `bit_addict` — the headline path —
  // now that the chain carries two rows per (day, source); the TSYS figure
  // is fetched separately via `fetchPerSourceRevenueTotals` below.
  let dailyQuery = supabase
    .from("v_revenue_daily")
    .select("day_utc, revenue")
    .eq("source", "bit_addict")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    dailyQuery = dailyQuery.lt("day_utc", period.end);
  }

  let tierQuery = supabase
    .from("v_revenue_by_tier")
    .select("day_utc, tier_order, tier_revenue, tier_set_id")
    .eq("source", "bit_addict")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    tierQuery = tierQuery.lt("day_utc", period.end);
  }

  // Period-scoped — drives both the T-03-17 error branch (period has
  // activity but nothing got priced) and the PartialCoverageBanner's
  // in-period day-set diff.
  let countsQuery = supabase
    .from("v_revenue_daily_counts")
    .select("day_utc")
    .eq("source", "bit_addict")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    countsQuery = countsQuery.lt("day_utc", period.end);
  }

  const [
    dailyResult,
    tierResult,
    perSourceTotalsResult,
    verificationCountsResult,
    domainActivityResult,
    pricingTierSetsResult,
    freshnessResult,
    verificationDrillResult,
    revenueTierDrillRows,
    forecastResult,
    forecastDailyResult,
  ] = await Promise.all([
    dailyQuery.order("day_utc", { ascending: true }).returns<RevenueDailyViewRow[]>(),
    tierQuery.returns<RevenueTierViewRow[]>(),
    // Grand totals summed in Postgres via revenue_total_for_period (0024,
    // now source-required per 0034/D-08) — the numbers reaching JS are
    // already the final NUMERIC totals for the resolved period, one per
    // source, never summed client-side from the per-day/per-tier rows
    // above. An RPC is used instead of a PostgREST `sum()` aggregate
    // because Supabase blocks aggregate functions by default (PGRST123).
    fetchPerSourceRevenueTotals(supabase, period),
    countsQuery.returns<RevenueDailyCountsRow[]>(),
    // UNSCOPED existence probe (never a period predicate) — distinguishes
    // "no verifications at all" (EmptyState) from "verifications exist,
    // this period has none" (PeriodEmptyState). A narrow period must never
    // masquerade as a totally-empty view. Restricted to source =
    // "bit_addict" (D-08): otherwise TSYS-only rows would make
    // hasVerificationActivity true for a database with no Bit Addict
    // verifications at all.
    supabase
      .from("v_revenue_daily_counts")
      .select("day_utc", { count: "exact", head: true })
      .eq("source", "bit_addict")
      .limit(1)
      .returns<RevenueDailyCountsRow[]>(),
    supabase
      .from("pricing_tier_sets")
      .select("id")
      .limit(1)
      .returns<PricingTierSetRow[]>(),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    // D-02: revenue counts ALL verifications, so `authenticated` is
    // deliberately omitted here (unlike verifications/page.tsx, which
    // filters by it) — the shared fetcher's optional param makes that a
    // caller-side choice, not a second code path.
    isVerificationDrill
      ? fetchVerificationDrillRows(supabase, undefined, {
          start: period.start,
          end: period.end,
        })
      : Promise.resolve<VerificationDrillFetchResult>({ rows: [], totalCount: null }),
    isRevenueTierDrill
      ? fetchRevenueTierDrillRows(supabase, drillFilter.tierOrder, {
          start: period.start,
          end: period.end,
        })
      : Promise.resolve<RevenueTierDrillRow[]>([]),
    forecastPromise,
    forecastDailyPromise,
  ]);

  if (
    dailyResult.error ||
    tierResult.error ||
    perSourceTotalsResult.error ||
    verificationCountsResult.error ||
    domainActivityResult.error ||
    pricingTierSetsResult.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
      </>
    );
  }

  const hasVerificationActivity = (domainActivityResult.count ?? 0) > 0;
  const hasPricingTierSet = (pricingTierSetsResult.data ?? []).length > 0;
  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  if (!hasVerificationActivity) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <EmptyState />
      </>
    );
  }

  const periodHasActivity = (verificationCountsResult.data ?? []).length > 0;

  if (!periodHasActivity) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <PeriodEmptyState viewNoun="revenue" period={period} />
      </>
    );
  }

  // T-03-17: verifications exist in the selected period, but there is no
  // pricing tier configured to price them (at all, or for the days that
  // have activity within the period) — an explicit error, never a silent
  // $0.
  if (!hasPricingTierSet || (dailyResult.data ?? []).length === 0) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <ErrorState />
      </>
    );
  }

  // 07-06/planner_notes: the dashed series starts AT `as_of_day`, not after
  // it — `revenue_forecast_daily_for_period` reports the actual figure for
  // `as_of_day` itself (its `is_projected` is false there), so carrying
  // that same day's value into `projected` is what lets the solid and
  // dashed `Line`s (both `connectNulls={false}`) share one x-value and
  // visually meet, per 07-UI-SPEC E2. Every day before `as_of_day` is left
  // `undefined` deliberately — a dashed spur mid-history would read as a
  // rendering fault, not a chart feature. `asOfDay` is null whenever the
  // forecast is degraded or errored, which alone empties this map (the
  // degraded RPC also returns zero daily rows — 07-04-SUMMARY — so this is
  // belt-and-braces, not the only gate).
  const asOfDay =
    forecastResult !== null && forecastResult.error === null
      ? forecastResult.data.as_of_day
      : null;
  const forecastDailyByDay = new Map<string, number>();
  if (asOfDay !== null && forecastDailyResult !== null && forecastDailyResult.error === null) {
    for (const row of forecastDailyResult.data) {
      if (row.day >= asOfDay) {
        forecastDailyByDay.set(row.day, row.revenue);
      }
    }
  }

  const dailyRows: RevenueDailyRow[] = (dailyResult.data ?? [])
    .filter(
      (row): row is RevenueDailyViewRow & { day_utc: string; revenue: string } =>
        row.day_utc !== null && row.revenue !== null,
    )
    .map((row) => ({
      day_utc: row.day_utc,
      revenue: row.revenue,
      projected: forecastDailyByDay.has(row.day_utc)
        ? String(forecastDailyByDay.get(row.day_utc))
        : undefined,
    }));

  const tierRows: RevenueTierRow[] = (tierResult.data ?? [])
    .filter(
      (
        row,
      ): row is RevenueTierViewRow & {
        day_utc: string;
        tier_order: number;
        tier_revenue: string;
        tier_set_id: string;
      } =>
        row.day_utc !== null &&
        row.tier_order !== null &&
        row.tier_revenue !== null &&
        row.tier_set_id !== null,
    )
    .map((row) => ({
      day_utc: row.day_utc,
      tier_order: row.tier_order,
      tier_revenue: row.tier_revenue,
      tier_set_id: row.tier_set_id,
    }));

  // The RPCs return the exact-NUMERIC totals as strings — no arithmetic
  // over the fetched daily rows ever produces these values (Pitfall 2).
  // Reaching here means perSourceTotalsResult.error is null (checked
  // above), so `.data` is non-null in practice — the `?? 0`/`?? null`
  // fallbacks and `tsysError` derivation are defensive, never load-bearing.
  const actual: RevenueActualPair = {
    bitAddict: perSourceTotalsResult.data?.bitAddict ?? 0,
    tsys: perSourceTotalsResult.data?.tsys ?? null,
    tsysError: perSourceTotalsResult.data === null,
  };

  // D-12: null whenever `projectable` is false — the absent case, never an
  // object with null fields. `error`/`degradedMessage`/the populated
  // figure/band/caption fields are mutually exclusive per
  // `RevenueProjection`'s own contract; `formatForecastBandSentence` and
  // `formatForecastMethodCaption` already return null for the degraded
  // row's null columns (a second, independent safety net — see
  // lib/dashboard/revenue-forecast.ts), so no extra `row.degraded` branch
  // is needed to null those two out here.
  const forecastScope = period.scope === "year" ? "year" : "month";
  let projection: RevenueProjection | null = null;
  if (projectable && forecastResult !== null) {
    projection =
      forecastResult.error !== null
        ? {
            eyebrow: projectedCardEyebrow(forecastScope),
            point: null,
            bandSentence: null,
            methodCaption: null,
            degradedMessage: null,
            error: true,
          }
        : {
            eyebrow: projectedCardEyebrow(forecastScope),
            point: forecastResult.data.projected_revenue,
            bandSentence: formatForecastBandSentence(
              forecastScope,
              forecastResult.data.low_revenue,
              forecastResult.data.high_revenue,
            ),
            methodCaption: formatForecastMethodCaption(
              forecastScope,
              forecastResult.data.covered_days,
              forecastResult.data.run_rate,
              forecastResult.data.as_of_day,
              forecastResult.data.inferred_days,
            ),
            degradedMessage: forecastResult.data.degraded
              ? formatForecastDegradedMessage(
                  forecastResult.data.usable_days,
                  forecastSettings.minCoveredDays,
                )
              : null,
            error: false,
          };
  }

  // WR-03: compare days WITH verification activity (within the period)
  // against days that were actually priced (within the period) — a
  // difference means a partial pricing-tier coverage gap inside the
  // selected period.
  const activityDayUtcs = new Set(
    (verificationCountsResult.data ?? [])
      .map((row) => row.day_utc)
      .filter((day): day is string => day !== null),
  );
  const pricedDayUtcs = new Set(dailyRows.map((row) => row.day_utc));
  const missingDayCount = [...activityDayUtcs].filter(
    (day) => !pricedDayUtcs.has(day),
  ).length;

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      {missingDayCount > 0 && <PartialCoverageBanner missingDayCount={missingDayCount} />}
      {forecastSettingsError !== null && <SettingsFallbackNotice />}
      <RevenueViewControls
        dailyRows={dailyRows}
        tierRows={tierRows}
        actual={actual}
        projection={projection}
      />
      <RevenueBasisCaption />
      <VerificationDrillSheet
        filter={isVerificationDrill ? drillFilter : null}
        rows={verificationDrillResult.rows}
        title="Verifications — All"
        totalCount={verificationDrillResult.totalCount}
      />
      <RevenueTierDrillSheet
        filter={isRevenueTierDrill ? drillFilter : null}
        rows={revenueTierDrillRows}
        title={`Revenue by tier — Tier ${(drillFilter?.tierOrder ?? 0) + 1}`}
      />
    </>
  );
}

export default function RevenuePage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <RevenueBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
