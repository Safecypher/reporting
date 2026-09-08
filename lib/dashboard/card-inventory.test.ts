import { describe, expect, it } from "vitest";

import {
  firstSeenByCard,
  latestSnapshot,
  netChange,
  removalSeries,
  snapshotSeries,
  type CardInventoryRow,
  type RemovedCardRow,
} from "./card-inventory";

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
