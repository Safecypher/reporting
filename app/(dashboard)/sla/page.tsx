import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import {
  SlaBreachDrillSheet,
  type SlaBreachDrillRow,
} from "@/components/dashboard/sla-breach-drill-sheet";
import { SlaBreachTable, type SlaBreachRow } from "@/components/dashboard/sla-breach-table";
import { SlaViewControls } from "@/components/dashboard/sla-view-controls";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { SlaDailyRow } from "@/lib/dashboard/sla-bucketing";
import { parseDrillParams } from "@/lib/dashboard/drill-params";

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

function PageHeader({ uploadedAt }: { uploadedAt: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">SLA</h1>
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
): Promise<SlaBreachDrillRow[]> {
  if (!date) return [];

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("v_sla_breaches")
    .select("created_at, external_card_reference, duration_ms")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd)
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

  const [dailyResult, breachResult, freshnessResult, drillRows] = await Promise.all([
    supabase
      .from("v_sla_daily")
      .select("day_utc, avg_duration_ms, breach_count")
      .order("day_utc", { ascending: true })
      .returns<SlaDailyViewRow[]>(),
    supabase
      .from("v_sla_breaches")
      .select("created_at, external_card_reference, duration_ms")
      .order("created_at", { ascending: false })
      .returns<SlaBreachViewRow[]>(),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    isSlaBreachDrill
      ? fetchSlaBreachDrillRows(supabase, drillFilter.date)
      : Promise.resolve<SlaBreachDrillRow[]>([]),
  ]);

  // Query error renders ErrorState, never a silent zero (4-state contract).
  if (dailyResult.error || breachResult.error || freshnessResult.error) {
    return (
      <>
        <PageHeader uploadedAt={null} />
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

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
      {dailyRows.length === 0 ? (
        <EmptyState />
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
