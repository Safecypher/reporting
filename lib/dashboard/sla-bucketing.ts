import {
  bucketKeyAndLabel,
  DATA_WINDOW_START,
  type BucketTimeZone,
  type Granularity,
} from "./bucketing";

/**
 * Pure re-bucketing of `v_sla_daily` rows into daily/weekly/monthly buckets,
 * optionally re-interpreted in one of the three D-04 IANA timezones. Mirrors
 * `rebucket` in bucketing.ts but for SLA duration + breach data (SLA-01).
 */

/** Shape of a `v_sla_daily` row as returned by supabase-js (numeric as string). */
export type SlaDailyRow = {
  day_utc: string;
  avg_duration_ms: number;
  breach_count: number;
};

export interface SlaBucketPoint {
  bucketKey: string;
  label: string;
  avgDurationMs: number;
  breachCount: number;
}

/**
 * Groups `rows` into the requested granularity, summing breach counts and
 * averaging duration per bucket.
 *
 * Averaging choice: `v_sla_daily` only exposes a per-day *average* duration,
 * not a per-day verification count — so there is no weight available to
 * compute a true count-weighted average across days grouped into a
 * weekly/monthly bucket. We therefore use the unweighted mean of the daily
 * averages within each bucket. This is documented as a deliberate
 * approximation (days with fewer verifications count equally to days with
 * more); if per-day counts become available later this can switch to
 * sum(avg*count)/sum(count) for an exact weighted average.
 *
 * Rows before the 13 Aug 2026 data window are defensively excluded
 * (mirroring the view's own cutoff).
 */
export function rebucketSla(
  rows: SlaDailyRow[],
  granularity: Granularity,
  timeZone: BucketTimeZone,
): SlaBucketPoint[] {
  const buckets = new Map<
    string,
    { bucketKey: string; label: string; durationSum: number; dayCount: number; breachCount: number }
  >();

  for (const row of rows) {
    if (row.day_utc.slice(0, 10) < DATA_WINDOW_START) continue;

    const { key, label } = bucketKeyAndLabel(row.day_utc, granularity, timeZone);
    const existing = buckets.get(key);

    if (existing) {
      existing.durationSum += row.avg_duration_ms;
      existing.dayCount += 1;
      existing.breachCount += row.breach_count;
    } else {
      buckets.set(key, {
        bucketKey: key,
        label,
        durationSum: row.avg_duration_ms,
        dayCount: 1,
        breachCount: row.breach_count,
      });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketKey.localeCompare(b.bucketKey))
    .map((bucket) => ({
      bucketKey: bucket.bucketKey,
      label: bucket.label,
      avgDurationMs: bucket.durationSum / bucket.dayCount,
      breachCount: bucket.breachCount,
    }));
}
