import type { createClient } from "@/lib/supabase/server";

/**
 * Server-side reader for the `app_settings` singleton's two dual-source
 * alignment settings (D-09/D-15/D-16): the TSYS live-cards baseline offset
 * and the alignment tolerance. Uses the session-scoped `createClient()` so
 * RLS applies (T-06-01 precedent) -- never the secret-key writer. Mirrors
 * `lib/settings/fy-settings.ts` exactly.
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

type AppSettingsAlignmentRow = {
  tsys_live_cards_baseline_offset: number;
  tsys_live_cards_baseline_as_of: string | null;
  alignment_tolerance: number;
};

/**
 * Returns the stored alignment settings when `app_settings` has a row, or
 * `DEFAULT_ALIGNMENT_SETTINGS` when no row exists or the query errors.
 * Never throws: a settings read must not take down `/alignment`, the home
 * page, or `/settings/general` -- the raw error is logged server-side for
 * diagnosis, and the documented defaults (also the pre-edit state, not a
 * silent failure -- both values are surfaced in the UI captions) are
 * returned instead.
 */
export async function fetchAlignmentSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AlignmentSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(
      "tsys_live_cards_baseline_offset, tsys_live_cards_baseline_as_of, alignment_tolerance",
    )
    .eq("id", 1)
    .maybeSingle<AppSettingsAlignmentRow>();

  if (error) {
    console.error("fetchAlignmentSettings: app_settings query failed", error);
    return DEFAULT_ALIGNMENT_SETTINGS;
  }

  if (!data) {
    return DEFAULT_ALIGNMENT_SETTINGS;
  }

  return {
    baselineOffset: data.tsys_live_cards_baseline_offset,
    baselineAsOf: data.tsys_live_cards_baseline_as_of,
    toleranceCount: data.alignment_tolerance,
  };
}
