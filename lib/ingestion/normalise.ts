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
function naiveToUtcIso(raw: string): string {
  // Appending "Z" tells the parser to interpret the naive wall-clock string
  // as UTC rather than the host's local timezone.
  return new Date(`${raw}Z`).toISOString();
}

/**
 * Convert validated verification rows into the shape `IngestDeps.upsertVerifications`
 * expects, and apply the DATA-06 cutoff. `row_hash` is deliberately absent —
 * it is a Postgres `GENERATED ALWAYS ... STORED` column (see 01-03 migrations).
 */
export function normaliseVerification(rows: VerificationRow[]): NormalisedVerificationRow[] {
  const normalised: NormalisedVerificationRow[] = [];

  for (const row of rows) {
    const createdAtIso = naiveToUtcIso(row.CreatedAt);
    const createdAtMs = Date.parse(createdAtIso);
    if (!Number.isFinite(createdAtMs) || createdAtMs < DATA_WINDOW_START) {
      continue;
    }
    normalised.push({
      created_at: createdAtIso,
      raw_created_at: row.CreatedAt,
      external_card_reference: row.ExternalCardReference,
      cvi2_value: row.Cvi2Value,
      duration_ms: row.duration,
      authenticated: row.Authenticated === "True",
    });
  }

  return normalised;
}
