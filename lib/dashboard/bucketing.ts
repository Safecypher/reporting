import { format, startOfMonth, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Pure re-bucketing of the `v_verifications_daily` view's daily rows into
 * daily/weekly/monthly buckets, optionally re-interpreted in one of the
 * three D-04 IANA timezones. No network/DOM access — safe to unit test and
 * to call from a client component on every toggle change.
 */

export type DailyRow = {
  day_utc: string;
  authenticated_count: number;
  failed_count: number;
};

export type Granularity = "daily" | "weekly" | "monthly";

/** Exactly the three options sanctioned by D-04 — no full IANA picker. */
export type BucketTimeZone = "UTC" | "Europe/London" | "America/Chicago";

export interface BucketPoint {
  bucketKey: string;
  label: string;
  authenticated: number;
  failed: number;
}

/** Mirrors the 13 Aug 2026 cutoff baked into `v_verifications_daily` (DATA-06). */
const DATA_WINDOW_START = "2026-08-13";

function bucketKeyAndLabel(
  dayUtc: string,
  granularity: Granularity,
  timeZone: BucketTimeZone,
): { key: string; label: string } {
  // `day_utc` is a UTC-truncated day. Supabase/Postgres returns it as a full
  // timestamptz string ("2026-08-13 00:00:00+00"), while unit fixtures may use a
  // bare date ("2026-08-13"). Take the first 10 chars (the YYYY-MM-DD calendar
  // day) in both cases and reconstruct UTC midnight — the same instant — then
  // shift into the selected zone via date-fns-tz (no hand-rolled offset math).
  const datePart = dayUtc.slice(0, 10);
  const utcMidnight = new Date(`${datePart}T00:00:00Z`);
  const zoned = toZonedTime(utcMidnight, timeZone);

  if (granularity === "daily") {
    const key = format(zoned, "yyyy-MM-dd");
    return { key, label: key };
  }

  if (granularity === "weekly") {
    const weekStart = startOfWeek(zoned, { weekStartsOn: 1 });
    const key = format(weekStart, "yyyy-MM-dd");
    return { key, label: `Week of ${key}` };
  }

  const monthStart = startOfMonth(zoned);
  const key = format(monthStart, "yyyy-MM");
  return { key, label: format(monthStart, "MMM yyyy") };
}

/**
 * Groups `rows` into the requested granularity, summing the authenticated
 * and failed counts per bucket. Rows before the 13 Aug 2026 data window are
 * defensively excluded (mirroring the view's own cutoff).
 */
export function rebucket(
  rows: DailyRow[],
  granularity: Granularity,
  timeZone: BucketTimeZone,
): BucketPoint[] {
  const buckets = new Map<string, BucketPoint>();

  for (const row of rows) {
    if (row.day_utc.slice(0, 10) < DATA_WINDOW_START) continue;

    const { key, label } = bucketKeyAndLabel(row.day_utc, granularity, timeZone);
    const existing = buckets.get(key);

    if (existing) {
      existing.authenticated += row.authenticated_count;
      existing.failed += row.failed_count;
    } else {
      buckets.set(key, {
        bucketKey: key,
        label,
        authenticated: row.authenticated_count,
        failed: row.failed_count,
      });
    }
  }

  return Array.from(buckets.values()).sort((a, b) =>
    a.bucketKey.localeCompare(b.bucketKey),
  );
}
