import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AlignmentDayBreakdownTable } from "@/components/dashboard/alignment-drill-columns";
import { SettingsFallbackNotice } from "@/components/dashboard/settings-fallback-notice";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import {
  ALIGNMENT_METRICS,
  alignmentMetricLabel,
  type AlignmentMetric,
} from "@/lib/dashboard/alignment";
import { fetchAlignmentDayBreakdownUncapped } from "@/lib/dashboard/alignment-drill";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  serializePeriodParams,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";
import { fetchAlignmentSettings } from "@/lib/settings/alignment-settings";

/**
 * The uncapped full-page day-breakdown route (UI-SPEC Planner Consequence
 * 1, ALIGN-07) the capped level-1 drill Sheet links out to for a period
 * longer than `ALIGNMENT_DRILL_DAY_CAP`. Mirrors `app/(dashboard)/cards/
 * page.tsx`'s period-scoped 4-state Server Component shape exactly: a
 * skeleton, a domain-empty state, a period-empty state, an error state, and
 * a populated table with no cap and no Sheet — a normal page. The `metric`
 * segment is untrusted input (T-06-26) and is validated against the same
 * closed four-value list `ALIGNMENT_METRICS` before any query is built;
 * anything else renders the standard Next.js not-found response.
 */

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type IngestedFileFreshness = { uploaded_at: string };

function isAlignmentMetric(value: string): value is AlignmentMetric {
  return (ALIGNMENT_METRICS as readonly string[]).includes(value);
}

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
  metricLabel,
  uploadedAt,
  period,
  monthOptions,
  yearOptions,
  backHref,
}: {
  metricLabel: string;
  uploadedAt: string | null;
  period: ResolvedPeriod | null;
  monthOptions: PeriodOption[];
  yearOptions: PeriodOption[];
  backHref: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">
            {metricLabel}
            {period ? ` — ${period.label}` : ""}
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
      <p className="text-sm font-light text-muted-foreground">{DATA_WINDOW_CAPTION}</p>
      <Link href={backHref} className="w-fit text-sm text-primary underline underline-offset-4">
        ← Back to Alignment
      </Link>
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

function ErrorState({ metricLabel }: { metricLabel: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        {metricLabel} day breakdown could not be loaded
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
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-6 w-56" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

type PageParams = Promise<{ metric: string }>;
type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

async function AlignmentMetricBody({
  metric,
  searchParams,
}: {
  metric: AlignmentMetric;
  searchParams: PageSearchParams;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const metricLabel = alignmentMetricLabel(metric);

  // D-01/D-05: resolve the period BEFORE any query is built, exactly like
  // every other scoped page — the link from the Sheet arrives with this
  // same period contract applied.
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);
  const backHref = `/alignment?${new URLSearchParams(serializePeriodParams(period)).toString()}`;

  const { settings, error: settingsError } = await fetchAlignmentSettings(supabase);

  const [
    dayBreakdownResult,
    tsysDomainProbe,
    bitAddictVerificationDomainProbe,
    bitAddictInventoryDomainProbe,
    freshnessResult,
  ] = await Promise.all([
    fetchAlignmentDayBreakdownUncapped(
      supabase,
      metric,
      period,
      settings.toleranceCount,
      settings.baselineOffset,
    ),
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
  ]);

  if (
    tsysDomainProbe.error ||
    bitAddictVerificationDomainProbe.error ||
    bitAddictInventoryDomainProbe.error ||
    freshnessResult.error ||
    dayBreakdownResult.error !== null
  ) {
    return (
      <>
        <PageHeader
          metricLabel={metricLabel}
          uploadedAt={null}
          period={null}
          monthOptions={[]}
          yearOptions={[]}
          backHref={backHref}
        />
        <ErrorState metricLabel={metricLabel} />
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
          metricLabel={metricLabel}
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
          backHref={backHref}
        />
        <EmptyState />
      </>
    );
  }

  if (dayBreakdownResult.rows.length === 0) {
    return (
      <>
        <PageHeader
          metricLabel={metricLabel}
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
          backHref={backHref}
        />
        <PeriodEmptyState viewNoun={`${metricLabel.toLowerCase()} data`} period={period} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        metricLabel={metricLabel}
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
        backHref={backHref}
      />
      {settingsError !== null && <SettingsFallbackNotice />}
      <AlignmentDayBreakdownTable rows={dayBreakdownResult.rows} />
    </>
  );
}

export async function generateMetadata({ params }: { params: PageParams }): Promise<Metadata> {
  const { metric } = await params;
  if (!isAlignmentMetric(metric)) {
    return { title: "Alignment — Safecypher Reporting" };
  }
  return { title: `${alignmentMetricLabel(metric)} — Safecypher Reporting` };
}

export default async function AlignmentMetricPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: PageSearchParams;
}) {
  const { metric: metricParam } = await params;

  // T-06-26 (binding): the path segment is attacker-controlled and must be
  // validated against the same closed list before any query is issued —
  // never reach a query builder with an unvalidated segment.
  if (!isAlignmentMetric(metricParam)) {
    notFound();
  }
  const metric = metricParam;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <AlignmentMetricBody metric={metric} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
