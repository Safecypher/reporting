import type { createClient } from "@/lib/supabase/server";
import { DATA_WINDOW_START, DRILL_ROW_LIMIT } from "@/lib/dashboard/reconciliation-drill";
import {
  fetchAlignmentDaily,
  fetchAlignmentInventoryDiffRows,
  type AlignmentMetric,
  type FlowAlignmentMetric,
} from "@/lib/dashboard/alignment";
import type { DrillEntity } from "@/lib/dashboard/drill-params";
import type { ResolvedPeriod } from "@/lib/dashboard/period";
import {
  computeAlignmentSettled,
  computeAlignmentShortSide,
  computeAlignmentStatus,
  type AlignmentShortSide,
  type AlignmentStatus,
} from "@/lib/dashboard/alignment-status";

/** The four whitelisted alignment `DrillEntity` values (`drill-params.ts`),
 * one per metric — mirrors how Phase 4 added `recon-billing`/`recon-inventory`
 * rather than a generic entity plus a separate metric param. */
export type AlignmentDrillEntity =
  | "alignment-enrolled"
  | "alignment-unenrolled"
  | "alignment-live-cards"
  | "alignment-volume";

export const ALIGNMENT_DRILL_ENTITY_TO_METRIC: Record<AlignmentDrillEntity, AlignmentMetric> = {
  "alignment-enrolled": "enrolled",
  "alignment-unenrolled": "unenrolled",
  "alignment-live-cards": "live-cards",
  "alignment-volume": "volume",
};

export const ALIGNMENT_METRIC_TO_DRILL_ENTITY: Record<AlignmentMetric, AlignmentDrillEntity> = {
  enrolled: "alignment-enrolled",
  unenrolled: "alignment-unenrolled",
  "live-cards": "alignment-live-cards",
  volume: "alignment-volume",
};

/** Narrows a generic `DrillEntity` to one of the four alignment entities, or
 * `null` when it belongs to a different drill (verification/revenue-tier/
 * sla-breach/recon-*) — the single choke point every alignment surface uses
 * to decide whether a given `DrillFilter` is "its own" drill. */
export function asAlignmentDrillEntity(drill: DrillEntity): AlignmentDrillEntity | null {
  return drill in ALIGNMENT_DRILL_ENTITY_TO_METRIC ? (drill as AlignmentDrillEntity) : null;
}

/**
 * Two-level alignment drill fetchers (D-19/ALIGN-04/ALIGN-07):
 * - Level 1: `fetchAlignmentDayBreakdown` — the per-day breakdown table for
 *   one metric across the active period, capped at `ALIGNMENT_DRILL_DAY_CAP`
 *   most-recent days (UI-SPEC E3's "cap and link out" probe decision).
 * - Level 2: `fetchAlignmentContributingRows` — the two sides' raw
 *   contributing rows for one UTC day, each embedding
 *   `ingested_files(file_name)` (PostgREST FK resource embedding) so the row
 *   carries its originating file NAME, not just its `source_file_id` UUID —
 *   the one genuinely new capability this plan adds (RESEARCH.md "Two-level
 *   drill + source-file caption").
 *
 * Mirrors `reconciliation-drill.ts`'s shape: whitelisted/parameterised
 * queries only (never a raw search param reaching a query builder, T-06-25),
 * the two sides of every fetch EXPLICITLY SEPARATED (Pitfall 5 — never
 * merged into one flat list), and an error-safe fallback to an empty
 * result plus a logged server-side error, never a thrown exception.
 */

export { DATA_WINDOW_START, DRILL_ROW_LIMIT };

/**
 * Roughly two months — generous for a leadership glance at the level-1
 * drill Sheet, and it only ever binds on a `year`/`all-time` scope selection
 * since a `month` scope never exceeds 31 days (RESEARCH.md "Full-page
 * day-breakdown route", UI-SPEC E3 probe decision A3).
 */
export const ALIGNMENT_DRILL_DAY_CAP = 60;

// ---------------------------------------------------------------------------
// Level 1: per-day breakdown
// ---------------------------------------------------------------------------

