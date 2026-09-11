import type { createClient } from "@/lib/supabase/server";
import { DATA_WINDOW_START, DRILL_ROW_LIMIT } from "@/lib/dashboard/reconciliation-drill";
import { fetchAlignmentDaily, type AlignmentMetric, type FlowAlignmentMetric } from "@/lib/dashboard/alignment";
import type { ResolvedPeriod } from "@/lib/dashboard/period";
import {
  computeAlignmentShortSide,
  computeAlignmentStatus,
  type AlignmentShortSide,
  type AlignmentStatus,
} from "@/lib/dashboard/alignment-status";

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

/**
 * Mirrors `alignment_status`'s (0027/0028) `add_business_days(date, int)` BY
 * HAND — the same discipline `lib/dashboard/alignment-status.ts` already
 * applies to the SQL truth table itself (0019's documented convention: if
 * either side changes, re-check the other). `add_business_days` IS exposed
 * as an authenticated RPC (0027's grant), but calling it once per rendered
 * day (up to `ALIGNMENT_DRILL_DAY_CAP`) would cost that many additional
 * round trips for a value this cheap to compute locally. Pure string/date
 * arithmetic only — no network/DOM/clock access.
 */
function addBusinessDaysLocal(day: string, n: number): string {
  let cursor = new Date(`${day}T00:00:00Z`);
  let remaining = n;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    // getUTCDay(): 0=Sunday...6=Saturday. isodow-equivalent weekday check:
    // Saturday (6) and Sunday (0) do not consume a business day.
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      remaining -= 1;
    }
  }
  return cursor.toISOString().slice(0, 10);
}

