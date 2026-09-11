import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import {
  PairedMetricCard,
  PairedMetricCardSkeleton,
} from "@/components/dashboard/alignment-kpi-cards";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { alignmentMetricLabel, fetchAlignmentTotals } from "@/lib/dashboard/alignment";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";

export const metadata: Metadata = {
  title: "Alignment — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

/**
 * Tolerance is a stored `app_settings.alignment_tolerance` value once Plan
 * 06-02 lands (D-15/D-16); until then this page passes the documented
 * default, matching `lib/settings/fy-settings.ts`'s "migration not yet
 * pushed -> fall back to the default" convention.
 */
const DEFAULT_TOLERANCE = 0;

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PairedMetricCardSkeleton metricLabel="Transaction volume" />
      </div>
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component mirroring `app/(dashboard)/cards/page.tsx`'s
 * period-scoped 4-state shape. Only the Transaction volume card is wired
 * this task (Task 1's tracer scope) — Plan 06-03 adds the remaining three
 * cards to the same grid.
 *
 * The domain-existence probe (unscoped, "has TSYS or Bit Addict volume data
 * ever been ingested") is distinct from the period-scoped totals fetch, so
 * domain-empty and period-empty stay two separate states (UI-SPEC E1).
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

  const [totalsResult, tsysDomainProbe, bitAddictDomainProbe, freshnessResult] =
    await Promise.all([
      fetchAlignmentTotals(supabase, "volume", period, DEFAULT_TOLERANCE),
      supabase
        .from("apigee_calls")
        .select("event_time", { count: "exact", head: true })
        .eq("endpoint_category", "verify")
        .limit(1),
      supabase
        .from("verifications")
        .select("created_at", { count: "exact", head: true })
        .limit(1),
      supabase
        .from("ingested_files")
        .select("uploaded_at")
        .eq("status", "done")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .returns<IngestedFileFreshness[]>()
        .maybeSingle(),
    ]);

  if (
    totalsResult.error !== null ||
    tsysDomainProbe.error ||
    bitAddictDomainProbe.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
      </>
    );
  }

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  const hasAlignmentDataEver =
    (tsysDomainProbe.count ?? 0) > 0 || (bitAddictDomainProbe.count ?? 0) > 0;

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
      </>
    );
  }

  const totals = totalsResult.data;

  if (totals.total_days === 0) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <PeriodEmptyState viewNoun="alignment data" period={period} />
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PairedMetricCard
          metricLabel={alignmentMetricLabel("volume")}
          data={{
            tsysCount: totals.tsys_count,
            bitAddictCount: totals.bit_addict_count,
            status: totals.status,
            tsysCoveredDays: totals.tsys_covered_days,
            bitAddictCoveredDays: totals.bit_addict_covered_days,
            totalDays: totals.total_days,
          }}
        />
      </div>
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
