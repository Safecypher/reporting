import type { CardInventoryRow } from "./parsers/card-inventory";

/** DATA-06: no data before this instant is trustworthy, applied per type (CR-02). */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/**
 * Parse a naive wall-clock string as UTC (A1/D-01) — same convention as
 * `lib/ingestion/normalise.ts`'s `naiveToUtcMs`, duplicated locally (not
 * imported) so this module has no shared-file coupling with the other five
 * Wave 2 report slices.
 */
function naiveToUtcMs(raw: string): number {
  return Date.parse(`${raw}Z`);
}

export interface NormalisedCardInventoryRow {
  report_date: string;
  external_card_reference: string;
  created_at: string;
  raw_created_at: string;
}

export interface NormaliseCardInventoryResult {
  rows: NormalisedCardInventoryRow[];
  /**
   * Count of valid rows dropped by the DATA-06 cutoff. Returned — never
   * silently swallowed — so `ingest()` can account for every parsed row
   * (accepted + duplicates + rejected + excluded === total). CR-02.
   */
  excludedPreWindow: number;
}

/**
 * Convert validated card-inventory rows into the shape
 * `deps.upsertRows('card_inventory', ...)` expects.
 *
 * CRITICAL (D-02, race-safety): `report_date` is read OFF each row — the
 * value `parseCardInventory` embedded from the filename — and threaded
 * straight through. This function takes NO `reportDate` parameter and holds
 * NO closure/module-level state: two concurrent card-inventory uploads
 * processed in the same Node process can never cross-contaminate each
 * other's snapshot day, which would otherwise corrupt the
 * `(report_date, external_card_reference)` dedup key this table relies on.
 */
export function normaliseCardInventory(
  rows: CardInventoryRow[]
): NormaliseCardInventoryResult {
  const normalised: NormalisedCardInventoryRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    // CR-01: the DATA-06 window must be keyed off the SNAPSHOT day
    // (`report_date`, derived from the filename), NOT each card's `CreatedAt`
    // (per-card enrolment time). A card enrolled before the window is still
    // legitimately present in a current snapshot and must be kept and counted
    // — filtering on enrolment time silently drops most of the live card base
    // and corrupts inventory reconciliation. `created_at` is still parsed from
    // `CreatedAt` for storage.
    const createdAtMs = naiveToUtcMs(row.CreatedAt);
    const reportDateMs = Date.parse(`${row.report_date}T00:00:00Z`);
    if (!Number.isFinite(reportDateMs) || reportDateMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({
      report_date: row.report_date,
      external_card_reference: row.ExternalCardReference,
      created_at: new Date(createdAtMs).toISOString(),
      raw_created_at: row.CreatedAt,
    });
  }

  return { rows: normalised, excludedPreWindow };
}
