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
    rawMessage.includes("make_date") ||
    // 05-VERIFICATION.md gap 2: the text Postgres actually raises for this
    // constraint (SQLSTATE 22008) -- make_date() itself raises before the
    // CHECK expression's boolean test is ever reached, so this is NOT a
    // 23514 check_violation as 05-RESEARCH Pitfall 3 assumed. Live-
    // reproduced against project gditxlxfdwlvnyhhxybf.
    rawMessage.includes("date field value out of range")
  ) {
    return FY_SETTINGS_INVALID_DAY_ERROR;
  }
  return FY_SETTINGS_GENERIC_ERROR;
}

/**
 * Dual-source alignment settings error mapping (Phase 6 Plan 2, D-09/D-15).
 * Zod (`alignmentSettingsSchema`) already rejects any negative or
 * non-integer value before this ever reaches Postgres, so the two CHECK
 * constraints below are a defence-in-depth backstop (a direct PostgREST
 * update bypassing the form), not an expected user-facing path -- but the
 * same "never echo the raw constraint name" discipline (WR-01) applies.
 */

export const ALIGNMENT_SETTINGS_GENERIC_ERROR =
  "Could not save alignment settings — please check the values and try again.";

/**
 * Every currently-known failure mode (either CHECK constraint, or any other
 * Postgres/PostgREST error) maps to the single generic message above --
 * unlike the FY mapper there is no distinct constraint-specific copy to
 * choose between yet, since Zod already produces field-level messages for
 * the only two validation rules these columns enforce. `rawMessage` is
 * accepted (and logged by the caller, never here) to keep this function's
 * shape consistent with `friendlyFinancialYearErrorMessage` should a
 * distinct case need distinguishing later.
 */
export function friendlyAlignmentSettingsErrorMessage(
  rawMessage: string,
): string {
  void rawMessage;
  return ALIGNMENT_SETTINGS_GENERIC_ERROR;
}
