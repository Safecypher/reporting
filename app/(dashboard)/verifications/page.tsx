import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { VerificationDrillSheet } from "@/components/dashboard/verification-drill-sheet";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { ViewControls } from "@/components/dashboard/view-controls";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { DailyRow } from "@/lib/dashboard/bucketing";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";
import {
  fetchVerificationDrillRows,
  type VerificationDrillFetchResult,
} from "@/lib/dashboard/verification-drill";

export const metadata: Metadata = {
  title: "Verifications — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type DailyViewRow = {
  day_utc: string | null;
  authenticated_count: number | null;
  failed_count: number | null;
};

type IngestedFileFreshness = { uploaded_at: string };

function verificationDrillTitle(authenticated: boolean | undefined): string {
  if (authenticated === true) return "Verifications — Authenticated";
  if (authenticated === false) return "Verifications — Failed";
  return "Verifications — All";
}

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
          <h1 className="text-2xl font-medium text-foreground">
            Verifications
          </h1>
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
      <h2 className="text-lg font-medium text-foreground">
        No verifications yet
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the daily verification report to see authenticated vs failed
        volume over time.{" "}
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

function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Verifications could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading verification data. Try refreshing the
        page — if it keeps happening, check the database connection.
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
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-72" />
      </div>
      <Skeleton className="h-[320px] w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component reading `v_verifications_daily` (DASH-01) and the
 * "as of last import" freshness timestamp (DASH-04: max(uploaded_at) from
 * ingested_files where status='done') via the session-scoped server client
 * so RLS applies (T-06-01). Suspended by the page below to drive the
 * loading state; renders empty/populated/error itself.
 *
 * Also reads the Next 16 `searchParams` prop (a Promise — must be awaited)
 * for the drill-down Sheet (DASH-03): `parseDrillParams` whitelists the
 * entity/keys before any query is built.
 */
async function VerificationsBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isVerificationDrill = drillFilter?.drill === "verification";

  // D-01/D-05: resolve the period BEFORE any query is built — `now` is
  // captured once here from the runtime clock and passed in, so
  // `resolvePeriod` itself stays pure (no wall-clock access inside it).
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);

  // RESEARCH Pattern 1: an outer .gte()/.lt() predicate on the unchanged
  // v_verifications_daily view — never a rewrite of the view itself. `.lt`
  // is applied only when the period has a defined end ("all" leaves it
  // open-ended, per D-01's ResolvedPeriod contract).
  let dailyQuery = supabase
    .from("v_verifications_daily")
    .select("day_utc, authenticated_count, failed_count")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    dailyQuery = dailyQuery.lt("day_utc", period.end);
  }

  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);

  const [dailyResult, sourceHasAnyRowsResult, freshnessResult, drillResult] = await Promise.all([
    dailyQuery.order("day_utc", { ascending: true }).returns<DailyViewRow[]>(),
    // Distinguishes the domain empty state ("no verifications, ever") from
    // the period-empty state ("verifications exist, this period has none")
    // — an UNSCOPED existence check, so a narrow period can never make an
    // otherwise-populated view look like it has no data at all.
    supabase
      .from("v_verifications_daily")
      .select("day_utc")
      .limit(1)
      .returns<{ day_utc: string | null }[]>(),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    isVerificationDrill
      ? fetchVerificationDrillRows(supabase, drillFilter.authenticated, {
          start: period.start,
          end: period.end,
        })
      : Promise.resolve<VerificationDrillFetchResult>({ rows: [], totalCount: null }),
  ]);

  // IN-03: surface a freshness-query failure as an error state rather than
  // silently folding it into "no imports yet" (which is indistinguishable from
  // a legitimately empty table and hides a real DB fault).
  if (dailyResult.error || sourceHasAnyRowsResult.error || freshnessResult.error) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
      </>
    );
  }

  const rows: DailyRow[] = (dailyResult.data ?? [])
    .filter((row): row is DailyViewRow & { day_utc: string } => row.day_utc !== null)
    .map((row) => ({
      day_utc: row.day_utc,
      authenticated_count: row.authenticated_count ?? 0,
      failed_count: row.failed_count ?? 0,
    }));

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;
  const sourceHasAnyRows = (sourceHasAnyRowsResult.data ?? []).length > 0;

  const dataRegion = !sourceHasAnyRows ? (
    <EmptyState />
  ) : rows.length === 0 ? (
    <PeriodEmptyState viewNoun="verifications" period={period} />
  ) : (
    <ViewControls dailyRows={rows} />
  );

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      {dataRegion}
      <VerificationDrillSheet
        filter={isVerificationDrill ? drillFilter : null}
        rows={drillResult.rows}
        title={verificationDrillTitle(drillFilter?.authenticated)}
        totalCount={drillResult.totalCount}
      />
    </>
  );
}

export default function VerificationsPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <VerificationsBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
