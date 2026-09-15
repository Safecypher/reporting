"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  alignmentSettingsSchema,
  financialYearSettingsSchema,
  revenueForecastSettingsSchema,
} from "@/lib/settings/schema";
import {
  friendlyAlignmentSettingsErrorMessage,
  friendlyFinancialYearErrorMessage,
  friendlyRevenueForecastSettingsErrorMessage,
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
 * - The baseline's "as of" date column is deliberately NOT part of this
 *   action's write payload (WR-02). That column is owned by the
 *   `trg_app_settings_baseline_as_of` BEFORE UPDATE trigger (0033): the
 *   database sets it to `current_date` if and only if
 *   `tsys_live_cards_baseline_offset` actually changes value in the same
 *   UPDATE, and otherwise carries the prior value forward unchanged. A
 *   fetch-then-compare equivalent inside this action was rejected because a
 *   read-then-write cannot be made atomic against a concurrent save -- two
 *   overlapping requests could each read the same "unchanged" offset, then
 *   both write, and whichever wins the race would silently decide the
 *   as-of date. Putting the rule in a BEFORE UPDATE trigger makes it
 *   atomic and takes the column out of this action's write path entirely,
 *   so a tolerance-only edit can never move it.
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

  const { error } = await supabase
    .from("app_settings")
    .update({
      tsys_live_cards_baseline_offset: parsed.data.baselineOffset,
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

/**
 * saveRevenueForecastSettings — the Revenue forecast section's only write
 * path (FCST-05, D-15). Mirrors `saveAlignmentSettings` above object-for-
 * object:
 * - Re-validates `input` with the SAME Zod schema
 *   (`revenueForecastSettingsSchema`) the client form uses -- client-side
 *   react-hook-form validation is UX only, this action is an untrusted
 *   entry point and must never trust its caller (T-07-06).
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never a
 *   service-role/secret-key client) so `auth.uid()` is present on the
 *   session and reaches `app_settings`'s AFTER UPDATE trigger
 *   (`trg_app_settings_audit`), attributing the audit row to the acting
 *   user (T-07-07). An unauthenticated call returns `Unauthorized` before
 *   any query.
 * - Never stamps an audit column itself -- the audit row is owned entirely
 *   by the database trigger, so the trail cannot be forged from the
 *   application side (T-07-09).
 *
 * `/alignment` is deliberately NOT revalidated by this action: the
 * alignment revenue card shows an actual figure, never a projection, so
 * the threshold cannot change anything on that page.
 */
export async function saveRevenueForecastSettings(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = revenueForecastSettingsSchema.safeParse(input);
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
      revenue_forecast_min_covered_days: parsed.data.minCoveredDays,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error(
      "saveRevenueForecastSettings: app_settings update failed",
      error,
    );
    return { error: friendlyRevenueForecastSettingsErrorMessage(error.message) };
  }

  revalidatePath("/settings/general");
  revalidatePath("/revenue");
  revalidatePath("/");

  return { success: true };
}
