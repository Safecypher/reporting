import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import {
  PairedMetricCard,
  PairedMetricCardError,
  PairedMetricCardPeriodEmpty,
  PairedMetricCardSkeleton,
  formatCurrency,
} from "@/components/dashboard/alignment-kpi-cards";
import { RevenueBasisCaption } from "@/components/dashboard/revenue-basis-caption";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { AlignmentDrillSheet } from "@/components/dashboard/alignment-drill-sheet";
import { SettingsFallbackNotice } from "@/components/dashboard/settings-fallback-notice";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import {
  alignmentMetricLabel,
  fetchAlignmentLiveCards,
  fetchAlignmentTotals,
  type AlignmentTotalsResult,
  type FlowAlignmentMetric,
} from "@/lib/dashboard/alignment";
import {
  fetchPerSourceRevenueTotals,
  type PerSourceRevenueTotalsResult,
} from "@/lib/dashboard/revenue-source";
import {
  computeLiveCardsCoverageFigures,
  formatLiveCardsDerivationCaption,
  formatLiveCardsStatusMeaningCaption,
} from "@/lib/dashboard/alignment-status";
import {
  ALIGNMENT_DRILL_ENTITY_TO_METRIC,
  ALIGNMENT_METRIC_TO_DRILL_ENTITY,
  asAlignmentDrillEntity,
  fetchAlignmentContributingRows,
  fetchAlignmentDayBreakdown,
  type AlignmentContributingRowsResult,
  type AlignmentDayBreakdownResult,
} from "@/lib/dashboard/alignment-drill";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  serializePeriodParams,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";
import { fetchAlignmentSettings } from "@/lib/settings/alignment-settings";

