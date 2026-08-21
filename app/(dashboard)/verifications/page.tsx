import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { DrillSheet } from "@/components/dashboard/drill-sheet";
import { verificationDrillColumns } from "@/components/dashboard/verification-drill-columns";
import { ViewControls } from "@/components/dashboard/view-controls";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { DailyRow } from "@/lib/dashboard/bucketing";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
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

function PageHeader({ uploadedAt }: { uploadedAt: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">
            Verifications
          </h1>
        </div>
        <FreshnessBadge uploadedAt={uploadedAt} />
      </div>
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

  const [dailyResult, freshnessResult, drillResult] = await Promise.all([
    supabase
      .from("v_verifications_daily")
      .select("day_utc, authenticated_count, failed_count")
      .order("day_utc", { ascending: true })
      .returns<DailyViewRow[]>(),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    isVerificationDrill
      ? fetchVerificationDrillRows(supabase, drillFilter.authenticated)
      : Promise.resolve<VerificationDrillFetchResult>({ rows: [], totalCount: null }),
  ]);

  // IN-03: surface a freshness-query failure as an error state rather than
  // silently folding it into "no imports yet" (which is indistinguishable from
  // a legitimately empty table and hides a real DB fault).
  if (dailyResult.error || freshnessResult.error) {
    return (
      <>
        <PageHeader uploadedAt={null} />
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

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
      {rows.length === 0 ? <EmptyState /> : <ViewControls dailyRows={rows} />}
      <DrillSheet
        filter={isVerificationDrill ? drillFilter : null}
        rows={drillResult.rows}
        columns={verificationDrillColumns}
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
