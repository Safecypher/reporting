"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { pricingTierSetSchema } from "@/lib/pricing/schema";

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

  const { data: tierSet, error: tierSetError } = await supabase
    .from("pricing_tier_sets")
    .insert({
      effective_from: parsed.data.effectiveFrom,
      reset_window: parsed.data.resetWindow,
    })
    .select()
    .single();

  if (tierSetError) {
    return { error: tierSetError.message };
  }

  const tierRows = parsed.data.tiers.map((tier, index) => ({
    tier_set_id: tierSet.id,
    tier_order: index,
    upper_bound: tier.upperBound,
    rate: tier.rate,
  }));

  const { error: tiersError } = await supabase
    .from("pricing_tiers")
    .insert(tierRows);

  if (tiersError) {
    return { error: tiersError.message };
  }

  // REV-02: same-roundtrip revalidation, no re-ingestion required — Revenue
  // re-reads the effective-dated tier set on next render.
  revalidatePath("/revenue");

  return { success: true };
}
