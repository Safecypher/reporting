import { afterEach, describe, expect, it, vi } from "vitest";

import type { createClient } from "@/lib/supabase/server";
import { fetchPerSourceRevenueTotals, type RevenueSource } from "../revenue-source";

/**
 * Task 3 (07-03) + 07-UAT fix (test 2/5 gap): covers
 * `fetchPerSourceRevenueTotals`'s success path, its RPC failure paths, its
 * new `v_apigee_coverage_daily` coverage-query failure path, and the three
 * TSYS cases the coverage check exists to distinguish — absent (no
 * coverage), covered-but-zero, and covered-and-non-zero. Stubs the Supabase
 * client by hand, following `lib/settings/__tests__/alignment-settings.test.ts`'s
 * existing convention — the Supabase module itself is never module-mocked,
 * and no new mocking dependency is introduced.
 */

type FakeSupabase = Awaited<ReturnType<typeof createClient>>;
type RpcResponse = { data: unknown; error: { message: string } | null };
type RpcCall = { name: string; args: Record<string, unknown> };
type CoverageResponse = { count: number | null; error: { message: string } | null };
type FromCall = { table: string; gte?: [string, unknown]; lt?: [string, unknown] };

/**
 * A plain object exposing an `rpc` function that records every call it
 * receives (name + args) and resolves with the queued response for that
 * call's `p_source` argument, plus a `from` function that builds a minimal
 * chainable (`select`/`gte`/`lt`), thenable query-builder stand-in for the
 * `v_apigee_coverage_daily` covered-day count — resolving to
 * `coverageResponse` regardless of which columns were filtered, recording
 * what was filtered in `fromCalls` for the tests that check it. Falls back
 * to a zero-revenue success response for any source not explicitly given a
 * response, and to a covered (`count: 1`) response for coverage, so a test
 * only needs to specify the response(s) it cares about.
 */
