"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { pricingTierSetSchema } from "@/lib/pricing/schema";
import {
  mapPricingDeleteError,
  mapPricingSaveError,
  type PricingErrorTone,
} from "@/lib/pricing/errors";
import { isValidCalendarDate } from "@/lib/pricing/calendar-date";

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
): Promise<
  | { success: true }
  | { error: string | Record<string, unknown>; tone: PricingErrorTone }
> {
  const parsed = pricingTierSetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten(), tone: "error" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized", tone: "error" };
  }

  // types/db.ts regenerated after 0025 was pushed (plan 05-05) — the RPC is
  // now called through the typed `supabase.rpc` client directly, letting the
  // compiler check the argument names against the real 4-argument signature.
  // Passing all four named arguments explicitly also removes any PostgREST
  // overload-ambiguity risk (P-03: the 3-argument function is dropped, not
  // overloaded, by 0025).
  const { error } = await supabase.rpc("save_pricing_tier_set", {
    p_effective_from: parsed.data.effectiveFrom,
    p_reset_window: parsed.data.resetWindow,
    p_tiers: parsed.data.tiers.map((tier, index) => ({
      tierOrder: index,
      upperBound: tier.upperBound,
      rate: tier.rate,
    })),
    p_tier_set_id: tierSetId ?? undefined,
  });

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error("savePricingTierSet: save_pricing_tier_set RPC failed", error);
    const mapped = mapPricingSaveError(error.message);
    return { error: mapped.message, tone: mapped.tone };
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

  // types/db.ts regenerated after 0025 was pushed (plan 05-05) — called
  // directly through the typed `supabase.rpc` client, same as
  // savePricingTierSet above.
  const { error } = await supabase.rpc("delete_pricing_tier_set", {
    p_tier_set_id: tierSetId,
  });

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message. Tone is discarded here — this
    // return shape stays string-only (D-19 non-regression) so
    // DeleteTierSet/its toast are untouched; delete-path messages keep
    // --destructive styling unconditionally regardless of which guard
    // rejected the delete.
    console.error("deletePricingTierSet: delete_pricing_tier_set RPC failed", error);
    return { error: mapPricingDeleteError(error.message).message };
  }

  revalidatePath("/settings/pricing");
  revalidatePath("/revenue");
  revalidatePath("/reconciliation");

  return { success: true };
}

/**
 * countRestatedDays — the D-18 warning-dialog input: counts the days
 * between `fromDate` and an (optional) inclusive `throughDate`, clamped to
 * today (UTC), that carry verification activity. `fromDate` is the EARLIER
 * of a tier set's current and proposed `effectiveFrom` for an edit; for a
 * create-supersede (05-07/G-05-5) it is `resolveSaveImpact`'s `from`/`through`
 * pair, bounding the count to the range the NEW set actually displaces
 * rather than counting from `from` all the way to today.
 *
 * Both `fromDate` and the optional `throughDate` are validated with
 * `isValidCalendarDate` (`lib/pricing/calendar-date.ts`) — a genuine
 * calendar round trip, not merely a shape-plus-`Date.parse` check (WR-01:
 * `Date.parse` silently rolls an out-of-range day into the next month
 * instead of rejecting it) — so an attacker-supplied or malformed end date
 * cannot widen the query unchecked, and a calendar-impossible date is
 * rejected in the application before it ever reaches the query. The
 * effective end is the EARLIER of `throughDate` and today's UTC date;
 * omitting `throughDate` keeps today's UTC date as the effective end exactly
 * as before. When the effective end precedes `fromDate`, this returns zero
 * days without querying.
 *
 * Phase 7 (D-08/07-RESEARCH Open Question A2): `v_revenue_daily_counts` now
 * carries a `source` dimension (0034) — one row per (day, source) rather
 * than one row per day — so the previous exact-count-with-no-rows-returned
 * approach would roughly double for any day both TSYS and Bit Addict had
 * activity on. This counts GENUINE DISTINCT DAYS instead: a day on which
 * EITHER source recorded activity is a day whose priced figure a tier-set
 * edit can restate, so `source` is deliberately left unfiltered and the
 * returned day strings are deduplicated in TypeScript via a `Set`. This is
 * acceptable here (unlike money arithmetic, L-01) because this is a UI
 * warning count, not a money figure. Read-only: unlike the two write
 * actions above, this performs no mutation and therefore calls no
 * revalidatePath.
 */
export async function countRestatedDays(
  fromDate: string,
  throughDate?: string | null
): Promise<{ days: number } | { error: string }> {
  if (!isValidCalendarDate(fromDate)) {
    return { error: "Invalid date." };
  }
  if (throughDate != null && !isValidCalendarDate(throughDate)) {
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
  const effectiveEnd =
    throughDate != null && throughDate < todayUtc ? throughDate : todayUtc;

  if (effectiveEnd < fromDate) {
    return { days: 0 };
  }

  const { data, error } = await supabase
    .from("v_revenue_daily_counts")
    .select("day_utc")
    .gte("day_utc", fromDate)
    .lte("day_utc", effectiveEnd)
    .returns<{ day_utc: string | null }[]>();

  if (error) {
    console.error(
      "countRestatedDays: v_revenue_daily_counts count query failed",
      error
    );
    return { error: "Could not determine the affected day count — please try again." };
  }

  const distinctDays = new Set(
    (data ?? [])
      .map((row) => row.day_utc)
      .filter((day): day is string => day !== null)
  );

  return { days: distinctDays.size };
}
