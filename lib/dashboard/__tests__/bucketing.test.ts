import { describe, expect, it } from "vitest";

import { rebucket, type DailyRow } from "@/lib/dashboard/bucketing";

describe("rebucket", () => {
  it("passes daily rows through unchanged in UTC", () => {
    const rows: DailyRow[] = [
      { day_utc: "2026-08-13", authenticated_count: 10, failed_count: 2 },
      { day_utc: "2026-08-14", authenticated_count: 5, failed_count: 1 },
    ];

    const result = rebucket(rows, "daily", "UTC");

    expect(result).toEqual([
      {
        bucketKey: "2026-08-13",
        label: "2026-08-13",
        authenticated: 10,
        failed: 2,
      },
      {
        bucketKey: "2026-08-14",
        label: "2026-08-14",
        authenticated: 5,
        failed: 1,
      },
    ]);
  });

  it("groups days into ISO (Monday-start) weeks and sums both series", () => {
    const rows: DailyRow[] = [
      { day_utc: "2026-08-17", authenticated_count: 10, failed_count: 1 },
      { day_utc: "2026-08-18", authenticated_count: 20, failed_count: 2 },
      { day_utc: "2026-08-23", authenticated_count: 30, failed_count: 3 },
      // next ISO week — must not merge with the above
      { day_utc: "2026-08-24", authenticated_count: 100, failed_count: 9 },
    ];

    const result = rebucket(rows, "weekly", "UTC");

    expect(result).toEqual([
      {
        bucketKey: "2026-08-17",
        label: "Week of 2026-08-17",
        authenticated: 60,
        failed: 6,
      },
      {
        bucketKey: "2026-08-24",
        label: "Week of 2026-08-24",
        authenticated: 100,
        failed: 9,
      },
    ]);
  });

  it("groups days into calendar months and sums both series", () => {
    const rows: DailyRow[] = [
      { day_utc: "2026-08-31", authenticated_count: 4, failed_count: 1 },
      { day_utc: "2026-09-01", authenticated_count: 6, failed_count: 2 },
    ];

    const result = rebucket(rows, "monthly", "UTC");

    expect(result).toEqual([
      {
        bucketKey: "2026-08",
        label: "Aug 2026",
        authenticated: 4,
        failed: 1,
      },
      {
        bucketKey: "2026-09",
        label: "Sep 2026",
        authenticated: 6,
        failed: 2,
      },
    ]);
  });

  it("re-buckets a boundary day into the adjacent bucket when the timezone shifts it (DST-safe via date-fns-tz)", () => {
    const rows: DailyRow[] = [
      { day_utc: "2026-08-13", authenticated_count: 10, failed_count: 0 },
    ];

    // UTC midnight on 2026-08-13 is 2026-08-12 19:00 in America/Chicago
    // (CDT, UTC-5) — the count must land in the previous day's bucket.
    const chicago = rebucket(rows, "daily", "America/Chicago");
    expect(chicago).toEqual([
      {
        bucketKey: "2026-08-12",
        label: "2026-08-12",
        authenticated: 10,
        failed: 0,
      },
    ]);

    // Europe/London (BST, UTC+1) stays on the same calendar day.
    const london = rebucket(rows, "daily", "Europe/London");
    expect(london).toEqual([
      {
        bucketKey: "2026-08-13",
        label: "2026-08-13",
        authenticated: 10,
        failed: 0,
      },
    ]);
  });

  it("never includes a row from before the 13 Aug 2026 data window", () => {
    const rows: DailyRow[] = [
      { day_utc: "2026-08-12", authenticated_count: 999, failed_count: 999 },
      { day_utc: "2026-08-13", authenticated_count: 1, failed_count: 0 },
    ];

    const result = rebucket(rows, "daily", "UTC");

    expect(result).toEqual([
      {
        bucketKey: "2026-08-13",
        label: "2026-08-13",
        authenticated: 1,
        failed: 0,
      },
    ]);
  });
});