async function fetchFlowDayBreakdown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  metric: FlowAlignmentMetric,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
): Promise<AlignmentDayBreakdownResult> {
  const result = await fetchAlignmentDaily(supabase, metric, period, tolerance);
  if (result.error !== null) {
    return { rows: [], hasMoreDays: false, error: result.error };
  }

  const all = result.data;
  const hasMoreDays = all.length > ALIGNMENT_DRILL_DAY_CAP;
  const capped = hasMoreDays ? all.slice(-ALIGNMENT_DRILL_DAY_CAP) : all;

  const rows: AlignmentDayBreakdownRow[] = capped.map((row) => ({
    day: row.day,
    tsysCount: row.tsys_count,
    bitAddictCount: row.bit_addict_count,
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

/**
 * Live cards (D-06/D-07) is a cumulative running total, not a per-day flow
 * count, so its day breakdown is built directly over `v_alignment_live_cards_daily`
 * (already live, 0030) rather than a per-day RPC — no migration this plan.
 * Each day's status mirrors `alignment_live_cards_for_period`'s own
 * gap-CHANGE derivation (D-07): the two "counts" passed into
 * `computeAlignmentStatus` are the gap immediately BEFORE this day and the
 * gap AT this day, never the raw TSYS/Bit-Addict levels — a permanent
 * pre-window offset must never read as a mismatch on its own, day after day.
 */
async function fetchLiveCardsDayBreakdown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  period: Pick<ResolvedPeriod, "start" | "end">,
  tolerance: number,
  baselineOffset: number,
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

  const [windowResult, boundsResult] = await Promise.all([
    windowQuery
      .order("day", { ascending: false })
      .limit(ALIGNMENT_DRILL_DAY_CAP)
      .returns<AlignmentLiveCardsDailyViewRow[]>(),
    supabase
      .from("v_alignment_live_cards_daily")
      .select("day")
      .order("day", { ascending: false })
      .limit(1)
      .returns<{ day: string }[]>()
      .maybeSingle(),
  ]);

  if (windowResult.error || boundsResult.error) {
    const error = windowResult.error ?? boundsResult.error;
    console.error("fetchLiveCardsDayBreakdown: query failed", { error });
    return { rows: [], hasMoreDays: false, error: error!.message };
  }

  const descRows = windowResult.data ?? [];
  const ascRows = [...descRows].reverse();
  const totalInPeriod = windowResult.count ?? ascRows.length;
  const hasMoreDays = totalInPeriod > ascRows.length;
  const maxDay = boundsResult.data?.day ?? null;

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
    const settled = maxDay !== null && maxDay >= addBusinessDaysLocal(row.day, 3);
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
    return fetchLiveCardsDayBreakdown(supabase, period, tolerance, baselineOffset);
  }
  return fetchFlowDayBreakdown(supabase, metric, period, tolerance);
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

interface RemovedCardContributingRawRow {
  removed_at: string;
  external_card_reference: string;
  ingested_files: { file_name: string } | null;
}

interface VerificationContributingRawRow {
  created_at: string;
  external_card_reference: string;
  ingested_files: { file_name: string } | null;
}

/**
 * Server-fetches the two sides' rows contributing to one UTC day's
 * alignment comparison for `metric` — TSYS rows from `apigee_calls` filtered
 * to the metric's `endpoint_category`, and Bit Addict rows from whichever
 * table matches the metric (`card_inventory` for enrolled/live-cards,
 * `removed_cards` for unenrolled, `verifications` for volume). `day` must
 * already be a validated `YYYY-MM-DD` string (from `parseDrillParams`) —
 * this function only ever builds `.gte()`/`.lt()`/`.eq()` day-range filters
 * from it, never a string-interpolated query fragment (T-06-25).
 *
 * Each select embeds `ingested_files(file_name)` through the existing
 * `source_file_id` foreign key (PostgREST resource embedding) so every row
 * carries its originating file NAME — the new capability this plan adds.
 * The two sides are fetched in PARALLEL and returned EXPLICITLY SEPARATED
 * (Pitfall 5) — never merged into one flat list. A day whose rows span more
 * than one uploaded file is handled by the caller grouping by distinct
 * `fileName` (RESEARCH.md "Two-level drill + source-file caption").
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

  const bitAddictQuery =
    metric === "enrolled" || metric === "live-cards"
      ? supabase
          .from("card_inventory")
          .select("created_at, external_card_reference, ingested_files(file_name)")
          .eq("report_date", day)
          .order("external_card_reference", { ascending: true })
          .limit(DRILL_ROW_LIMIT)
          .returns<CardInventoryContributingRawRow[]>()
      : metric === "unenrolled"
        ? supabase
            .from("removed_cards")
            .select("removed_at, external_card_reference, ingested_files(file_name)")
            .gte("removed_at", dayStart)
            .lt("removed_at", dayEnd)
            .order("removed_at", { ascending: false })
            .limit(DRILL_ROW_LIMIT)
            .returns<RemovedCardContributingRawRow[]>()
        : supabase
            .from("verifications")
            .select("created_at, external_card_reference, ingested_files(file_name)")
            .gte("created_at", dayStart)
            .lt("created_at", dayEnd)
            .order("created_at", { ascending: false })
            .limit(DRILL_ROW_LIMIT)
            .returns<VerificationContributingRawRow[]>();

  const [tsysResult, bitAddictResult] = await Promise.all([tsysQuery, bitAddictQuery]);

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
      error: (tsysResult.error ?? bitAddictResult.error)!.message,
    };
  }

  const tsysRows: AlignmentTsysContributingRow[] = (tsysResult.data ?? []).map((row) => ({
    eventTime: row.event_time,
    endpointCategory: row.endpoint_category,
    responseCode: row.response_code,
    fileName: row.ingested_files?.file_name ?? null,
  }));

  const bitAddictRows: AlignmentBitAddictContributingRow[] = (bitAddictResult.data ?? []).map(
    (row: CardInventoryContributingRawRow | RemovedCardContributingRawRow | VerificationContributingRawRow) => {
      if ("removed_at" in row) {
        return {
          eventTime: row.removed_at,
          externalCardReference: row.external_card_reference,
          fileName: row.ingested_files?.file_name ?? null,
        };
      }
      return {
        eventTime: row.created_at,
        externalCardReference: row.external_card_reference,
        fileName: row.ingested_files?.file_name ?? null,
      };
    },
  );

  return { tsysRows, bitAddictRows, error: null };
}
