"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { pricingTierSetSchema } from "@/lib/pricing/schema";

const GENERIC_ERROR =
  "Could not save pricing tiers — please check the values and try again.";

/**
 * Maps a raw Postgres/PostgREST error message to safe, user-facing copy
 * (WR-01: raw constraint/schema names must never reach the form UI). The
 * detailed message is always logged server-side first.
 */
const DATA_WINDOW_BLOCKED_MESSAGE =
  "This is the only tier set covering the data window (from 13 Aug 2026). Add a replacement before deleting this one.";

/**
 * D-17/D-19: maps the data-window coverage guard's `check_violation` — new
 * in 0025, raised by both `save_pricing_tier_set` (an edit that backdates
 * or removes coverage) and `delete_pricing_tier_set` — to the UI-SPEC's
 * exact blocked-delete copy. The guard's underlying message differs
 * slightly by call site (`save_pricing_tier_set: this change would leave...`
 * vs `delete_pricing_tier_set: this is the only tier set...`), but the
 * user-facing consequence is identical: a write that would leave 2026-08-13
 * uncovered. `isDelete` only changes nothing today (both map to the same
 * copy) but keeps the call sites self-documenting about which action
 * triggered it.
 */
function isDataWindowCoverageError(rawMessage: string): boolean {
  return (
    rawMessage.includes("would leave the data window") ||
    rawMessage.includes("is the only tier set covering the data window")
  );
}

/**
 * Maps a raw Postgres/PostgREST error message to safe, user-facing copy
 * (WR-01: raw constraint/schema names must never reach the form UI). The
 * detailed message is always logged server-side first.
 */
function friendlyErrorMessage(rawMessage: string): string {
  if (rawMessage.includes("pricing_tier_sets_effective_from_key")) {
    return "A pricing tier set already exists for this date.";
  }
  if (isDataWindowCoverageError(rawMessage)) {
    // D-17: the retired backdating guard's mapping is replaced by this one
    // — the only guard left on effective_from is the data-window coverage
    // check (RESEARCH Pitfall 1), never "must be after the latest existing".
    return DATA_WINDOW_BLOCKED_MESSAGE;
  }
  if (rawMessage.includes("no pricing tier set found for id")) {
    return "That pricing tier set no longer exists — it may have already been deleted.";
  }
  if (
    rawMessage.includes("open-ended") ||
    rawMessage.includes("contiguous tier_order") ||
    rawMessage.includes("ascending upper_bound")
  ) {
    return "Tiers must be contiguous and in ascending order, ending with a single open-ended tier — check the thresholds and try again.";
  }
  return GENERIC_ERROR;
}

/**
 * savePricingTierSet — the pricing admin's only write path (ADMIN-01, REV-02).
 * D-17: now also the in-place EDIT path — passing `tierSetId` routes the RPC
 * to its UPDATE branch instead of INSERT.
 *
 * Security-critical shape (03-PATTERNS/03-RESEARCH Pattern 4, T-03-05/T-03-06):
 * - Re-validates `input` with the SAME Zod schema the client form uses.
 *   Client-side react-hook-form validation is UX only — this action is an
 *   untrusted entry point and must never trust its caller.
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never the
 *   privileged-key writer used by app/api/ingest/route.ts) so `auth.uid()`
 *   is present on the session and reaches the `pricing_tier_sets` AFTER
 *   INSERT trigger (insert path) or the explicit audit insert inside the
 *   RPC (update path, D-18) — both are what attribute the audit trail to
 *   the acting user. The privileged-key writer has no session user and
 *   would silently break attribution.
 * - Returns a plain result object (not NextResponse) — this is a Server
 *   Action invoked directly by the form's `handleSubmit`, not an HTTP route.
 *
 * CR-04: the tier-set row and its tier rows are written by a single
 * `save_pricing_tier_set` RPC (supabase/migrations/0015_pricing_tier_integrity.sql,
 * extended to 4 arguments by 0025_pricing_tier_edit_in_place.sql) so the
 * writes are transactional — a failure partway through can never leave an
 * orphaned, audit-logged tier set with zero tiers. D-17 retired CR-05's
 * "must be strictly after the latest existing" backdating guard; the only
 * guard remaining on `effective_from` is the data-window coverage check
 * (RESEARCH Pitfall 1), mapped above.
 */
