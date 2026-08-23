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

/**
 * Card-inventory drill fetcher (RECON-02/RECON-03, "recon-inventory"
 * entity). Mirrors fetchReconciliationBillingDrillRows's shape, but against
 * TWO source tables (card_inventory + removed_cards) for a single flagged
 * UTC day, returned EXPLICITLY SEPARATED (Pitfall 5) -- never merged into
 * one flat list.
 *
 * card_inventory is scoped by report_date (a plain `date` column, `.eq()`,
 * not a day-range) -- one row per card per snapshot day. removed_cards is
 * scoped by removed_at (`.gte()`/`.lt()` day-range) since it is an event
 * log, not a snapshot.
 */

export interface ReconciliationInventoryCardRow {
  report_date: string;
  external_card_reference: string;
  created_at: string;
  source_file_id: string;
}

export interface ReconciliationRemovedCardRow {
  removed_at: string;
  external_card_reference: string;
  source_file_id: string;
}

export interface ReconciliationInventoryDrillFetchResult {
  cardInventoryRows: ReconciliationInventoryCardRow[];
  cardInventoryTotalCount: number | null;
  removedCardRows: ReconciliationRemovedCardRow[];
  removedCardTotalCount: number | null;
}

const EMPTY_INVENTORY_RESULT: ReconciliationInventoryDrillFetchResult = {
  cardInventoryRows: [],
  cardInventoryTotalCount: null,
  removedCardRows: [],
  removedCardTotalCount: null,
};

/**
 * Server-fetches the card_inventory and removed_cards rows contributing to
 * a single flagged UTC day's card-inventory reconciliation row. `date` must
 * already be a validated `YYYY-MM-DD` string (from `parseDrillParams`) --
 * this function only ever builds `.eq()`/`.gte()`/`.lt()` filters from it,
 * never a string-interpolated query fragment.
 */
export async function fetchReconciliationInventoryDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  date: string | undefined,
): Promise<ReconciliationInventoryDrillFetchResult> {
  if (!date) return EMPTY_INVENTORY_RESULT;

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [cardInventoryResult, removedCardResult] = await Promise.all([
    supabase
      .from("card_inventory")
      .select("report_date, external_card_reference, created_at, source_file_id", {
        count: "exact",
      })
      .eq("report_date", date)
      .order("external_card_reference", { ascending: true })
      .limit(DRILL_ROW_LIMIT)
      .returns<ReconciliationInventoryCardRow[]>(),
    supabase
      .from("removed_cards")
      .select("removed_at, external_card_reference, source_file_id", { count: "exact" })
      .gte("removed_at", dayStart)
      .lt("removed_at", dayEnd)
      .order("removed_at", { ascending: false })
      .limit(DRILL_ROW_LIMIT)
      .returns<ReconciliationRemovedCardRow[]>(),
  ]);

  return {
    cardInventoryRows: cardInventoryResult.error ? [] : cardInventoryResult.data ?? [],
    cardInventoryTotalCount: cardInventoryResult.error ? null : cardInventoryResult.count ?? null,
    removedCardRows: removedCardResult.error ? [] : removedCardResult.data ?? [],
    removedCardTotalCount: removedCardResult.error ? null : removedCardResult.count ?? null,
  };
}
