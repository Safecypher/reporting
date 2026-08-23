import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { ReconciliationDrillSheet } from "@/components/dashboard/reconciliation-drill-sheet";
import {
  ReconciliationBillingTable,
  type ReconciliationBillingDailyRow,
} from "@/components/dashboard/reconciliation-billing-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
import { fetchReconciliationBillingDrillRows } from "@/lib/dashboard/reconciliation-drill";
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

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component reading `v_reconciliation_billing_daily` (RECON-01/
 * RECON-03) and the "as of last import" freshness timestamp via the
 * session-scoped server client so RLS applies. Suspended by the page below
 * to drive the loading state; renders empty/populated/error itself.
 *
 * Also reads the Next 16 `searchParams` prop (a Promise -- must be awaited)
 * for the drill-down Sheet (DASH-03): `parseDrillParams` whitelists the
 * entity/keys before any query is built.
 *
 * The card-inventory section (04-03) will widen the empty-state check to
 * all four contributing sources; this plan checks the billing source only.
 */
async function ReconciliationBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isBillingDrill = drillFilter?.drill === "recon-billing";

  const [billingDailyResult, freshnessResult, billingDrillResult] = await Promise.all([
    supabase
      .from("v_reconciliation_billing_daily")
      .select("day_utc, billing_count, verification_count, delta, status")
      .order("day_utc", { ascending: true })
      .returns<ReconciliationBillingViewRow[]>(),
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
      : Promise.resolve({
          billingRows: [],
          billingTotalCount: null,
          verificationRows: [],
          verificationTotalCount: null,
          authorisedCount: 0,
          declinedCount: 0,
          authenticatedCount: 0,
          failedCount: 0,
        }),
  ]);

  // Query error renders ErrorState, never a silent-empty or silent-all-OK
  // table -- a trust tool must never look "clean" because it failed to check.
  if (billingDailyResult.error || freshnessResult.error) {
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

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;
  const hasMismatches = billingDailyRows.some((row) => row.status !== "ok");

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
      {billingDailyRows.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent>
            {hasMismatches ? (
              <ReconciliationBillingTable rows={billingDailyRows} />
            ) : (
              <NoMismatchesGoodNews />
            )}
          </CardContent>
        </Card>
      )}
      <ReconciliationDrillSheet
        filter={isBillingDrill ? drillFilter : null}
        billingResult={billingDrillResult}
        title={`Billing vs verifications — ${drillFilter?.date ?? ""}`}
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
