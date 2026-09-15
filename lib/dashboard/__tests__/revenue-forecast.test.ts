import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";

import {
  fetchRevenueForecast,
  fetchRevenueForecastDaily,
  formatForecastBandSentence,
  formatForecastDegradedMessage,
  formatForecastMethodCaption,
  formatHomeProjectionSubLine,
  projectedCardEyebrow,
} from "../revenue-forecast";

/**
 * Hand-rolled Supabase stub convention (matches
 * `lib/settings/__tests__/alignment-settings.test.ts`'s `fetchAlignmentSettings`
 * suite) — no module-level Vitest mock, no new dependency. Every call's
 * `(fn, args)` pair is
 * recorded so tests can assert on the RPC arguments as well as the returned
 * values.
 */
type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

interface RecordedRpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function makeFakeSupabaseRpc(response: {
  data: unknown;
  error: { message: string } | null;
}): { supabase: FakeSupabase; calls: RecordedRpcCall[] } {
  const calls: RecordedRpcCall[] = [];
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(response);
    },
  } as unknown as FakeSupabase;
  return { supabase, calls };
}

const PERIOD = { start: "2026-09-01", end: "2026-10-01" };

// A non-degraded row, shaped exactly like the live Bit Addict September
// figures recorded in 07-04-SUMMARY.md — NUMERIC columns arrive as strings.
const LIVE_BIT_ADDICT_ROW = {
  as_of_day: "2026-09-10",
  covered_days: 10,
  usable_days: 9,
  inferred_days: 20,
  run_rate: "492.1111111111111111",
  min_day_volume: "3",
  max_day_volume: "2387",
  actual_volume: "4436",
  projected_volume: "14278.2222222222222220",
  low_volume: "4496",
  high_volume: "52176",
  projected_revenue: "578.26799999999999999100",
  low_revenue: "182.0880",
  high_revenue: "2113.1280",
  degraded: false,
  degraded_reason: null,
};

// A degraded row, shaped exactly like the live TSYS September figures
// recorded in 07-04-SUMMARY.md — every projected/low/high column null, not
// zero; run_rate/min/max also null because covered_days is 0.
const LIVE_TSYS_DEGRADED_ROW = {
  as_of_day: null,
  covered_days: 0,
  usable_days: 0,
  inferred_days: 30,
  run_rate: null,
  min_day_volume: null,
  max_day_volume: null,
  actual_volume: "0",
  projected_volume: null,
  low_volume: null,
  high_volume: null,
  projected_revenue: null,
  low_revenue: null,
  high_revenue: null,
  degraded: true,
  degraded_reason: "too_few_usable_days",
};

describe("fetchRevenueForecast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts every NUMERIC-string column to a number exactly once on a non-degraded row", async () => {
    const { supabase } = makeFakeSupabaseRpc({ data: [LIVE_BIT_ADDICT_ROW], error: null });

    const result = await fetchRevenueForecast(supabase, PERIOD, "bit_addict", 7);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      as_of_day: "2026-09-10",
      covered_days: 10,
      usable_days: 9,
      inferred_days: 20,
      run_rate: 492.1111111111111111,
      min_day_volume: 3,
      max_day_volume: 2387,
      actual_volume: 4436,
      projected_volume: 14278.222222222222222,
      low_volume: 4496,
      high_volume: 52176,
      projected_revenue: 578.267999999999999991,
      low_revenue: 182.088,
      high_revenue: 2113.128,
      degraded: false,
      degraded_reason: null,
    });
  });

  it("preserves every null column as null on a degraded row -- never coerced to zero", async () => {
    const { supabase } = makeFakeSupabaseRpc({ data: [LIVE_TSYS_DEGRADED_ROW], error: null });

    const result = await fetchRevenueForecast(supabase, PERIOD, "tsys", 7);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      as_of_day: null,
      covered_days: 0,
      usable_days: 0,
      inferred_days: 30,
      run_rate: null,
      min_day_volume: null,
      max_day_volume: null,
      actual_volume: 0,
      projected_volume: null,
      low_volume: null,
      high_volume: null,
      projected_revenue: null,
      low_revenue: null,
      high_revenue: null,
      degraded: true,
      degraded_reason: "too_few_usable_days",
    });
  });

  it("passes p_source, p_start, p_end and p_min_covered_days explicitly on every call", async () => {
    const { supabase, calls } = makeFakeSupabaseRpc({ data: [LIVE_BIT_ADDICT_ROW], error: null });

    await fetchRevenueForecast(supabase, PERIOD, "bit_addict", 7);

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("revenue_forecast_for_period");
    expect(calls[0].args).toEqual({
      p_start: "2026-09-01",
      p_end: "2026-10-01",
      p_source: "bit_addict",
      p_min_covered_days: 7,
    });
  });

  it("returns { data: null, error: <message> } and logs server-side when the RPC errors", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabaseRpc({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await fetchRevenueForecast(supabase, PERIOD, "bit_addict", 7);

    expect(result).toEqual({ data: null, error: "connection refused" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws, on the error path or either row shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase: errorSupabase } = makeFakeSupabaseRpc({
      data: null,
      error: { message: "boom" },
    });
    const { supabase: liveSupabase } = makeFakeSupabaseRpc({
      data: [LIVE_BIT_ADDICT_ROW],
      error: null,
    });
    const { supabase: degradedSupabase } = makeFakeSupabaseRpc({
      data: [LIVE_TSYS_DEGRADED_ROW],
      error: null,
    });

    await expect(fetchRevenueForecast(errorSupabase, PERIOD, "bit_addict", 7)).resolves.toBeDefined();
    await expect(fetchRevenueForecast(liveSupabase, PERIOD, "bit_addict", 7)).resolves.toBeDefined();
    await expect(fetchRevenueForecast(degradedSupabase, PERIOD, "tsys", 7)).resolves.toBeDefined();
  });
});

