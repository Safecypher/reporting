import type { createClient } from "@/lib/supabase/server";

/**
 * Server-side reader for the `app_settings` singleton's two dual-source
 * alignment settings (D-09/D-15/D-16): the TSYS live-cards baseline offset
 * and the alignment tolerance. Uses the session-scoped `createClient()` so
 * RLS applies (T-06-01 precedent) -- never the secret-key writer. Mirrors
 * `lib/settings/fy-settings.ts`'s shape closely but deliberately diverges on
 * one point (WR-03): it returns a discriminated `AlignmentSettingsResult`
 * rather than the bare settings, because every verdict-rendering caller
 * must be able to tell "settings could not be read" apart from "an admin
 * configured 0/0" -- see `AlignmentSettingsResult`'s own doc comment below.
 */

export interface AlignmentSettings {
  baselineOffset: number;
  /** ISO date string (YYYY-MM-DD), or null if the offset has never been saved. */
  baselineAsOf: string | null;
  toleranceCount: number;
}

/** The documented default state (UI-SPEC E7 "unset renders its documented
 * default") until an admin ever saves a value, and the fallback used
 * whenever the row/table can't be read for any reason. */
export const DEFAULT_ALIGNMENT_SETTINGS: AlignmentSettings = {
  baselineOffset: 0,
  baselineAsOf: null,
  toleranceCount: 0,
};

/**
 * The discriminated result `fetchAlignmentSettings` returns (WR-03,
 * ALIGN-06). `error` is non-null ONLY when the `app_settings` query itself
 * failed -- an absent row (no admin has ever saved a value yet) is the
 * documented default state (UI-SPEC E7) and reports `error: null`, exactly
 * like a present row. Conflating "never configured" with "could not be
 * read" would raise a false alarm on a brand-new project and is exactly
 * the ambiguity this type exists to remove: a caller can now distinguish
 * an admin who deliberately configured zero tolerance from a settings read
 * that failed and silently fell back to the same numbers.
 */
export interface AlignmentSettingsResult {
  settings: AlignmentSettings;
  error: string | null;
}

type AppSettingsAlignmentRow = {
  tsys_live_cards_baseline_offset: number;
  tsys_live_cards_baseline_as_of: string | null;
  alignment_tolerance: number;
};

/**
 * Returns a discriminated result carrying the stored alignment settings
 * (or `DEFAULT_ALIGNMENT_SETTINGS`) plus an `error` field (WR-03). Never
 * throws: a settings read must not take down `/alignment`, the home page,
 * or `/settings/general`. Three exit paths, deliberately kept
 * distinguishable rather than collapsed to two:
 *
 * 1. The query errors -- returns the defaults with a non-null `error`
 *    string (also logged server-side, raw, for diagnosis). Every
 *    verdict-rendering caller must treat this as "settings could not be
 *    loaded", not as a deliberate zero.
 * 2. The query succeeds with no row -- returns the defaults with
 *    `error: null`. An `app_settings` row that has never been saved is the
 *    documented default state (UI-SPEC E7), not a failure; treating it as
 *    one would misfire on every brand-new project before its first save.
 * 3. The query succeeds with a row -- returns that row's three values with
 *    `error: null`.
 *
 * This deliberately diverges from `lib/settings/fy-settings.ts`
 * (`fetchFinancialYearStart`), which this file otherwise mirrors: the FY
 * start has no visible-notice requirement, so its read failure degrades
 * silently to `DEFAULT_FY_START` with no error signal threaded through.
 */
export async function fetchAlignmentSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AlignmentSettingsResult> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(
      "tsys_live_cards_baseline_offset, tsys_live_cards_baseline_as_of, alignment_tolerance",
    )
    .eq("id", 1)
    .maybeSingle<AppSettingsAlignmentRow>();

  if (error) {
    console.error("fetchAlignmentSettings: app_settings query failed", error);
    return { settings: DEFAULT_ALIGNMENT_SETTINGS, error: error.message };
  }

  if (!data) {
    return { settings: DEFAULT_ALIGNMENT_SETTINGS, error: null };
  }

  return {
    settings: {
      baselineOffset: data.tsys_live_cards_baseline_offset,
      baselineAsOf: data.tsys_live_cards_baseline_as_of,
      toleranceCount: data.alignment_tolerance,
    },
    error: null,
  };
}
