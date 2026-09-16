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
  /**
   * `null` means TSYS has **no coverage at all** in this period — distinct
   * from a genuine `0`, which means TSYS covered at least one day but
   * recorded no billable volume on it. `revenue_total_for_period` itself
   * cannot make this distinction (it `coalesce`s a no-rows period to `0`,
   * supabase/migrations/0034_v_revenue_source.sql), so this fetcher derives
   * absence separately from `v_apigee_coverage_daily` — the SAME TSYS-side
   * coverage view `revenue_forecast_for_period` already uses to count
   * covered days (supabase/migrations/0037_revenue_forecast.sql) — rather
   * than guessing absence from the revenue figure being zero (07-UAT gap:
   * "A period with no TSYS data is shown as absent, not as a confident
   * $0.00 with a 100% shortfall"). Also `null` whenever `tsysError` is
   * `true` — see that field for how the two `null`-producing cases differ.
   */
  tsys: number | null;
  /**
   * 07-REVIEW WR-01: `true` when the TSYS RPC or the TSYS coverage query
   * failed to load — a genuine load failure, card-scoped (the Bit Addict
   * headline above is unaffected and still renders). Distinct from
   * `tsys === null` with `tsysError: false`, which means the calls
   * succeeded and TSYS genuinely has no coverage in this period. The two
   * cases render different copy in `revenue-kpi-cards.tsx` — never merge
   * them. A `bit_addict` RPC failure is NOT represented here: it makes this
   * whole function return `{ data: null, error }` instead, because the
   * headline is this page's reason to exist and there is nothing honest to
   * show without it (page-fatal, handled by the caller's combined error
   * gate).
   */
  tsysError: boolean;
}

export type PerSourceRevenueTotalsResult =
  | { data: PerSourceRevenueTotals; error: null }
  | { data: null; error: string };

/**
 * Issues both `revenue_total_for_period` RPC calls (one per source) plus a
 * `v_apigee_coverage_daily` covered-day count for TSYS, all in a single
 * `Promise.all`, each with an explicit `p_source` where applicable (D-08:
 * the two-argument overload no longer exists, so a stale call site fails
 * loudly rather than silently reading a doubled figure). Mirrors
 * `lib/dashboard/alignment.ts`'s `fetchAlignmentTotals` discriminated-result
 * convention: never throws, logs the raw error server-side, and returns a
 * typed error string to the caller.
 *
 * 07-REVIEW WR-01: only a `bit_addict` RPC failure produces `{ data: null,
 * error }` (page-fatal — there is no honest headline to show without it). A
 * TSYS-side failure (the `tsys` RPC or the coverage query) instead resolves
 * to `{ data: { bitAddict, tsys: null, tsysError: true }, error: null }` —
 * the Bit Addict figure is still returned so the headline renders, and the
 * caller's per-card fallback ("TSYS revenue could not be loaded.") becomes
 * reachable.
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
  // Coverage-day count for TSYS over the same [start, end) range, read
  // directly off v_apigee_coverage_daily (queried the same way page.tsx
  // already queries v_revenue_daily/v_revenue_by_tier/v_revenue_daily_counts
  // directly — a plain filtered view read, not a new RPC or migration).
  // `.lt()` is applied only when the period has a defined end, matching
  // every other period-scoped query in this codebase ("all" leaves it
  // open-ended).
  let tsysCoverageQuery = supabase
    .from("v_apigee_coverage_daily")
    .select("day", { count: "exact", head: true })
    .gte("day", period.start);
  if (period.end !== null) {
    tsysCoverageQuery = tsysCoverageQuery.lt("day", period.end);
  }

  const [bitAddictResult, tsysResult, tsysCoverageResult] = await Promise.all([
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
    tsysCoverageQuery,
  ]);

  if (bitAddictResult.error) {
    console.error("fetchPerSourceRevenueTotals: bit_addict RPC failed", {
      error: bitAddictResult.error,
    });
    // Page-fatal: the Bit Addict headline is this page's reason to exist,
    // so there is nothing honest to show without it (07-REVIEW WR-01).
    return { data: null, error: bitAddictResult.error.message };
  }

  const bitAddict = Number(bitAddictResult.data ?? "0");

  // 07-REVIEW WR-01: from here, a TSYS-side failure (RPC or coverage query)
  // degrades to a card-scoped `tsysError: true` result instead of failing
  // the whole page — the Bit Addict headline above is already known-good
  // and must still render.
  if (tsysResult.error) {
    console.error("fetchPerSourceRevenueTotals: tsys RPC failed", {
      error: tsysResult.error,
    });
    return { data: { bitAddict, tsys: null, tsysError: true }, error: null };
  }

  if (tsysCoverageResult.error) {
    console.error("fetchPerSourceRevenueTotals: tsys coverage query failed", {
      error: tsysCoverageResult.error,
    });
    return { data: { bitAddict, tsys: null, tsysError: true }, error: null };
  }

  const tsysCoveredDays = tsysCoverageResult.count ?? 0;

  return {
    data: {
      bitAddict,
      tsys: tsysCoveredDays > 0 ? Number(tsysResult.data ?? "0") : null,
      tsysError: false,
    },
    error: null,
  };
}