function makeFakeSupabase(
  responses: Partial<Record<RevenueSource, RpcResponse>>,
  coverageResponse: CoverageResponse = { count: 1, error: null },
): {
  supabase: FakeSupabase;
  calls: RpcCall[];
  fromCalls: FromCall[];
} {
  const calls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const source = args.p_source as RevenueSource;
      const response = responses[source] ?? { data: "0", error: null };
      return Promise.resolve(response);
    },
    from: (table: string) => {
      const record: FromCall = { table };
      fromCalls.push(record);
      const builder = {
        select: () => builder,
        gte: (col: string, val: unknown) => {
          record.gte = [col, val];
          return builder;
        },
        lt: (col: string, val: unknown) => {
          record.lt = [col, val];
          return builder;
        },
        then: (
          resolve: (value: CoverageResponse) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(coverageResponse).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as FakeSupabase;
  return { supabase, calls, fromCalls };
}

describe("fetchPerSourceRevenueTotals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns both figures converted to numbers exactly once when both RPC calls succeed and TSYS is covered", async () => {
    const { supabase } = makeFakeSupabase({
      bit_addict: { data: "184.9635", error: null },
      tsys: { data: "180.1200", error: null },
    });

    const result = await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: null });

    expect(result).toEqual({
      data: { bitAddict: 184.9635, tsys: 180.12 },
      error: null,
    });
  });

  it("issues each RPC call with an explicit p_source argument, using different source values on the two calls", async () => {
    const { supabase, calls } = makeFakeSupabase({
      bit_addict: { data: "100", error: null },
      tsys: { data: "90", error: null },
    });

    await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: "2026-09-30" });

    expect(calls).toHaveLength(2);
    const sources = calls.map((call) => call.args.p_source);
    expect(sources).toContain("bit_addict");
    expect(sources).toContain("tsys");
    expect(new Set(sources).size).toBe(2);
    for (const call of calls) {
      expect(call.name).toBe("revenue_total_for_period");
    }
  });

  it("passes a null p_end through for an all-time period, rather than substituting a date", async () => {
    const { supabase, calls } = makeFakeSupabase({});

    await fetchPerSourceRevenueTotals(supabase, { start: "2026-08-13", end: null });

    for (const call of calls) {
      expect(call.args.p_start).toBe("2026-08-13");
      expect(call.args.p_end).toBeNull();
    }
  });

  it("returns a discriminated error and logs server-side when the Bit Addict RPC call fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabase({
      bit_addict: { data: null, error: { message: "bit_addict connection refused" } },
      tsys: { data: "90", error: null },
    });

    const result = await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: null });

    expect(result).toEqual({ data: null, error: "bit_addict connection refused" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("returns a discriminated error and logs server-side when the TSYS RPC call fails — never silently absorbed into zero", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabase({
      bit_addict: { data: "100", error: null },
      tsys: { data: null, error: { message: "tsys connection refused" } },
    });

    const result = await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: null });

    expect(result).toEqual({ data: null, error: "tsys connection refused" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("returns a discriminated error and logs server-side when the TSYS coverage query fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabase(
      {
        bit_addict: { data: "100", error: null },
        tsys: { data: "90", error: null },
      },
      { count: null, error: { message: "coverage query connection refused" } },
    );

    const result = await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: null });

    expect(result).toEqual({ data: null, error: "coverage query connection refused" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws, in any of the above cases", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { supabase: bothOkSupabase } = makeFakeSupabase({
      bit_addict: { data: "100", error: null },
      tsys: { data: "90", error: null },
    });
    const { supabase: bitAddictErrorSupabase } = makeFakeSupabase({
      bit_addict: { data: null, error: { message: "boom" } },
      tsys: { data: "90", error: null },
    });
    const { supabase: tsysErrorSupabase } = makeFakeSupabase({
      bit_addict: { data: "100", error: null },
      tsys: { data: null, error: { message: "boom" } },
    });
    const { supabase: coverageErrorSupabase } = makeFakeSupabase(
      { bit_addict: { data: "100", error: null }, tsys: { data: "90", error: null } },
      { count: null, error: { message: "boom" } },
    );

    await expect(
      fetchPerSourceRevenueTotals(bothOkSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
    await expect(
      fetchPerSourceRevenueTotals(bitAddictErrorSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
    await expect(
      fetchPerSourceRevenueTotals(tsysErrorSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
    await expect(
      fetchPerSourceRevenueTotals(coverageErrorSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
  });

  describe("TSYS absence vs. genuine zero (07-UAT gap)", () => {
    it("returns tsys: null when TSYS has zero covered days in the period, even though the RPC still returns a numeric figure", async () => {
      const { supabase } = makeFakeSupabase(
        {
          bit_addict: { data: "184.9635", error: null },
          // Mirrors the live defect: revenue_total_for_period still returns
          // a coalesced "0" for a no-rows period — the coverage count, not
          // this figure, is what must decide absence.
          tsys: { data: "0", error: null },
        },
        { count: 0, error: null },
      );

      const result = await fetchPerSourceRevenueTotals(supabase, {
        start: "2026-09-01",
        end: "2026-10-01",
      });

      expect(result).toEqual({
        data: { bitAddict: 184.9635, tsys: null },
        error: null,
      });
    });

    it("returns tsys: 0 (a real number, not null) when TSYS covered at least one day but recorded no billable volume", async () => {
      const { supabase } = makeFakeSupabase(
        {
          bit_addict: { data: "184.9635", error: null },
          tsys: { data: "0", error: null },
        },
        { count: 1, error: null },
      );

      const result = await fetchPerSourceRevenueTotals(supabase, {
        start: "2026-09-01",
        end: "2026-10-01",
      });

      expect(result).toEqual({
        data: { bitAddict: 184.9635, tsys: 0 },
        error: null,
      });
      expect(result.data?.tsys).not.toBeNull();
    });

    it("returns the real tsys figure unchanged when TSYS is covered and non-zero", async () => {
      const { supabase } = makeFakeSupabase(
        {
          bit_addict: { data: "184.9635", error: null },
          tsys: { data: "0.0810", error: null },
        },
        { count: 1, error: null },
      );

      const result = await fetchPerSourceRevenueTotals(supabase, {
        start: "2026-08-01",
        end: "2026-09-01",
      });

      expect(result).toEqual({
        data: { bitAddict: 184.9635, tsys: 0.081 },
        error: null,
      });
    });

    it("queries v_apigee_coverage_daily filtered to the same [start, end) range, omitting the upper bound for an open-ended (all-time) period", async () => {
      const { supabase, fromCalls } = makeFakeSupabase({});

      await fetchPerSourceRevenueTotals(supabase, { start: "2026-08-13", end: null });

      expect(fromCalls).toHaveLength(1);
      expect(fromCalls[0].table).toBe("v_apigee_coverage_daily");
      expect(fromCalls[0].gte).toEqual(["day", "2026-08-13"]);
      expect(fromCalls[0].lt).toBeUndefined();
    });

    it("applies the upper bound on the coverage query when the period has a defined end", async () => {
      const { supabase, fromCalls } = makeFakeSupabase({});

      await fetchPerSourceRevenueTotals(supabase, { start: "2026-09-01", end: "2026-10-01" });

      expect(fromCalls[0].gte).toEqual(["day", "2026-09-01"]);
      expect(fromCalls[0].lt).toEqual(["day", "2026-10-01"]);
    });
  });
});
