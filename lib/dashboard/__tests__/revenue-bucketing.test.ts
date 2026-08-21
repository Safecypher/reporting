import { describe, expect, it } from "vitest";

import { rebucketRevenue, type RevenueDailyRow } from "../revenue-bucketing";

describe("rebucketRevenue", () => {
  it("passes daily rows through unchanged in UTC", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-13", revenue: "80.00" },
      { day_utc: "2026-08-14", revenue: "135.00" },
    ];

    const result = rebucketRevenue(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80 },
      { bucketKey: "2026-08-14", label: "2026-08-14", revenue: 135 },
    ]);
  });

  it("groups days into ISO (Monday-start) weeks and sums revenue", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-17", revenue: "10.50" },
      { day_utc: "2026-08-18", revenue: "20.25" },
      { day_utc: "2026-08-23", revenue: "5.00" },
      // next ISO week — must not merge with the above
      { day_utc: "2026-08-24", revenue: "99.99" },
    ];

    const result = rebucketRevenue(rows, "weekly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-17", label: "Week of 2026-08-17", revenue: 35.75 },
      { bucketKey: "2026-08-24", label: "Week of 2026-08-24", revenue: 99.99 },
    ]);
  });

  it("groups days into calendar months and sums revenue", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-31", revenue: "80.00" },
      { day_utc: "2026-09-01", revenue: "135.00" },
      { day_utc: "2026-09-02", revenue: "15.00" },
    ];

    const result = rebucketRevenue(rows, "monthly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08", label: "Aug 2026", revenue: 80 },
      { bucketKey: "2026-09", label: "Sep 2026", revenue: 150 },
    ]);
  });

  it("never includes a row from before the 13 Aug 2026 data window", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-12", revenue: "9999.99" },
      { day_utc: "2026-08-13", revenue: "80.00" },
    ];

    const result = rebucketRevenue(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80 },
    ]);
  });
});
