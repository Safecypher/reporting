import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { ReconciliationDrillSheet } from "@/components/dashboard/reconciliation-drill-sheet";
import {
  ReconciliationBillingTable,
  type ReconciliationBillingDailyRow,
} from "@/components/dashboard/reconciliation-billing-table";
import {
  ReconciliationInventoryTable,
  type ReconciliationInventoryDailyRow,
  type ReconciliationInventoryGapRow,
  type ApigeeCrossCheckRow,
} from "@/components/dashboard/reconciliation-inventory-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import {
  fetchReconciliationBillingDrillRows,
  fetchReconciliationInventoryDrillRows,
} from "@/lib/dashboard/reconciliation-drill";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

export const metadata: Metadata = {
  title: "Reconciliation — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";
const PAGE_SUB_HEADING =
  "Billing must equal verifications, and inventory changes must equal removals. This page flags anything that doesn't.";

type ReconciliationBillingViewRow = {
  day_utc: string | null;
  billing_count: number | null;
  verification_count: number | null;
  delta: number | null;
  status: ReconciliationStatus | null;
};

type ReconciliationInventoryViewRow = {
  day: string | null;
  enrolled_count: number | null;
  unenrolled_count: number | null;
  removed_count: number | null;
  delta: number | null;
  status: ReconciliationStatus | null;
};

type ApigeeCrossCheckViewRow = {
  day_utc: string | null;
  endpoint_category: string | null;
  mapped_metric: string | null;
  apigee_count: number | null;
  mapped_count: number | null;
  error_500_count: number | null;
  status: "ok" | "needs_review" | null;
};

type InventoryGapViewRow = { missing_day: string | null };

type InventoryLiveCountRow = { live_count: number };

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

function PageHeader({ uploadedAt }: { uploadedAt: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">Reconciliation</h1>
        </div>
        <FreshnessBadge uploadedAt={uploadedAt} />
      </div>
      <p className="max-w-2xl text-sm font-light text-muted-foreground">{PAGE_SUB_HEADING}</p>
      <p className="text-sm font-light text-muted-foreground">{DATA_WINDOW_CAPTION}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground">
        <use href="/icons.svg#rotate" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">No reconciliation data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload billing, verification, card-inventory, and removed-cards reports to see daily
        reconciliation.{" "}
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
      <h2 className="text-lg font-medium text-foreground">Reconciliation could not be loaded</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong comparing billing, verification, and inventory records — try
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
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Good-news micro-state (04-UI-SPEC.md): populated overall but zero
 * mismatches in the current data window reads as good news, not an error or
 * a top-level empty state -- rendered inline where the billing table would go.
 */
function NoMismatchesGoodNews() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Billing vs verifications</h2>
      <div className="rounded-lg border border-border p-6 text-center">
        <p className="text-sm font-light text-muted-foreground">
          No billing/verification mismatches in this period.
        </p>
      </div>
    </div>
  );
}

/**
 * Good-news micro-state for the card-inventory section (04-UI-SPEC.md),
 * mirroring NoMismatchesGoodNews above -- populated overall but zero
 * inventory flags reads as good news, not an error or top-level empty state.
 */
function NoDiscrepanciesGoodNews() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Card inventory</h2>
      <div className="rounded-lg border border-border p-6 text-center">
        <p className="text-sm font-light text-muted-foreground">
          No inventory discrepancies in this period.
        </p>
      </div>
    </div>
  );
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const EMPTY_BILLING_DRILL_RESULT = {
  billingRows: [],
  billingTotalCount: null,
  verificationRows: [],
  verificationTotalCount: null,
  authorisedCount: 0,
  declinedCount: 0,
  authenticatedCount: 0,
  failedCount: 0,
};

const EMPTY_INVENTORY_DRILL_RESULT = {
  cardInventoryRows: [],
  cardInventoryTotalCount: null,
  removedCardRows: [],
  removedCardTotalCount: null,
};

/**
 * Async Server Component reading `v_reconciliation_billing_daily` (RECON-01/
 * RECON-03), `v_reconciliation_inventory_daily` / `v_apigee_cross_check` /
 * `v_inventory_gap_days` / `v_inventory_live_count` (RECON-02/DASH-02), and
 * the "as of last import" freshness timestamp via the session-scoped server
 * client so RLS applies. Suspended by the page below to drive the loading
 * state; renders empty/populated/error itself.
 *
 * Also reads the Next 16 `searchParams` prop (a Promise -- must be awaited)
 * for the drill-down Sheet (DASH-03): `parseDrillParams` whitelists the
 * entity/keys before any query is built.
 *
 * The empty-state check is widened here to all four contributing sources
 * (billing recon, inventory recon, gap days, APIGEE) -- EmptyState shows
 * only when NONE of them have any data (UI-SPEC binding).
 */
