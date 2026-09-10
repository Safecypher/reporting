/**
 * Financial-year settings error mapping — extracted from
 * `app/(dashboard)/settings/general/actions.ts` (05-06, closing
 * 05-VERIFICATION.md gap 2 / 05-REVIEW WR-01, FY-01).
 *
 * This is a PLAIN module — no `"use server"` directive, no Supabase/Next
 * imports — deliberately, because a `"use server"` module may only export
 * async functions. A synchronous mapper defined inside the Server Action
 * could never be imported by a test, which is exactly how this mapping
 * shipped as dead code: the 05-VERIFICATION live probe was the first thing
 * to ever actually exercise it against the real Postgres error text.
 */

export const FY_SETTINGS_GENERIC_ERROR =
  "Could not save financial year settings — please check the values and try again.";

export const FY_SETTINGS_INVALID_DAY_ERROR =
  "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";

/**
 * Maps a raw Postgres/PostgREST error message to safe, user-facing copy
 * (WR-01: a raw constraint name must never reach the form UI). Returns
 * ONLY one of the two exported constants above — never interpolates,
 * echoes, truncates, or otherwise passes through any part of `rawMessage`.
 */
export function friendlyFinancialYearErrorMessage(rawMessage: string): string {
  if (
    rawMessage.includes("app_settings_fy_start_day_check") ||
    rawMessage.includes("make_date")
  ) {
    return FY_SETTINGS_INVALID_DAY_ERROR;
  }
  return FY_SETTINGS_GENERIC_ERROR;
}
