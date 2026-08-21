import type { DcvvRow } from "./parsers/dcvv";

/** DATA-06: no dCVV data before this instant is trustworthy. */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/**
 * A normalised dCVV row, ready to be written to the `dcvv_fetches` table.
 * `row_hash` is intentionally absent — it is a Postgres
 * `GENERATED ALWAYS ... STORED` column computed by the database (D-04),
 * never in application code.
 */
export interface NormalisedDcvvRow {
  timestamp: string;
  raw_timestamp: string;
  duration_ms: number;
  external_reference: string;
}

export interface NormaliseDcvvResult {
  rows: NormalisedDcvvRow[];
  /**
   * Count of valid rows dropped by the DATA-06 cutoff (before 2026-08-13).
   * Returned — never silently swallowed — so `ingest()` can account for
   * every parsed row (accepted + duplicates + rejected + excluded ===
   * total). CR-02.
   */
  excludedPreWindow: number;
}

/**
 * Convert validated dCVV rows into the shape `IngestDeps.upsertRows`
 * expects, and apply the DATA-06 cutoff.
 *
 * Unlike verification's naive `CreatedAt` (A1), dCVV's `timestamp` is
 * already Z-suffixed (confirmed UTC), so `new Date(raw).toISOString()`
 * is used directly with no `naiveToUtcMs`-style offset assumption.
 * `raw_timestamp` retains the original string for lineage.
 */
export function normaliseDcvv(rows: DcvvRow[]): NormaliseDcvvResult {
  const normalised: NormalisedDcvvRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    const timestampMs = Date.parse(row.timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({
      timestamp: new Date(timestampMs).toISOString(),
      raw_timestamp: row.timestamp,
      duration_ms: row.duration,
      external_reference: row.ExternalReference,
    });
  }

  return { rows: normalised, excludedPreWindow };
}
