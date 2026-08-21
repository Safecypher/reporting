import {
  bucketKeyAndLabel,
  DATA_WINDOW_START,
  type BucketTimeZone,
  type Granularity,
} from "./bucketing";

/**
 * Pure re-bucketing of `v_revenue_daily` rows into daily/weekly/monthly
 * buckets, optionally re-interpreted in one of the three D-04 IANA
 * timezones. Mirrors `rebucket`/`rebucketSla` in bucketing.ts/sla-bucketing.ts
 * but for revenue data (REV-01).
 *
 * IMPORTANT (Pitfall 2, T-03-16): this client-side re-bucket exists ONLY to
 * drive the chart series (data volumes are tiny per 03-RESEARCH.md). The
 * authoritative grand total displayed in the "Total revenue" KPI must come
 * from a dedicated SQL SUM() over `v_revenue_daily` (or an equivalent
 * server-computed total), never from summing the numbers produced here —
 * the revenue string is only converted to a JS `number` at this final
 * chart-aggregation step, and that number is never re-used as the
 * authoritative total.
 */

/** Shape of a `v_revenue_daily` row as returned by supabase-js (NUMERIC as string). */
export type RevenueDailyRow = { day_utc: string; revenue: string };

export interface RevenueBucketPoint {
  bucketKey: string;
  label: string;
  revenue: number;
}

/**
 * Groups `rows` into the requested granularity, summing revenue per bucket.
 * The `revenue` string (Postgres NUMERIC returned as a string by
 * supabase-js) is converted to a `number` only here, for chart-series
 * purposes — never treat this sum as the authoritative grand total (use the
 * SQL-computed total for the KPI card instead).
 *
 * Rows before the 13 Aug 2026 data window are defensively excluded
 * (mirroring the view's own cutoff).
 */
export function rebucketRevenue(
  rows: RevenueDailyRow[],
  granularity: Granularity,
  timeZone: BucketTimeZone,
): RevenueBucketPoint[] {
  const buckets = new Map<string, RevenueBucketPoint>();

  for (const row of rows) {
    if (row.day_utc.slice(0, 10) < DATA_WINDOW_START) continue;

    const { key, label } = bucketKeyAndLabel(row.day_utc, granularity, timeZone);
    const existing = buckets.get(key);
    const revenue = Number(row.revenue);

    if (existing) {
      existing.revenue += revenue;
    } else {
      buckets.set(key, { bucketKey: key, label, revenue });
    }
  }

  return Array.from(buckets.values()).sort((a, b) =>
    a.bucketKey.localeCompare(b.bucketKey),
  );
}
