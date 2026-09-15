import { afterEach, describe, expect, it, vi } from "vitest";

import type { createClient } from "@/lib/supabase/server";
import { fetchPerSourceRevenueTotals, type RevenueSource } from "../revenue-source";

/**
 * Task 3 (07-03): covers `fetchPerSourceRevenueTotals`'s success path and
 * both its failure paths. Stubs the Supabase client by hand, following
 * `lib/settings/__tests__/alignment-settings.test.ts`'s existing convention
 * — the Supabase module itself is never module-mocked, and no new mocking
 * dependency is introduced.
 */

type FakeSupabase = Awaited<ReturnType<typeof createClient>>;
type RpcResponse = { data: unknown; error: { message: string } | null };
type RpcCall = { name: string; args: Record<string, unknown> };

/**
 * A plain object exposing an `rpc` function that records every call it
 * receives (name + args) and resolves with the queued response for that
 * call's `p_source` argument. Falls back to a zero-revenue success response
 * for any source not explicitly given a response, so a test only needs to
 * specify the response(s) it cares about.
 */
function makeFakeSupabase(responses: Partial<Record<RevenueSource, RpcResponse>>): {
  supabase: FakeSupabase;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const source = args.p_source as RevenueSource;
      const response = responses[source] ?? { data: "0", error: null };
      return Promise.resolve(response);
    },
  } as unknown as FakeSupabase;
  return { supabase, calls };
}

describe("fetchPerSourceRevenueTotals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns both figures converted to numbers exactly once when both RPC calls succeed", async () => {
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

    await expect(
      fetchPerSourceRevenueTotals(bothOkSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
    await expect(
      fetchPerSourceRevenueTotals(bitAddictErrorSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
    await expect(
      fetchPerSourceRevenueTotals(tsysErrorSupabase, { start: "2026-09-01", end: null }),
    ).resolves.toBeDefined();
  });
});
