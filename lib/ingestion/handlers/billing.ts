import { matchesHeader } from "../classify";
import { normaliseBilling } from "../normalise-billing";
import { parseBilling, validateBillingRows } from "../parsers/billing";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const BILLING_HEADER = [
  "timestamp",
  "transactionDate",
  "transactionTime",
  "processor",
  "issuerBank",
  "transactionId",
  "tokenReference",
  "authorised",
  "verificationKind",
  "region",
] as const;

/**
 * Billing wrapped as a `ReportHandler`. Overwrites the Wave 1 stub — real
 * parse/validate/normalise/upsert now delegate to the Wave 2 billing slice.
 * `upsert` uses the generic `deps.upsertRows` on `transaction_id` (D-07,
 * ON CONFLICT DO NOTHING semantics — never DO UPDATE, Pitfall 5), unlike
 * verification's dedicated `upsertVerifications`.
 */
export const billingHandler: ReportHandler = {
  reportType: "billing",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("billing-report");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, BILLING_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(bytes: Uint8Array): Promise<{ rawRows: Record<string, unknown>[] }> {
    const parsed = parseBilling(bytes);
    return { rawRows: parsed.rows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateBillingRows(rawRows as unknown as Record<string, string>[]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseBilling(valid as Parameters<typeof normaliseBilling>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertRows("billing_transactions", rows, {
      onConflict: "transaction_id",
      ignoreDuplicates: true,
    });
  },
};
