import type { NormalisedVerificationRow } from "./types";
import type { VerificationRow } from "./parsers/verification";

/** DATA-06: no verification data before this instant is trustworthy. */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/**
 * ASSUMPTION A1 (see 01-RESEARCH.md "Pitfall 1" / "Assumptions Log"):
 * the verification report's `CreatedAt` column has no timezone marker at
 * all (a fully naive timestamp, confirmed by byte-inspecting the real
 * sample file). Pending confirmation from Joachim/Chris/Richard, this is
 * interpreted as UTC with NO offset applied — the safest zero-conversion
 * default and the canonical storage/display zone (D-02). The original
 * string is always retained as `raw_created_at` so every row can be
 * cheaply re-derived under a different assumed source zone without
 * re-uploading files, if this assumption turns out to be wrong.
 */
/**
 * Parse a naive wall-clock string as UTC. Appending "Z" tells the parser to
 * interpret it as UTC rather than the host's local timezone. Returns the epoch
 * ms (NaN if unparseable) so callers can check validity WITHOUT risking the
 * RangeError that `new Date(invalid).toISOString()` throws.
 */
function naiveToUtcMs(raw: string): number {
  return Date.parse(`${raw}Z`);
}

export interface NormaliseResult {
  rows: NormalisedVerificationRow[];
  /**
   * Count of valid rows dropped by the DATA-06 cutoff (before 2026-08-13).
   * Returned — never silently swallowed — so `ingest()` can account for every
   * parsed row (accepted + duplicates + rejected + excluded === total). CR-02.
   */
  excludedPreWindow: number;
}

/**
 * Convert validated verification rows into the shape `IngestDeps.upsertVerifications`
 * expects, and apply the DATA-06 cutoff. `row_hash` is deliberately absent —
 * it is a Postgres `GENERATED ALWAYS ... STORED` column (see 01-03 migrations).
 *
 * Rows before the data window are counted in `excludedPreWindow` rather than
 * dropped silently. CreatedAt is guaranteed parseable by the Zod schema, so an
 * unparseable value would have been rejected upstream; the defensive check here
 * treats any residual unparseable value as excluded too (still counted, never
 * silently lost).
 */
export function normaliseVerification(rows: VerificationRow[]): NormaliseResult {
  const normalised: NormalisedVerificationRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    const createdAtMs = naiveToUtcMs(row.CreatedAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({
      created_at: new Date(createdAtMs).toISOString(),
      raw_created_at: row.CreatedAt,
      external_card_reference: row.ExternalCardReference,
      cvi2_value: row.Cvi2Value,
      duration_ms: row.duration,
      authenticated: row.Authenticated === "True",
    });
  }

  return { rows: normalised, excludedPreWindow };
}