async function ReconciliationBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isBillingDrill = drillFilter?.drill === "recon-billing";
  const isInventoryDrill = drillFilter?.drill === "recon-inventory";

  const [
    billingDailyResult,
    inventoryDailyResult,
    apigeeResult,
    gapDaysResult,
    liveCountResult,
    freshnessResult,
    billingDrillResult,
    inventoryDrillResult,
  ] = await Promise.all([
    supabase
      .from("v_reconciliation_billing_daily")
      .select("day_utc, billing_count, verification_count, delta, status")
      .order("day_utc", { ascending: true })
      .returns<ReconciliationBillingViewRow[]>(),
    supabase
      .from("v_reconciliation_inventory_daily")
      .select("day, enrolled_count, unenrolled_count, removed_count, delta, status")
      .order("day", { ascending: true })
      .returns<ReconciliationInventoryViewRow[]>(),
    supabase
      .from("v_apigee_cross_check")
      .select(
        "day_utc, endpoint_category, mapped_metric, apigee_count, mapped_count, error_500_count, status",
      )
      .order("day_utc", { ascending: true })
      .returns<ApigeeCrossCheckViewRow[]>(),
    supabase
      .from("v_inventory_gap_days")
      .select("missing_day")
      .order("missing_day", { ascending: true })
      .returns<InventoryGapViewRow[]>(),
    supabase
      .from("v_inventory_live_count")
      .select("live_count")
      .returns<InventoryLiveCountRow[]>()
      .maybeSingle(),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
    isBillingDrill
      ? fetchReconciliationBillingDrillRows(supabase, drillFilter.date)
      : Promise.resolve(EMPTY_BILLING_DRILL_RESULT),
    isInventoryDrill
      ? fetchReconciliationInventoryDrillRows(supabase, drillFilter.date)
      : Promise.resolve(EMPTY_INVENTORY_DRILL_RESULT),
  ]);

  // Query error renders ErrorState, never a silent-empty or silent-all-OK
  // table -- a trust tool must never look "clean" because it failed to check.
  if (
    billingDailyResult.error ||
    inventoryDailyResult.error ||
    apigeeResult.error ||
    gapDaysResult.error ||
    liveCountResult.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} />
        <ErrorState />
      </>
    );
  }

  const billingDailyRows: ReconciliationBillingDailyRow[] = (billingDailyResult.data ?? [])
    .filter(
      (row): row is ReconciliationBillingViewRow & { day_utc: string; status: ReconciliationStatus } =>
        row.day_utc !== null && row.status !== null,
    )
    .map((row) => ({
      day_utc: row.day_utc,
      billing_count: row.billing_count ?? 0,
      verification_count: row.verification_count ?? 0,
      delta: row.delta ?? 0,
      status: row.status,
    }));

  const inventoryDailyRows: ReconciliationInventoryDailyRow[] = (inventoryDailyResult.data ?? [])
    .filter(
      (row): row is ReconciliationInventoryViewRow & { day: string; status: ReconciliationStatus } =>
        row.day !== null && row.status !== null,
    )
    .map((row) => ({
      day: row.day,
      enrolled_count: row.enrolled_count ?? 0,
      unenrolled_count: row.unenrolled_count ?? 0,
      removed_count: row.removed_count ?? 0,
      delta: row.delta ?? 0,
      status: row.status,
    }));

  const apigeeRows: ApigeeCrossCheckRow[] = (apigeeResult.data ?? [])
    .filter(
      (row): row is ApigeeCrossCheckViewRow & {
        day_utc: string;
        endpoint_category: string;
        mapped_metric: string;
        status: "ok" | "needs_review";
      } => row.day_utc !== null && row.endpoint_category !== null && row.mapped_metric !== null && row.status !== null,
    )
    .map((row) => ({
      day_utc: row.day_utc,
      endpoint_category: row.endpoint_category,
      mapped_metric: row.mapped_metric,
      apigee_count: row.apigee_count ?? 0,
      mapped_count: row.mapped_count ?? 0,
      error_500_count: row.error_500_count ?? 0,
      status: row.status,
    }));

  const gapRows: ReconciliationInventoryGapRow[] = (gapDaysResult.data ?? [])
    .filter((row): row is { missing_day: string } => row.missing_day !== null)
    .map((row) => ({ missing_day: row.missing_day }));

  const liveCount = liveCountResult.data?.live_count ?? 0;
  const enrolledToday = inventoryDailyRows.length > 0
    ? inventoryDailyRows[inventoryDailyRows.length - 1].enrolled_count
    : 0;
  const unenrolledToday = inventoryDailyRows.length > 0
    ? inventoryDailyRows[inventoryDailyRows.length - 1].unenrolled_count
    : 0;

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;
  const hasMismatches = billingDailyRows.some((row) => row.status !== "ok");
  const hasInventoryFlags = inventoryDailyRows.some((row) => row.status !== "ok");

  // Widened empty-state check (04-03): EmptyState shows only when NONE of
  // the four contributing sources (billing recon, inventory recon, gap
  // days, APIGEE) have any data -- not just the billing source (04-02
  // checked billing only; UI-SPEC binding requires all four here).
  const isEmpty =
    billingDailyRows.length === 0 &&
    inventoryDailyRows.length === 0 &&
    gapRows.length === 0 &&
    apigeeRows.length === 0;

  const activeDrillFilter = isBillingDrill || isInventoryDrill ? drillFilter : null;
  const sheetTitle = isInventoryDrill
    ? `Card inventory — ${drillFilter?.date ?? ""}`
    : `Billing vs verifications — ${drillFilter?.date ?? ""}`;

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              {billingDailyRows.length === 0 ? (
                <NoMismatchesGoodNews />
              ) : hasMismatches ? (
                <ReconciliationBillingTable rows={billingDailyRows} />
              ) : (
                <NoMismatchesGoodNews />
              )}
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardContent>
              {inventoryDailyRows.length === 0 && gapRows.length === 0 ? (
                <NoDiscrepanciesGoodNews />
              ) : hasInventoryFlags || gapRows.length > 0 ? (
                <ReconciliationInventoryTable
                  rows={inventoryDailyRows}
                  gapRows={gapRows}
                  apigeeRows={apigeeRows}
                  liveCount={liveCount}
                  enrolledToday={enrolledToday}
                  unenrolledToday={unenrolledToday}
                />
              ) : (
                <NoDiscrepanciesGoodNews />
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <ReconciliationDrillSheet
        filter={activeDrillFilter}
        billingResult={billingDrillResult}
        inventoryResult={inventoryDrillResult}
        title={sheetTitle}
      />
    </>
  );
}

export default function ReconciliationPage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <ReconciliationBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
