import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";

import {
  DEFAULT_REVENUE_FORECAST_SETTINGS,
  fetchRevenueForecastSettings,
} from "../revenue-forecast-settings";

/**
 * `fetchRevenueForecastSettings`'s three discriminated-result exit paths
 * (07-02 Task 1, mirrors `lib/settings/__tests__/alignment-settings.test.ts`'s
 * `fetchAlignmentSettings` suite and hand-rolled Supabase client stub shape
 * rather than introducing a mocking library). A failed read and a
 * genuinely-configured value must never collapse to the same result — a
 * forecast threshold that silently defaults to 7 is a money-adjacent
 * surprise (WR-03 precedent).
 */

type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

function makeFakeSupabase(result: {
  data: unknown;
  error: { message: string } | null;
}): FakeSupabase {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as FakeSupabase;
}

describe("fetchRevenueForecastSettings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("query error -- resolves to the defaults with a non-null error, and logs server-side", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeFakeSupabase({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await fetchRevenueForecastSettings(supabase);

    expect(result).toEqual({
      settings: DEFAULT_REVENUE_FORECAST_SETTINGS,
      error: "connection refused",
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("absent row -- resolves to the defaults with a NULL error (never-configured is the documented default state, not a failure)", async () => {
    const supabase = makeFakeSupabase({ data: null, error: null });

    const result = await fetchRevenueForecastSettings(supabase);

    expect(result).toEqual({
      settings: DEFAULT_REVENUE_FORECAST_SETTINGS,
      error: null,
    });
  });

  it("present row -- resolves to that row's value with a NULL error", async () => {
    const supabase = makeFakeSupabase({
      data: { revenue_forecast_min_covered_days: 12 },
      error: null,
    });

    const result = await fetchRevenueForecastSettings(supabase);

    expect(result).toEqual({
      settings: { minCoveredDays: 12 },
      error: null,
    });
  });

  it("never throws, in any of the three cases", async () => {
    const errorSupabase = makeFakeSupabase({ data: null, error: { message: "boom" } });
    const absentSupabase = makeFakeSupabase({ data: null, error: null });
    const presentSupabase = makeFakeSupabase({
      data: { revenue_forecast_min_covered_days: 1 },
      error: null,
    });

    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(fetchRevenueForecastSettings(errorSupabase)).resolves.toBeDefined();
    await expect(fetchRevenueForecastSettings(absentSupabase)).resolves.toBeDefined();
    await expect(fetchRevenueForecastSettings(presentSupabase)).resolves.toBeDefined();
  });
});
