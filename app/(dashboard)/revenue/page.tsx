import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { RevenueViewControls } from "@/components/dashboard/revenue-view-controls";
import type { RevenueTierRow } from "@/components/dashboard/revenue-tier-breakdown";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { RevenueDailyRow } from "@/lib/dashboard/revenue-bucketing";

export const metadata: Metadata = {
  title: "Revenue — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

type RevenueDailyViewRow = { day_utc: string | null; revenue: string | null };
type RevenueTierViewRow = {
  day_utc: string | null;
  tier_order: number | null;
  tier_revenue: string | null;
  tier_set_id: string | null;
};
/** All-verifications daily counts (D-02) — used only to distinguish "no
 * verification data at all" (EmptyState) from "verifications exist but no
 * pricing tier covers them" (ErrorState, never a silent $0). */
type RevenueDailyCountsRow = { day_utc: string | null };
type PricingTierSetRow = { id: string };
type RevenueTotalRow = { sum: string | null };
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
          <h1 className="text-2xl font-medium text-foreground">Revenue</h1>
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
      <h2 className="text-lg font-medium text-foreground">No revenue data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the daily verification report to see computed revenue over
        time.{" "}
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

/**
 * Binding rule (03-UI-SPEC.md / T-03-17): a revenue-computation failure
 * caused by missing pricing tier configuration is an explicit error state
 * with actionable copy — never a silent $0 presented as a real answer.
 */
function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Revenue could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong computing revenue — try refreshing the page, and
        check the pricing tiers are configured correctly.
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
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/**
 * Async Server Component reading `v_revenue_daily` / `v_revenue_by_tier`
 * (REV-01) plus the grand total for the "Total revenue" KPI (summed in
 * Postgres via a PostgREST aggregate — never re-summed in JS, Pitfall
 * 2/T-03-16), and the "as of last import" freshness timestamp via the
 * session-scoped server client so RLS applies. Also checks
 * `pricing_tier_sets` so a missing pricing configuration renders
 * ErrorState, never a silent $0 (T-03-17).
 */
async function RevenueBody() {
  const supabase = await createClient();

  const [
    dailyResult,
    tierResult,
    totalResult,
    verificationCountsResult,
    pricingTierSetsResult,
    freshnessResult,
  ] = await Promise.all([
    supabase
      .from("v_revenue_daily")
      .select("day_utc, revenue")
      .order("day_utc", { ascending: true })
      .returns<RevenueDailyViewRow[]>(),
    supabase
      .from("v_revenue_by_tier")
      .select("day_utc, tier_order, tier_revenue, tier_set_id")
      .returns<RevenueTierViewRow[]>(),
    // Grand total summed in Postgres (PostgREST aggregate function) — the
    // number reaching JS is already the final NUMERIC total, never summed
    // client-side from the per-day/per-tier rows above.
    supabase
      .from("v_revenue_daily")
      .select("sum:revenue.sum()")
      .returns<RevenueTotalRow[]>()
      .maybeSingle(),
    supabase
      .from("v_revenue_daily_counts")
      .select("day_utc")
      .returns<RevenueDailyCountsRow[]>(),
    supabase
      .from("pricing_tier_sets")
      .select("id")
      .limit(1)
      .returns<PricingTierSetRow[]>(),
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
    dailyResult.error ||
    tierResult.error ||
    totalResult.error ||
    verificationCountsResult.error ||
    pricingTierSetsResult.error ||
    freshnessResult.error
  ) {
    return (
      <>
        <PageHeader uploadedAt={null} />
        <ErrorState />
      </>
    );
  }

  const hasVerificationActivity = (verificationCountsResult.data ?? []).length > 0;
  const hasPricingTierSet = (pricingTierSetsResult.data ?? []).length > 0;

  if (!hasVerificationActivity) {
    return (
      <>
        <PageHeader uploadedAt={freshnessResult.data?.uploaded_at ?? null} />
        <EmptyState />
      </>
    );
  }

  // T-03-17: verifications exist, but there is no pricing tier configured to
  // price them (at all, or for the days that have activity) — an explicit
  // error, never a silent $0.
  if (!hasPricingTierSet || (dailyResult.data ?? []).length === 0) {
    return (
      <>
        <PageHeader uploadedAt={freshnessResult.data?.uploaded_at ?? null} />
        <ErrorState />
      </>
    );
  }

  const dailyRows: RevenueDailyRow[] = (dailyResult.data ?? [])
    .filter(
      (row): row is RevenueDailyViewRow & { day_utc: string; revenue: string } =>
        row.day_utc !== null && row.revenue !== null,
    )
    .map((row) => ({ day_utc: row.day_utc, revenue: row.revenue }));

  const tierRows: RevenueTierRow[] = (tierResult.data ?? [])
    .filter(
      (
        row,
      ): row is RevenueTierViewRow & {
        day_utc: string;
        tier_order: number;
        tier_revenue: string;
        tier_set_id: string;
      } =>
        row.day_utc !== null &&
        row.tier_order !== null &&
        row.tier_revenue !== null &&
        row.tier_set_id !== null,
    )
    .map((row) => ({
      day_utc: row.day_utc,
      tier_order: row.tier_order,
      tier_revenue: row.tier_revenue,
      tier_set_id: row.tier_set_id,
    }));

  const totalRevenue = Number(totalResult.data?.sum ?? "0");
  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
      <RevenueViewControls
        dailyRows={dailyRows}
        tierRows={tierRows}
        totalRevenue={totalRevenue}
      />
    </>
  );
}

export default function RevenuePage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <RevenueBody />
      </Suspense>
    </div>
  );
}
