"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { freshnessTable } from "@/lib/dashboard/freshness";
import { pushRpc } from "@/lib/push/tables";
import { DRAIN_SCHEDULE_EDITABLE } from "@/lib/settings/drain-schedule";
import {
  reportSourceSettingsSchema,
  drainRunTimeSchema,
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

const DRAIN_RUN_TIME_GENERIC_ERROR =
  "Could not save the daily check run time — please check the value and try again.";

const DRAIN_RUN_TIME_EDIT_DISABLED_ERROR =
  "Editing the daily check run time is not available on this deployment.";

/**
 * saveDrainRunTime — the /settings/sources run-time editor's write path
 * (FRESH-05, D-14).
 *
 * Two effects from one save, and they must not be allowed to disagree
 * (T-10-23): (1) `app_settings.drain_cron_run_time` -- this is what fires
 * `trg_app_settings_audit`, the attribution for the change -- and (2)
 * `fn_set_drain_cron_schedule`, the SECURITY DEFINER wrapper that actually
 * moves the live `daily-drop-off` pg_cron job. Ordered setting-first, then
 * RPC. When the RPC errors, the previous value is written back so the page
 * never asserts a schedule that is not in force -- the wrapper (0047) raises
 * precisely so this branch is reachable rather than silent. The
 * compensating write itself produces a second audit row, which is correct
 * and wanted: "someone tried to move the run time and it did not take" is
 * exactly the kind of fact this audit trail exists to record.
 *
 * `DRAIN_SCHEDULE_EDITABLE` (plan 10-02's measured D-15 verdict) is checked
 * before any database access. The UI does not render a caller when it is
 * false, but a Server Action is a directly-invocable endpoint regardless of
 * what the UI renders, and must not be reachable as a back door to a
 * mechanism the deploy has declared unavailable.
 *
 * `app_settings` is not yet in `types/db.ts` for this new column, and
 * `fn_set_drain_cron_schedule` is not in it at all (regeneration is plan
 * 10-06's job after the live apply), so both the read/write and the RPC
 * call go through this codebase's existing untyped escape hatches
 * (`freshnessTable`, `pushRpc`) rather than adding a new suppression.
 */
export async function saveDrainRunTime(
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const parsed = drainRunTimeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? DRAIN_RUN_TIME_GENERIC_ERROR,
    };
  }

  if (!DRAIN_SCHEDULE_EDITABLE) {
    return { error: DRAIN_RUN_TIME_EDIT_DISABLED_ERROR };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // Read the CURRENT value first so it is available to restore if the RPC
  // below errors.
  const { data: currentSettings, error: readError } = (await freshnessTable(
    supabase,
    "app_settings",
  )
    .select("drain_cron_run_time")
    .eq("id", 1)
    .single()) as {
    data: { drain_cron_run_time: string } | null;
    error: { message: string } | null;
  };

  if (readError || !currentSettings) {
    console.error("saveDrainRunTime: app_settings read failed", readError);
    return { error: DRAIN_RUN_TIME_GENERIC_ERROR };
  }

  const previousRunTime = currentSettings.drain_cron_run_time;

  const { error: updateError } = await freshnessTable(supabase, "app_settings")
    .update({
      drain_cron_run_time: parsed.data.runTime,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (updateError) {
    console.error("saveDrainRunTime: app_settings update failed", updateError);
    return { error: DRAIN_RUN_TIME_GENERIC_ERROR };
  }

  const { error: rpcError } = await pushRpc(
    supabase,
    "fn_set_drain_cron_schedule",
    { p_run_time: parsed.data.runTime },
  );

  if (rpcError) {
    console.error(
      "saveDrainRunTime: fn_set_drain_cron_schedule failed -- restoring previous run time",
      rpcError,
    );

    // Compensating write: the setting was already saved above, so leaving
    // it as-is would show a time the job is not actually running at. This
    // produces its own audit row -- correct and wanted (see doc comment).
    const { error: restoreError } = await freshnessTable(
      supabase,
      "app_settings",
    )
      .update({
        drain_cron_run_time: previousRunTime,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (restoreError) {
      console.error(
        "saveDrainRunTime: failed to restore previous run time after RPC failure",
        restoreError,
      );
    }

    return { error: DRAIN_RUN_TIME_GENERIC_ERROR };
  }

  revalidatePath("/settings/sources");

  return { success: true };
}