describe("fetchRevenueForecastDaily", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts each day row's NUMERIC revenue string to a number", async () => {
    const { supabase } = makeFakeSupabaseRpc({
      data: [
        { day: "2026-09-01", revenue: "0.6075", is_projected: false },
        { day: "2026-09-30", revenue: "19.9305", is_projected: true },
      ],
      error: null,
    });

    const result = await fetchRevenueForecastDaily(supabase, PERIOD, "bit_addict", 7);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { day: "2026-09-01", revenue: 0.6075, is_projected: false },
      { day: "2026-09-30", revenue: 19.9305, is_projected: true },
    ]);
  });

  it("returns zero rows when the RPC returns zero rows (the documented degraded contract)", async () => {
    const { supabase } = makeFakeSupabaseRpc({ data: [], error: null });

    const result = await fetchRevenueForecastDaily(supabase, PERIOD, "tsys", 7);

    expect(result).toEqual({ data: [], error: null });
  });

  it("returns { data: null, error: <message> } and logs server-side when the RPC errors", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabaseRpc({
      data: null,
      error: { message: "timeout" },
    });

    const result = await fetchRevenueForecastDaily(supabase, PERIOD, "bit_addict", 7);

    expect(result).toEqual({ data: null, error: "timeout" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("projectedCardEyebrow", () => {
  it("returns the month-scope eyebrow for a month scope", () => {
    expect(projectedCardEyebrow("month")).toBe("Projected month-end");
  });

  it("returns the year-scope eyebrow for a year scope", () => {
    expect(projectedCardEyebrow("year")).toBe("Projected year-end");
  });
});

describe("formatForecastBandSentence", () => {
  it("produces the exact month-scope sentence with both figures currency-formatted", () => {
    expect(formatForecastBandSentence("month", 48200, 53600)).toBe(
      "If the rest of the month runs at our quietest day's pace: $48,200.00. At our busiest day's pace: $53,600.00.",
    );
  });

  it("produces the exact year-scope sentence with both figures currency-formatted", () => {
    expect(formatForecastBandSentence("year", 182.088, 2113.128)).toBe(
      "If the rest of the year runs at our quietest day's pace so far: $182.09. At our busiest day's pace: $2,113.13.",
    );
  });

  it("returns null when the low bound is null", () => {
    expect(formatForecastBandSentence("month", null, 53600)).toBeNull();
  });

  it("returns null when the high bound is null", () => {
    expect(formatForecastBandSentence("month", 48200, null)).toBeNull();
  });
});

describe("formatForecastMethodCaption", () => {
  it("produces the exact month-scope caption", () => {
    expect(
      formatForecastMethodCaption("month", 10, 492.11, "2026-09-10", 20),
    ).toBe(
      "Projected from 10 covered days this month at 492.11/day (as at 10 Sept 2026); 20 uncovered day(s) inferred at the same rate.",
    );
  });

  it("produces the exact year-scope caption", () => {
    expect(
      formatForecastMethodCaption("year", 100, 492.11, "2026-09-10", 165),
    ).toBe(
      "Projected from 100 covered days year-to-date at 492.11/day (as at 10 Sept 2026); remaining months priced at this rate.",
    );
  });

  it("returns null when the forecast is degraded (run_rate null on zero covered days)", () => {
    expect(formatForecastMethodCaption("month", 0, null, null, 30)).toBeNull();
  });
});

describe("formatForecastDegradedMessage", () => {
  it("produces the exact D-14 sentence naming the usable-day count and threshold", () => {
    expect(formatForecastDegradedMessage(4, 7)).toBe(
      "Not enough data to project yet — 4 of 7 covered days.",
    );
  });
});

describe("formatHomeProjectionSubLine", () => {
  it("produces the exact month-scope sub-line when a point figure exists", () => {
    expect(formatHomeProjectionSubLine("month", 578.268)).toBe("Projected month-end: $578.27");
  });

  it("produces the exact year-scope sub-line when a point figure exists", () => {
    expect(formatHomeProjectionSubLine("year", 52340)).toBe("Projected year-end: $52,340.00");
  });

  it("returns null when the point figure is null (not computable, degraded, or errored)", () => {
    expect(formatHomeProjectionSubLine("month", null)).toBeNull();
  });
});