export const metadata: Metadata = {
  title: "Alignment — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type IngestedFileFreshness = { uploaded_at: string };

function FreshnessBadge({ uploadedAt }: { uploadedAt: string | null }) {
  const label = uploadedAt
    ? `Data as of last import: ${new Date(uploadedAt).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : "Data as of last import: no imports yet";

  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
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
          <h1 className="text-2xl font-medium text-foreground">Alignment</h1>
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
        TSYS is the report from the customer&apos;s systems. Bit Addict is the report from our own
        systems. This page shows whether they agree.
      </p>
      <p className="text-sm font-light text-muted-foreground">{DATA_WINDOW_CAPTION}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground">
        <use href="/icons.svg#layers" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">No data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload any report to see live status and headline figures here.{" "}
        <Link href="/uploads" className="text-primary underline underline-offset-4">
          Upload report
        </Link>
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Alignment data could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading TSYS or Bit Addict data. Try refreshing the page — if it
        keeps happening, check the database connection.
      </p>
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
      {/* Fixed at exactly four card-shaped skeletons, matching the populated
          grid below — the card count never varies (UI-SPEC E1). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PairedMetricCardSkeleton metricLabel={alignmentMetricLabel("enrolled")} />
        <PairedMetricCardSkeleton metricLabel={alignmentMetricLabel("unenrolled")} />
        <PairedMetricCardSkeleton metricLabel={alignmentMetricLabel("live-cards")} />
        <PairedMetricCardSkeleton metricLabel={alignmentMetricLabel("volume")} />
      </div>
    </div>
  );
}

/** UTC-safe "d MMM yyyy" formatter, matching every other dashboard caption's
 * date format (e.g. `card-inventory-kpi-cards.tsx`'s `formatDay`). */
function formatAsOfDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * Renders one of the three flow-metric cards (Enrolled/Unenrolled/Volume,
 * all backed by `alignment_totals_for_period`) in its own independent
 * state — a single metric's error or period-emptiness never suppresses the
 * other cards in the grid (UI-SPEC E1/E2, Task 2 acceptance criterion: "no
 * single early return collapses all four cards on one metric's failure").
 */
function FlowMetricCard({
  metric,
  result,
}: {
  metric: FlowAlignmentMetric;
  result: AlignmentTotalsResult;
}) {
  const metricLabel = alignmentMetricLabel(metric);

  if (result.error !== null) {
    return <PairedMetricCardError metricLabel={metricLabel} />;
  }

  if (result.data.total_days === 0) {
    return <PairedMetricCardPeriodEmpty metricLabel={metricLabel} />;
  }

  return (
    <PairedMetricCard
      metricLabel={metricLabel}
      data={{
        tsysCount: result.data.tsys_count,
        bitAddictCount: result.data.bit_addict_count,
        status: result.data.status,
        tsysCoveredDays: result.data.tsys_covered_days,
        bitAddictCoveredDays: result.data.bit_addict_covered_days,
        totalDays: result.data.total_days,
      }}
      drillEntity={ALIGNMENT_METRIC_TO_DRILL_ENTITY[metric]}
    />
  );
}

/**
 * D-11: `/alignment`'s fifth `PairedMetricCard` instance, Revenue. This is a
 * render-time composition of the volume metric's already-resolved verdict
 * with the per-source revenue figures — NOT a sixth alignment metric with
 * its own RPC. `status`/`tsysCoveredDays`/`bitAddictCoveredDays`/`totalDays`
 * are copied verbatim from `volumeResult.data` (never recomputed from the
 * revenue figures, never given a tolerance of its own), so the coverage
 * statement is word-identical to the Transaction volume card's for the same
 * period and the card's own emptiness/error state tracks the volume metric's
 * — Revenue itself adds no independent emptiness/error signal (see the
 * whole-page period-empty comment below, which deliberately does not
 * reference this card).
 */
function AlignmentRevenueCard({
  volumeResult,
  revenueResult,
}: {
  volumeResult: AlignmentTotalsResult;
  revenueResult: PerSourceRevenueTotalsResult;
}) {
  const metricLabel = "Revenue";

  if (volumeResult.error !== null || revenueResult.error !== null) {
    return <PairedMetricCardError metricLabel={metricLabel} />;
  }

  if (volumeResult.data.total_days === 0) {
    return <PairedMetricCardPeriodEmpty metricLabel={metricLabel} />;
  }

  return (
    <PairedMetricCard
      metricLabel={metricLabel}
      data={{
        // `PerSourceRevenueTotals.tsys` widened to `number | null` (07-UAT
        // fix, absence-vs-zero for /revenue's TSYS block) — `PairedMetricCard`
        // still requires a plain `number`, and this card's own coverage
        // signal (badge/caption) already comes verbatim from `volumeResult`
        // (D-11), never independently from this figure, so `?? 0` here is a
        // type-safety coalesce that reproduces this card's pre-existing
        // behaviour exactly, not a new absence treatment — extending the
        // coverage-aware distinction to this card is out of scope for the
        // /revenue-only UAT gap this fix addresses.
        tsysCount: revenueResult.data.tsys ?? 0,
        bitAddictCount: revenueResult.data.bitAddict,
        status: volumeResult.data.status,
        tsysCoveredDays: volumeResult.data.tsys_covered_days,
        bitAddictCoveredDays: volumeResult.data.bit_addict_covered_days,
        totalDays: volumeResult.data.total_days,
      }}
      formatValue={formatCurrency}
      statusMeaningCaption="This status mirrors the Transaction volume status — a revenue difference can only come from a volume difference, since both sides price the same verified activity through the same tier ladder."
      footerCaption={<RevenueBasisCaption />}
      drillEntity={ALIGNMENT_METRIC_TO_DRILL_ENTITY.volume}
    />
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component mirroring `app/(dashboard)/cards/page.tsx`'s
 * period-scoped 4-state shape, completed to all four ROADMAP SC1 metrics
 * (Enrolled cards, Unenrolled cards, Live cards, Transaction volume) laid
 * out two-by-two on desktop, one per row below `sm` (D-18, UI-SPEC Visual
 * Hierarchy). The three flow metrics (enrolled/unenrolled/volume) reuse the
 * same `alignment_totals_for_period` RPC via `FlowMetricCard` above — no new
 * SQL; live cards is its own cumulative RPC (Task 1).
 *
 * `fetchAlignmentSettings()` is read BEFORE any metric fetch (D-15/D-16,
 * D-06/D-09) — the live tolerance and baseline offset flow into every
 * metric RPC call below, closing the gap 06-02's SUMMARY flagged
 * (`lib/dashboard/alignment.ts`/this page were not in that plan's
 * `files_modified`, so the settings it built were not yet consumed anywhere
 * until Plan 06-03).
 *
 * The domain-existence probe (unscoped, "has TSYS or Bit Addict alignment
 * data ever been ingested at all, across any of the four metrics") is
 * distinct from the period-scoped totals fetch, so domain-empty and
 * period-empty stay two separate states (UI-SPEC E1). Each of the four
 * fetches is independent — no single early return on one metric's error or
 * emptiness ever suppresses the other three (Task 2 acceptance criterion).
 */
async function AlignmentBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;

  // D-01/D-05: resolve the period BEFORE any query is built.
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);

  const { settings, error: settingsError } = await fetchAlignmentSettings(supabase);

  // Two-level alignment drill (D-19/ALIGN-04/ALIGN-07): the whitelisted
  // entity chooses which metric's Sheet is open; the presence of `date`
  // chooses level two. `asAlignmentDrillEntity` narrows a generic
  // `DrillFilter` to "one of ours" — a foreign drill (verification/
  // revenue-tier/sla-breach/recon-*) never reaches this page's fetchers.
  const drillFilter = parseDrillParams(params);
  const alignmentDrillEntity = drillFilter ? asAlignmentDrillEntity(drillFilter.drill) : null;
  const activeMetric = alignmentDrillEntity
    ? ALIGNMENT_DRILL_ENTITY_TO_METRIC[alignmentDrillEntity]
    : null;
  const activeMetricLabel = activeMetric ? alignmentMetricLabel(activeMetric) : "";
  const periodQueryString = new URLSearchParams(serializePeriodParams(period)).toString();
  const fullPageHref = activeMetric
    ? `/alignment/${activeMetric}?${periodQueryString}`
    : "/alignment";

  const EMPTY_DAY_BREAKDOWN: AlignmentDayBreakdownResult = {
    rows: [],
    hasMoreDays: false,
    error: null,
  };
  const EMPTY_CONTRIBUTING_ROWS: AlignmentContributingRowsResult = {
    tsysRows: [],
    bitAddictRows: [],
    error: null,
  };

  const [
    enrolledResult,
    unenrolledResult,
    volumeResult,
    liveCardsResult,
    revenueResult,
    tsysDomainProbe,
    bitAddictVerificationDomainProbe,
    bitAddictInventoryDomainProbe,
    freshnessResult,
    dayBreakdownResult,
    contributingRowsResult,
  ] = await Promise.all([
    fetchAlignmentTotals(supabase, "enrolled", period, settings.toleranceCount),
    fetchAlignmentTotals(supabase, "unenrolled", period, settings.toleranceCount),
    fetchAlignmentTotals(supabase, "volume", period, settings.toleranceCount),
    fetchAlignmentLiveCards(supabase, period, settings.baselineOffset, settings.toleranceCount),
    // D-11: Revenue is a render-time composition of the volume verdict with
    // its own per-source figures, not a fifth `alignment_totals_for_period`
    // metric — `fetchPerSourceRevenueTotals` is the same fetcher plan 07-01
    // shipped for /revenue, called here with the alignment page's own
    // period.
    fetchPerSourceRevenueTotals(supabase, period),
    supabase
      .from("apigee_calls")
      .select("event_time", { count: "exact", head: true })
      .not("endpoint_category", "is", null)
      .limit(1),
    supabase
      .from("verifications")
      .select("created_at", { count: "exact", head: true })
      .limit(1),
    supabase
      .from("card_inventory")
      .select("report_date", { count: "exact", head: true })
      .limit(1),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    activeMetric
      ? fetchAlignmentDayBreakdown(
          supabase,
          activeMetric,
          period,
          settings.toleranceCount,
          settings.baselineOffset,
        )
      : Promise.resolve(EMPTY_DAY_BREAKDOWN),
    activeMetric && drillFilter?.date
      ? fetchAlignmentContributingRows(supabase, activeMetric, drillFilter.date)
      : Promise.resolve(EMPTY_CONTRIBUTING_ROWS),
  ]);

  // Mounted in EVERY branch below (error/empty/period-empty/populated) so a
  // deep-linked drill URL never finds the Sheet missing — D-19's "never
  // closed and reopened" binding applies regardless of which top-level page
  // state is showing.
  const drillSheet = (
    <AlignmentDrillSheet
      filter={drillFilter}
      metric={activeMetric}
      metricLabel={activeMetricLabel}
      periodLabel={period.label}
      dayBreakdown={dayBreakdownResult}
      contributingRows={contributingRowsResult}
      fullPageHref={fullPageHref}
    />
  );

  if (
    tsysDomainProbe.error ||
    bitAddictVerificationDomainProbe.error ||
    bitAddictInventoryDomainProbe.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
        {drillSheet}
      </>
    );
  }

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  const hasAlignmentDataEver =
    (tsysDomainProbe.count ?? 0) > 0 ||
    (bitAddictVerificationDomainProbe.count ?? 0) > 0 ||
    (bitAddictInventoryDomainProbe.count ?? 0) > 0;

  if (!hasAlignmentDataEver) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <EmptyState />
        {drillSheet}
      </>
    );
  }

  // Whole-page period-empty only when EVERY metric has no comparison data
  // for the active period — live cards is a stock metric (L-02) so its own
  // "nothing to show" signal is a null carried-forward snapshot day, not a
  // day count. Each card still renders its OWN period-empty/error treatment
  // below (UI-SPEC E1/E2, via FlowMetricCard for the three flow metrics);
  // this whole-page check only covers the case where all four are empty at
  // once, matching /cards' and /reconciliation's precedent for the
  // domain-empty-vs-period-empty split. Revenue (the fifth card) is
  // deliberately NOT a fifth term here — it is derived entirely from the
  // volume metric's verdict (D-11) and adds no independent emptiness
  // signal, so this four-way AND stays exactly as it was before this card
  // existed; do not "complete" it to a five-way AND.
  const enrolledEmpty = enrolledResult.error === null && enrolledResult.data.total_days === 0;
  const unenrolledEmpty =
    unenrolledResult.error === null && unenrolledResult.data.total_days === 0;
  const volumeEmpty = volumeResult.error === null && volumeResult.data.total_days === 0;
  const liveCardsEmpty =
    liveCardsResult.error === null && liveCardsResult.data.bit_addict_snapshot_day === null;

  if (enrolledEmpty && unenrolledEmpty && volumeEmpty && liveCardsEmpty) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <PeriodEmptyState viewNoun="alignment data" period={period} />
        {drillSheet}
      </>
    );
  }

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      {/* WR-03: a settings-read failure is never silent — every card below
          is computed from DEFAULT_ALIGNMENT_SETTINGS when this is shown, so
          the notice sits above the grid rather than replacing it (E1). */}
      {settingsError !== null && <SettingsFallbackNotice />}
      {/* Four ROADMAP SC1 paired KPI cards plus a fifth, Revenue (07-03,
          D-11) — grid-cols-1 sm:grid-cols-2 (D-18, UI-SPEC E1); five cards
          resolves to a lone trailing card on the final row at sm and above,
          expected and matching how this grid already behaves for any odd
          card count — not a defect to fix by forcing a three-column
          layout. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FlowMetricCard metric="enrolled" result={enrolledResult} />
        <FlowMetricCard metric="unenrolled" result={unenrolledResult} />
        {liveCardsResult.error !== null ? (
          <PairedMetricCardError metricLabel={alignmentMetricLabel("live-cards")} />
        ) : liveCardsResult.data.bit_addict_snapshot_day === null ? (
          <PairedMetricCardPeriodEmpty metricLabel={alignmentMetricLabel("live-cards")} />
        ) : (
          <PairedMetricCard
            metricLabel={alignmentMetricLabel("live-cards")}
            data={{
              tsysCount: Math.round(liveCardsResult.data.tsys_live_cards),
              bitAddictCount: liveCardsResult.data.bit_addict_live_cards,
              status: liveCardsResult.data.status,
              // CR-02: the TSYS-only running coverage guard
              // (tsys_coverage_complete) and the Bit Addict snapshot
              // presence are two independent signals. The RPC's combined
              // coverage_complete is the AND of both and can never serve as
              // either side's own figure — using it for tsysCoveredDays
              // would report TSYS as uncovered whenever Bit Addict is the
              // side actually missing data. computeLiveCardsCoverageFigures
              // expresses the whole-window boolean pair as a 1-of-1/0-of-1
              // day count so the shared coverage-statement formatter still
              // renders the D-12 "incomplete coverage" clause correctly.
              ...computeLiveCardsCoverageFigures(
                liveCardsResult.data.tsys_coverage_complete,
                liveCardsResult.data.bit_addict_snapshot_day,
              ),
            }}
            tsysCaption={formatLiveCardsDerivationCaption(
              settings.baselineOffset,
              settings.baselineAsOf,
            )}
            statusMeaningCaption={formatLiveCardsStatusMeaningCaption()}
            bitAddictAsOfCaption={
              liveCardsResult.data.bit_addict_snapshot_day
                ? `As of ${formatAsOfDay(liveCardsResult.data.bit_addict_snapshot_day)}.`
                : undefined
            }
            drillEntity={ALIGNMENT_METRIC_TO_DRILL_ENTITY["live-cards"]}
          />
        )}
        <FlowMetricCard metric="volume" result={volumeResult} />
        <AlignmentRevenueCard volumeResult={volumeResult} revenueResult={revenueResult} />
      </div>
      {drillSheet}
    </>
  );
}

export default function AlignmentPage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <AlignmentBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
