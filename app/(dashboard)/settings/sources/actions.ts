"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { freshnessTable } from "@/lib/dashboard/freshness";
import {
  reportSourceSettingsSchema,
} from "@/lib/settings/schema";
import { friendlyReportSourceSettingsErrorMessage } from "@/lib/settings/errors";

/**
 * saveReportSourceSettings — the /settings/sources per-row editor's only
 * write path (FRESH-05, D-13).
 *
 * Security-critical shape (mirrors app/(dashboard)/settings/general/actions.ts's
 * saveFinancialYearSettings, T-10-14/T-10-15/T-10-17):
 * - Re-validates `input` with the SAME Zod schema the client form uses.
 *   Client-side validation is UX only — this action is an untrusted entry
 *   point invoked directly from the browser and must never trust its
 *   caller.
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client (never a
 *   privileged/secret-key client) so `auth.uid()` is present on the session
 *   and reaches `report_sources`'s AFTER UPDATE trigger
 *   (`trg_report_sources_audit`) -- a privileged client would write the row
 *   with no acting user and silently defeat the audit trail this whole
 *   surface exists to provide (T-10-15).
 * - Updates EXACTLY ONE row, scoped by the validated `reportType` enum
 *   value. Never an `upsert`, never a bare `insert` -- the six
 *   `report_sources` rows are migration-seeded and this action must not be
 *   able to create a seventh (T-10-17).
 * - Never writes `report_sources_audit` directly. That table's only write
 *   path is the SECURITY DEFINER trigger above; a manual insert here would
 *   both be denied by RLS and be a forgeable attribution path (T-10-15).
 * - Returns a plain result object (not NextResponse) — this is a Server
 *   Action invoked directly by each row's own submit handler, not an HTTP
 *   route. Each of the six rows calls this independently, so an invalid
 *   edit to one source can never block saving a valid edit to another.
 *
 * `report_sources` is not yet in `types/db.ts` (regeneration is plan
 * 10-06's job after the live apply), so this write goes through the same
 * single documented untyped accessor `lib/dashboard/freshness.ts` carries
 * rather than adding a second suppression.
 */
export async function saveReportSourceSettings(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = reportSourceSettingsSchema.safeParse(input);
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

  const { error } = await freshnessTable(supabase, "report_sources")
    .update({
      expected_cadence: parsed.data.expectedCadence,
      stale_after_hours: parsed.data.staleAfterHours,
      enabled: parsed.data.enabled,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("report_type", parsed.data.reportType);

  if (error) {
    // WR-01: log the raw, detailed error server-side only; the client only
    // ever sees the mapped, friendly message.
    console.error(
      "saveReportSourceSettings: report_sources update failed",
      error,
    );
    return { error: friendlyReportSourceSettingsErrorMessage(error.message) };
  }

  // A threshold/cadence/enabled change moves the freshness strip on both
  // pages that render it (dashboard home and /uploads), plus this page's
  // own table -- without revalidating all three the strip stays stale
  // until a hard reload.
  revalidatePath("/settings/sources");
  revalidatePath("/");
  revalidatePath("/uploads");

  return { success: true };
}
