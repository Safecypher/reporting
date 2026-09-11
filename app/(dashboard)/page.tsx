import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { AlignmentStrip, AlignmentStripSkeleton } from "@/components/dashboard/alignment-strip";
import {
  HomeKpiTileSkeleton,
  LiveCardsTile,
  RevenueThisPeriodTile,
  VolumeThisPeriodTile,
} from "@/components/dashboard/home-kpi-tiles";
import { TileErrorBoundary } from "@/components/dashboard/tile-error-boundary";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { fetchCardInventoryRowsUpTo, latestSnapshot } from "@/lib/dashboard/card-inventory";
import {
  alignmentMetricLabel,
  fetchAlignmentLiveCards,
  fetchAlignmentTotals,
} from "@/lib/dashboard/alignment";
import type { AlignmentMetricStatus } from "@/lib/dashboard/alignment-rollup";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";
import { fetchAlignmentSettings } from "@/lib/settings/alignment-settings";

/**
 * The real dashboard home (D-04/D-05, ALIGN-05, ROADMAP SC5) — replaces the
 * former redirect to /verifications. Carries the alignment status strip
 * (leadership's first question: "are we OK today?") and three headline KPI
 * tiles (live cards, volume this period, revenue this period), each linking
 * to its canonical page. The strip and each of the three tiles is wrapped in
 * its OWN `TileErrorBoundary` — four independent regions, so a failed read in
 * one never blanks the others (UI-SPEC Planner consequence 2, T-06-34).
 * `app/(dashboard)/error.tsx` (unchanged) remains the outer safety net for a
 * total page failure this boundary does not catch.
 */
export const metadata: Metadata = {
  title: "Overview — Safecypher Reporting",
};

type IngestedFileFreshness = { uploaded_at: string };
type VerificationsDailyRow = {
  day_utc: string | null;
  authenticated_count: number | null;
  failed_count: number | null;
};

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
          <h1 className="text-2xl font-medium text-foreground">Overview</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {period && <ScopeBadge period={period} />}
          <FreshnessBadge uploadedAt={uploadedAt} />
        </div>
      </div>
      {period && (
        <PeriodControls period={period} monthOptions={monthOptions} yearOptions={yearOptions} />
      )}
    </div>
  );
}

/** Domain-empty: nothing has EVER been ingested, across any of the six
 * report types (UI-SPEC Copywriting Contract "Home empty state"). */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground">
        <use href="/icons.svg#eye" />
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

/** Whole-page infrastructure failure (the freshness read itself failed) —
 * a genuinely different case from any single region's own scoped error,
 * which each of the four `TileErrorBoundary`-wrapped regions handles on its
 * own (UI-SPEC Copywriting Contract "Home error state"). */
function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">The dashboard could not be loaded</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading alignment, card, verification, or revenue data — try
        refreshing the page.
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
      <AlignmentStripSkeleton />
      <Separator />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HomeKpiTileSkeleton label="Live cards" />
        <HomeKpiTileSkeleton label="Volume this period" />
        <HomeKpiTileSkeleton label="Revenue this period" />
      </div>
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component. Reads `fetchAlignmentSettings()` before any metric
 * fetch (mirroring `/alignment`'s own convention) so the live tolerance and
 * baseline offset flow into every alignment RPC call below. The three
 * headline KPI tiles read the SAME sources their canonical pages read
 * (D-05) — `fetchCardInventoryRowsUpTo` (unscoped, `/cards`),
 * `v_verifications_daily` (`/verifications`), and `revenue_total_for_period`
 * (`/revenue`) — never re-derived.
 *
 * The whole-page domain-empty check reuses the same "at least one completed
 * import" freshness fact every other page already reads (Claude's
 * Discretion, 06-CONTEXT.md) rather than re-deriving a per-table OR probe:
 * if no ingestion has ever completed, no table has data, by construction.
 */
