import type { createClient } from "@/lib/supabase/server";

/**
 * Server-side reader for the `app_settings` singleton's revenue-forecast
 * honest-degradation threshold (D-15/FCST-05): the minimum number of usable
 * covered days required before `/revenue` shows a month-end or year-end
 * projection. Uses the session-scoped `createClient()` so RLS applies
 * (mirrors `lib/settings/alignment-settings.ts`'s security shape) -- never
 * the secret-key writer.
 *
 * This fetcher's shape follows `alignment-settings.ts`, not `fy-settings.ts`
 * (07-02-PLAN.md planner note): a forecast threshold that silently defaults
 * to 7 when the real saved value is something else is a money-adjacent
 * surprise -- closer in spirit to WR-03's alignment-settings concern than to
 * the FY start's lower-stakes default.
 */

export interface RevenueForecastSettings {
  minCoveredDays: number;
}

/** The documented default state (07-UI-SPEC.md E5 "an unset threshold
 * renders its documented default of 7") until an admin ever saves a value,
 * and the fallback used whenever the row/table can't be read for any
 * reason. */
export const DEFAULT_REVENUE_FORECAST_SETTINGS: RevenueForecastSettings = {
  minCoveredDays: 7,
};

/**
 * The discriminated result `fetchRevenueForecastSettings` returns (WR-03
 * precedent, T-07-10). `error` is non-null ONLY when the `app_settings`
 * query itself failed -- an absent row (no admin has ever saved a value
 * yet) is the documented default state (07-UI-SPEC.md E5) and reports
 * `error: null`, exactly like a present row. Conflating "never configured"
 * with "could not be read" would raise a false alarm on a brand-new
 * project and is exactly the ambiguity this type exists to remove: a
 * caller can now distinguish an admin who deliberately configured the
 * default of 7 from a settings read that failed and silently fell back to
 * the same number.
 */
export interface RevenueForecastSettingsResult {
  settings: RevenueForecastSettings;
  error: string | null;
}

type AppSettingsRevenueForecastRow = {
  revenue_forecast_min_covered_days: number;
};

/**
 * Returns a discriminated result carrying the stored revenue-forecast
 * threshold (or `DEFAULT_REVENUE_FORECAST_SETTINGS`) plus an `error` field.
 * No exception ever escapes this function: a settings read must not take
 * down `/revenue`, the home page, or `/settings/general`. Three exit paths,
 * deliberately kept distinguishable rather than collapsed to two:
 *
 * 1. The query errors -- returns the defaults with a non-null `error`
 *    string (also logged server-side, raw, for diagnosis). Every
 *    forecast-rendering caller must treat this as "settings could not be
 *    loaded", not as a deliberate 7.
 * 2. The query succeeds with no row -- returns the defaults with
 *    `error: null`. An `app_settings` row that has never been saved is the
 *    documented default state (07-UI-SPEC.md E5), not a failure.
 * 3. The query succeeds with a row -- returns that row's value with
 *    `error: null`.
 */
export async function fetchRevenueForecastSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<RevenueForecastSettingsResult> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("revenue_forecast_min_covered_days")
    .eq("id", 1)
    .maybeSingle<AppSettingsRevenueForecastRow>();

  if (error) {
    console.error(
      "fetchRevenueForecastSettings: app_settings query failed",
      error,
    );
    return { settings: DEFAULT_REVENUE_FORECAST_SETTINGS, error: error.message };
  }

  if (!data) {
    return { settings: DEFAULT_REVENUE_FORECAST_SETTINGS, error: null };
  }

  return {
    settings: {
      minCoveredDays: data.revenue_forecast_min_covered_days,
    },
    error: null,
  };
}
