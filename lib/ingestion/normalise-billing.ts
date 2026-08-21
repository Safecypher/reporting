import type { BillingRow } from "./parsers/billing";

/** DATA-06: no billing data before this instant is trustworthy. Computed
 * independently here (per-type counter) rather than importing normalise.ts's
 * private constant — each normaliser must own its own excludedPreWindow
 * accounting (see 02-PATTERNS.md Anti-Patterns: never share a counter
 * across report types). */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/**
 * A normalised billing row, ready to be written to the `billing_transactions`
 * table via the generic `deps.upsertRows`. No `row_hash` — de-dup here is on
 * the natural key `transaction_id` (D-07), a plain UNIQUE column, not a
 * generated hash.
 */
export interface NormalisedBillingRow {
  event_time: string;
  raw_transaction_date: string;
  raw_transaction_time: string;
  processor: string;
  issuer_bank: string;
  transaction_id: string;
  token_reference: string;
  authorised: boolean;
  verification_kind: string;
  region: string;
}

export interface NormaliseBillingResult {
  rows: NormalisedBillingRow[];
  /**
   * Count of valid rows dropped by the DATA-06 cutoff (before 2026-08-13).
   * Returned — never silently swallowed — so `ingest()` can account for
   * every parsed row (accepted + duplicates + rejected + excluded === total,
   * CR-02).
   */
  excludedPreWindow: number;
}

/**
 * Convert validated billing rows into the shape `IngestDeps.upsertRows`
 * expects, and apply the DATA-06 cutoff.
 *
 * D-06: `timestamp` is already Z-suffixed UTC (unlike verification's naive
 * CreatedAt) — event_time is derived with a plain `new Date(...).toISOString()`,
 * no `naiveToUtcMs`-style offset assumption needed.
 *
 * D-05: ALL rows are stored, including `authorised="False"` (declined)
 * transactions — there is no business-rule filtering here beyond the
 * DATA-06 cutoff. Full lineage for revenue reconciliation requires every
 * declined attempt to be visible, not just successful ones.
 */
export function normaliseBilling(rows: BillingRow[]): NormaliseBillingResult {
  const normalised: NormalisedBillingRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    const eventTimeMs = Date.parse(row.timestamp);
    if (!Number.isFinite(eventTimeMs) || eventTimeMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({
      event_time: new Date(eventTimeMs).toISOString(),
      raw_transaction_date: row.transactionDate,
      raw_transaction_time: row.transactionTime,
      processor: row.processor,
      issuer_bank: row.issuerBank,
      transaction_id: row.transactionId,
      token_reference: row.tokenReference,
      authorised: row.authorised === "True",
      verification_kind: row.verificationKind,
      region: row.region,
    });
  }

  return { rows: normalised, excludedPreWindow };
}
