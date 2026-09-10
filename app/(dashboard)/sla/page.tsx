import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import {
  SlaBreachDrillSheet,
  type SlaBreachDrillRow,
} from "@/components/dashboard/sla-breach-drill-sheet";
import { SlaBreachTable, type SlaBreachRow } from "@/components/dashboard/sla-breach-table";
import { SlaViewControls } from "@/components/dashboard/sla-view-controls";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { SlaDailyRow } from "@/lib/dashboard/sla-bucketing";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";

export const metadata: Metadata = {
  title: "SLA — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type SlaDailyViewRow = {
  day_utc: string | null;
  avg_duration_ms: number | null;
  breach_count: number | null;
};

type SlaBreachViewRow = {
  created_at: string | null;
  external_card_reference: string | null;
  duration_ms: number | null;
};

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
          <h1 className="text-2xl font-medium text-foreground">SLA</h1>
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
        <use href="/icons.svg#signal" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">No SLA data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the daily verification report to see response time against the
        750ms SLA.{" "}
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
        SLA data could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading verification durations — try refreshing
        the page.
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
      <Skeleton className="h-28 w-full sm:w-1/3" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/**
 * Good-news micro-state (03-UI-SPEC.md): populated overall but zero
 * breaches in the current data window reads as good news, not an error or
 * a top-level empty state — rendered inline where the breach table would go.
 */
function NoBreachesGoodNews() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">
        Breaching verifications
      </h2>
      <div className="rounded-lg border border-border p-6 text-center">
        <p className="text-sm font-light text-muted-foreground">
          No SLA breaches in this period.
        </p>
      </div>
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Server-fetches the individual breaching rows for a specific day (DASH-03/
 * D-11's "sla-breach" entity). Whitelisted + parameterised: the date is
 * turned into a `.gte()`/`.lt()` UTC-day range, never string-interpolated
 * into the query (T-03-19). `v_sla_breaches` is `security_invoker = on`, so
 * the session-scoped client keeps RLS in effect (T-03-20).
 */
async function fetchSlaBreachDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  date: string | undefined,
  range?: { start: string; end: string | null },
): Promise<SlaBreachDrillRow[]> {
  if (!date) return [];

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("v_sla_breaches")
    .select("created_at, external_card_reference, duration_ms")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd);

  if (range) {
    query = query.gte("created_at", `${range.start}T00:00:00Z`);
    if (range.end) {
      query = query.lt("created_at", `${range.end}T00:00:00Z`);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<SlaBreachViewRow[]>();

  if (error) return [];

  return (data ?? []).filter(
    (row): row is SlaBreachDrillRow =>
      row.created_at !== null && row.external_card_reference !== null,
  );
}

/**
 * Async Server Component reading `v_sla_daily` + `v_sla_breaches` (SLA-01)
 * and the "as of last import" freshness timestamp via the session-scoped
 * server client so RLS applies. Suspended by the page below to drive the
 * loading state; renders empty/populated/error itself.
 *
 * Also reads the Next 16 `searchParams` prop (a Promise — must be awaited)
 * for the drill-down Sheet (DASH-03): `parseDrillParams` whitelists the
 * entity/keys before any query is built.
 */
async function SlaBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isSlaBreachDrill = drillFilter?.drill === "sla-breach";

  // D-01/D-05: resolve the period BEFORE any query is built — `now` is
  // captured once here from the runtime clock and passed in, so
  // `resolvePeriod` itself stays pure (no wall-clock access inside it).
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);
  const periodEndInstant = period.end !== null ? `${period.end}T00:00:00Z` : null;

  // RESEARCH Pattern 1: outer .gte()/.lt() predicates on the unchanged
  // v_sla_daily / v_sla_breaches views — never a rewrite of either view.
  // v_sla_breaches' created_at is timestamptz, so the resolved date bounds
  // are converted to UTC instants before filtering.
  let dailyQuery = supabase
    .from("v_sla_daily")
    .select("day_utc, avg_duration_ms, breach_count")
    .gte("day_utc", period.start);
  if (period.end !== null) {
    dailyQuery = dailyQuery.lt("day_utc", period.end);
  }

  let breachQuery = supabase
    .from("v_sla_breaches")
    .select("created_at, external_card_reference, duration_ms")
    .gte("created_at", `${period.start}T00:00:00Z`);
  if (periodEndInstant !== null) {
    breachQuery = breachQuery.lt("created_at", periodEndInstant);
  }

  const [dailyResult, breachResult, domainActivityResult, freshnessResult, drillRows] =
    await Promise.all([
      dailyQuery.order("day_utc", { ascending: true }).returns<SlaDailyViewRow[]>(),
      breachQuery.order("created_at", { ascending: false }).returns<SlaBreachViewRow[]>(),
      // UNSCOPED existence probe (never a period predicate) — distinguishes
      // "no SLA data at all" (EmptyState) from "SLA data exists, this
      // period has none" (PeriodEmptyState).
      supabase
        .from("v_sla_daily")
        .select("day_utc", { count: "exact", head: true })
        .limit(1)
        .returns<SlaDailyViewRow[]>(),
      supabase
        .from("ingested_files")
        .select("uploaded_at")
        .eq("status", "done")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .returns<IngestedFileFreshness[]>()
        .maybeSingle(),
      isSlaBreachDrill
        ? fetchSlaBreachDrillRows(supabase, drillFilter.date, {
            start: period.start,
            end: period.end,
          })
        : Promise.resolve<SlaBreachDrillRow[]>([]),
    ]);

  // Query error renders ErrorState, never a silent zero (4-state contract).
  if (
    dailyResult.error ||
    breachResult.error ||
    domainActivityResult.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} period={null} monthOptions={[]} yearOptions={[]} />
        <ErrorState />
      </>
    );
  }

  const dailyRows: SlaDailyRow[] = (dailyResult.data ?? [])
    .filter((row): row is SlaDailyViewRow & { day_utc: string } => row.day_utc !== null)
    .map((row) => ({
      day_utc: row.day_utc,
      avg_duration_ms: row.avg_duration_ms ?? 0,
      breach_count: row.breach_count ?? 0,
    }));

  const breachRows: SlaBreachRow[] = (breachResult.data ?? [])
    .filter(
      (row): row is SlaBreachViewRow & { created_at: string; external_card_reference: string } =>
        row.created_at !== null && row.external_card_reference !== null,
    )
    .map((row) => ({
      created_at: row.created_at,
      external_card_reference: row.external_card_reference,
      duration_ms: row.duration_ms ?? 0,
    }));

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;
  const hasSlaData = (domainActivityResult.count ?? 0) > 0;

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      {!hasSlaData ? (
        <EmptyState />
      ) : dailyRows.length === 0 ? (
        <PeriodEmptyState viewNoun="SLA data" period={period} />
      ) : (
        <>
          <SlaViewControls dailyRows={dailyRows} />
          {breachRows.length === 0 ? (
            <NoBreachesGoodNews />
          ) : (
            <SlaBreachTable rows={breachRows} />
          )}
        </>
      )}
      <SlaBreachDrillSheet
        filter={isSlaBreachDrill ? drillFilter : null}
        rows={drillRows}
        title={`Breaching verifications — ${drillFilter?.date ?? ""}`}
      />
    </>
  );
}

export default function SlaPage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <SlaBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