export interface AlignmentDayBreakdownRow {
  day: string;
  tsysCount: number;
  bitAddictCount: number;
  /** Per-side coverage (D-10/D-11) — the Coverage cell names which side, if
   * any, is uncovered rather than only stating a combined boolean. */
  tsysCovered: boolean;
  bitAddictCovered: boolean;
  coverageComplete: boolean;
  settled: boolean;
  shortSide: AlignmentShortSide;
  status: AlignmentStatus;
}

export interface AlignmentDayBreakdownResult {
  rows: AlignmentDayBreakdownRow[];
  /** True when the period contained more days than `ALIGNMENT_DRILL_DAY_CAP`
   * could return — the Sheet renders the bounded-window notice only then
   * (UI-SPEC E3: "not shown when every day in the period is already
   * rendered"). */
  hasMoreDays: boolean;
  error: string | null;
}

async function fetchFlowDayBreakdown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: FlowAlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
  rowCap: number | null,
): Promise<AlignmentDayBreakdownResult> {
  const result = await fetchAlignmentDaily(supabase, metric, period, tolerance);
  if (result.error !== null) {
    return { rows: [], hasMoreDays: false, error: result.error };
  }

  const all = result.data;
  const hasMoreDays = rowCap !== null && all.length > rowCap;
  const capped = hasMoreDays ? all.slice(-rowCap!) : all;

  const rows: AlignmentDayBreakdownRow[] = capped.map((row) => ({
    day: row.day,
    tsysCount: row.tsys_count,
    bitAddictCount: row.bit_addict_count,
    tsysCovered: row.tsys_covered,
    bitAddictCovered: row.bit_addict_covered,
    coverageComplete: row.coverage_complete,
    settled: row.settled,
    shortSide: row.short_side,
    status: row.status,
  }));

  return { rows, hasMoreDays, error: null };
}

interface AlignmentLiveCardsDailyViewRow {
  day: string;
  tsys_cumulative_net: number;
  bit_addict_live_cards: number;
  bit_addict_snapshot_day: string | null;
  coverage_complete_to_date: boolean;
}

/** The bounds row's two independent per-side maxima (0031) — both constant
 * across every row of `v_alignment_live_cards_daily`, so one row still
 * answers the question. */
interface AlignmentLiveCardsBoundsRow {
  day: string;
  tsys_max_day: string | null;
  bit_addict_max_day: string | null;
}

/**
 * Live cards (D-06/D-07) is a cumulative running total, not a per-day flow
 * count, so its day breakdown is built directly over `v_alignment_live_cards_daily`
 * (already live, 0030) rather than a per-day RPC — no migration this plan.
 * Each day's status mirrors `alignment_live_cards_for_period`'s own
 * gap-CHANGE derivation (D-07): the two "counts" passed into
 * `computeAlignmentStatus` are the gap immediately BEFORE this day and the
 * gap AT this day, never the raw TSYS/Bit-Addict levels — a permanent
 * pre-window offset must never read as a mismatch on its own, day after day.
 *
 * Settling now also mirrors `alignment_live_cards_for_period`'s (0031)
 * per-side settling: the bounds query selects `tsys_max_day` and
 * `bit_addict_max_day` independently (rather than one combined `day`
 * maximum), and each row's `settled` is decided by `computeAlignmentSettled`
 * — the exported hand-mirror of SQL `alignment_settled` — so a cadence
 * divergence between the two sources can never let the fresher one alone
 * settle a day whose true counterpart hasn't caught up (CR-01/WR-01).
 */
