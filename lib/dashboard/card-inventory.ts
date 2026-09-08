import type { createClient } from "@/lib/supabase/server";

/**
 * Pure shaping helpers for the card-inventory page (quick task 260908-r3x).
 * No Supabase imports in the pure functions below — keeps them unit-testable
 * in isolation, matching `lib/dashboard/bucketing.ts`'s convention. Server
 * fetchers live in this same file and mirror `verification-drill.ts`'s
 * shape (a typed `{ rows, error }` result the caller checks explicitly).
 *
 * No migration, no view: `card_inventory` and `removed_cards` are read
 * directly and shaped in TypeScript (see PLAN.md "No migration" design
 * decision). At 912 inventory rows this costs nothing; revisit with a view
 * if inventory reaches five figures.
 */

export interface CardInventoryRow {
  report_date: string;
  external_card_reference: string;
}

export interface RemovedCardRow {
  removed_at: string;
}

export interface SnapshotPoint {
  day: string;
  cardCount: number;
}

export interface LatestSnapshot {
  day: string;
  references: string[];
}

export interface RemovalPoint {
  day: string;
  removedCount: number;
}

/**
 * Change vs the PREVIOUS snapshot, plus the calendar-day gap between them —
 * this report is not delivered daily (9 snapshots over 27 days), so the UI
 * must say "+1 since 2 Sep (6 days earlier)" rather than implying a daily
 * delta. `change`/`dayGapDays`/`previousDay` are all null for the first
 * snapshot in the series, which has no previous snapshot to diff against.
 */
export interface SnapshotNetChange {
  day: string;
  cardCount: number;
  change: number | null;
  dayGapDays: number | null;
  previousDay: string | null;
}

/**
 * Groups `card_inventory` rows into one ascending entry per distinct
 * `report_date`, counting distinct card references per day. Counts distinct
 * references defensively (via a Set) rather than raw row counts, so a
 * caller isn't silently wrong if the DB's `UNIQUE (report_date,
 * external_card_reference)` constraint is ever bypassed (e.g. a stale
 * fixture in a test).
 */
export function snapshotSeries(rows: CardInventoryRow[]): SnapshotPoint[] {
  const byDay = new Map<string, Set<string>>();

  for (const row of rows) {
    const day = row.report_date.slice(0, 10);
    const existing = byDay.get(day);
    if (existing) {
      existing.add(row.external_card_reference);
    } else {
      byDay.set(day, new Set([row.external_card_reference]));
    }
  }

  return Array.from(byDay.entries())
    .map(([day, refs]) => ({ day, cardCount: refs.size }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Maps each card reference to the earliest `report_date` it appears in. */
export function firstSeenByCard(rows: CardInventoryRow[]): Map<string, string> {
  const firstSeen = new Map<string, string>();

  for (const row of rows) {
    const day = row.report_date.slice(0, 10);
    const existing = firstSeen.get(row.external_card_reference);
    if (existing === undefined || day < existing) {
      firstSeen.set(row.external_card_reference, day);
    }
  }

  return firstSeen;
}

/** Returns the card references present on the max `report_date`, or null for no rows. */
export function latestSnapshot(rows: CardInventoryRow[]): LatestSnapshot | null {
  if (rows.length === 0) return null;

  let latestDay = rows[0].report_date.slice(0, 10);
  for (const row of rows) {
    const day = row.report_date.slice(0, 10);
    if (day > latestDay) latestDay = day;
  }

  const references = Array.from(
    new Set(
      rows
        .filter((row) => row.report_date.slice(0, 10) === latestDay)
        .map((row) => row.external_card_reference),
    ),
  );

  return { day: latestDay, references };
}

/**
 * Buckets `removed_cards` rows by UTC calendar day. `removed_at` is a
 * timestamptz string; the first 10 characters are always the `YYYY-MM-DD`
 * UTC calendar day regardless of the exact separator/offset format Supabase
 * returns (mirrors `bucketing.ts`'s `bucketKeyAndLabel` convention).
 */
export function removalSeries(rows: RemovedCardRow[]): RemovalPoint[] {
  const byDay = new Map<string, number>();

  for (const row of rows) {
    const day = row.removed_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return Array.from(byDay.entries())
    .map(([day, removedCount]) => ({ day, removedCount }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(earlierDay: string, laterDay: string): number {
  return Math.round(
    (Date.parse(`${laterDay}T00:00:00Z`) - Date.parse(`${earlierDay}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/**
 * Computes each snapshot's change vs the PREVIOUS snapshot in the series,
 * plus the calendar-day gap between them. `series` must already be sorted
 * ascending by day (as `snapshotSeries` returns it) — this function does not
 * re-sort.
 */
export function netChange(series: SnapshotPoint[]): SnapshotNetChange[] {
  return series.map((point, index) => {
    if (index === 0) {
      return {
        day: point.day,
        cardCount: point.cardCount,
        change: null,
        dayGapDays: null,
        previousDay: null,
      };
    }

    const previous = series[index - 1];
    return {
      day: point.day,
      cardCount: point.cardCount,
      change: point.cardCount - previous.cardCount,
      dayGapDays: daysBetween(previous.day, point.day),
      previousDay: previous.day,
    };
  });
}

/**
 * `card_inventory.report_date` is a plain `date` column (one row per card
 * per snapshot day) — filtered directly against the DATA-06 floor as a date
 * string, never built from a timestamptz range.
 */
export const DATA_WINDOW_START_DATE = "2026-08-13";

/**
 * `removed_cards.removed_at` is a timestamptz — the same DATA-06 floor as
 * `verification-drill.ts`'s `DATA_WINDOW_START`, duplicated here (rather than
 * imported) to keep this module free of `@/` value-imports: this repo has no
 * vitest alias config, so a value-import via the `@/` path alias resolves
 * fine in `next build` but breaks under `vitest run` (only type-only `@/`
 * imports are safe, since esbuild strips them without resolving the module).
 */
export const REMOVED_CARDS_DATA_WINDOW_START = "2026-08-13T00:00:00Z";

export interface CardInventoryFetchResult {
  rows: CardInventoryRow[];
  error: boolean;
}

export interface RemovedCardFetchResult {
  rows: RemovedCardRow[];
  error: boolean;
}

/**
 * Server-fetches `card_inventory` rows via the session-scoped server client
 * (RLS applies), filtered to the DATA-06 floor. Mirrors
 * `verification-drill.ts`'s `{ rows, error }` result shape — the caller
 * checks `.error` explicitly (IN-03: never folds a query failure into "no
 * rows").
 */
export async function fetchCardInventoryRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<CardInventoryFetchResult> {
  const { data, error } = await supabase
    .from("card_inventory")
    .select("report_date, external_card_reference")
    .gte("report_date", DATA_WINDOW_START_DATE)
    .order("report_date", { ascending: true })
    .returns<CardInventoryRow[]>();

  if (error) return { rows: [], error: true };
  return { rows: data ?? [], error: false };
}

/**
 * Server-fetches `removed_cards` rows via the session-scoped server client
 * (RLS applies), filtered to the DATA-06 floor.
 */
export async function fetchRemovedCardRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<RemovedCardFetchResult> {
  const { data, error } = await supabase
    .from("removed_cards")
    .select("removed_at")
    .gte("removed_at", REMOVED_CARDS_DATA_WINDOW_START)
    .order("removed_at", { ascending: true })
    .returns<RemovedCardRow[]>();

  if (error) return { rows: [], error: true };
  return { rows: data ?? [], error: false };
}
