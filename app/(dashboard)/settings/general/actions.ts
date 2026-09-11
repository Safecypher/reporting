"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  alignmentSettingsSchema,
  financialYearSettingsSchema,
} from "@/lib/settings/schema";
import {
  friendlyAlignmentSettingsErrorMessage,
  friendlyFinancialYearErrorMessage,
} from "@/lib/settings/errors";

/**
 * saveFinancialYearSettings — the FY-start admin editor's only write path
 * (FY-01, D-10/D-11/D-12/D-13).
 *
 * Security-critical shape (mirrors app/(dashboard)/settings/pricing/actions.ts's
 * savePricingTierSet, T-05-13/T-05-14/T-05-15):
 * - Re-validates `input` with the SAME Zod schema the client form uses.
 *   Client-side react-hook-form validation is UX only — this action is an
 *   untrusted entry point and must never trust its caller.
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never the
 *   privileged ingest writer) so `auth.uid()` is present on the session and
 *   reaches `app_settings`'s AFTER UPDATE trigger (trg_app_settings_audit),
 *   which is what attributes the D-13 audit trail to the acting user.
 * - Returns a plain result object (not NextResponse) — this is a Server
 *   Action invoked directly by the form's `handleSubmit`, not an HTTP route.
 *
 * The `app_settings` table's `make_date(2001, fy_start_month, fy_start_day)`
 * CHECK constraint is the second validation layer (defense in depth) behind
 * the Zod superRefine — a direct RPC/PostgREST call that bypasses the form
 * still cannot write an impossible month/day pair (05-RESEARCH Pitfall 3).
 */
export async function saveFinancialYearSettings(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = financialYearSettingsSchema.safeParse(input);
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

  const { error } = await supabase
    .from("app_settings")
    .update({
      fy_start_month: parsed.data.fyStartMonth,
      fy_start_day: parsed.data.fyStartDay,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error(
      "saveFinancialYearSettings: app_settings update failed",
      error,
    );
    return { error: friendlyFinancialYearErrorMessage(error.message) };
  }

  // Every period-scoped route whose year boundary the FY change moves must
  // be revalidated in the same round trip — the change is otherwise stale
  // on any already-rendered page until a hard reload.
  revalidatePath("/settings/general");
  revalidatePath("/verifications");
  revalidatePath("/revenue");
  revalidatePath("/sla");
  revalidatePath("/cards");
  revalidatePath("/reconciliation");

  return { success: true };
}

/**
 * saveAlignmentSettings — the Dual-source alignment section's only write
 * path (ALIGN-06, D-09/D-15/D-16). Mirrors `saveFinancialYearSettings`
 * above object-for-object:
 * - Re-validates `input` with the SAME Zod schema (`alignmentSettingsSchema`)
 *   the client form uses -- client-side react-hook-form validation is UX
 *   only, this action is an untrusted entry point and must never trust its
 *   caller (ASVS V5).
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never a
 *   service-role/secret-key client) so `auth.uid()` is present on the
 *   session and reaches `app_settings`'s AFTER UPDATE trigger
 *   (`trg_app_settings_audit`), attributing the audit row to the acting
 *   user (T-06-13).
 * - Both fields are written in ONE `.update()` after a single `safeParse`
 *   of the whole object, so a submit where one field is valid and the
 *   other is not rejects the whole submit and persists neither value
 *   (T-06-14).
 * - `tsys_live_cards_baseline_as_of` is stamped to today's UTC date
 *   alongside the offset every time this action runs -- it is not an
 *   independently-editable field, only ever a byproduct of saving the
 *   offset (mirroring the D-08 caption's "as of" basis).
 */
export async function saveAlignmentSettings(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = alignmentSettingsSchema.safeParse(input);
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

  const todayUtc = new Date().toISOString().slice(0, 10);

  const { error } = await supabase
    .from("app_settings")
    .update({
      tsys_live_cards_baseline_offset: parsed.data.baselineOffset,
      tsys_live_cards_baseline_as_of: todayUtc,
      alignment_tolerance: parsed.data.toleranceCount,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error("saveAlignmentSettings: app_settings update failed", error);
    return { error: friendlyAlignmentSettingsErrorMessage(error.message) };
  }

  // Both new values change which days read as aligned/needs_review/mismatch
  // on both alignment surfaces (D-05's home strip and /alignment itself) --
  // leaving them stale is a correctness bug, not a refresh annoyance.
  revalidatePath("/settings/general");
  revalidatePath("/alignment");
  revalidatePath("/");

  return { success: true };
}
