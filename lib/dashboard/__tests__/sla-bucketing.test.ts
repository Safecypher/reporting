import { describe, expect, it } from "vitest";

import { rebucketSla, type SlaDailyRow } from "../sla-bucketing";

describe("rebucketSla", () => {
  it("passes daily rows through unchanged in UTC", () => {
    const rows: SlaDailyRow[] = [
      { day_utc: "2026-08-13", avg_duration_ms: 120, breach_count: 0 },
      { day_utc: "2026-08-14", avg_duration_ms: 800, breach_count: 3 },
    ];

    const result = rebucketSla(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", avgDurationMs: 120, breachCount: 0 },
      { bucketKey: "2026-08-14", label: "2026-08-14", avgDurationMs: 800, breachCount: 3 },
    ]);
  });

  it("groups days into ISO (Monday-start) weeks, sums breach counts, and averages duration across days", () => {
    const rows: SlaDailyRow[] = [
      { day_utc: "2026-08-17", avg_duration_ms: 100, breach_count: 1 },
      { day_utc: "2026-08-18", avg_duration_ms: 200, breach_count: 2 },
      { day_utc: "2026-08-23", avg_duration_ms: 300, breach_count: 3 },
      // next ISO week — must not merge with the above
      { day_utc: "2026-08-24", avg_duration_ms: 900, breach_count: 4 },
    ];

    const result = rebucketSla(rows, "weekly", "UTC");

    expect(result).toEqual([
      {
        bucketKey: "2026-08-17",
        label: "Week of 2026-08-17",
        avgDurationMs: 200, // mean of 100, 200, 300 (unweighted — no per-day count available)
        breachCount: 6,
      },
      {
        bucketKey: "2026-08-24",
        label: "Week of 2026-08-24",
        avgDurationMs: 900,
        breachCount: 4,
      },
    ]);
  });

  it("groups days into calendar months, sums breach counts, and averages duration", () => {
    const rows: SlaDailyRow[] = [
      { day_utc: "2026-08-31", avg_duration_ms: 100, breach_count: 1 },
      { day_utc: "2026-09-01", avg_duration_ms: 700, breach_count: 5 },
      { day_utc: "2026-09-02", avg_duration_ms: 300, breach_count: 0 },
    ];

    const result = rebucketSla(rows, "monthly", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08", label: "Aug 2026", avgDurationMs: 100, breachCount: 1 },
      { bucketKey: "2026-09", label: "Sep 2026", avgDurationMs: 500, breachCount: 5 },
    ]);
  });

  it("never includes a row from before the 13 Aug 2026 data window", () => {
    const rows: SlaDailyRow[] = [
      { day_utc: "2026-08-12", avg_duration_ms: 9999, breach_count: 999 },
      { day_utc: "2026-08-13", avg_duration_ms: 100, breach_count: 0 },
    ];

    const result = rebucketSla(rows, "daily", "UTC");

    expect(result).toEqual([
      { bucketKey: "2026-08-13", label: "2026-08-13", avgDurationMs: 100, breachCount: 0 },
    ]);
  });
});
