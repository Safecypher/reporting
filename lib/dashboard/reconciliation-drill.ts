import type { createClient } from "@/lib/supabase/server";
import { DATA_WINDOW_START, DRILL_ROW_LIMIT } from "@/lib/dashboard/verification-drill";

/**
 * Billing-vs-verification drill fetcher (RECON-01/DASH-03, "recon-billing"
 * entity). Mirrors lib/dashboard/verification-drill.ts's fetch template,
 * but scoped to a single UTC day (`.gte()`/`.lt()` day-range, per
 * app/(dashboard)/sla/page.tsx's fetchSlaBreachDrillRows day-range pattern)
 * and against TWO source tables at once (billing_transactions +
 * verifications), returned EXPLICITLY SEPARATED (Pitfall 5) -- never merged
 * into one flat list, since the whole point of this drill is showing both
 * sides of the reconciliation independently.
 *
 * Whitelisted, parameterised: only `.gte()`/`.lt()`/`.order()`/`.limit()`
 * builder calls are used, the `date` argument is never string-interpolated
 * into a raw query fragment (T-04-04/T-03-19).
 */

export { DATA_WINDOW_START, DRILL_ROW_LIMIT };

export interface ReconciliationBillingDrillRow {
  event_time: string;
  transaction_id: string;
  authorised: boolean;
  verification_kind: string;
  region: string;
  source_file_id: string;
}

export interface ReconciliationVerificationDrillRow {
  created_at: string;
  external_card_reference: string;
  duration_ms: number;
  authenticated: boolean;
}

export interface ReconciliationBillingDrillFetchResult {
  billingRows: ReconciliationBillingDrillRow[];
  billingTotalCount: number | null;
  verificationRows: ReconciliationVerificationDrillRow[];
  verificationTotalCount: number | null;
  /** D-02 composition breakdown, computed client-side from the fetched rows (PoC scale). */
  authorisedCount: number;
  declinedCount: number;
  authenticatedCount: number;
  failedCount: number;
}

const EMPTY_RESULT: ReconciliationBillingDrillFetchResult = {
  billingRows: [],
  billingTotalCount: null,
  verificationRows: [],
  verificationTotalCount: null,
  authorisedCount: 0,
  declinedCount: 0,
  authenticatedCount: 0,
  failedCount: 0,
};

/**
 * Server-fetches the billing_transactions and verifications rows
 * contributing to a single flagged UTC day's billing-vs-verification
 * reconciliation row. `date` must already be a validated `YYYY-MM-DD`
 * string (from `parseDrillParams`) -- this function only ever builds
 * `.gte()`/`.lt()` day-range filters from it, never a string-interpolated
 * query fragment.
 */
export async function fetchReconciliationBillingDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  date: string | undefined,
): Promise<ReconciliationBillingDrillFetchResult> {
  if (!date) return EMPTY_RESULT;

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [billingResult, verificationResult] = await Promise.all([
    supabase
      .from("billing_transactions")
      .select("event_time, transaction_id, authorised, verification_kind, region, source_file_id", {
        count: "exact",
      })
      .gte("event_time", dayStart)
      .lt("event_time", dayEnd)
      .order("event_time", { ascending: false })
      .limit(DRILL_ROW_LIMIT)
      .returns<ReconciliationBillingDrillRow[]>(),
    supabase
      .from("verifications")
      .select("created_at, external_card_reference, duration_ms, authenticated", {
        count: "exact",
      })
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd)
      .order("created_at", { ascending: false })
      .limit(DRILL_ROW_LIMIT)
      .returns<ReconciliationVerificationDrillRow[]>(),
  ]);

  const billingRows = billingResult.error ? [] : billingResult.data ?? [];
  const verificationRows = verificationResult.error ? [] : verificationResult.data ?? [];

  return {
    billingRows,
    billingTotalCount: billingResult.error ? null : billingResult.count ?? null,
    verificationRows,
    verificationTotalCount: verificationResult.error ? null : verificationResult.count ?? null,
    authorisedCount: billingRows.filter((row) => row.authorised).length,
    declinedCount: billingRows.filter((row) => !row.authorised).length,
    authenticatedCount: verificationRows.filter((row) => row.authenticated).length,
    failedCount: verificationRows.filter((row) => !row.authenticated).length,
  };
}