async function HomeBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;

  // D-01/D-05: resolve the period BEFORE any query is built.
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);

  const settings = await fetchAlignmentSettings(supabase);

  let verificationsQuery = supabase
    .from("v_verifications_daily")
    .select("day_utc, authenticated_count, failed_count")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    verificationsQuery = verificationsQuery.lt("day_utc", period.end);
  }

  const [
    alignEnrolledResult,
    alignUnenrolledResult,
    alignVolumeResult,
    alignLiveCardsResult,
    cardInventoryResult,
    verificationsResult,
    revenueTotalResult,
    freshnessResult,
  ] = await Promise.all([
    fetchAlignmentTotals(supabase, "enrolled", period, settings.toleranceCount),
    fetchAlignmentTotals(supabase, "unenrolled", period, settings.toleranceCount),
    fetchAlignmentTotals(supabase, "volume", period, settings.toleranceCount),
    fetchAlignmentLiveCards(supabase, period, settings.baselineOffset, settings.toleranceCount),
    // Live-cards tile (D-05/L-02): unscoped by period — no end bound, so the
    // figure is always the latest-ever snapshot, reading the exact same
    // source `/cards` reads, never re-derived.
    fetchCardInventoryRowsUpTo(supabase, null),
    verificationsQuery.returns<VerificationsDailyRow[]>(),
    supabase.rpc("revenue_total_for_period", { p_start: period.start, p_end: period.end }),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
  ]);

  if (freshnessResult.error) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
      </>
    );
  }

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  if (uploadedAt === null) {
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

  const alignmentMetrics: AlignmentMetricStatus[] = [
    {
      metric: alignmentMetricLabel("enrolled"),
      status: alignEnrolledResult.error !== null ? null : alignEnrolledResult.data.status,
    },
    {
      metric: alignmentMetricLabel("unenrolled"),
      status: alignUnenrolledResult.error !== null ? null : alignUnenrolledResult.data.status,
    },
    {
      metric: alignmentMetricLabel("live-cards"),
      status: alignLiveCardsResult.error !== null ? null : alignLiveCardsResult.data.status,
    },
    {
      metric: alignmentMetricLabel("volume"),
      status: alignVolumeResult.error !== null ? null : alignVolumeResult.data.status,
    },
  ];

  const latestCardSnapshot = cardInventoryResult.error
    ? null
    : latestSnapshot(cardInventoryResult.rows);
  const liveCardsCount = latestCardSnapshot?.references.length ?? 0;

  const verificationRows = verificationsResult.error ? [] : (verificationsResult.data ?? []);
  const hasVerificationActivity = !verificationsResult.error && verificationRows.length > 0;
  const volumeCount = verificationRows.reduce(
    (sum, row) => sum + (row.authenticated_count ?? 0) + (row.failed_count ?? 0),
    0,
  );
  const revenueTotal = revenueTotalResult.error ? 0 : Number(revenueTotalResult.data ?? "0");

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      <TileErrorBoundary label="Alignment status">
        <AlignmentStrip metrics={alignmentMetrics} periodLabel={period.label} />
      </TileErrorBoundary>
      <Separator />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TileErrorBoundary label="Live cards">
          <LiveCardsTile
            count={liveCardsCount}
            hasData={latestCardSnapshot !== null}
            error={cardInventoryResult.error}
          />
        </TileErrorBoundary>
        <TileErrorBoundary label="Volume this period">
          <VolumeThisPeriodTile
            count={volumeCount}
            hasData={hasVerificationActivity}
            error={verificationsResult.error !== null}
          />
        </TileErrorBoundary>
        <TileErrorBoundary label="Revenue this period">
          <RevenueThisPeriodTile
            total={revenueTotal}
            hasData={hasVerificationActivity}
            error={revenueTotalResult.error !== null}
          />
        </TileErrorBoundary>
      </div>
    </>
  );
}

export default function HomePage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <HomeBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
