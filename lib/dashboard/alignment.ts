import type { createClient } from "@/lib/supabase/server";
import type { ResolvedPeriod } from "@/lib/dashboard/period";
import type { AlignmentShortSide, AlignmentStatus } from "@/lib/dashboard/alignment-status";

/**
 * Server-side period-scoped fetchers for the `alignment_totals_for_period` /
 * `alignment_daily_for_period` RPCs (supabase/migrations/0028_v_alignment_daily.sql).
 * Uses the session-scoped `lib/supabase/server.ts` client so RLS applies
 * (T-06-01 precedent) — never the secret-key writer.
 *
 * The `tolerance` argument arrives from `app_settings.alignment_tolerance`
 * once Plan 06-02 lands (D-15/D-16); until then every call site passes `0`,
 * matching `lib/settings/fy-settings.ts`'s documented "migration not yet
 * pushed -> fall back to the default" convention. Each fetcher returns a
 * discriminated result carrying either rows or an error — it never throws
 * and never swallows the error silently; the raw error is logged
 * server-side and an error flag is returned for the page to render as its
 * own scoped error state.
 */

export const ALIGNMENT_METRICS = ["enrolled", "unenrolled", "live-cards", "volume"] as const;
export type AlignmentMetric = (typeof ALIGNMENT_METRICS)[number];

const ALIGNMENT_METRIC_LABELS: Record<AlignmentMetric, string> = {
  enrolled: "Enrolled cards",
  unenrolled: "Unenrolled cards",
  "live-cards": "Live cards",
  volume: "Transaction volume",
};

/** Copywriting Contract metric labels. */
export function alignmentMetricLabel(metric: AlignmentMetric): string {
  return ALIGNMENT_METRIC_LABELS[metric];
}

/**
 * Only the three flow metrics are backed by `v_alignment_daily` as of this
 * plan — `live-cards` is its own cumulative view/RPC, wired in Plan 06-03.
 * `ALIGNMENT_METRICS`/`AlignmentMetric` above stay the full four-value
 * vocabulary (it is the shared metric identity every later plan keys off),
 * but the two fetchers below only accept the three this plan's RPCs
 * actually serve.
 */
export type FlowAlignmentMetric = Exclude<AlignmentMetric, "live-cards">;

export interface AlignmentTotalsRow {
  tsys_count: number;
  bit_addict_count: number;
  tsys_covered_days: number;
  bit_addict_covered_days: number;
  total_days: number;
  period_coverage_complete: boolean;
  settled: boolean;
  short_side: AlignmentShortSide;
  status: AlignmentStatus;
}

export interface AlignmentDailyRow {
  day: string;
  metric: string;
  tsys_count: number;
  bit_addict_count: number;
  tsys_covered: boolean;
  bit_addict_covered: boolean;
  coverage_complete: boolean;
  settled: boolean;
  short_side: AlignmentShortSide;
  status: AlignmentStatus;
}

/** A period with no observed comparison days at all (e.g. entirely before
 * any TSYS or Bit Addict data exists) — the RPC still returns exactly one
 * row (an aggregate over zero grouped rows), so this is what that row looks
 * like: zero counts, incomplete coverage, needs_review — never a
 * spuriously-confident aligned. */
const EMPTY_TOTALS: AlignmentTotalsRow = {
  tsys_count: 0,
  bit_addict_count: 0,
  tsys_covered_days: 0,
  bit_addict_covered_days: 0,
  total_days: 0,
  period_coverage_complete: false,
  settled: false,
  short_side: null,
  status: "needs_review",
};

export type AlignmentTotalsResult =
  | { data: AlignmentTotalsRow; error: null }
  | { data: null; error: string };

export type AlignmentDailyResult =
  | { data: AlignmentDailyRow[]; error: null }
  | { data: null; error: string };

export async function fetchAlignmentTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: FlowAlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
): Promise<AlignmentTotalsResult> {
  // `lib/supabase/server.ts`'s client isn't parameterised with the
  // generated `Database` type (see `revenue_total_for_period`'s identical
  // call-site convention in app/(dashboard)/revenue/page.tsx), so a
  // set-returning RPC's result comes back untyped here — `as unknown` first,
  // never a narrowing cast straight to the row type, so a genuine shape
  // mismatch still fails loudly at the point the value is actually used.
  const { data, error } = await supabase.rpc("alignment_totals_for_period", {
    p_metric: metric,
    p_start: period.start,
    p_end: period.end,
    p_tolerance: tolerance,
  });

  if (error) {
    console.error("fetchAlignmentTotals: RPC failed", { metric, error });
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as unknown as AlignmentTotalsRow[];
  return { data: rows[0] ?? EMPTY_TOTALS, error: null };
}

export async function fetchAlignmentDaily(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: FlowAlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
): Promise<AlignmentDailyResult> {
  const { data, error } = await supabase.rpc("alignment_daily_for_period", {
    p_metric: metric,
    p_start: period.start,
    p_end: period.end,
    p_tolerance: tolerance,
  });

  if (error) {
    console.error("fetchAlignmentDaily: RPC failed", { metric, error });
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as unknown as AlignmentDailyRow[];
  return { data: rows, error: null };
}
