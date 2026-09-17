import { describe, expect, it } from "vitest";

import type { createClient } from "@/lib/supabase/server";
import {
  DATA_WINDOW_START_DATE,
  fetchRemovedCardRows,
  firstSeenByCard,
  latestSnapshot,
  netChange,
  removalSeries,
  rowsWithin,
  snapshotSeries,
  type CardInventoryRow,
  type RemovedCardRow,
} from "./card-inventory";

/**
 * WR-03 (08-01): `fetchRemovedCardRows`'s `.gte("removed_at", ...)` floor.
 * Stubs the Supabase client by hand, following
 * `lib/settings/__tests__/alignment-settings.test.ts`'s existing convention
 * — the Supabase module itself is never module-mocked.
 */
type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

function makeFakeSupabaseForRemovedCards(): {
  supabase: FakeSupabase;
  gteArgs: unknown[];
} {
  const gteArgs: unknown[] = [];
  const builder = {
    select: () => builder,
    gte: (_col: string, val: unknown) => {
      gteArgs.push(val);
      return builder;
    },
    lt: () => builder,
    order: () => builder,
    returns: () => Promise.resolve({ data: [], error: null }),
  };
  const supabase = { from: () => builder } as unknown as FakeSupabase;
  return { supabase, gteArgs };
}

const row = (report_date: string, external_card_reference: string): CardInventoryRow => ({
  report_date,
  external_card_reference,
});

describe("snapshotSeries", () => {
  it("groups rows into one ascending entry per distinct report_date", () => {
    const rows: CardInventoryRow[] = [
      row("2026-08-24", "card-1"),
      row("2026-08-13", "card-1"),
      row("2026-08-13", "card-2"),
      row("2026-08-24", "card-2"),
      row("2026-08-24", "card-3"),
    ];

    expect(snapshotSeries(rows)).toEqual([
      { day: "2026-08-13", cardCount: 2 },
      { day: "2026-08-24", cardCount: 3 },
    ]);
  });

  it("counts distinct card references per day defensively, even if a reference repeats", () => {
    const rows: CardInventoryRow[] = [row("2026-08-13", "card-1"), row("2026-08-13", "card-1")];

    expect(snapshotSeries(rows)).toEqual([{ day: "2026-08-13", cardCount: 1 }]);
  });

  it("returns an empty array for no rows", () => {
    expect(snapshotSeries([])).toEqual([]);
  });
});

describe("firstSeenByCard", () => {
  it("maps each card reference to its earliest report_date across snapshots", () => {
    const rows: CardInventoryRow[] = [
      row("2026-08-24", "card-1"),
      row("2026-08-13", "card-1"),
      row("2026-09-02", "card-2"),
    ];

    const result = firstSeenByCard(rows);

    expect(result.get("card-1")).toBe("2026-08-13");
    expect(result.get("card-2")).toBe("2026-09-02");
    expect(result.size).toBe(2);
  });
});

describe("latestSnapshot", () => {
  it("returns the references present on the max report_date only", () => {
    const rows: CardInventoryRow[] = [
      row("2026-08-13", "card-1"),
      row("2026-08-13", "card-2"),
      row("2026-08-24", "card-1"),
      row("2026-08-24", "card-3"),
    ];

    expect(latestSnapshot(rows)).toEqual({
      day: "2026-08-24",
      references: ["card-1", "card-3"],
    });
  });

  it("returns null for no rows", () => {
    expect(latestSnapshot([])).toBeNull();
  });
});

