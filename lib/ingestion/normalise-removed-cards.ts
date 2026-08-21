import type { RemovedCardsRow } from "./parsers/removed-cards";

/** DATA-06: no removed-cards data before this instant is trustworthy. */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/**
 * D-01 (mirrors A1, normalise.ts): the removed-cards report's `RemovedAt`
 * column has no timezone marker at all (a fully naive timestamp, confirmed
 * by byte-inspecting the real sample file). Interpreted as UTC with NO
 * offset applied — the safest zero-conversion default and the canonical
 * storage/display zone (D-02). The original string is always retained as
 * `raw_removed_at` so every row can be cheaply re-derived under a different
 * assumed source zone without re-uploading files, if this assumption turns
 * out to be wrong.
 */
function naiveToUtcMs(raw: string): number {
  return Date.parse(`${raw}Z`);
}

/**
 * A normalised removed-cards row, ready to be written to the `removed_cards`
 * table. `row_hash` is intentionally NOT part of this shape — it is a
 * Postgres `GENERATED ALWAYS ... STORED` column computed by the database
 * over (raw_removed_at, external_card_reference), never in application code
 * (D-03, 0009_removed_cards.sql). removed-cards is an event log, not a daily
 * snapshot — there is deliberately no `report_date` field here (D-03).
 */
export interface NormalisedRemovedCardsRow {
  removed_at: string;
  raw_removed_at: string;
  external_card_reference: string;
}

export interface NormaliseResult {
  rows: NormalisedRemovedCardsRow[];
  /**
   * Count of valid rows dropped by the DATA-06 cutoff (before 2026-08-13).
   * Returned — never silently swallowed — so `ingest()` can account for every
   * parsed row (accepted + duplicates + rejected + excluded === total). CR-02.
   * Computed independently per report type — never shared/leaked across
   * handlers.
   */
  excludedPreWindow: number;
}

/**
 * Convert validated removed-cards rows into the shape
 * `IngestDeps.upsertRows("removed_cards", ...)` expects, and apply the
 * DATA-06 cutoff. `row_hash` is deliberately absent — it is a Postgres
 * `GENERATED ALWAYS ... STORED` column (see 0009_removed_cards.sql).
 *
 * Rows before the data window are counted in `excludedPreWindow` rather than
 * dropped silently. RemovedAt is guaranteed parseable by the Zod schema, so
 * an unparseable value would have been rejected upstream; the defensive
 * check here treats any residual unparseable value as excluded too (still
 * counted, never silently lost).
 */
export function normaliseRemovedCards(rows: RemovedCardsRow[]): NormaliseResult {
  const normalised: NormalisedRemovedCardsRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    const removedAtMs = naiveToUtcMs(row.RemovedAt);
    if (!Number.isFinite(removedAtMs) || removedAtMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({
      removed_at: new Date(removedAtMs).toISOString(),
      raw_removed_at: row.RemovedAt,
      external_card_reference: row.ExternalCardReference,
    });
  }

  return { rows: normalised, excludedPreWindow };
}
