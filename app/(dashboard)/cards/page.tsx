import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { CardInventoryChart, type CardInventoryChartPoint } from "@/components/dashboard/card-inventory-chart";
import { CardInventoryKpiCards } from "@/components/dashboard/card-inventory-kpi-cards";
import { CardInventoryTable } from "@/components/dashboard/card-inventory-table";
import type { CardInventoryTableRow } from "@/components/dashboard/card-inventory-columns";
import { CardRemovalsChart, type CardRemovalsChartPoint } from "@/components/dashboard/card-removals-chart";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import {
  fetchCardInventoryRows,
  fetchRemovedCardRows,
  firstSeenByCard,
  latestSnapshot,
  netChange,
  removalSeries,
  snapshotSeries,
} from "@/lib/dashboard/card-inventory";

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

function PageHeader({ uploadedAt }: { uploadedAt: string | null }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
            Dashboard
          </p>
          <h1 className="text-2xl font-medium text-foreground">Cards</h1>
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
 */
async function CardsBody() {
  const supabase = await createClient();

  const [inventoryResult, removedResult, freshnessResult] = await Promise.all([
    fetchCardInventoryRows(supabase),
    fetchRemovedCardRows(supabase),
    supabase
      .from("ingested_files")
      .select("uploaded_at")
      .eq("status", "done")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .returns<IngestedFileFreshness[]>()
      .maybeSingle(),
  ]);

  if (inventoryResult.error || removedResult.error || freshnessResult.error) {
    return (
      <>
        <PageHeader uploadedAt={null} />
        <ErrorState />
      </>
    );
  }

  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;

  if (inventoryResult.rows.length === 0 && removedResult.rows.length === 0) {
    return (
      <>
        <PageHeader uploadedAt={uploadedAt} />
        <EmptyState />
      </>
    );
  }

  const snapshots = snapshotSeries(inventoryResult.rows);
  const changes = netChange(snapshots);
  const latest = latestSnapshot(inventoryResult.rows);
  const firstSeen = firstSeenByCard(inventoryResult.rows);
  const removals = removalSeries(removedResult.rows);

  const chartPoints: CardInventoryChartPoint[] = snapshots.map((point) => ({
    timestamp: Date.parse(`${point.day}T00:00:00Z`),
    day: point.day,
    cardCount: point.cardCount,
  }));

  const removalsChartPoints: CardRemovalsChartPoint[] = removals.map((point) => ({
    day: point.day,
    removedCount: point.removedCount,
  }));

  const latestReferences = new Set(latest?.references ?? []);
  const tableRows: CardInventoryTableRow[] = Array.from(firstSeen.entries())
    .map(([reference, day]) => ({
      reference,
      firstSeen: day,
      presentInLatest: latestReferences.has(reference),
    }))
    .sort((a, b) => a.reference.localeCompare(b.reference));

  // The latest snapshot's own net-change entry (change vs the PREVIOUS
  // snapshot, plus the real day-gap between them — see PLAN.md "Design
  // decisions": this report is not delivered daily, so the caption must
  // never imply a daily delta).
  const latestChange = changes[changes.length - 1] ?? null;
  const changeCaption =
    latestChange && latestChange.change !== null && latestChange.previousDay !== null
      ? `${latestChange.change >= 0 ? "+" : ""}${latestChange.change} since ${formatDayLong(
          latestChange.previousDay,
        )} (${latestChange.dayGapDays} day${latestChange.dayGapDays === 1 ? "" : "s"} earlier)`
      : null;

  return (
    <>
      <PageHeader uploadedAt={uploadedAt} />
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

export default function CardsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <CardsBody />
      </Suspense>
    </div>
  );
}
