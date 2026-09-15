import type { createClient } from "@/lib/supabase/server";
import type { ResolvedPeriod } from "@/lib/dashboard/period";

/**
 * The two revenue sources the Phase 7 source dimension threads through
 * `supabase/migrations/0034_v_revenue_source.sql`'s view chain (D-07). Bit
 * Addict is our own systems (verifications); TSYS is the customer-side
 * check (apigee_calls, endpoint_category = 'verify' only, L-06).
 */
export const REVENUE_SOURCES = ["bit_addict", "tsys"] as const;
export type RevenueSource = (typeof REVENUE_SOURCES)[number];

/**
 * D-09: Bit Addict is the headline revenue figure. Our own systems are
 * canonical; TSYS is shown alongside as the customer-side check and is
 * NEVER averaged in. An unqualified "revenue" anywhere in the UI or the
 * code means Bit Addict.
 */
export const HEADLINE_REVENUE_SOURCE: RevenueSource = "bit_addict";

export interface PerSourceRevenueTotals {
  bitAddict: number;
  tsys: number;
}

export type PerSourceRevenueTotalsResult =
  | { data: PerSourceRevenueTotals; error: null }
  | { data: null; error: string };

/**
 * Issues both `revenue_total_for_period` RPC calls (one per source) in a
 * single `Promise.all`, each with an explicit `p_source` (D-08: the
 * two-argument overload no longer exists, so a stale call site fails
 * loudly rather than silently reading a doubled figure). Mirrors
 * `lib/dashboard/alignment.ts`'s `fetchAlignmentTotals` discriminated-result
 * convention: never throws, logs the raw error server-side, and returns a
 * typed error string to the caller.
 *
 * The NUMERIC strings `revenue_total_for_period` returns are converted to
 * `number` only at this boundary — never re-summed or otherwise
 * re-derived (Pitfall 2/L-01): each figure is already the final,
 * exact-NUMERIC total computed in Postgres for its own source.
 */
export async function fetchPerSourceRevenueTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: Pick<ResolvedPeriod, "start" | "end">,
): Promise<PerSourceRevenueTotalsResult> {
  const [bitAddictResult, tsysResult] = await Promise.all([
    supabase.rpc("revenue_total_for_period", {
      p_start: period.start,
      p_end: period.end,
      p_source: "bit_addict",
    }),
    supabase.rpc("revenue_total_for_period", {
      p_start: period.start,
      p_end: period.end,
      p_source: "tsys",
    }),
  ]);

  if (bitAddictResult.error) {
    console.error("fetchPerSourceRevenueTotals: bit_addict RPC failed", {
      error: bitAddictResult.error,
    });
    return { data: null, error: bitAddictResult.error.message };
  }

  if (tsysResult.error) {
    console.error("fetchPerSourceRevenueTotals: tsys RPC failed", {
      error: tsysResult.error,
    });
    return { data: null, error: tsysResult.error.message };
  }

  return {
    data: {
      bitAddict: Number(bitAddictResult.data ?? "0"),
      tsys: Number(tsysResult.data ?? "0"),
    },
    error: null,
  };
}
