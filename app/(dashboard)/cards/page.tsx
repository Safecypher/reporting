import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { CardInventoryChart, type CardInventoryChartPoint } from "@/components/dashboard/card-inventory-chart";
import { CardInventoryKpiCards } from "@/components/dashboard/card-inventory-kpi-cards";
import { CardInventoryTable } from "@/components/dashboard/card-inventory-table";
import type { CardInventoryTableRow } from "@/components/dashboard/card-inventory-columns";
import { CardRemovalsChart, type CardRemovalsChartPoint } from "@/components/dashboard/card-removals-chart";
import { ScopeBadge } from "@/components/dashboard/scope-badge";
import { PeriodControls } from "@/components/dashboard/period-controls";
import { PeriodEmptyState } from "@/components/dashboard/period-empty-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import {
  fetchCardInventoryRowsUpTo,
  fetchRemovedCardRows,
  firstSeenByCard,
  latestSnapshot,
  netChange,
  removalSeries,
  rowsWithin,
  snapshotSeries,
} from "@/lib/dashboard/card-inventory";
import {
  monthOptions as buildMonthOptions,
  yearOptions as buildYearOptions,
  resolvePeriod,
  type ResolvedPeriod,
} from "@/lib/dashboard/period";
import { fetchFinancialYearStart } from "@/lib/settings/fy-settings";

export const metadata: Metadata = {
  title: "Cards — Safecypher Reporting",
};

const DATA_WINDOW_CAPTION = "Excludes data before 13 Aug 2026.";

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
          <h1 className="text-2xl font-medium text-foreground">Cards</h1>
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
        <use href="/icons.svg#card" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        No card data yet
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the card-inventory and removed-cards reports to see enrolment
        and removal activity over time.{" "}
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
        Card data could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading card-inventory or removed-cards data.
        Try refreshing the page — if it keeps happening, check the database
        connection.
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-[320px] w-full" />
      <Skeleton className="h-[320px] w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function formatDayLong(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

type PageSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Async Server Component reading `card_inventory` and `removed_cards` via
 * the session-scoped server client so RLS applies, mirroring
 * `verifications/page.tsx`'s structure. IN-03: a freshness-query failure is
 * surfaced as `ErrorState`, never folded into "no imports yet" (which is
 * indistinguishable from a legitimately empty table and hides a real DB
 * fault).
 *
 * No migration, no view (PLAN.md "No migration" decision): shaping happens
 * in TypeScript over the plain table reads in `lib/dashboard/card-inventory.ts`.
 *
 * P-02 (Phase 5): card inventory is a STOCK metric, not a flow metric like
 * the other four period-scoped views — see the module doc comment on
 * `lib/dashboard/card-inventory.ts` for the full rule. The Enrolled-cards
 * KPI and the latest-snapshot table are both derived from
 * `fetchCardInventoryRowsUpTo(supabase, period.end)` (as-of-period-end),
 * while the enrolment-over-time chart and removals are windowed strictly to
 * `[period.start, period.end)` (flow).
 */