export async function savePricingTierSet(
  input: unknown,
  tierSetId?: string | null
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = pricingTierSetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // types/db.ts lacks the 4-argument save_pricing_tier_set until the
  // orchestrator regenerates types after 0025 is pushed (plan 05-05) —
  // narrow cast only, same pattern deleteLatestPricingTierSet already
  // established (see delete_pricing_tier_set below). Passing all four named
  // arguments explicitly also removes any PostgREST overload-ambiguity risk
  // (P-03: the 3-argument function is dropped, not overloaded, by 0025 —
  // this cast just keeps TypeScript honest about the new signature).
  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: {
        p_effective_from: string;
        p_reset_window: string;
        p_tiers: { tierOrder: number; upperBound: number | null; rate: number }[];
        p_tier_set_id: string | null;
      }
    ) => Promise<{ error: { message: string } | null }>
  )("save_pricing_tier_set", {
    p_effective_from: parsed.data.effectiveFrom,
    p_reset_window: parsed.data.resetWindow,
    p_tiers: parsed.data.tiers.map((tier, index) => ({
      tierOrder: index,
      upperBound: tier.upperBound,
      rate: tier.rate,
    })),
    p_tier_set_id: tierSetId ?? null,
  });

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error("savePricingTierSet: save_pricing_tier_set RPC failed", error);
    return { error: friendlyErrorMessage(error.message) };
  }

  // REV-02: same-roundtrip revalidation, no re-ingestion required — Revenue
  // re-reads the effective-dated tier set on next render. WR-02: also
  // revalidate the settings page itself so the new audit-log entry (D-06)
  // appears without a manual reload. /reconciliation is revalidated too
  // (05-04): an edited rate changes the revenue side of the billing
  // reconciliation.
  revalidatePath("/revenue");
  revalidatePath("/settings/pricing");
  revalidatePath("/reconciliation");

  return { success: true };
}

/**
 * Maps a raw Postgres error from delete_pricing_tier_set (migration 0025) to
 * safe, user-facing copy (WR-01) — mirrors friendlyErrorMessage above.
 */
function friendlyDeleteErrorMessage(rawMessage: string): string {
  if (isDataWindowCoverageError(rawMessage)) {
    return DATA_WINDOW_BLOCKED_MESSAGE;
  }
  if (rawMessage.includes("no pricing tier set found for id")) {
    return "That pricing tier set no longer exists — it may have already been deleted.";
  }
  return "Could not delete the pricing tier set — please try again.";
}

/**
 * deletePricingTierSet — the generalised correction path (D-19, replaces
 * `deleteLatestPricingTierSet`/0016's "most recent only" restriction):
 * deletes WHICHEVER tier set is selected via the guarded
 * `delete_pricing_tier_set` RPC (supabase/migrations/0025), refused with
 * `check_violation` only when the delete would leave the data window (from
 * 2026-08-13) with no effective tier set.
 *
 * Uses the SESSION-SCOPED `lib/supabase/server.ts` client, same as
 * savePricingTierSet, so `auth.uid()` is present on the session and reaches
 * the RPC's audit insert — the RPC is SECURITY DEFINER, but auth.uid()
 * still resolves to the real acting user inside a definer function running
 * within this session (see 0016's header comment, unchanged reasoning).
 */
export async function deletePricingTierSet(
  tierSetId: string
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // types/db.ts lacks this RPC until orchestrator regenerates after 0025 is
  // pushed (plan 05-05) — narrow cast only, same pattern as
  // deleteLatestPricingTierSet previously used.
  const { error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { p_tier_set_id: string }
    ) => Promise<{ error: { message: string } | null }>
  )("delete_pricing_tier_set", { p_tier_set_id: tierSetId });

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error("deletePricingTierSet: delete_pricing_tier_set RPC failed", error);
    return { error: friendlyDeleteErrorMessage(error.message) };
  }

  revalidatePath("/settings/pricing");
  revalidatePath("/revenue");
  revalidatePath("/reconciliation");

  return { success: true };
}

const RESTATE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict `YYYY-MM-DD` shape plus a calendar-validity round trip — the same
 * `DATE_RE` + `Date.parse` pairing `lib/dashboard/drill-params.ts` already
 * establishes (CR-02 precedent) — this value originates in a form field and
 * must not reach a query unchecked. */
function isValidCalendarDate(value: string): boolean {
  return RESTATE_DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * countRestatedDays — the D-18 warning-dialog input: counts the days
 * between `fromDate` and today (UTC), inclusive, that carry verification
 * activity. `fromDate` is the EARLIER of a tier set's current and proposed
 * `effectiveFrom`, so an edit that moves the boundary in either direction
 * reports every day whose price changes.
 *
 * Uses the `{ count: "exact", head: true }` exact-count mechanism against
 * `v_revenue_daily_counts` (RESEARCH Pattern 3) — never a blocked PostgREST
 * aggregate function and never fetching rows just to measure their length.
 * Read-only: unlike the two write actions above, this performs no mutation
 * and therefore calls no revalidatePath.
 */
export async function countRestatedDays(
  fromDate: string
): Promise<{ days: number } | { error: string }> {
  if (!isValidCalendarDate(fromDate)) {
    return { error: "Invalid date." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  const todayUtc = new Date().toISOString().slice(0, 10);

  const { count, error } = await supabase
    .from("v_revenue_daily_counts")
    .select("day_utc", { count: "exact", head: true })
    .gte("day_utc", fromDate)
    .lte("day_utc", todayUtc);

  if (error) {
    console.error(
      "countRestatedDays: v_revenue_daily_counts count query failed",
      error
    );
    return { error: "Could not determine the affected day count — please try again." };
  }

  return { days: count ?? 0 };
}
