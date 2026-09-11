import type { createClient } from "@/lib/supabase/server";
import type { ResolvedPeriod } from "@/lib/dashboard/period";
import type { AlignmentShortSide, AlignmentStatus } from "@/lib/dashboard/alignment-status";

/**
 * Server-side period-scoped fetchers for the `alignment_totals_for_period` /
 * `alignment_daily_for_period` RPCs (supabase/migrations/0028_v_alignment_daily.sql)
 * and the `alignment_live_cards_for_period` RPC
 * (supabase/migrations/0030_v_alignment_live_cards.sql). Uses the
 * session-scoped `lib/supabase/server.ts` client so RLS applies (T-06-01
 * precedent) — never the secret-key writer.
 *
 * The `tolerance`/`baselineOffset` arguments now come from
 * `fetchAlignmentSettings()` (`lib/settings/alignment-settings.ts`, D-15/D-16
 * and D-06/D-09) — every call site in `app/(dashboard)/alignment/page.tsx`
 * reads the live settings once and passes them into every metric fetch
 * below (Plan 06-03, closing the gap 06-02's SUMMARY flagged). Each fetcher
 * returns a discriminated result carrying either rows or an error — it
 * never throws and never swallows the error silently; the raw error is
 * logged server-side and an error flag is returned for the page to render
 * as its own scoped error state.
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

/**
 * Live cards (Plan 06-03, D-06/D-07/D-09) is a cumulative running total, not
 * a per-day flow metric — its RPC shape is deliberately different from
 * `AlignmentTotalsRow` above (no `total_days`/`tsys_covered_days`; instead a
 * single as-at figure pair, the gap at the period's start and end, and the
 * carried-forward Bit Addict snapshot day, D-06/L-02).
 */
export interface AlignmentLiveCardsRow {
  tsys_live_cards: number;
  bit_addict_live_cards: number;
  bit_addict_snapshot_day: string | null;
  gap_at_period_end: number;
  gap_at_period_start: number;
  gap_change: number;
  coverage_complete: boolean;
  settled: boolean;
  short_side: AlignmentShortSide;
  status: AlignmentStatus;
  /** The TSYS-only running coverage guard, separable from the combined
   * `coverage_complete` (CR-02, ALIGN-02, migration 0031). Use this — never
   * `coverage_complete` — as the TSYS side's own coverage figure. */
  tsys_coverage_complete: boolean;
}

/** A period with no observed live-cards data at all — the RPC still returns
 * exactly one row (composed from scalar/left-join subqueries, never an empty
 * result), so this is what that row looks like when nothing has ever been
 * carried forward: zero counts, incomplete coverage, needs_review — never a
 * spuriously-confident aligned. */
const EMPTY_LIVE_CARDS: AlignmentLiveCardsRow = {
  tsys_live_cards: 0,
  bit_addict_live_cards: 0,
  bit_addict_snapshot_day: null,
  gap_at_period_end: 0,
  gap_at_period_start: 0,
  gap_change: 0,
  coverage_complete: false,
  settled: false,
  short_side: null,
  status: "needs_review",
  tsys_coverage_complete: false,
};

export type AlignmentLiveCardsResult =
  | { data: AlignmentLiveCardsRow; error: null }
  | { data: null; error: string };

export async function fetchAlignmentLiveCards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: Pick<ResolvedPeriod, "start" | "end">,
  baselineOffset: number,
  tolerance: number,
): Promise<AlignmentLiveCardsResult> {
  const { data, error } = await supabase.rpc("alignment_live_cards_for_period", {
    p_start: period.start,
    p_end: period.end,
    p_baseline_offset: baselineOffset,
    p_tolerance: tolerance,
  });

  if (error) {
    console.error("fetchAlignmentLiveCards: RPC failed", { error });
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as unknown as AlignmentLiveCardsRow[];
  return { data: rows[0] ?? EMPTY_LIVE_CARDS, error: null };
}