async function fetchLiveCardsDayBreakdown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
  baselineOffset: number,
  rowCap: number | null,
): Promise<AlignmentDayBreakdownResult> {
  let windowQuery = supabase
    .from("v_alignment_live_cards_daily")
    .select(
      "day, tsys_cumulative_net, bit_addict_live_cards, bit_addict_snapshot_day, coverage_complete_to_date",
      { count: "exact" },
    )
    .gte("day", period.start);
  if (period.end !== null) {
    windowQuery = windowQuery.lt("day", period.end);
  }
  // Capped (Sheet, level 1): most-recent-first with a limit, then reversed
  // to ascending. Uncapped (full-page route, Task 3): every day in the
  // period, fetched already-ascending — no limit, no reversal needed.
  windowQuery =
    rowCap !== null
      ? windowQuery.order("day", { ascending: false }).limit(rowCap)
      : windowQuery.order("day", { ascending: true });

  const [windowResult, boundsResult] = await Promise.all([
    windowQuery.returns<AlignmentLiveCardsDailyViewRow[]>(),
    supabase
      .from("v_alignment_live_cards_daily")
      .select("day, tsys_max_day, bit_addict_max_day")
      .order("day", { ascending: false })
      .limit(1)
      .returns<AlignmentLiveCardsBoundsRow[]>()
      .maybeSingle(),
  ]);

  if (windowResult.error || boundsResult.error) {
    const error = windowResult.error ?? boundsResult.error;
    console.error("fetchLiveCardsDayBreakdown: query failed", { error });
    return { rows: [], hasMoreDays: false, error: error!.message };
  }

  const fetchedRows = windowResult.data ?? [];
  const ascRows = rowCap !== null ? [...fetchedRows].reverse() : fetchedRows;
  const totalInPeriod = windowResult.count ?? ascRows.length;
  const hasMoreDays = rowCap !== null && totalInPeriod > ascRows.length;
  const tsysMaxDay = boundsResult.data?.tsys_max_day ?? null;
  const bitAddictMaxDay = boundsResult.data?.bit_addict_max_day ?? null;

  if (ascRows.length === 0) {
    return { rows: [], hasMoreDays: false, error: null };
  }

  // The gap immediately BEFORE the first rendered day — the same "day
  // before" lookup `alignment_live_cards_for_period` (0030) performs
  // server-side (`start_prior_row`). Zero-based when there is no earlier row
  // (D-06/D-09's zero-basis rule at the data-window boundary).
  const firstDay = ascRows[0].day;
  const priorDayResult = await supabase
    .from("v_alignment_live_cards_daily")
    .select("tsys_cumulative_net, bit_addict_live_cards")
    .lt("day", firstDay)
    .order("day", { ascending: false })
    .limit(1)
    .returns<{ tsys_cumulative_net: number; bit_addict_live_cards: number }[]>()
    .maybeSingle();

  if (priorDayResult.error) {
    console.error("fetchLiveCardsDayBreakdown: prior-day query failed", priorDayResult.error);
    return { rows: [], hasMoreDays: false, error: priorDayResult.error.message };
  }

  let previousGap =
    priorDayResult.data === null
      ? 0
      : baselineOffset +
        priorDayResult.data.tsys_cumulative_net -
        priorDayResult.data.bit_addict_live_cards;

  const rows: AlignmentDayBreakdownRow[] = ascRows.map((row) => {
    const tsysCount = baselineOffset + row.tsys_cumulative_net;
    const bitAddictCount = row.bit_addict_live_cards;
    const gap = tsysCount - bitAddictCount;
    const coverageComplete = row.coverage_complete_to_date && row.bit_addict_snapshot_day !== null;
    const settled = computeAlignmentSettled(row.day, tsysMaxDay, bitAddictMaxDay);
    const status = computeAlignmentStatus(
      Math.round(previousGap),
      Math.round(gap),
      tolerance,
      settled,
      coverageComplete,
    );
    const shortSide = computeAlignmentShortSide(tsysCount, bitAddictCount);
    previousGap = gap;
    return {
      day: row.day,
      tsysCount: Math.round(tsysCount),
      bitAddictCount,
      tsysCovered: row.coverage_complete_to_date,
      bitAddictCovered: row.bit_addict_snapshot_day !== null,
      coverageComplete,
      settled,
      shortSide,
      status,
    };
  });

  return { rows, hasMoreDays, error: null };
}

/**
 * Level-1 fetcher: the most recent `ALIGNMENT_DRILL_DAY_CAP` days of
 * per-day rows for `metric` across `period`, plus `hasMoreDays` stating
 * whether the period contained more days than were returned. The three flow
 * metrics (enrolled/unenrolled/volume) reuse `alignment_daily_for_period`
 * (0028, unchanged) via `fetchAlignmentDaily`; live cards reads
 * `v_alignment_live_cards_daily` (0030) directly, since it has no per-day
 * RPC of its own. `baselineOffset` only affects the live-cards branch — the
 * three flow metrics ignore it, matching `alignment_daily_for_period`'s own
 * signature (no baseline concept applies to a flow metric).
 */
