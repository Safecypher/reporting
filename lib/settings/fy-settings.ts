import type { createClient } from "@/lib/supabase/server";
import type { FinancialYearStart } from "@/lib/dashboard/period";

/**
 * Server-side reader for the `app_settings` singleton's financial-year
 * start (D-10/D-12). Uses the session-scoped `createClient()` so RLS
 * applies (T-06-01 precedent) — never the secret-key writer.
 */

/** 1 January — the documented default state (UI-SPEC E5 empty) until an
 * admin ever saves a value, and the fallback used whenever the row/table
 * can't be read for any reason. */
export const DEFAULT_FY_START: FinancialYearStart = { month: 1, day: 1 };

/**
 * Returns the stored FY start when `app_settings` has a row, or
 * `DEFAULT_FY_START` when no row exists or the query errors. Never throws:
 * the FY start must not take down five dashboard pages, so a read failure
 * degrades to the documented default rather than propagating. This is not
 * a silent failure in effect — the scope badge always prints the resolved
 * boundary dates, so whichever FY start was actually applied is visible on
 * screen — but the raw error is still logged server-side for diagnosis.
 *
 * Migration 0023 (which creates `app_settings`) is authored in this plan
 * but not pushed to the live database until plan 05-05 (Wave 3), so until
 * then this call is EXPECTED to error and fall back to `DEFAULT_FY_START`.
 */
export async function fetchFinancialYearStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<FinancialYearStart> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("fy_start_month, fy_start_day")
    .eq("id", 1)
    .maybeSingle<{ fy_start_month: number; fy_start_day: number }>();

  if (error) {
    console.error("fetchFinancialYearStart: app_settings query failed", error);
    return DEFAULT_FY_START;
  }

  if (!data) {
    return DEFAULT_FY_START;
  }

  return { month: data.fy_start_month, day: data.fy_start_day };
}