async function CardsBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;

  // D-01/D-05: resolve the period BEFORE any query is built — `now` is
  // captured once here from the runtime clock and passed in, so
  // `resolvePeriod` itself stays pure (no wall-clock access inside it).
  const now = new Date();
  const fyStart = await fetchFinancialYearStart(supabase);
  const period = resolvePeriod(params, fyStart, now);
  const monthOptions = buildMonthOptions(now);
  const yearOptions = buildYearOptions(now);

  const [
    rowsUpToEndResult,
    removedResult,
    // UNSCOPED domain-existence probes (never a period predicate) —
    // distinguish "no card data at all, ever" (EmptyState) from "card data
    // exists, this period has neither a snapshot at-or-before its end nor a
    // removal inside it" (PeriodEmptyState, P-02).
    inventoryDomainProbe,
    removedDomainProbe,
    freshnessResult,
  ] = await Promise.all([
    fetchCardInventoryRowsUpTo(supabase, period.end),
    fetchRemovedCardRows(supabase, { start: period.start, end: period.end }),
    supabase
      .from("card_inventory")
      .select("report_date", { count: "exact", head: true })
      .limit(1),
    supabase
      .from("removed_cards")
      .select("removed_at", { count: "exact", head: true })
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
    rowsUpToEndResult.error ||
    removedResult.error ||
    inventoryDomainProbe.error ||
    removedDomainProbe.error ||
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

  const hasCardDataEver =
    (inventoryDomainProbe.count ?? 0) > 0 || (removedDomainProbe.count ?? 0) > 0;

  if (!hasCardDataEver) {
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

  // P-02 STOCK: the as-of-period-end snapshot. `latest` can be dated before
  // `period.start` (carried forward) — that is the whole point of the rule.
  const latest = latestSnapshot(rowsUpToEndResult.rows);
  const firstSeen = firstSeenByCard(rowsUpToEndResult.rows);

  // P-02 FLOW: strictly windowed to the selected period.
  const rowsWithinPeriod = rowsWithin(
    rowsUpToEndResult.rows,
    period.start,
    period.end,
    (row) => row.report_date,
  );
  const snapshotsInPeriod = snapshotSeries(rowsWithinPeriod);
  const changesInPeriod = netChange(snapshotsInPeriod);
  const removals = removalSeries(removedResult.rows);

  const hasRemovalsInPeriod = removals.length > 0;

  // Reach the period-empty state only when there is NEITHER a snapshot at
  // or before the period end NOR a removal inside the window (P-02) — a
  // carried-forward KPI is a legitimate populated state, never "empty".
  if (latest === null && !hasRemovalsInPeriod) {
    return (
      <>
        <PageHeader
          uploadedAt={uploadedAt}
          period={period}
          monthOptions={monthOptions}
          yearOptions={yearOptions}
        />
        <PeriodEmptyState viewNoun="card activity" period={period} />
      </>
    );
  }

  const chartPoints: CardInventoryChartPoint[] = snapshotsInPeriod.map((point) => ({
    timestamp: Date.parse(`${point.day}T00:00:00Z`),
    day: point.day,
    cardCount: point.cardCount,
  }));

  const removalsChartPoints: CardRemovalsChartPoint[] = removals.map((point) => ({
    day: point.day,
    removedCount: point.removedCount,
  }));

  // Table and KPI always agree (PLAN.md Task 3): both are built from the
  // SAME `rowsUpToEndResult.rows` — `firstSeen` names every card seen up to
  // the period end, `presentInLatest` flags exactly the as-of snapshot's
  // own references.
  const latestReferences = new Set(latest?.references ?? []);
  const tableRows: CardInventoryTableRow[] = Array.from(firstSeen.entries())
    .map(([reference, day]) => ({
      reference,
      firstSeen: day,
      presentInLatest: latestReferences.has(reference),
    }))
    .sort((a, b) => a.reference.localeCompare(b.reference));

  // The KPI caption ALWAYS names the as-of snapshot's real date (PLAN.md
  // Task 3 acceptance criterion) — carried-forward basis stated explicitly
  // when that date precedes the selected period's start (P-02); otherwise
  // the existing net-change-vs-previous-snapshot wording, itself anchored
  // to the same date, since this report is not delivered daily (PLAN.md
  // "Design decisions": the caption must never imply a daily delta).
  const carriedForward = latest !== null && latest.day < period.start;
  const latestChangeInPeriod =
    latest !== null ? (changesInPeriod.find((c) => c.day === latest.day) ?? null) : null;
  const changeCaption = (() => {
    if (latest === null) return null;
    if (carriedForward) {
      return `Carried forward from ${formatDayLong(latest.day)} — no snapshot in this period.`;
    }
    if (
      latestChangeInPeriod &&
      latestChangeInPeriod.change !== null &&
      latestChangeInPeriod.previousDay !== null
    ) {
      return `As of ${formatDayLong(latest.day)} — ${
        latestChangeInPeriod.change >= 0 ? "+" : ""
      }${latestChangeInPeriod.change} since ${formatDayLong(
        latestChangeInPeriod.previousDay,
      )} (${latestChangeInPeriod.dayGapDays} day${
        latestChangeInPeriod.dayGapDays === 1 ? "" : "s"
      } earlier).`;
    }
    return `As of ${formatDayLong(latest.day)}.`;
  })();

  return (
    <>
      <PageHeader
        uploadedAt={uploadedAt}
        period={period}
        monthOptions={monthOptions}
        yearOptions={yearOptions}
      />
      <CardInventoryKpiCards
        enrolledCount={latest?.references.length ?? 0}
        changeCaption={changeCaption}
        latestSnapshotDay={latest?.day ?? null}
        totalRemovals={removedResult.rows.length}
      />
      <CardInventoryChart data={chartPoints} />
      <CardRemovalsChart data={removalsChartPoints} />
      <CardInventoryTable rows={tableRows} />
    </>
  );
}

export default function CardsPage({ searchParams }: { searchParams: PageSearchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <CardsBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
