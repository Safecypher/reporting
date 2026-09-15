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
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80, projected: null },
      { bucketKey: "2026-08-14", label: "2026-08-14", revenue: 135, projected: null },
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
      { bucketKey: "2026-08-17", label: "Week of 2026-08-17", revenue: 35.75, projected: null },
      { bucketKey: "2026-08-24", label: "Week of 2026-08-24", revenue: 99.99, projected: null },
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
      { bucketKey: "2026-08", label: "Aug 2026", revenue: 80, projected: null },
      { bucketKey: "2026-09", label: "Sep 2026", revenue: 150, projected: null },
    ]);
  });

  it("never includes a row from before the 13 Aug 2026 data window", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-12", revenue: "9999.99" },
      { day_utc: "2026-08-13", revenue: "80.00" },
    ];

    const result = rebucketRevenue(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80, projected: null },
    ]);
  });

  it("returns a null projected field, with unchanged revenue, when rows carry no projected value", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-13", revenue: "80.00" },
      { day_utc: "2026-08-14", revenue: "135.00" },
    ];

    const result = rebucketRevenue(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80, projected: null },
      { bucketKey: "2026-08-14", label: "2026-08-14", revenue: 135, projected: null },
    ]);
  });

  it("sums projected values per bucket when every contributing day carries one", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-17", revenue: "10.50", projected: "5.00" },
      { day_utc: "2026-08-18", revenue: "20.25", projected: "7.25" },
    ];

    const result = rebucketRevenue(rows, "weekly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-17", label: "Week of 2026-08-17", revenue: 30.75, projected: 12.25 },
    ]);
  });

  it("keeps a bucket's projected value null (not zero) when none of its days carry one", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-09-01", revenue: "0.50", projected: null },
      { day_utc: "2026-09-02", revenue: "1.25", projected: null },
    ];

    const result = rebucketRevenue(rows, "monthly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-09", label: "Sep 2026", revenue: 1.75, projected: null },
    ]);
  });

  it("sums only the days that carry a projected value in a mixed bucket", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-09-10", revenue: "0.60", projected: null },
      { day_utc: "2026-09-11", revenue: "0.65", projected: "19.93" },
      { day_utc: "2026-09-12", revenue: "0.70", projected: "20.11" },
    ];

    const result = rebucketRevenue(rows, "monthly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-09", label: "Sep 2026", revenue: 1.95, projected: 40.04 },
    ]);
  });

  it("excludes a pre-data-window row's projected value exactly as it excludes its revenue", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-12", revenue: "9999.99", projected: "500.00" },
      { day_utc: "2026-08-13", revenue: "80.00", projected: "10.00" },
    ];

    const result = rebucketRevenue(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", revenue: 80, projected: 10 },
    ]);
  });

  it("aggregates projected the same way for weekly and monthly granularity", () => {
    const rows: RevenueDailyRow[] = [
      { day_utc: "2026-08-31", revenue: "80.00", projected: "1.00" },
      { day_utc: "2026-09-01", revenue: "135.00", projected: "2.00" },
      { day_utc: "2026-09-02", revenue: "15.00", projected: null },
    ];

    const result = rebucketRevenue(rows, "monthly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08", label: "Aug 2026", revenue: 80, projected: 1 },
      { bucketKey: "2026-09", label: "Sep 2026", revenue: 150, projected: 2 },
    ]);
  });
});