describe("removalSeries", () => {
  it("buckets removed_at timestamps by UTC calendar day, ascending", () => {
    const rows: RemovedCardRow[] = [
      { removed_at: "2026-09-04T10:23:00+00:00" },
      { removed_at: "2026-09-04T18:00:00+00:00" },
      { removed_at: "2026-08-13T00:00:00+00:00" },
    ];

    expect(removalSeries(rows)).toEqual([
      { day: "2026-08-13", removedCount: 1 },
      { day: "2026-09-04", removedCount: 2 },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(removalSeries([])).toEqual([]);
  });
});

describe("netChange", () => {
  it("marks the first snapshot's change, dayGapDays, and previousDay as null", () => {
    const series = [{ day: "2026-08-13", cardCount: 100 }];

    expect(netChange(series)).toEqual([
      { day: "2026-08-13", cardCount: 100, change: null, dayGapDays: null, previousDay: null },
    ]);
  });

  it("computes change and day-gap for a sparse snapshot more than one day after the previous one", () => {
    // The core case the design decision calls out: snapshots are not daily.
    // A gap of 6 days must be reported as 6, never silently treated as 1.
    const series = [
      { day: "2026-08-13", cardCount: 100 },
      { day: "2026-08-24", cardCount: 111 },
    ];

    expect(netChange(series)).toEqual([
      { day: "2026-08-13", cardCount: 100, change: null, dayGapDays: null, previousDay: null },
      {
        day: "2026-08-24",
        cardCount: 111,
        change: 11,
        dayGapDays: 11,
        previousDay: "2026-08-13",
      },
    ]);
  });

  it("computes a negative change when card count drops between snapshots", () => {
    const series = [
      { day: "2026-09-02", cardCount: 912 },
      { day: "2026-09-08", cardCount: 900 },
    ];

    const result = netChange(series);

    expect(result[1]).toEqual({
      day: "2026-09-08",
      cardCount: 900,
      change: -12,
      dayGapDays: 6,
      previousDay: "2026-09-02",
    });
  });

  it("returns an empty array for an empty series", () => {
    expect(netChange([])).toEqual([]);
  });
});

describe("rowsWithin", () => {
  it("keeps only rows whose date is >= start and < end (half-open window)", () => {
    const rows: CardInventoryRow[] = [
      row("2026-08-31", "card-1"),
      row("2026-09-01", "card-2"),
      row("2026-09-15", "card-3"),
      row("2026-09-30", "card-4"),
      row("2026-10-01", "card-5"),
    ];

    expect(rowsWithin(rows, "2026-09-01", "2026-10-01", (r) => r.report_date)).toEqual([
      row("2026-09-01", "card-2"),
      row("2026-09-15", "card-3"),
      row("2026-09-30", "card-4"),
    ]);
  });

  it("keeps every row on or after start when end is null (open-ended window)", () => {
    const rows: CardInventoryRow[] = [
      row("2026-08-31", "card-1"),
      row("2026-09-01", "card-2"),
      row("2026-12-25", "card-3"),
    ];

    expect(rowsWithin(rows, "2026-09-01", null, (r) => r.report_date)).toEqual([
      row("2026-09-01", "card-2"),
      row("2026-12-25", "card-3"),
    ]);
  });

  it("returns an empty array when no rows fall inside the window", () => {
    const rows: CardInventoryRow[] = [row("2026-08-01", "card-1")];

    expect(rowsWithin(rows, "2026-09-01", "2026-10-01", (r) => r.report_date)).toEqual([]);
  });

  it("IN-04: also works for removed_cards.removed_at callers, not just report_date — its doc comment claims both, this proves it", () => {
    const removedRows: RemovedCardRow[] = [
      { removed_at: "2026-08-31T10:00:00+00:00" },
      { removed_at: "2026-09-01T00:00:00+00:00" },
      { removed_at: "2026-09-15T23:59:59+00:00" },
      { removed_at: "2026-10-01T00:00:00+00:00" },
    ];

    expect(
      rowsWithin(removedRows, "2026-09-01", "2026-10-01", (r) => r.removed_at),
    ).toEqual([
      { removed_at: "2026-09-01T00:00:00+00:00" },
      { removed_at: "2026-09-15T23:59:59+00:00" },
    ]);
  });
});

describe("rowsWithin composed with latestSnapshot (P-02 as-of-period-end KPI rule)", () => {
  // Mirrors fetchCardInventoryRowsUpTo(supabase, period.end)'s DB-side
  // filter: a lower bound at the data-window floor, an optional exclusive
  // upper bound at the period end — expressed here as rowsWithin so the
  // composition is unit-testable without a network call.
  const rowsUpTo = (rows: CardInventoryRow[], endExclusive: string | null) =>
    rowsWithin(rows, DATA_WINDOW_START_DATE, endExclusive, (r) => r.report_date);

  const fixture: CardInventoryRow[] = [
    ...Array.from({ length: 10 }, (_, i) => row("2026-08-20", `aug-card-${i}`)),
    ...Array.from({ length: 12 }, (_, i) => row("2026-09-02", `sep-card-${i}`)),
  ];

  it("returns the most recent snapshot at or before the period end, even when it predates the period start", () => {
    // October 2026 period: [2026-10-01, 2026-11-01) — no snapshot inside
    // it, but the 2 Sep snapshot is the latest one at-or-before 2026-11-01.
    const octoberRowsUpToEnd = rowsUpTo(fixture, "2026-11-01");

    const result = latestSnapshot(octoberRowsUpToEnd);

    expect(result?.day).toBe("2026-09-02");
    expect(result?.references).toHaveLength(12);
  });

  it("excludes a later snapshot that falls after the period end", () => {
    // August 2026 period: [2026-08-01, 2026-09-01) — the 2 Sep snapshot is
    // AFTER the period end and must not leak into the KPI.
    const augustRowsUpToEnd = rowsUpTo(fixture, "2026-09-01");

    const result = latestSnapshot(augustRowsUpToEnd);

    expect(result?.day).toBe("2026-08-20");
    expect(result?.references).toHaveLength(10);
  });
});

describe("fetchRemovedCardRows (WR-03: floor clamp, never a bare ternary)", () => {
  it("clamps a range.start before the floor up to the floor, never emitting a lower gte bound", async () => {
    const { supabase, gteArgs } = makeFakeSupabaseForRemovedCards();

    await fetchRemovedCardRows(supabase, { start: "2026-01-01", end: null });

    expect(gteArgs[0]).toBe("2026-08-13T00:00:00Z");
  });

  it("passes through a range.start at or after the floor unchanged", async () => {
    const { supabase, gteArgs } = makeFakeSupabaseForRemovedCards();

    await fetchRemovedCardRows(supabase, { start: "2026-09-01", end: null });

    expect(gteArgs[0]).toBe("2026-09-01T00:00:00Z");
  });

  it("defaults to the floor when no range is given at all", async () => {
    const { supabase, gteArgs } = makeFakeSupabaseForRemovedCards();

    await fetchRemovedCardRows(supabase);

    expect(gteArgs[0]).toBe("2026-08-13T00:00:00Z");
  });
});