export async function fetchAlignmentDayBreakdown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: AlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
  baselineOffset = 0,
): Promise<AlignmentDayBreakdownResult> {
  if (metric === "live-cards") {
    return fetchLiveCardsDayBreakdown(supabase, period, tolerance, baselineOffset, ALIGNMENT_DRILL_DAY_CAP);
  }
  return fetchFlowDayBreakdown(supabase, metric, period, tolerance, ALIGNMENT_DRILL_DAY_CAP);
}

/**
 * The uncapped counterpart used by the full-page day-breakdown route
 * (`/alignment/[metric]`, Task 3) — every day in `period`, no row cap,
 * `hasMoreDays` always `false` (there is nothing further to link out to).
 * Reuses the exact same per-metric derivation as `fetchAlignmentDayBreakdown`
 * above; only the row limit differs.
 */
export async function fetchAlignmentDayBreakdownUncapped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: AlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
  baselineOffset = 0,
): Promise<AlignmentDayBreakdownResult> {
  if (metric === "live-cards") {
    return fetchLiveCardsDayBreakdown(supabase, period, tolerance, baselineOffset, null);
  }
  return fetchFlowDayBreakdown(supabase, metric, period, tolerance, null);
}

// ---------------------------------------------------------------------------
// Level 2: contributing rows for one day, with source-file provenance
// ---------------------------------------------------------------------------

export interface AlignmentTsysContributingRow {
  eventTime: string;
  endpointCategory: string | null;
  responseCode: number;
  fileName: string | null;
}

export interface AlignmentBitAddictContributingRow {
  eventTime: string;
  externalCardReference: string;
  fileName: string | null;
}

export interface AlignmentContributingRowsResult {
  tsysRows: AlignmentTsysContributingRow[];
  bitAddictRows: AlignmentBitAddictContributingRow[];
  error: string | null;
}

const EMPTY_CONTRIBUTING_RESULT: AlignmentContributingRowsResult = {
  tsysRows: [],
  bitAddictRows: [],
  error: null,
};

/** endpoint_category values counted on the TSYS side for each metric —
 * live cards nets both enrol and unenrol, mirroring 0030's derivation. */
const TSYS_ENDPOINT_CATEGORIES: Record<AlignmentMetric, readonly string[]> = {
  enrolled: ["enrol"],
  unenrolled: ["unenrol"],
  "live-cards": ["enrol", "unenrol"],
  volume: ["verify"],
};

interface ApigeeContributingRawRow {
  event_time: string;
  endpoint_category: string | null;
  response_code: number;
  ingested_files: { file_name: string } | null;
}

interface CardInventoryContributingRawRow {
  created_at: string;
  external_card_reference: string;
  ingested_files: { file_name: string } | null;
}

interface VerificationContributingRawRow {
  created_at: string;
  external_card_reference: string;
  ingested_files: { file_name: string } | null;
}

/** One side's resolved contributing rows plus its own error, so the two
 * sides (fetched in parallel below) can be combined uniformly regardless of
 * whether they came from a direct table query or the set-difference RPC. */
interface BitAddictContributingSideResult {
  rows: AlignmentBitAddictContributingRow[];
  error: string | null;
}

/**
 * The Bit Addict side of `fetchAlignmentContributingRows`, below. `enrolled`
 * and `unenrolled` call `fetchAlignmentInventoryDiffRows` (0032, WR-04) so
 * the drill returns exactly the day-over-day set difference the aggregate
 * figure counts — never the raw table read. `live-cards`'s figure IS the
 * whole snapshot's distinct card count (a stock metric, L-02, not a
 * day-over-day flow), so the full `report_date` snapshot from `card_inventory`
 * remains the correct contributing rowset for it — left unchanged
 * deliberately; do not "fix" this into a set difference by analogy with
 * enrolled/unenrolled. `volume` reads `verifications`, unchanged.
 */
