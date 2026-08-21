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
function friendlyErrorMessage(rawMessage: string): string {
  if (rawMessage.includes("pricing_tier_sets_effective_from_key")) {
    return "A pricing tier set already exists for this date.";
  }
  if (rawMessage.includes("must be strictly after the latest existing effective_from")) {
    return "The effective date must be after the most recent pricing tier set's date — past revenue is never rewritten.";
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
 *
 * Security-critical shape (03-PATTERNS/03-RESEARCH Pattern 4, T-03-05/T-03-06):
 * - Re-validates `input` with the SAME Zod schema the client form uses.
 *   Client-side react-hook-form validation is UX only — this action is an
 *   untrusted entry point and must never trust its caller.
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never the
 *   privileged-key writer used by app/api/ingest/route.ts) so `auth.uid()`
 *   is present on the session and reaches the `pricing_tier_sets` AFTER
 *   INSERT trigger, which is what attributes the D-06 audit trail to the
 *   acting user. The privileged-key writer has no session user and would
 *   silently break attribution.
 * - Returns a plain result object (not NextResponse) — this is a Server
 *   Action invoked directly by the form's `handleSubmit`, not an HTTP route.
 *
 * CR-04: the tier-set row and its tier rows are written by a single
 * `save_pricing_tier_set` RPC (see supabase/migrations/0015_pricing_tier_integrity.sql)
 * so the two inserts are transactional — a failure partway through can never
 * leave an orphaned, audit-logged tier set with zero tiers. CR-05: the RPC
 * also rejects a backdated `effective_from` at the DB level.
 */
export async function savePricingTierSet(
  input: unknown
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

  const { error } = await supabase.rpc("save_pricing_tier_set", {
    p_effective_from: parsed.data.effectiveFrom,
    p_reset_window: parsed.data.resetWindow,
    p_tiers: parsed.data.tiers.map((tier, index) => ({
      tierOrder: index,
      upperBound: tier.upperBound,
      rate: tier.rate,
    })),
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
  // appears without a manual reload.
  revalidatePath("/revenue");
  revalidatePath("/settings/pricing");

  return { success: true };
}