async function fetchBitAddictContributingRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: AlignmentMetric,
  day: string,
  dayStart: string,
  dayEnd: string,
): Promise<BitAddictContributingSideResult> {
  if (metric === "enrolled" || metric === "unenrolled") {
    const result = await fetchAlignmentInventoryDiffRows(supabase, day, metric);
    if (result.error !== null) {
      return { rows: [], error: result.error };
    }
    return {
      rows: result.data.map((row) => ({
        eventTime: row.created_at,
        externalCardReference: row.external_card_reference,
        fileName: row.file_name,
      })),
      error: null,
    };
  }

  if (metric === "live-cards") {
    const { data, error } = await supabase
      .from("card_inventory")
      .select("created_at, external_card_reference, ingested_files(file_name)")
      .eq("report_date", day)
      .order("external_card_reference", { ascending: true })
      .limit(DRILL_ROW_LIMIT)
      .returns<CardInventoryContributingRawRow[]>();

    if (error) {
      return { rows: [], error: error.message };
    }
    return {
      rows: (data ?? []).map((row) => ({
        eventTime: row.created_at,
        externalCardReference: row.external_card_reference,
        fileName: row.ingested_files?.file_name ?? null,
      })),
      error: null,
    };
  }

  const { data, error } = await supabase
    .from("verifications")
    .select("created_at, external_card_reference, ingested_files(file_name)")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd)
    .order("created_at", { ascending: false })
    .limit(DRILL_ROW_LIMIT)
    .returns<VerificationContributingRawRow[]>();

  if (error) {
    return { rows: [], error: error.message };
  }
  return {
    rows: (data ?? []).map((row) => ({
      eventTime: row.created_at,
      externalCardReference: row.external_card_reference,
      fileName: row.ingested_files?.file_name ?? null,
    })),
    error: null,
  };
}

/**
 * Server-fetches the two sides' rows contributing to one UTC day's
 * alignment comparison for `metric` — TSYS rows from `apigee_calls` filtered
 * to the metric's `endpoint_category`, and Bit Addict rows sourced per
 * `fetchBitAddictContributingRows` above: the set difference
 * `alignment_inventory_diff_rows` RPC for `enrolled`/`unenrolled` (0032,
 * WR-04 — the day-over-day rows the aggregate actually counts, never a
 * whole-snapshot read or the independently-sourced removed-cards log),
 * `card_inventory`'s full snapshot for `live-cards` (a stock metric, L-02,
 * unchanged), and `verifications` for `volume` (unchanged). `day` must
 * already be a validated `YYYY-MM-DD` string (from `parseDrillParams`) —
 * this function only ever builds `.gte()`/`.lt()`/`.eq()` day-range filters
 * or passes it as a whitelisted RPC argument, never a string-interpolated
 * query fragment (T-06-25/T-06G-15).
 *
 * Each select (or the RPC) carries its originating file NAME, so the caller
 * can still render one `From {file_name}` caption per distinct file. The two
 * sides are fetched in PARALLEL and returned EXPLICITLY SEPARATED (Pitfall
 * 5) — never merged into one flat list.
 */
export async function fetchAlignmentContributingRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: AlignmentMetric,
  day: string | undefined,
): Promise<AlignmentContributingRowsResult> {
  if (!day) return EMPTY_CONTRIBUTING_RESULT;

  const dayStart = `${day}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const categories = TSYS_ENDPOINT_CATEGORIES[metric];

  const tsysQuery = supabase
    .from("apigee_calls")
    .select("event_time, endpoint_category, response_code, ingested_files(file_name)")
    .gte("event_time", dayStart)
    .lt("event_time", dayEnd)
    .in("endpoint_category", categories as string[])
    .order("event_time", { ascending: false })
    .limit(DRILL_ROW_LIMIT)
    .returns<ApigeeContributingRawRow[]>();

  const [tsysResult, bitAddictResult] = await Promise.all([
    tsysQuery,
    fetchBitAddictContributingRows(supabase, metric, day, dayStart, dayEnd),
  ]);

  if (tsysResult.error || bitAddictResult.error) {
    console.error("fetchAlignmentContributingRows: query failed", {
      metric,
      day,
      tsysError: tsysResult.error,
      bitAddictError: bitAddictResult.error,
    });
    return {
      tsysRows: [],
      bitAddictRows: [],
      error: (tsysResult.error?.message ?? bitAddictResult.error)!,
    };
  }

  const tsysRows: AlignmentTsysContributingRow[] = (tsysResult.data ?? []).map((row) => ({
    eventTime: row.event_time,
    endpointCategory: row.endpoint_category,
    responseCode: row.response_code,
    fileName: row.ingested_files?.file_name ?? null,
  }));

  return { tsysRows, bitAddictRows: bitAddictResult.rows, error: null };
}
